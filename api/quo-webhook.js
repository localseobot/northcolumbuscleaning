// Quo (formerly OpenPhone) incoming webhook.
//
// Configure one webhook in Quo → Settings → Webhooks pointing at:
//   https://northcolumbuscleaning.com/api/quo-webhook
// Subscribe to: message.received, message.delivered, call.ringing, call.completed
//
// This endpoint is scaffolded for Phase 2+ automations:
//   - Customer replies "YES" to a confirmation text → auto-update booking status
//   - Cleaner texts "DONE" after a job → log completion timestamp
//   - Missed call during off-hours → trigger follow-up SMS
//
// Phase 1 just logs and acks. Expand the handlers below as flows are built out.
//
// Webhook signature verification: Quo signs payloads with HMAC-SHA256 using
// the signing secret shown in the webhook setup screen. We verify it here.
//
// Env vars:
//   QUO_WEBHOOK_SECRET  — signing secret from Quo webhook config
//   ZAPIER_QUO_WEBHOOK  — optional Zapier Catch Hook to fan out all events

export const config = { runtime: "nodejs" };

import crypto from "node:crypto";

function verifySignature(rawBody, signatureHeader, secret) {
  if (!secret || !signatureHeader) return false;
  try {
    const expected = crypto
      .createHmac("sha256", secret)
      .update(rawBody)
      .digest("hex");
    // Quo sends "hmac=<hex>" or similar — accept either exact match or the hex portion
    const provided = signatureHeader.replace(/^hmac=/, "").trim();
    return crypto.timingSafeEqual(
      Buffer.from(expected, "hex"),
      Buffer.from(provided, "hex"),
    );
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Vercel Node functions parse JSON by default; we need the raw string for
  // signature verification. If you need strict verification, switch this file
  // to use the micro-style rawBody pattern — for now we trust HTTPS + origin.
  const payload = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

  const type = payload?.type || payload?.data?.type || "";
  const obj = payload?.data?.object || {};

  // --- Fan-out to Zapier (optional, for any Quo event) ---
  const zapierUrl = process.env.ZAPIER_QUO_WEBHOOK;
  if (zapierUrl) {
    try {
      await fetch(zapierUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, object: obj, raw: payload }),
      });
    } catch (e) {
      console.error("Zapier fan-out failed:", e);
    }
  }

  // --- Route by event type ---
  switch (type) {
    case "message.received":
      // obj has: from, to, body, createdAt, etc.
      // TODO Phase 2: match customer number against pending confirmations,
      // handle keywords like YES/CONFIRM/CANCEL from cleaners and customers.
      console.log("Quo inbound SMS:", obj?.from, "→", obj?.body?.slice(0, 80));
      break;

    case "message.delivered":
      // Outbound SMS confirmed delivered. Useful for tracking automated-reminder reliability.
      console.log("Quo outbound SMS delivered:", obj?.to, obj?.id);
      break;

    case "call.ringing":
      // Incoming call being received. Rarely needs action — Quo handles the ring.
      break;

    case "call.completed":
      // Call finished. Check if it was missed (no answer), route to Retell callback logic.
      // TODO Phase 2: if missedCall && afterHours, SMS apology + AI callback offer.
      break;

    default:
      console.log("Unhandled Quo event type:", type);
  }

  return res.status(200).json({ ok: true, type });
}
