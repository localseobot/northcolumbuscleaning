// Aggregates the past week's business activity from GHL into a shape
// the digest template consumes. Used by both the Monday cron and the
// manual preview endpoint.

import { ghl } from "./ghl.js";
import {
  OPP_QUOTED_PRICE,
  OPP_SERVICE_TYPE,
  OPP_FREQUENCY,
  OPP_APPOINTMENT_DATE,
} from "./ghl-fields.js";

const SALES_PIPELINE_ID = "6YDehH2kNtHrdfJaEQfa";
const STAGE_BOOKED = "a1df2c52-9211-4e13-a920-0c17ab00eff9";
const STAGE_WON_ONE_TIME = "9253419b-4c69-4f61-814b-ee27cd165f7a";
const STAGE_RECURRING =
  process.env.STAGE_RECURRING_ID || "24ef9398-abc2-472d-9f35-59b1d8a8f4f6";
const STAGE_LOST = "7eaafc3f-ab36-4ebe-b2c2-c64ab998897d";

function getCf(cfs, id) {
  if (!Array.isArray(cfs)) return null;
  const f = cfs.find((c) => c.id === id);
  if (!f) return null;
  return (
    f.fieldValueString ||
    f.fieldValueNumber ||
    (f.fieldValueDate ? new Date(f.fieldValueDate).toISOString() : null) ||
    f.fieldValue ||
    null
  );
}

function lower(v) {
  return String(v || "").toLowerCase();
}

async function fetchOpps({ stageId, status, limit = 200 }) {
  const res = await ghl({
    method: "POST",
    path: "/opportunities/search",
    body: {
      location_id: process.env.GHL_LOCATION_ID,
      pipeline_id: SALES_PIPELINE_ID,
      pipeline_stage_id: stageId,
      status,
      limit,
      getCustomFields: true,
    },
  }).catch(() => ({ opportunities: [] }));
  return res?.opportunities || [];
}

async function getContactSnapshot(contactId) {
  if (!contactId) return null;
  const r = await ghl({ method: "GET", path: `/contacts/${contactId}` }).catch(() => null);
  return r?.contact || null;
}

function inWindow(iso, fromMs, toMs) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= fromMs && t < toMs;
}

function customerNameFromContact(c) {
  if (!c) return "(unknown)";
  return (
    [c.firstNameRaw, c.lastNameRaw].filter(Boolean).join(" ") ||
    [c.firstName, c.lastName].filter(Boolean).join(" ") ||
    c.contactName ||
    "(unknown)"
  );
}

/**
 * Build the data payload for the digest template, covering the window
 * [weekStartMs, weekEndMs). Pulls the prior 7 days too for delta calc.
 *
 * @param {object} opts
 * @param {Date} opts.weekStart  Start of current window (inclusive)
 * @param {Date} opts.weekEnd    End of current window (exclusive)
 */
export async function gatherWeeklyDigestData({ weekStart, weekEnd }) {
  const weekStartMs = weekStart.getTime();
  const weekEndMs = weekEnd.getTime();
  const prevStartMs = weekStartMs - 7 * 86400000;
  const prevEndMs = weekStartMs;

  // Pull all relevant opps in parallel
  const [wonOneTime, wonRecurring, lost, booked] = await Promise.all([
    fetchOpps({ stageId: STAGE_WON_ONE_TIME, status: "won" }),
    fetchOpps({ stageId: STAGE_RECURRING, status: "won" }),
    fetchOpps({ stageId: STAGE_LOST, status: "lost" }),
    fetchOpps({ stageId: STAGE_BOOKED, status: "open" }),
  ]);

  // ── Current-week metrics ────────────────────────────────────────
  const wonThisWeek = [...wonOneTime, ...wonRecurring].filter((o) =>
    inWindow(o.lastStatusChangeAt, weekStartMs, weekEndMs),
  );
  const wonLastWeek = [...wonOneTime, ...wonRecurring].filter((o) =>
    inWindow(o.lastStatusChangeAt, prevStartMs, prevEndMs),
  );

  const lostThisWeek = lost.filter((o) =>
    inWindow(o.lastStatusChangeAt, weekStartMs, weekEndMs),
  );
  const lostLastWeek = lost.filter((o) =>
    inWindow(o.lastStatusChangeAt, prevStartMs, prevEndMs),
  );

  const bookedThisWeek = booked.filter((o) =>
    inWindow(o.createdAt || o.lastStatusChangeAt, weekStartMs, weekEndMs),
  );
  const bookedLastWeek = booked.filter((o) =>
    inWindow(o.createdAt || o.lastStatusChangeAt, prevStartMs, prevEndMs),
  );

  // Revenue = sum of monetaryValue (or Quoted Price custom field as fallback) on Won opps
  const revenue = (week) =>
    week.reduce((sum, o) => {
      const v = o.monetaryValue || Number(getCf(o.customFields, OPP_QUOTED_PRICE)) || 0;
      return sum + Number(v);
    }, 0);
  const currRevenue = revenue(wonThisWeek);
  const prevRevenue = revenue(wonLastWeek);
  const avgTicket = wonThisWeek.length ? currRevenue / wonThisWeek.length : 0;
  const avgTicketPrev = wonLastWeek.length ? prevRevenue / wonLastWeek.length : 0;

  // Build "completed jobs" rows (we hydrate customer names below)
  const completedJobsRaw = wonThisWeek;
  const completedJobs = await Promise.all(
    completedJobsRaw.map(async (o) => {
      const c = await getContactSnapshot(o.contactId);
      const svcType = getCf(o.customFields, OPP_SERVICE_TYPE);
      const freq = getCf(o.customFields, OPP_FREQUENCY);
      const price =
        o.monetaryValue || Number(getCf(o.customFields, OPP_QUOTED_PRICE)) || 0;
      return {
        completedAt: o.lastStatusChangeAt,
        customerName: customerNameFromContact(c),
        serviceType: svcType,
        frequency: freq,
        value: Number(price),
        oppId: o.id,
      };
    }),
  );
  completedJobs.sort(
    (a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime(),
  );

  // ── Watch list: same-day cancels + negative feedback this week ──
  const watchlist = [];
  for (const o of lostThisWeek) {
    const c = await getContactSnapshot(o.contactId);
    if (!c) continue;
    const tags = (c.tags || []).map(lower);
    const sameDay = tags.includes("same-day-cancel");
    const name = customerNameFromContact(c);
    if (sameDay) {
      watchlist.push(
        `${name} — same-day cancel (consider charging fee or following up to retain)`,
      );
    }
    if (tags.includes("feedback:negative") || tags.includes("needs-recovery")) {
      watchlist.push(`${name} — left negative feedback; needs personal follow-up`);
    }
  }

  // ── Wins: recurring conversions this week ───────────────────────
  const wins = [];
  for (const o of wonThisWeek) {
    if (o.pipelineStageId === STAGE_RECURRING) {
      const c = await getContactSnapshot(o.contactId);
      const name = customerNameFromContact(c);
      const freq = getCf(o.customFields, OPP_FREQUENCY) || "recurring";
      wins.push(
        `${name} moved to recurring (${freq}) — projected LTV +${
          Math.round((o.monetaryValue || 0) * 24)
        } over 2 years`,
      );
    }
  }
  // Cap wins to top 5 so the digest stays scannable
  if (wins.length > 5) wins.splice(5);

  // ── Reviews requested this week (proxy: contacts updated with the tag) ──
  // We don't have a per-event audit log so we just count contacts that have
  // the review-request-sent tag AND were updated this week. Imperfect but
  // useful as a trend indicator.
  let reviewsRequested = 0;
  try {
    const search = await ghl({
      method: "POST",
      path: "/contacts/search",
      body: {
        locationId: process.env.GHL_LOCATION_ID,
        pageLimit: 100,
        filters: [
          { field: "tags", operator: "contains", value: "review-request-sent" },
        ],
        sort: [{ field: "dateUpdated", direction: "desc" }],
      },
    });
    reviewsRequested = (search?.contacts || []).filter((c) =>
      inWindow(c.dateUpdated, weekStartMs, weekEndMs),
    ).length;
  } catch {}

  // Same-day cancellation count
  const sameDayCancellations = await (async () => {
    let count = 0;
    for (const o of lostThisWeek) {
      const c = await getContactSnapshot(o.contactId);
      if (!c) continue;
      const tags = (c.tags || []).map(lower);
      if (tags.includes("same-day-cancel")) count++;
    }
    return count;
  })();

  return {
    weekStart: weekStart.toISOString(),
    weekEnd: weekEnd.toISOString(),
    curr: {
      revenue: currRevenue,
      jobsCompleted: wonThisWeek.length,
      newBookings: bookedThisWeek.length,
      newRecurring: wonThisWeek.filter((o) => o.pipelineStageId === STAGE_RECURRING)
        .length,
      cancellations: lostThisWeek.length,
      sameDayCancellations,
      avgTicket,
      reviewsRequested,
    },
    prev: {
      revenue: prevRevenue,
      jobsCompleted: wonLastWeek.length,
      newBookings: bookedLastWeek.length,
      cancellations: lostLastWeek.length,
      avgTicket: avgTicketPrev,
    },
    completedJobs,
    wins,
    watchlist,
  };
}
