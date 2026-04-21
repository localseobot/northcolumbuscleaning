// Retell AI post-call webhook — Quo-native version.
//
// Receives call-started, call-ended, and call-analyzed events from Retell.
// On call_analyzed, it:
//   1. Sends the office manager an SMS recap FROM the Quo workspace number
//      (so the recap lands in Quo's shared team inbox — not a separate Twilio thread)
//   2. Forwards a structured summary to Zapier for Booking Koala lead creation
//
// Environment variables (set in Vercel → Settings → Environment Variables):
//   QUO_API_KEY         — from Quo dashboard → Settings → API
//   QUO_FROM_NUMBER     — your Quo workspace number in E.164, e.g. +17409133693
//   MANAGER_PHONE       — owner/manager cell in E.164, where the recap SMS goes
//   ZAPIER_WEBHOOK_URL  — Zapier "Catch Hook" URL

import { sendSms } from "./_lib/quo.js";

export const config = { runtime: "nodejs" };

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

  // Only act on call_analyzed — that's when Retell has the full summary
  // and the structured custom-analysis fields.
  if (event !== "call_analyzed") {
    return res.status(200).json({ ok: true, ignored: event });
  }

  const analysis = call?.call_analysis || {};
  const extracted = analysis?.custom_analysis_data || {};
  const summary = analysis?.call_summary || "";
  const sentiment = analysis?.user_sentiment || "";
  const callerNumber = call?.from_number || "";
  const startedAt = call?.start_timestamp
    ? new Date(call.start_timestamp).toISOString()
    : "";
  const durationSec = call?.duration_ms
    ? Math.round(call.duration_ms / 1000)
    : 0;

  const zapierResult = { attempted: false };
  const smsResult = { attempted: false };

  // --- 1. Forward structured payload to Zapier ---
  const zapierUrl = process.env.ZAPIER_WEBHOOK_URL;
  if (zapierUrl) {
    zapierResult.attempted = true;
    try {
      const r = await fetch(zapierUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callId,
          startedAt,
          durationSec,
          callerNumber,
          summary,
          sentiment,
          intent: extracted.intent,
          callerName: extracted.caller_name,
          callbackNumber: extracted.callback_number || callerNumber,
          serviceType: extracted.service_type,
          propertyDetails: extracted.property_details,
          serviceAddressOrArea: extracted.service_address_or_area,
          preferredTiming: extracted.preferred_timing,
          specialNotes: extracted.special_notes,
          urgency: extracted.urgency,
          requiresHumanFollowup: extracted.requires_human_followup,
          transcript: call?.transcript,
        }),
      });
      zapierResult.ok = r.ok;
      zapierResult.status = r.status;
    } catch (e) {
      zapierResult.ok = false;
      zapierResult.error = String(e);
    }
  }

  // --- 2. SMS recap to manager via Quo API ---
  const to = process.env.MANAGER_PHONE;
  if (to && summary) {
    smsResult.attempted = true;
    const recap = [
      `New call (${durationSec}s) — ${extracted.intent || "general"}`,
      extracted.caller_name
        ? `${extracted.caller_name} • ${extracted.callback_number || callerNumber}`
        : callerNumber,
      extracted.service_type
        ? `Service: ${extracted.service_type} • ${extracted.property_details || ""}`
        : "",
      extracted.service_address_or_area
        ? `Area: ${extracted.service_address_or_area}`
        : "",
      extracted.preferred_timing ? `Timing: ${extracted.preferred_timing}` : "",
      extracted.special_notes ? `Notes: ${extracted.special_notes}` : "",
      "",
      summary,
    ]
      .filter(Boolean)
      .join("\n")
      .slice(0, 1500);

    const result = await sendSms(to, recap);
    smsResult.ok = result.ok;
    smsResult.status = result.status;
    if (!result.ok) smsResult.error = result.body;
  }

  return res.status(200).json({
    ok: true,
    callId,
    zapier: zapierResult,
    sms: smsResult,
  });
}
