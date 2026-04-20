// Retell AI post-call webhook
// Receives call-started, call-ended, and call-analyzed events from Retell.
// On call_analyzed, forwards a structured summary to:
//   - Zapier webhook (→ Booking Koala lead, Google Sheet log, etc.)
//   - Twilio SMS to the office manager with a call recap
//
// Environment variables required (set in Vercel dashboard):
//   RETELL_WEBHOOK_SECRET  — shared secret, optional, see Retell's verification docs
//   ZAPIER_WEBHOOK_URL     — Zapier "Catch Hook" URL
//   TWILIO_ACCOUNT_SID
//   TWILIO_AUTH_TOKEN
//   TWILIO_FROM            — your Twilio phone number in E.164 (e.g. +16145550100)
//   MANAGER_PHONE          — office manager's cell in E.164 (e.g. +16145551234)

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

  // Only act on call_analyzed — that's when Retell has the summary + extracted fields.
  // call_started / call_ended fire earlier but have less data.
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

  // --- 1. Forward to Zapier ---
  const zapierUrl = process.env.ZAPIER_WEBHOOK_URL;
  if (zapierUrl) {
    try {
      await fetch(zapierUrl, {
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
    } catch (e) {
      console.error("Zapier forward failed:", e);
    }
  }

  // --- 2. SMS the manager a recap ---
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM;
  const to = process.env.MANAGER_PHONE;

  if (sid && token && from && to && summary) {
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
      summary.slice(0, 700),
    ]
      .filter(Boolean)
      .join("\n");

    try {
      const body = new URLSearchParams({
        To: to,
        From: from,
        Body: recap.slice(0, 1500),
      });
      await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization:
              "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: body.toString(),
        },
      );
    } catch (e) {
      console.error("Twilio SMS failed:", e);
    }
  }

  return res.status(200).json({ ok: true, callId });
}
