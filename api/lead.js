// Website lead capture — one half of the product.
//
// Every quote request on the site posts here. This records the lead in the
// ledger and hands it to the buyer by text and email, in that order of
// urgency. Before this endpoint existed the form fell back to opening the
// visitor's mail client, which meant a lead only arrived if the visitor had a
// configured mail app and actually pressed send. Most didn't.
//
// POST { name, email, phone, service, message, sqft?, bedrooms?, bathrooms?, page?, website? }
// → 200 { ok: true }
//
// The handler answers 200 as long as we captured something usable. A visitor
// must never see an error because our CRM was slow.

import { recordLead } from "./_lib/lead-ledger.js";
import { deliverLead } from "./_lib/lead-delivery.js";
import { normalizeServiceType } from "./_lib/ghl-fields.js";
import { sendSlack } from "./_lib/slack.js";

export const config = { runtime: "nodejs" };

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function s(v, max = 500) {
  return String(v === null || v === undefined ? "" : v).trim().slice(0, max);
}

// Normalize US numbers to E.164 so GHL matches contacts and the buyer's phone
// can dial straight from the alert. Anything we can't confidently parse is
// passed through — a malformed number is still worth delivering.
function toE164(raw) {
  const digits = s(raw, 40).replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (!digits) return "";
  return s(raw, 40).startsWith("+") ? `+${digits}` : digits;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: "Invalid JSON" });
    }
  }
  body = body || {};

  // Honeypot. Real visitors never see this field, so anything in it is a bot.
  // Answer 200 so the bot has no signal that it was caught.
  if (s(body.website)) return res.status(200).json({ ok: true });

  const name = s(body.name, 120);
  const email = s(body.email, 160).toLowerCase();
  const phone = toE164(body.phone);
  const service = s(body.service, 80);
  const message = s(body.message, 1500);

  if (!name) return res.status(400).json({ error: "Please tell us your name." });
  if (!email && !phone) {
    return res.status(400).json({ error: "Please give us an email address or a phone number." });
  }
  if (email && !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "That email address doesn't look right." });
  }

  const detail = [
    message,
    body.sqft ? `Approx. ${s(body.sqft, 20)} sq ft` : "",
    body.bedrooms ? `${s(body.bedrooms, 10)} bed` : "",
    body.bathrooms ? `${s(body.bathrooms, 10)} bath` : "",
    body.page ? `Submitted from ${s(body.page, 120)}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const lead = {
    channel: "web",
    name,
    email: email || undefined,
    phone: phone || undefined,
    service: normalizeServiceType(service) || undefined,
    detail,
    sourceLabel: "Website — quote form",
  };

  let recorded = { ok: false, billable: true };
  try {
    recorded = await recordLead(lead);
  } catch (e) {
    // Losing the CRM write is bad, but losing the lead is worse. Fall through
    // to delivery so the buyer still gets the call-back details.
    recorded = { ok: false, error: e.message, billable: true };
  }

  const delivery = await deliverLead({
    ...lead,
    // Show the raw service the visitor picked, not our internal enum — it's
    // closer to how they described what they want.
    service: service || lead.service,
    billable: recorded.billable,
  }).catch((e) => ({ error: e.message }));

  // Slack is the safety net: if both the CRM write and the alerts failed,
  // this is the last place the lead can still surface.
  if (!recorded.ok || (delivery?.sms?.ok === false && delivery?.email?.error)) {
    const alert = `Website lead needed manual handling: ${name} ${phone || email} — CRM: ${
      recorded.error || "ok"
    }`;
    await sendSlack(
      process.env.SLACK_WEBHOOK_URL,
      [{ type: "section", text: { type: "mrkdwn", text: alert } }],
      alert,
    ).catch(() => {});
  }

  return res.status(200).json({ ok: true });
}
