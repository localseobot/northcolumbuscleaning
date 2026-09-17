// GHL inbound-call webhook — the live phone half of the lead-sales product.
//
// Homeowners dial the GHL tracking number on the site. GHL forwards that
// call to the buyer's phone. This endpoint hears about the call and runs it
// through the same recordLead → deliverLead path as the website form.
//
// This is the ONLY phone lead source. Calls are no longer answered by an AI
// agent — GHL forwards them straight to the buyer's line, and this webhook is
// how we learn the call happened.
//
// Wire this in GHL (see README go-live checklist):
//   POST https://www.northcolumbuscleaning.com/api/ghl-call-webhook
//   Published workflow "After-Hours Call Routing" currently Connect-Calls
//   +16147629409 (old Retell). Change Connect Call to +17409712907
//   (All Clean Sol), then add this Webhook action alongside it.
//   Draft "Call Routing 24/7" has an Incoming Call trigger and no actions
//   — only use it if you finish Connect Call + Webhook and publish it.
// Preferred trigger: Inbound Message (CALL) or Call Status = completed.
// Fallback: Workflow "Inbound Call" → Webhook. Payloads with no status are
// treated as leads unless GHL_CALL_REQUIRE_ANSWERED=1.
//
// Optional header: X-Webhook-Secret: <GHL_CALL_WEBHOOK_SECRET>

import { ghl } from "./_lib/ghl.js";
import { recordLead } from "./_lib/lead-ledger.js";
import { deliverLead } from "./_lib/lead-delivery.js";
import { parseGhlCallEvent, classifyGhlCall, selectCallerPhone } from "./_lib/ghl-call.js";
import { LEAD_SOURCE_OPTIONS } from "./_lib/ghl-fields.js";
import { sendSlack } from "./_lib/slack.js";
import { CUSTOMER_LINE, INTERNAL_LINE } from "./_lib/ghl-sms.js";

export const config = { runtime: "nodejs" };

function s(v, max = 500) {
  return String(v === null || v === undefined ? "" : v).trim().slice(0, max);
}

function envFlag(name) {
  const v = String(process.env[name] || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function parseBody(req) {
  let body = req.body;
  if (typeof body === "string") {
    const raw = body.trim();
    if (!raw) return {};
    try {
      return JSON.parse(raw);
    } catch {
      try {
        return Object.fromEntries(new URLSearchParams(raw));
      } catch {
        return { __invalid: true };
      }
    }
  }
  return body && typeof body === "object" ? body : {};
}

async function hydrateFromContact(event) {
  if (!event.contactId || !process.env.GHL_PIT) return event;
  const r = await ghl({ method: "GET", path: `/contacts/${event.contactId}` }).catch(() => null);
  const c = r?.contact || r;
  if (!c) return event;
  const name =
    event.name ||
    s(c.contactName) ||
    [s(c.firstName), s(c.lastName)].filter(Boolean).join(" ");
  return {
    ...event,
    // Contact record is the homeowner. Webhook `from` may be our tracking line.
    phone: s(c.phone) || event.phone,
    email: event.email || s(c.email).toLowerCase(),
    name,
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Webhook-Secret");
  if (req.method === "OPTIONS") return res.status(204).end();

  // Browser-pasteable liveness check so the go-live checklist can confirm
  // the URL is deployed before GHL is pointed at it.
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      endpoint: "ghl-call-webhook",
      hint: "POST GHL inbound-call or call-status payloads here.",
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (process.env.GHL_CALL_WEBHOOK_SECRET) {
    const provided =
      req.headers["x-webhook-secret"] ||
      String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (provided !== process.env.GHL_CALL_WEBHOOK_SECRET) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  const body = parseBody(req);
  if (body.__invalid) {
    return res.status(200).json({ ok: false, skipped: "invalid json" });
  }

  const parsed = parseGhlCallEvent(body);
  const expectedLocation = s(process.env.GHL_LOCATION_ID);
  if (expectedLocation && parsed.locationId && parsed.locationId !== expectedLocation) {
    return res.status(200).json({
      ok: true,
      skipped: `location mismatch (${parsed.locationId})`,
    });
  }

  const classified = classifyGhlCall(parsed, {
    requireAnswered: envFlag("GHL_CALL_REQUIRE_ANSWERED"),
    minDuration: Number(process.env.GHL_CALL_MIN_DURATION || 0),
  });

  const result = {
    ok: true,
    receivedAt: new Date().toISOString(),
    skipped: classified.skip ? classified.reason : null,
    connected: classified.connected,
    contactId: parsed.contactId || null,
    phone: parsed.phone || null,
    status: parsed.status || null,
    duration: parsed.duration,
    lead: { attempted: false },
  };

  if (classified.skip) {
    return res.status(200).json(result);
  }

  const event = await hydrateFromContact(parsed);
  const caller = selectCallerPhone(
    [event.phone, ...(parsed.phoneCandidates || []), parsed.from],
    [
      process.env.TRACKING_NUMBER,
      process.env.GHL_FROM_NUMBER,
      process.env.BUYER_PHONE,
      CUSTOMER_LINE,
      INTERNAL_LINE,
      "+16147629409",
    ],
  );
  if (caller) event.phone = caller;
  result.phone = event.phone || result.phone;
  result.contactId = event.contactId || result.contactId;

  if (!event.phone && !event.contactId) {
    result.skipped = "no caller phone or contactId";
    return res.status(200).json(result);
  }

  const durationBit =
    event.duration !== null && event.duration !== undefined
      ? `${event.duration}s`
      : "duration unknown";
  const statusBit = event.status || "no status";
  const detail = [
    "Inbound call forwarded by GoHighLevel to the buyer.",
    `Status: ${statusBit}. Duration: ${durationBit}.`,
    event.recordingUrl ? `Recording: ${event.recordingUrl}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const lead = {
    channel: "phone",
    contactId: event.contactId || undefined,
    opportunityId: event.opportunityId || undefined,
    name: event.name || event.phone || "Inbound caller",
    phone: event.phone || undefined,
    email: event.email || undefined,
    detail,
    sourceLabel: "GHL forwarded call",
    leadSource: LEAD_SOURCE_OPTIONS.OTHER,
  };

  result.lead.attempted = true;
  let recorded = { ok: false, billable: true };
  try {
    recorded = await recordLead(lead);
    result.lead.ok = recorded.ok;
    result.lead.billable = recorded.billable;
    result.lead.duplicate = recorded.duplicate;
    result.lead.leadId = recorded.leadId || null;
    result.lead.contactId = recorded.contactId || null;
    if (recorded.error) result.lead.error = recorded.error;
  } catch (e) {
    recorded = { ok: false, error: e.message, billable: true };
    result.lead.ok = false;
    result.lead.error = e.message;
  }

  result.lead.delivery = await deliverLead({
    ...lead,
    billable: recorded.billable,
  }).catch((e) => ({ error: e.message }));

  if (!recorded.ok) {
    const alert = `GHL forwarded call needed manual handling: ${lead.name} ${
      lead.phone || lead.contactId || ""
    } — CRM: ${recorded.error || "ok"}`;
    await sendSlack(
      process.env.SLACK_WEBHOOK_URL,
      [{ type: "section", text: { type: "mrkdwn", text: alert } }],
      alert,
    ).catch(() => {});
  }

  return res.status(200).json(result);
}
