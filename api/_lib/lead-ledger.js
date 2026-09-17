// The lead ledger — the record of every lead we sell, and the one place that
// decides what a lead is worth.
//
// There is no database. GoHighLevel is the system of record, and the ledger
// maps cleanly onto what GHL already stores, at the grain each fact belongs to:
//
//   * A lead is an OPPORTUNITY in the Sales Pipeline. One call or one form
//     submission = one opportunity = one line on the buyer's dashboard.
//   * The lead's OUTCOME (did the buyer win the job?) is the opportunity's
//     native status + stage. Per-lead, and it keeps GHL's own reporting honest.
//   * BILLING state (is this person a repeat? did we credit them?) lives in
//     CONTACT tags. Billing is a fact about a person, not about one enquiry —
//     the same caller twice in a month is one billable lead, not two.
//
// Using tags rather than custom fields is deliberate: tags need no provisioning
// in the GHL UI, so this ships without anyone clicking through settings first.

import { ghl } from "./ghl.js";
import { getPricing } from "./buyer.js";
import { OPP_SERVICE_TYPE, OPP_QUOTED_PRICE, OPP_LEAD_SOURCE } from "./ghl-fields.js";

// ── Pipeline + stages (GHL → Opportunities → Sales Pipeline) ───────────────
export const SALES_PIPELINE_ID = "6YDehH2kNtHrdfJaEQfa";

export const STAGES = {
  new: "4bb733e7-d38d-4cb0-afb8-512406509144",
  contacted: "06cf319d-8de6-4c09-82dd-dcc5b823c682",
  quoted: "e426851f-65f6-4bfe-8fe0-66b93a1309df",
  booked: "a1df2c52-9211-4e13-a920-0c17ab00eff9",
  won: "9253419b-4c69-4f61-814b-ee27cd165f7a",
  lost: "7eaafc3f-ab36-4ebe-b2c2-c64ab998897d",
};

// ── Tags ──────────────────────────────────────────────────────────────────
export const TAG = {
  delivered: "lead:delivered",
  web: "lead:web",
  phone: "lead:phone",
  duplicate: "lead:duplicate",
  credited: "lead:credited",
  test: "lead:test",
  disputeOpen: "dispute:open",
  disputeApproved: "dispute:approved",
  disputeDenied: "dispute:denied",
};

// Buyer is in Columbus, OH. "Today" on the dashboard means their local day.
export const BUYER_TIMEZONE = "America/New_York";

export function localDayKey(iso, timeZone = BUYER_TIMEZONE) {
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Delivered but free: duplicates, credits, and labeled TEST / demo seeds. */
export function leadIsBillable(tags) {
  const list = Array.isArray(tags) ? tags.map((t) => String(t).toLowerCase()) : [];
  return !list.includes(TAG.duplicate) && !list.includes(TAG.credited) && !list.includes(TAG.test);
}

const CHANNEL_TAG = { web: TAG.web, phone: TAG.phone };

// Outcomes the buyer can set, mapped onto GHL's native opportunity state.
// "abandoned" is GHL's own status for a lead that went nowhere without being
// actively lost — exactly what "never picked up" means.
const OUTCOMES = {
  new: { status: "open", stage: STAGES.new, label: "New" },
  contacted: { status: "open", stage: STAGES.contacted, label: "Contacted" },
  quoted: { status: "open", stage: STAGES.quoted, label: "Quoted" },
  booked: { status: "open", stage: STAGES.booked, label: "Booked" },
  won: { status: "won", stage: STAGES.won, label: "Won" },
  lost: { status: "lost", stage: STAGES.lost, label: "Lost" },
  no_answer: { status: "abandoned", stage: STAGES.new, label: "No answer" },
};

export const OUTCOME_KEYS = Object.keys(OUTCOMES);

function s(v) {
  return v === null || v === undefined ? "" : String(v).trim();
}

function cf(id, value) {
  return { id, field_value: value };
}

function getCf(cfs, id) {
  if (!Array.isArray(cfs)) return null;
  const f = cfs.find((c) => c.id === id);
  if (!f) return null;
  return f.fieldValueString || f.fieldValueNumber || f.fieldValue || null;
}

// Reverse the outcome map: given an opportunity's status + stage, say what the
// buyer last marked it. Status wins — a won/lost opp is unambiguous — and the
// stage only disambiguates the several "open" states.
function readOutcome(opp) {
  const status = s(opp?.status).toLowerCase();
  if (status === "won") return "won";
  if (status === "lost") return "lost";
  if (status === "abandoned") return "no_answer";
  const stage = s(opp?.pipelineStageId);
  for (const key of ["booked", "quoted", "contacted"]) {
    if (stage === OUTCOMES[key].stage) return key;
  }
  return "new";
}

export function outcomeLabel(key) {
  return OUTCOMES[key]?.label || "New";
}

// ── Tag helpers ───────────────────────────────────────────────────────────

async function addTags(contactId, tags) {
  const list = tags.filter(Boolean);
  if (!contactId || !list.length) return;
  await ghl({
    method: "POST",
    path: `/contacts/${contactId}/tags`,
    body: { tags: list },
  });
}

async function removeTags(contactId, tags) {
  const list = tags.filter(Boolean);
  if (!contactId || !list.length) return;
  // Removing a tag the contact doesn't carry is a 4xx in GHL, and it is never
  // worth failing the caller's request over.
  await ghl({
    method: "DELETE",
    path: `/contacts/${contactId}/tags`,
    body: { tags: list },
  }).catch(() => {});
}

async function addNote(contactId, body) {
  if (!contactId || !body) return;
  await ghl({
    method: "POST",
    path: `/contacts/${contactId}/notes`,
    body: { body },
  }).catch(() => {});
}

// ── Dedupe ────────────────────────────────────────────────────────────────

/**
 * Has this contact already produced a lead inside the dedupe window?
 *
 * The buyer should never pay twice because one homeowner filled in the form
 * and then rang the number ten minutes later. We still deliver the second
 * touch — it may carry new information — we just don't bill it.
 */
async function hasRecentLead(contactId, withinDays, excludeOpportunityId) {
  if (!contactId || !withinDays) return false;
  const cutoff = Date.now() - withinDays * 86400000;
  const res = await ghl({
    method: "POST",
    path: "/opportunities/search",
    body: {
      location_id: process.env.GHL_LOCATION_ID,
      pipeline_id: SALES_PIPELINE_ID,
      contact_id: contactId,
      limit: 20,
    },
  }).catch(() => null);
  const opps = res?.opportunities || [];
  return opps.some((o) => {
    // Callers that created the opportunity themselves (the call webhook does)
    // must not have it counted as a prior lead against itself.
    if (excludeOpportunityId && o.id === excludeOpportunityId) return false;
    const t = new Date(o.createdAt || 0).getTime();
    return Number.isFinite(t) && t >= cutoff;
  });
}

// ── Recording a lead ──────────────────────────────────────────────────────

/**
 * Record a lead and return the ledger entry.
 *
 * Callers that have already upserted the contact and created the opportunity
 * (the GHL call webhook does both) pass `contactId` / `opportunityId` and this
 * only applies ledger state. Callers starting from raw form input (the website)
 * leave them out and this creates both.
 *
 * @param {object} o
 * @param {"web"|"phone"} o.channel
 * @param {string} [o.contactId]      Existing GHL contact, if the caller made one
 * @param {string} [o.opportunityId]  Existing GHL opportunity, if the caller made one
 * @param {string} [o.name]
 * @param {string} [o.email]
 * @param {string} [o.phone]
 * @param {string} [o.service]        Canonical service type
 * @param {string} [o.detail]         Free text from the visitor / call summary
 * @param {number} [o.value]          Estimated job value, for the opportunity
 * @param {string} [o.sourceLabel]    Human-readable source for GHL's Source field
 * @param {string} [o.leadSource]     Opportunity Source dropdown value (must match GHL)
 * @returns {Promise<{ok, leadId, contactId, billable, duplicate, error?}>}
 */
export async function recordLead(o) {
  const pricing = getPricing();
  const channel = o.channel === "phone" ? "phone" : "web";
  const out = { ok: false, leadId: null, contactId: o.contactId || null, billable: false, duplicate: false };

  if (!process.env.GHL_PIT) {
    out.error = "GHL_PIT not set";
    return out;
  }

  // 1. Contact — upsert unless the caller already has one. GHL matches on
  //    email/phone, so a returning visitor lands on their existing record.
  if (!out.contactId) {
    const name = s(o.name);
    const space = name.indexOf(" ");
    try {
      const upsert = await ghl({
        method: "POST",
        path: "/contacts/upsert",
        body: {
          locationId: process.env.GHL_LOCATION_ID,
          email: s(o.email) || undefined,
          phone: s(o.phone) || undefined,
          firstName: (space > 0 ? name.slice(0, space) : name) || undefined,
          lastName: space > 0 ? name.slice(space + 1) : undefined,
          country: "US",
          source: o.sourceLabel || (channel === "web" ? "Website — quote form" : "Inbound call"),
        },
      });
      out.contactId = upsert?.contact?.id || upsert?.id || null;
    } catch (e) {
      out.error = `contact upsert failed: ${e.message}`;
      return out;
    }
  }
  if (!out.contactId) {
    out.error = "no contactId";
    return out;
  }

  // 2. Dedupe BEFORE creating this lead's opportunity, so the window check
  //    doesn't trip over the row we're about to write.
  out.duplicate = await hasRecentLead(out.contactId, pricing.dedupeDays, o.opportunityId);
  out.billable = !out.duplicate;

  // 3. Opportunity — the lead itself.
  out.leadId = o.opportunityId || null;
  if (!out.leadId) {
    const customFields = [];
    if (o.service) customFields.push(cf(OPP_SERVICE_TYPE, o.service));
    if (o.value) customFields.push(cf(OPP_QUOTED_PRICE, String(o.value)));
    customFields.push(
      cf(OPP_LEAD_SOURCE, o.leadSource || (channel === "web" ? "Web form" : "Other")),
    );
    try {
      const opp = await ghl({
        method: "POST",
        path: "/opportunities/",
        body: {
          pipelineId: SALES_PIPELINE_ID,
          pipelineStageId: STAGES.new,
          locationId: process.env.GHL_LOCATION_ID,
          contactId: out.contactId,
          name: s(o.name) || s(o.phone) || s(o.email) || "New lead",
          status: "open",
          monetaryValue: Number(o.value) || 0,
          customFields,
        },
      });
      out.leadId = opp?.opportunity?.id || opp?.id || null;
    } catch (e) {
      // A lead we can't file as an opportunity is still a lead: the contact
      // exists and the buyer alert still fires. Surface the error, don't throw.
      out.error = `opportunity create failed: ${e.message}`;
    }
  }

  // 4. Ledger tags + an audit note.
  await addTags(out.contactId, [
    TAG.delivered,
    CHANNEL_TAG[channel],
    out.duplicate ? TAG.duplicate : null,
  ]).catch(() => {});

  const priceNote = out.billable
    ? pricing.mode === "per_lead"
      ? `Billable — $${pricing.perLead}`
      : "Billable — counts toward the monthly allowance"
    : `Not billable — repeat contact inside ${pricing.dedupeDays} days`;

  await addNote(
    out.contactId,
    [
      `LEAD DELIVERED (${channel === "web" ? "website form" : "phone call"})`,
      `When: ${new Date().toISOString()}`,
      o.detail ? `Detail: ${s(o.detail)}` : null,
      priceNote,
    ]
      .filter(Boolean)
      .join("\n"),
  );

  out.ok = true;
  return out;
}

// ── Reading the ledger ────────────────────────────────────────────────────

function tagsOf(contact) {
  const raw = contact?.tags;
  if (!Array.isArray(raw)) return [];
  return raw.map((t) => String(t).toLowerCase());
}

/**
 * Turn a GHL opportunity (+ its contact) into the shape the dashboard renders.
 * Deliberately excludes anything the buyer has no business seeing — internal
 * notes, recording URLs, GHL ids beyond the one needed to act on the lead.
 */
function toLead(opp, contact) {
  const tags = tagsOf(contact);
  const disputeState = tags.includes(TAG.disputeApproved)
    ? "approved"
    : tags.includes(TAG.disputeDenied)
      ? "denied"
      : tags.includes(TAG.disputeOpen)
        ? "open"
        : null;

  // Credited, duplicate, and TEST / demo leads are delivered but free.
  const billable = leadIsBillable(tags);

  const channel = tags.includes(TAG.phone) && !tags.includes(TAG.web)
    ? "phone"
    : tags.includes(TAG.web)
      ? "web"
      : s(getCf(opp.customFields, OPP_LEAD_SOURCE)).toLowerCase().includes("call")
        ? "phone"
        : "web";

  const outcome = readOutcome(opp);

  return {
    id: opp.id,
    receivedAt: opp.createdAt || null,
    channel,
    name: opp.name || contact?.contactName || "(no name)",
    phone: contact?.phone || null,
    email: contact?.email || null,
    service: getCf(opp.customFields, OPP_SERVICE_TYPE) || null,
    estimatedValue: Number(opp.monetaryValue) || null,
    outcome,
    outcomeLabel: outcomeLabel(outcome),
    billable,
    duplicate: tags.includes(TAG.duplicate),
    credited: tags.includes(TAG.credited),
    test: tags.includes(TAG.test),
    dispute: disputeState,
  };
}

/**
 * Every lead in the ledger, newest first.
 *
 * One search call, then one contact fetch per distinct contact that the search
 * didn't already embed. At ten leads a month this stays well inside a single
 * serverless invocation.
 *
 * @param {object} [o]
 * @param {number} [o.limit]  Max leads to return. Default 250.
 */
export async function listLeads({ limit = 250 } = {}) {
  const res = await ghl({
    method: "POST",
    path: "/opportunities/search",
    body: {
      location_id: process.env.GHL_LOCATION_ID,
      pipeline_id: SALES_PIPELINE_ID,
      limit,
      getCustomFields: true,
    },
  });
  const opps = res?.opportunities || [];

  // GHL usually embeds the contact on search results, but not always, and not
  // always with tags. Fetch the ones we're missing, once each.
  const cache = new Map();
  for (const o of opps) {
    if (o.contact?.id && Array.isArray(o.contact.tags)) cache.set(o.contact.id, o.contact);
  }
  const missing = [...new Set(opps.map((o) => o.contactId).filter((id) => id && !cache.has(id)))];
  await Promise.all(
    missing.map(async (id) => {
      const r = await ghl({ method: "GET", path: `/contacts/${id}` }).catch(() => null);
      if (r?.contact) cache.set(id, r.contact);
    }),
  );

  return opps
    .map((o) => ({ opp: o, contact: cache.get(o.contactId) || o.contact || null }))
    // Only leads we actually delivered belong on the buyer's dashboard. An
    // opportunity someone created by hand in GHL isn't something anyone bought.
    .filter(({ contact }) => tagsOf(contact).includes(TAG.delivered))
    .map(({ opp, contact }) => toLead(opp, contact))
    .sort((a, b) => new Date(b.receivedAt || 0) - new Date(a.receivedAt || 0));
}

/** One lead, with the notes trail attached. Used when the buyer expands a row. */
export async function getLead(leadId) {
  const r = await ghl({ method: "GET", path: `/opportunities/${leadId}` }).catch(() => null);
  const opp = r?.opportunity || r;
  if (!opp?.id) return null;

  const c = await ghl({ method: "GET", path: `/contacts/${opp.contactId}` }).catch(() => null);
  const contact = c?.contact || null;

  const notesRes = await ghl({
    method: "GET",
    path: `/contacts/${opp.contactId}/notes`,
  }).catch(() => null);
  const notes = (notesRes?.notes || [])
    .map((n) => ({ at: n.dateAdded || n.createdAt || null, body: String(n.body || "") }))
    .sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));

  return { ...toLead(opp, contact), notes };
}

// ── Writing back what the buyer says happened ─────────────────────────────

/**
 * Record the buyer's outcome for a lead by moving the underlying opportunity.
 * @param {string} leadId
 * @param {keyof OUTCOMES} outcome
 */
export async function setOutcome(leadId, outcome) {
  const target = OUTCOMES[outcome];
  if (!target) throw new Error(`unknown outcome: ${outcome}`);

  await ghl({
    method: "PUT",
    path: `/opportunities/${leadId}`,
    body: {
      pipelineId: SALES_PIPELINE_ID,
      pipelineStageId: target.stage,
      status: target.status,
    },
  });

  const opp = await ghl({ method: "GET", path: `/opportunities/${leadId}` }).catch(() => null);
  const contactId = (opp?.opportunity || opp)?.contactId;
  await addNote(contactId, `Buyer marked this lead: ${target.label}`);

  return { ok: true, outcome, label: target.label };
}

/**
 * The buyer flags a lead as bad — wrong number, spam, outside the service
 * area, or someone who never asked to be contacted.
 *
 * Filing a dispute does NOT credit it. It opens the question and marks the
 * lead as disputed on the dashboard; we review and resolve it with
 * resolveDispute(). Deciding your own refunds isn't a dispute process.
 */
export async function fileDispute(leadId, reason) {
  const opp = await ghl({ method: "GET", path: `/opportunities/${leadId}` }).catch(() => null);
  const contactId = (opp?.opportunity || opp)?.contactId;
  if (!contactId) throw new Error("lead not found");

  await removeTags(contactId, [TAG.disputeApproved, TAG.disputeDenied]);
  await addTags(contactId, [TAG.disputeOpen]);
  await addNote(
    contactId,
    `DISPUTE FILED by buyer\nReason: ${s(reason) || "(none given)"}\nWhen: ${new Date().toISOString()}`,
  );

  return { ok: true, dispute: "open" };
}

/**
 * We resolve a dispute. Approving it credits the lead — it stops being
 * billable, on this month's invoice and in the cost-per-lead the buyer sees.
 *
 * @param {string} leadId
 * @param {"approved"|"denied"} decision
 * @param {string} [note]
 */
export async function resolveDispute(leadId, decision, note) {
  const opp = await ghl({ method: "GET", path: `/opportunities/${leadId}` }).catch(() => null);
  const contactId = (opp?.opportunity || opp)?.contactId;
  if (!contactId) throw new Error("lead not found");

  const approved = decision === "approved";
  await removeTags(contactId, [TAG.disputeOpen, TAG.disputeApproved, TAG.disputeDenied]);
  await addTags(contactId, [
    approved ? TAG.disputeApproved : TAG.disputeDenied,
    approved ? TAG.credited : null,
  ]);
  await addNote(
    contactId,
    `DISPUTE ${approved ? "APPROVED — lead credited, not billable" : "DENIED — lead stands"}\n${s(note)}`,
  );

  return { ok: true, dispute: approved ? "approved" : "denied", credited: approved };
}

/** Group leads into calendar months (newest first), keyed "YYYY-MM". */
export function groupByMonth(leads) {
  const months = new Map();
  for (const l of leads) {
    if (!l.receivedAt) continue;
    const d = new Date(l.receivedAt);
    if (Number.isNaN(d.getTime())) continue;
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    if (!months.has(key)) months.set(key, []);
    months.get(key).push(l);
  }
  return [...months.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}

const TEST_SEEDS = [
  {
    channel: "web",
    name: "TEST Web Lead",
    email: "test+dashboard.web@northcolumbuscleaning.com",
    detail: "TEST / demo seed so the buyer dashboard is not empty. Not a real job.",
    sourceLabel: "TEST seed",
    leadSource: "Web form",
  },
  {
    channel: "phone",
    name: "TEST Phone Lead",
    email: "test+dashboard.phone@northcolumbuscleaning.com",
    detail: "TEST / demo seed (phone). Not a real job.",
    sourceLabel: "TEST seed",
    leadSource: "Other",
  },
];

function inferChannel(opp, contact) {
  const tags = tagsOf(contact);
  if (tags.includes(TAG.phone) && !tags.includes(TAG.web)) return "phone";
  if (tags.includes(TAG.web)) return "web";
  const source = s(getCf(opp?.customFields, OPP_LEAD_SOURCE)).toLowerCase();
  if (source.includes("call") || source.includes("phone")) return "phone";
  return "web";
}

function looksLikeTest(opp, contact) {
  const blob = [
    opp?.name,
    contact?.contactName,
    contact?.firstName,
    contact?.lastName,
    contact?.email,
    contact?.source,
  ]
    .map((v) => s(v).toLowerCase())
    .join(" ");
  return /\btest\b|\bdemo\b/.test(blob);
}

async function loadSalesOpportunities({ limit = 250 } = {}) {
  const res = await ghl({
    method: "POST",
    path: "/opportunities/search",
    body: {
      locationId: process.env.GHL_LOCATION_ID,
      pipelineId: SALES_PIPELINE_ID,
      limit,
      getCustomFields: true,
    },
  });
  const opps = res?.opportunities || [];
  const cache = new Map();
  for (const o of opps) {
    if (o.contact?.id && Array.isArray(o.contact.tags)) cache.set(o.contact.id, o.contact);
  }
  const missing = [...new Set(opps.map((o) => o.contactId).filter((id) => id && !cache.has(id)))];
  await Promise.all(
    missing.map(async (id) => {
      const r = await ghl({ method: "GET", path: `/contacts/${id}` }).catch(() => null);
      if (r?.contact) cache.set(id, r.contact);
    }),
  );
  return opps.map((o) => ({ opp: o, contact: cache.get(o.contactId) || o.contact || null }));
}

function summarizeRow(opp, contact) {
  const tags = tagsOf(contact);
  return {
    id: opp?.id || null,
    contactId: opp?.contactId || contact?.id || null,
    name: opp?.name || contact?.contactName || "(no name)",
    email: contact?.email || null,
    phone: contact?.phone || null,
    receivedAt: opp?.createdAt || null,
    delivered: tags.includes(TAG.delivered),
    test: tags.includes(TAG.test),
  };
}

/**
 * Today's Sales Pipeline opportunities (buyer-local day) and whether each
 * already carries `lead:delivered`. Used to put inbound test activity on
 * `/dashboard` without inventing rows when real GHL opportunities exist.
 *
 * @param {object} [o]
 * @param {string} [o.day]              YYYY-MM-DD in America/New_York. Default today.
 * @param {boolean} [o.dryRun]          Preview only. Default true.
 * @param {boolean} [o.markTest]        Tag backfilled / seeded rows `lead:test` (not billed). Default true.
 * @param {boolean} [o.createTestIfEmpty] Seed 2 labeled TEST leads if today has no sales opps.
 */
export async function backfillTodayLeads({
  day = localDayKey(new Date()),
  dryRun = true,
  markTest = true,
  createTestIfEmpty = false,
} = {}) {
  const rows = await loadSalesOpportunities({ limit: 250 });
  const todayRows = rows.filter(({ opp }) => localDayKey(opp?.createdAt) === day);

  const existing = todayRows.map(({ opp, contact }) => {
    const summary = summarizeRow(opp, contact);
    const shouldMarkTest = markTest || looksLikeTest(opp, contact);
    return {
      ...summary,
      action: summary.delivered ? "already_on_dashboard" : dryRun ? "would_tag" : "pending",
      markTest: shouldMarkTest,
    };
  });

  const out = {
    ok: true,
    day,
    timezone: BUYER_TIMEZONE,
    dryRun,
    found: existing.length,
    alreadyOnDashboard: existing.filter((r) => r.delivered).length,
    missing: existing.filter((r) => !r.delivered).length,
    results: existing,
    seeded: [],
  };

  if (dryRun) {
    if (!todayRows.length && createTestIfEmpty) {
      out.seeded = TEST_SEEDS.map((seed) => ({
        action: "would_seed",
        name: seed.name,
        email: seed.email,
        channel: seed.channel,
        markTest: true,
      }));
    }
    return out;
  }

  for (const row of todayRows) {
    const item = existing.find((r) => r.id === row.opp.id);
    if (!item || item.delivered) continue;
    const recorded = await recordLead({
      channel: inferChannel(row.opp, row.contact),
      contactId: row.opp.contactId || row.contact?.id,
      opportunityId: row.opp.id,
      name: item.name,
      email: item.email || undefined,
      phone: item.phone || undefined,
      detail: "Backfilled onto the buyer dashboard from today's inbound / test activity.",
    });
    if (item.markTest && recorded.contactId) {
      await addTags(recorded.contactId, [TAG.test]).catch(() => {});
    }
    item.action = recorded.ok ? "tagged" : "failed";
    item.leadId = recorded.leadId || row.opp.id;
    item.error = recorded.error || null;
  }

  if (!todayRows.length && createTestIfEmpty) {
    for (const seed of TEST_SEEDS) {
      const recorded = await recordLead(seed);
      if (recorded.contactId) {
        await addTags(recorded.contactId, [TAG.test]).catch(() => {});
      }
      out.seeded.push({
        action: recorded.ok ? "seeded" : "failed",
        name: seed.name,
        email: seed.email,
        channel: seed.channel,
        leadId: recorded.leadId,
        contactId: recorded.contactId,
        markTest: true,
        error: recorded.error || null,
      });
    }
  }

  return out;
}
