// Retell AI post-call webhook — syncs call data into GoHighLevel + manager SMS.
//
// On every Retell call_analyzed event, this handler:
//   1. Upserts the caller as a contact in GHL (matched by phone)
//   2. Applies cleaning-business tags from the structured analysis
//      (source:maya, inbound-call, intent:*, service:*, frequency:*)
//   3. Adds a contact note with summary, sentiment, recording URL, key fields
//   4. Creates an opportunity in Sales Pipeline → New Lead when the intent
//      is a booking/quote and Taylor gave a quote amount
//   5. Texts the office manager a recap from the Quo workspace number
//      (lands in the team's shared inbox)
//
// call_started / call_ended events are acknowledged and ignored — only
// call_analyzed has the structured custom_analysis_data populated.
//
// Environment variables (Vercel → Settings → Environment Variables):
//   GHL_PIT             — Private Integration Token (scoped to the sub-account)
//   GHL_LOCATION_ID     — Sub-account ID
//   QUO_API_KEY         — Quo (OpenPhone) API key, for the manager-recap SMS
//   QUO_FROM_NUMBER     — Quo workspace number in E.164
//   MANAGER_PHONE       — owner/manager cell in E.164

import { ghl } from "./_lib/ghl.js";
import { sendSms } from "./_lib/quo.js";

export const config = { runtime: "nodejs" };

// Sales Pipeline (a.k.a. "Marketing Pipeline" until renamed in UI) and stages.
// IDs are stable across renames, so the rename is risk-free.
const SALES_PIPELINE_ID = "WUuo5W5hnaIKAwi1Mw6n";
const STAGE_NEW_LEAD = "36aa4620-4d9c-423f-b468-f35e8c101013";
const STAGE_QUOTED = "293d64f5-1bca-4ff9-bb2d-dee9d6bb2d71";

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
  return tags;
}

function buildNote(call, extracted) {
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

  const quote = num(extracted.quote_amount);
  if (quote > 0) lines.push(`Quote given: $${quote.toFixed(2)} per visit`);

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

function buildManagerRecap(call, extracted) {
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
  const quote = num(extracted.quote_amount);
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
  if (quote > 0) lines.push(`Quote: $${quote.toFixed(2)}`);
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

  const result = { ok: true, callId, ghl: {}, sms: { attempted: false } };

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

  // --- 3. Contact note with summary + recording link ---
  if (contactId) {
    try {
      const note = buildNote(call, extracted);
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

  // --- 4. Opportunity if booking/quote intent + a quote was given ---
  if (contactId) {
    const intent = s(extracted.intent).toLowerCase();
    const quote = num(extracted.quote_amount);
    if (BOOKING_INTENTS.has(intent)) {
      const stageId = quote > 0 ? STAGE_QUOTED : STAGE_NEW_LEAD;
      try {
        const opp = await ghl({
          method: "POST",
          path: "/opportunities/",
          body: {
            locationId: process.env.GHL_LOCATION_ID,
            pipelineId: SALES_PIPELINE_ID,
            pipelineStageId: stageId,
            name: buildOpportunityName(extracted, firstName, lastName),
            contactId,
            monetaryValue: quote || undefined,
            status: "open",
            source: "Retell — Taylor",
          },
        });
        result.ghl.opportunityId = opp?.opportunity?.id || opp?.id || null;
        result.ghl.opportunityStage = quote > 0 ? "Quoted" : "New Lead";
      } catch (e) {
        result.ghl.opportunityError = e.message;
      }
    }
  }

  // --- 5. SMS recap to manager via Quo (kept — lands in team's shared inbox) ---
  const to = process.env.MANAGER_PHONE;
  const recap = buildManagerRecap(call, extracted);
  if (to && recap) {
    result.sms.attempted = true;
    const smsResp = await sendSms(to, recap);
    result.sms.ok = smsResp.ok;
    result.sms.status = smsResp.status;
    if (!smsResp.ok) result.sms.error = smsResp.body;
  }

  return res.status(200).json(result);
}
