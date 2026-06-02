// Retell AI post-call webhook — syncs call data into GoHighLevel + manager SMS.
//
// On every Retell call_analyzed event, this handler:
//   1. Upserts the caller as a contact in GHL (matched by phone)
//   2. Applies cleaning-business tags from the structured analysis
//      (source:maya, inbound-call, intent:*, service:*, frequency:*, sms-consent:*)
//   3. Adds a contact note with summary, sentiment, callback window, SMS consent,
//      recording URL, key property details, AND an auto-computed quote (when
//      service + sqft are sufficient). Taylor never quotes out loud — the team
//      does, using this note as a starting point.
//   4. Creates an opportunity in Sales Pipeline → New Lead for any
//      booking/quote intent — the team takes it from there (Quoted, Booked, etc.)
//   5. Auto-texts the caller from the GHL number (only if sms_consent === "yes")
//      with a confirmation + SLA promise
//   6. Texts the office manager a recap from the GHL number
//      (lands in the team's GHL conversations inbox)
//   7. Posts a rich Slack block to the configured channel (when
//      SLACK_WEBHOOK_URL is set) with deep links to GHL + recording
//
// call_started / call_ended events are acknowledged and ignored — only
// call_analyzed has the structured custom_analysis_data populated.
//
// Environment variables (Vercel → Settings → Environment Variables):
//   GHL_PIT             — Private Integration Token (scoped to the sub-account)
//   GHL_LOCATION_ID     — Sub-account ID
//   GHL_FROM_NUMBER     — (optional) E.164 number for outbound SMS. If unset,
//                         GHL uses the location's default SMS-capable number.
//   GHL_ASSIGNED_USER_ID — (optional) GHL user ID to auto-assign new contacts
//                         and opportunities to. Defaults to North Columbus Admin.
//                         Assigned users get notified in GHL (bell + email + push).
//   MANAGER_PHONE       — owner/manager cell in E.164 (recap SMS recipient)
//   SLACK_WEBHOOK_URL   — (optional) Slack Incoming Webhook URL; if set,
//                         posts a rich call recap per call

import { ghl } from "./_lib/ghl.js";
import { sendGhlSms } from "./_lib/ghl-sms.js";
import { calculateQuote } from "./_lib/pricing.js";
import { buildCallBlocks, sendSlack } from "./_lib/slack.js";
import {
  OPP_SERVICE_TYPE,
  OPP_FREQUENCY,
  OPP_SQUARE_FOOTAGE,
  OPP_BEDROOMS,
  OPP_BATHROOMS,
  OPP_QUOTED_PRICE,
  OPP_LEAD_SOURCE,
  LEAD_SOURCE_OPTIONS,
  normalizeServiceType,
  normalizeFrequency,
  cf,
  cfArray,
} from "./_lib/ghl-fields.js";

export const config = { runtime: "nodejs" };

// Sales Pipeline + stage IDs (from GHL → Opportunities → Sales Pipeline).
// If you recreate the pipeline in GHL, pull the new IDs from
//   GET /opportunities/pipelines  and update these constants.
const SALES_PIPELINE_ID = "6YDehH2kNtHrdfJaEQfa";
const STAGE_NEW_LEAD = "4bb733e7-d38d-4cb0-afb8-512406509144";

// Default assignee for new contacts + opportunities. When set, the assigned
// user gets a GHL notification (bell + email + mobile push) for each new
// opportunity. Override at runtime with the GHL_ASSIGNED_USER_ID env var.
const DEFAULT_ASSIGNED_USER_ID = "gzWzHHYAIBmbcZExALq9"; // North Columbus Admin
const ASSIGNED_USER_ID =
  process.env.GHL_ASSIGNED_USER_ID || DEFAULT_ASSIGNED_USER_ID;
// Stage IDs kept here for the team's reference / future automations:
// Contacted        = 06cf319d-8de6-4c09-82dd-dcc5b823c682
// Quoted           = e426851f-65f6-4bfe-8fe0-66b93a1309df
// Booked           = a1df2c52-9211-4e13-a920-0c17ab00eff9
// Won — One Time   = 9253419b-4c69-4f61-814b-ee27cd165f7a
// Recurring        = 24ef9398-abc2-472d-9f35-59b1d8a8f4f6
// Lost             = 7eaafc3f-ab36-4ebe-b2c2-c64ab998897d

// Map Retell post-call analysis enums to GHL tag names.
const SERVICE_TAG = {
  regular: "service:residential",
  deep: "service:deep-clean",
  move_in_out: "service:move-in-out",
  commercial: "service:commercial",
  post_construction: "service:post-construction",
};
const FREQUENCY_TAG = {
  one_time: "frequency:one-time",
  weekly: "frequency:weekly",
  biweekly: "frequency:biweekly",
  monthly: "frequency:monthly",
};
const BOOKING_INTENTS = new Set(["booking", "quote_only"]);
const SMS_CONSENT_TAG = {
  yes: "sms-consent:yes",
  no: "sms-consent:no",
};

// Interpret Retell's sms_consent string permissively. The schema asks Retell
// to normalize to "yes" / "no" / "not_stated", but in practice callers say
// "yeah", "sure", "absolutely", "I'd rather not", etc. and the normalization
// isn't perfect. Treat a clear positive as consent UNLESS a negative is also
// present.
function interpretSmsConsent(raw) {
  const v = String(raw || "").toLowerCase().trim();
  if (!v || v === "not_stated") return { value: "not_stated", consented: false };
  const POSITIVE = /\b(yes|yeah|yep|sure|ok|okay|alright|fine|please|definitely|absolutely|agreed|sounds good|that works|go ahead)\b/;
  const NEGATIVE = /\b(no|nope|don'?t|do not|rather not|never|nah|no thanks|no thank you)\b/;
  const neg = NEGATIVE.test(v);
  const pos = POSITIVE.test(v);
  if (neg && !pos) return { value: "no", consented: false };
  if (pos) return { value: "yes", consented: true };
  // Falls through: unclear text → safer to NOT send (TCPA caution).
  return { value: v, consented: false };
}

// Map Retell's service_type enum to the pricing engine's service keys.
const SERVICE_TO_PRICING = {
  regular: "standard",
  deep: "deep",
  move_in_out: "move_in_out",
};

// Map Retell's frequency enum to the pricing engine's frequency keys.
// (They mostly already align — this is here as the explicit contract.)
const FREQUENCY_TO_PRICING = {
  one_time: "one_time",
  weekly: "weekly",
  biweekly: "biweekly",
  every_3_weeks: "every_3_weeks",
  monthly: "monthly",
};

/**
 * Compute a quote from Taylor's post-call analysis fields, if possible.
 * Returns { ok, total, summary, line } on success, or { ok: false, reason }
 * when the inputs aren't sufficient for an instant quote.
 */
function computeQuote(extracted) {
  const svc = SERVICE_TO_PRICING[s(extracted.service_type).toLowerCase()];
  if (!svc) {
    return {
      ok: false,
      reason:
        s(extracted.service_type).toLowerCase() === "commercial"
          ? "commercial — team prices each commercial job custom"
          : s(extracted.service_type).toLowerCase() === "post_construction"
            ? "post-construction — needs custom quote"
            : "service type unclear",
    };
  }
  const sqft = num(extracted.sqft);
  if (!sqft) return { ok: false, reason: "sqft not captured" };
  const freq = FREQUENCY_TO_PRICING[s(extracted.frequency).toLowerCase()] || "one_time";

  const q = calculateQuote({
    service: svc,
    sqft,
    frequency: freq,
    bedrooms: num(extracted.bedrooms),
    bathrooms: num(extracted.bathrooms),
  });
  if (!q.breakdown.base) {
    return {
      ok: false,
      reason:
        q.breakdown.flags[0] || "sqft outside standard pricing bands — custom quote",
    };
  }
  return {
    ok: true,
    total: q.breakdown.total,
    summary: q.summary,
    line:
      q.breakdown.discountPct > 0
        ? `Est. quote: $${q.breakdown.total.toFixed(2)}/visit ($${q.breakdown.base.toFixed(2)} base − ${(q.breakdown.discountPct * 100).toFixed(1)}% recurring)`
        : `Est. quote: $${q.breakdown.total.toFixed(2)}/visit`,
  };
}

function s(v) {
  if (v === null || v === undefined) return "";
  const out = String(v).trim();
  return out === "not_stated" || out === "0" ? "" : out;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function normalizePhone(raw) {
  if (!raw) return "";
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  if (String(raw).startsWith("+") && digits.length >= 10) return "+" + digits;
  return "";
}

function splitName(extracted, fallback) {
  let first = s(extracted.caller_first_name);
  let last = s(extracted.caller_last_name);
  if (!first && !last && fallback) {
    const parts = String(fallback).trim().split(/\s+/);
    first = parts[0] || "";
    last = parts.slice(1).join(" ");
  }
  return { firstName: first, lastName: last };
}

function buildTags(extracted) {
  const tags = ["source:maya", "inbound-call"];
  const intent = s(extracted.intent).toLowerCase();
  if (intent && intent !== "other") tags.push(`intent:${intent}`);
  const svc = s(extracted.service_type).toLowerCase();
  if (SERVICE_TAG[svc]) tags.push(SERVICE_TAG[svc]);
  const freq = s(extracted.frequency).toLowerCase();
  if (FREQUENCY_TAG[freq]) tags.push(FREQUENCY_TAG[freq]);
  // Use the same permissive interpretation we use for sending the SMS.
  const consent = interpretSmsConsent(extracted.sms_consent);
  if (consent.value === "yes" || consent.value === "no") {
    tags.push(SMS_CONSENT_TAG[consent.value]);
  }
  if (s(extracted.existing_customer).toLowerCase() === "yes") {
    tags.push("existing-customer");
  }
  // Surface call-quality flags as a tag so the operator can filter for review.
  const flags = s(extracted.call_quality_flags);
  if (flags) tags.push("needs-review");
  return tags;
}

function buildNote(call, extracted, quote) {
  const startedAt = call.start_timestamp
    ? new Date(call.start_timestamp).toISOString()
    : "";
  const durationSec = call.duration_ms ? Math.round(call.duration_ms / 1000) : 0;
  const summary = call.call_analysis?.call_summary || "";
  const sentiment = call.call_analysis?.user_sentiment || "";

  const lines = [
    `Inbound call via Taylor — ${startedAt}`,
    `Duration: ${durationSec}s`,
    `Intent: ${s(extracted.intent) || "(unknown)"}`,
  ];

  const svc = s(extracted.service_type);
  const freq = s(extracted.frequency);
  if (svc || freq) lines.push(`Service: ${[svc, freq].filter(Boolean).join(" / ")}`);

  const beds = num(extracted.bedrooms);
  const baths = num(extracted.bathrooms);
  const sqft = num(extracted.sqft);
  const pets = s(extracted.has_pets);
  const propParts = [];
  if (beds) propParts.push(`${beds}bd`);
  if (baths) propParts.push(`${baths}ba`);
  if (sqft) propParts.push(`${sqft}sqft`);
  if (pets) propParts.push(`pets: ${pets}`);
  if (propParts.length) lines.push(`Property: ${propParts.join(", ")}`);

  const addr = s(extracted.service_address);
  const zip = s(extracted.service_zip);
  const inArea = s(extracted.in_service_area);
  if (addr || zip || inArea) {
    const addrParts = [addr, zip].filter(Boolean).join(" ");
    const areaLabel = inArea ? ` (in service area: ${inArea})` : "";
    lines.push(`Address: ${addrParts}${areaLabel}`);
  }

  const callback = s(extracted.preferred_callback_window);
  if (callback) lines.push(`Preferred callback: ${callback}`);
  const sms = s(extracted.sms_consent);
  if (sms) lines.push(`SMS consent: ${sms}`);
  const existing = s(extracted.existing_customer);
  if (existing) lines.push(`Existing customer: ${existing}`);
  const flags = s(extracted.call_quality_flags);
  if (flags) lines.push(`⚠️ Call quality flags: ${flags}`);

  // Auto-computed quote (best-effort)
  if (quote) {
    if (quote.ok) {
      lines.push("");
      lines.push("--- Auto quote ---");
      lines.push(quote.line);
      lines.push(quote.summary);
    } else {
      lines.push(`Auto quote: pending (${quote.reason})`);
    }
  }

  const notes = s(extracted.special_notes);
  if (notes) lines.push(`Special notes: ${notes}`);

  if (sentiment) lines.push(`Sentiment: ${sentiment}`);

  if (summary) {
    lines.push("");
    lines.push("Summary:");
    lines.push(summary);
  }

  lines.push("");
  if (call.recording_url) lines.push(`Recording: ${call.recording_url}`);
  if (call.public_log_url) lines.push(`Call log: ${call.public_log_url}`);
  if (call.call_id) lines.push(`Call ID: ${call.call_id}`);

  return lines.join("\n");
}

function buildOpportunityName(extracted, firstName, lastName) {
  const name = [firstName, lastName].filter(Boolean).join(" ") || "Inbound caller";
  const svc = s(extracted.service_type);
  const svcLabel = {
    regular: "Regular clean",
    deep: "Deep clean",
    move_in_out: "Move-in/out",
    commercial: "Commercial",
    post_construction: "Post-construction",
  }[svc] || "Cleaning quote";
  return `${name} — ${svcLabel}`;
}

function buildCustomerConfirmation(firstName) {
  // Kept short on purpose — A2P-friendly, single message segment when possible.
  // First-name personalization falls back to "there" if Taylor didn't catch it.
  const name = firstName ? firstName.trim() : "there";
  return (
    `Hi ${name}! Thanks for calling North Columbus Cleaning. ` +
    `We've got your info — the team will reach out shortly to confirm pricing and find a time. ` +
    `Reply STOP to opt out.`
  );
}

function buildManagerRecap(call, extracted, quote) {
  const durationSec = call.duration_ms ? Math.round(call.duration_ms / 1000) : 0;
  const intent = s(extracted.intent) || "general";
  const name = [s(extracted.caller_first_name), s(extracted.caller_last_name)]
    .filter(Boolean)
    .join(" ");
  const phone = s(extracted.callback_number) || call.from_number || "";
  const svc = s(extracted.service_type);
  const freq = s(extracted.frequency);
  const beds = num(extracted.bedrooms);
  const baths = num(extracted.bathrooms);
  const sqft = num(extracted.sqft);
  const zip = s(extracted.service_zip);
  const inArea = s(extracted.in_service_area);
  const callback = s(extracted.preferred_callback_window);
  const sms = s(extracted.sms_consent);
  const summary = call.call_analysis?.call_summary || "";

  const lines = [
    `New call via Taylor (${durationSec}s) — ${intent}`,
    name ? `${name} • ${phone}` : phone,
  ];
  const svcLine = [svc, freq].filter(Boolean).join(" / ");
  if (svcLine) lines.push(`Service: ${svcLine}`);
  const propLine = [
    beds ? `${beds}bd` : "",
    baths ? `${baths}ba` : "",
    sqft ? `${sqft}sqft` : "",
  ]
    .filter(Boolean)
    .join(", ");
  if (propLine) lines.push(propLine);
  if (zip) lines.push(`Zip ${zip}${inArea ? ` (in area: ${inArea})` : ""}`);
  if (quote) {
    lines.push(quote.ok ? quote.line : `Quote: pending (${quote.reason})`);
  }
  if (callback) lines.push(`Callback: ${callback}`);
  if (sms) lines.push(`Text OK: ${sms}`);
  if (summary) {
    lines.push("");
    lines.push(summary);
  }
  return lines.join("\n").slice(0, 1500);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  let payload = req.body;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      return res.status(400).json({ error: "Invalid JSON" });
    }
  }

  const event = payload?.event;
  const call = payload?.call || {};
  const callId = call?.call_id;

  if (event !== "call_analyzed") {
    // Acknowledge call_started, call_ended, etc. without acting.
    return res.status(200).json({ ok: true, ignored: event });
  }

  const extracted = call?.call_analysis?.custom_analysis_data || {};
  const callerNumber = call?.from_number || "";

  const phone = normalizePhone(s(extracted.callback_number) || callerNumber);
  const { firstName, lastName } = splitName(extracted, "");
  const email = s(extracted.email).toLowerCase();
  const address1 = s(extracted.service_address);
  const postalCode = s(extracted.service_zip);

  // Compute the auto-quote once up front — used by both the GHL note and
  // the manager-recap SMS. Best-effort; falls back to a "pending" status
  // line when sqft/service isn't sufficient for a quote.
  const intentLower = s(extracted.intent).toLowerCase();
  const quote = BOOKING_INTENTS.has(intentLower) ? computeQuote(extracted) : null;

  const result = {
    ok: true,
    callId,
    ghl: {},
    quote: quote
      ? quote.ok
        ? { ok: true, total: quote.total }
        : { ok: false, reason: quote.reason }
      : { skipped: "non-booking intent" },
    customerSms: { attempted: false },
    managerSms: { attempted: false },
    slack: { attempted: false },
  };

  // --- 1. Upsert contact in GHL ---
  let contactId = null;
  if (process.env.GHL_PIT && phone) {
    try {
      const upsert = await ghl({
        method: "POST",
        path: "/contacts/upsert",
        body: {
          locationId: process.env.GHL_LOCATION_ID,
          phone,
          firstName,
          lastName,
          email: email || undefined,
          address1: address1 || undefined,
          postalCode: postalCode || undefined,
          country: "US",
          source: "Retell — Taylor (inbound call)",
          assignedTo: ASSIGNED_USER_ID,
        },
      });
      contactId = upsert?.contact?.id || upsert?.id || null;
      result.ghl.contactId = contactId;
      result.ghl.contactNew = upsert?.new ?? null;
    } catch (e) {
      result.ghl.upsertError = e.message;
    }
  } else if (!process.env.GHL_PIT) {
    result.ghl.skipped = "GHL_PIT not set";
  } else {
    result.ghl.skipped = "no caller phone";
  }

  // --- 2. Tags ---
  if (contactId) {
    const tags = buildTags(extracted);
    try {
      await ghl({
        method: "POST",
        path: `/contacts/${contactId}/tags`,
        body: { tags },
      });
      result.ghl.tags = tags;
    } catch (e) {
      result.ghl.tagsError = e.message;
    }
  }

  // --- 3. Contact note with summary + recording link + auto-quote ---
  if (contactId) {
    try {
      const note = buildNote(call, extracted, quote);
      await ghl({
        method: "POST",
        path: `/contacts/${contactId}/notes`,
        body: { body: note },
      });
      result.ghl.noteCreated = true;
    } catch (e) {
      result.ghl.noteError = e.message;
    }
  }

  // --- 4. Opportunity in Sales Pipeline → New Lead for booking/quote calls ---
  // Taylor never quotes anymore, so we always land in New Lead. The team
  // moves the opportunity to Quoted / Booked manually as they follow up.
  if (contactId) {
    const intent = s(extracted.intent).toLowerCase();
    if (BOOKING_INTENTS.has(intent)) {
      try {
        // Build custom fields from Taylor's post-call extraction.
        const oppFields = cfArray([
          cf(OPP_SERVICE_TYPE, normalizeServiceType(extracted.service_type)),
          cf(OPP_FREQUENCY, normalizeFrequency(extracted.frequency)),
          cf(OPP_SQUARE_FOOTAGE, num(extracted.sqft) || null),
          cf(OPP_BEDROOMS, num(extracted.bedrooms) || null),
          cf(OPP_BATHROOMS, num(extracted.bathrooms) || null),
          cf(OPP_QUOTED_PRICE, quote?.total || null),
          cf(OPP_LEAD_SOURCE, LEAD_SOURCE_OPTIONS.RETELL_CALL),
        ]);
        const oppBody = {
          locationId: process.env.GHL_LOCATION_ID,
          pipelineId: SALES_PIPELINE_ID,
          pipelineStageId: STAGE_NEW_LEAD,
          name: buildOpportunityName(extracted, firstName, lastName),
          contactId,
          status: "open",
          source: "Retell — Taylor",
          assignedTo: ASSIGNED_USER_ID,
        };
        // monetaryValue gets a value if Taylor computed a quote, so the
        // pipeline view shows real revenue projections instead of $0.
        if (quote?.total) oppBody.monetaryValue = quote.total;
        const opp = await ghl({
          method: "POST",
          path: "/opportunities/",
          body: oppBody,
        });
        const oppId = opp?.opportunity?.id || opp?.id || null;
        result.ghl.opportunityId = oppId;
        result.ghl.opportunityStage = "New Lead";
        // POST /opportunities/ silently drops customFields[]; set them via PUT.
        if (oppId && oppFields.length) {
          try {
            await ghl({
              method: "PUT",
              path: `/opportunities/${oppId}`,
              body: { customFields: oppFields },
            });
            result.ghl.opportunityFieldsSet = oppFields.length;
          } catch (e) {
            result.ghl.opportunityFieldsError = e.message;
          }
        }
      } catch (e) {
        result.ghl.opportunityError = e.message;
      }
    }
  }

  // --- 5. Auto-text the caller from the GHL number (only if they consented) ---
  // GHL's /conversations/messages routes through the location's SMS-capable
  // number (the A2P-verified one), lands in the same thread as any future
  // replies, and shows up in the GHL conversations inbox for the team.
  const consent = interpretSmsConsent(extracted.sms_consent);
  result.customerSms.smsConsentRaw = s(extracted.sms_consent) || "(empty)";
  result.customerSms.smsConsentInterpreted = consent.value;
  if (contactId && consent.consented) {
    result.customerSms.attempted = true;
    try {
      const body = {
        type: "SMS",
        contactId,
        message: buildCustomerConfirmation(firstName),
      };
      if (process.env.GHL_FROM_NUMBER) body.fromNumber = process.env.GHL_FROM_NUMBER;
      const smsResp = await ghl({
        method: "POST",
        path: "/conversations/messages",
        body,
      });
      result.customerSms.ok = true;
      result.customerSms.messageId =
        smsResp?.messageId || smsResp?.message?.id || null;
    } catch (e) {
      result.customerSms.ok = false;
      result.customerSms.error = e.message;
    }
  } else if (contactId) {
    result.customerSms.skipped = `no consent (raw: "${result.customerSms.smsConsentRaw}", interpreted: ${consent.value})`;
  }

  // --- 6. SMS recap to manager via GHL (lands in GHL conversations inbox) ---
  const to = process.env.MANAGER_PHONE;
  const recap = buildManagerRecap(call, extracted, quote);
  if (to && recap) {
    result.managerSms.attempted = true;
    const smsResp = await sendGhlSms({
      to,
      message: recap,
      firstName: "Manager",
      tag: "internal:manager",
    });
    result.managerSms.ok = smsResp.ok;
    result.managerSms.contactId = smsResp.contactId;
    result.managerSms.messageId = smsResp.messageId;
    if (!smsResp.ok) result.managerSms.error = smsResp.error;
  }

  // --- 7. Slack notification (optional — only if SLACK_WEBHOOK_URL is set) ---
  if (process.env.SLACK_WEBHOOK_URL) {
    result.slack.attempted = true;
    try {
      const callerName =
        [firstName, lastName].filter(Boolean).join(" ") || "Unknown caller";
      const blocks = buildCallBlocks({
        call,
        extracted,
        contactId,
        locationId: process.env.GHL_LOCATION_ID,
        quote,
      });
      const slackResp = await sendSlack(
        process.env.SLACK_WEBHOOK_URL,
        blocks,
        `📞 New call from ${callerName}`,
      );
      result.slack.ok = slackResp.ok;
      if (!slackResp.ok) result.slack.error = slackResp.error;
    } catch (e) {
      result.slack.ok = false;
      result.slack.error = e.message;
    }
  }

  return res.status(200).json(result);
}
