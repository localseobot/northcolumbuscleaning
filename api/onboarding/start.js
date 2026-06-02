// Self-serve onboarding step 1: request a one-time code.
//
// POST { email }
// If the email belongs to an eligible provider (tagged onboarding:eligible by
// provider-sync), generate a 6-digit code, store its salted hash on the
// contact, and send the code by email + SMS. Returns whether they're eligible
// and which channels the code went to (masked).

import { ghl } from "../_lib/ghl.js";
import { sendEmail } from "../_lib/resend.js";
import { sendGhlSms, INTERNAL_LINE } from "../_lib/ghl-sms.js";
import { findContactByEmail, hasTag } from "../_lib/ghl-find.js";
import { setOnboardCors } from "../_lib/onboard-auth.js";
import {
  generateCode,
  hashCode,
  packOtp,
  OTP_TTL_SECONDS,
} from "../_lib/otp.js";
import {
  CONTACT_ONBOARDING_OTP,
  CONTACT_ONBOARDING_COMPLETE,
  TAG_ONBOARDING_ELIGIBLE,
  readContactField,
  isYes,
} from "../_lib/onboarding-fields.js";

export const config = { runtime: "nodejs" };

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default async function handler(req, res) {
  setOnboardCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: "Invalid JSON" }); }
  }
  body = body || {};

  const email = String(body.email || "").trim().toLowerCase();
  if (!email || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "Please enter a valid email address." });
  }

  const contact = await findContactByEmail(email);
  // Eligible = exists AND tagged onboarding:eligible.
  if (!contact || !hasTag(contact, TAG_ONBOARDING_ELIGIBLE)) {
    // Friendly (this is a hiring flow, low enumeration risk).
    return res.status(200).json({ ok: true, eligible: false });
  }

  if (isYes(readContactField(contact, CONTACT_ONBOARDING_COMPLETE))) {
    return res.status(200).json({ ok: true, eligible: true, complete: true });
  }

  // Generate + store the code (hash only).
  const code = generateCode();
  const exp = Math.floor(Date.now() / 1000) + OTP_TTL_SECONDS;
  try {
    await ghl({
      method: "PUT",
      path: `/contacts/${contact.id}`,
      body: {
        customFields: [
          { id: CONTACT_ONBOARDING_OTP, field_value: packOtp(hashCode(code, contact.id), exp, 0) },
        ],
      },
    });
  } catch (e) {
    return res.status(502).json({ error: "Could not start verification. Please try again." });
  }

  const channels = [];
  const firstName = contact.firstName || "there";

  if (contact.email) {
    const html = `
      <div style="font-family:Inter,Arial,sans-serif;color:#2b2b2b;max-width:480px">
        <h2 style="color:#1a4d2e">Your onboarding code</h2>
        <p>Hi ${escapeHtml(firstName)}, here's your code to continue onboarding with North Columbus Cleaning:</p>
        <p style="font-size:30px;font-weight:900;letter-spacing:6px;color:#1a4d2e">${code}</p>
        <p style="font-size:13px;color:#666">This code expires in 10 minutes. If you didn't request it, you can ignore this email.</p>
      </div>`;
    const r = await sendEmail({
      to: contact.email,
      subject: `Your onboarding code: ${code}`,
      html,
      tags: ["onboarding", "otp"],
    });
    if (r.id) channels.push("email");
  }

  if (contact.phone) {
    const r = await sendGhlSms({
      to: contact.phone,
      firstName: contact.firstName,
      fromNumber: INTERNAL_LINE,
      message: `North Columbus Cleaning onboarding code: ${code} (expires in 10 min)`,
    });
    if (r.ok) channels.push("sms");
  }

  return res.status(200).json({
    ok: true,
    eligible: true,
    channels,
    maskedEmail: maskEmail(contact.email),
    maskedPhone: maskPhone(contact.phone),
  });
}

function escapeHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function maskEmail(e) {
  if (!e) return "";
  const [u, d] = String(e).split("@");
  if (!d) return "";
  const head = u.slice(0, 2);
  return `${head}${"*".repeat(Math.max(1, u.length - 2))}@${d}`;
}
function maskPhone(p) {
  if (!p) return "";
  const s = String(p).replace(/\D/g, "");
  return s ? `•••• ${s.slice(-4)}` : "";
}
