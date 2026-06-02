// Self-serve onboarding step 2: verify the one-time code → issue a token.
//
// POST { email, code }
// On success, clears the stored code, sets a fresh nonce, and returns a signed
// onboarding token (24h) that the page uses for the existing state/w9/
// agreement/checklist endpoints.

import { ghl } from "../_lib/ghl.js";
import { findContactByEmail } from "../_lib/ghl-find.js";
import { setOnboardCors } from "../_lib/onboard-auth.js";
import { signToken, newNonce } from "../_lib/onboard-token.js";
import {
  hashCode,
  parseOtp,
  packOtp,
  safeEqualHex,
  OTP_MAX_ATTEMPTS,
} from "../_lib/otp.js";
import {
  CONTACT_ONBOARDING_OTP,
  CONTACT_ONBOARDING_TOKEN_NONCE,
  readContactField,
} from "../_lib/onboarding-fields.js";

export const config = { runtime: "nodejs" };

const TOKEN_TTL_SECONDS = 24 * 60 * 60; // 24h session

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
  const code = String(body.code || "").replace(/\D/g, "");
  if (!email || !code) {
    return res.status(400).json({ error: "Email and code are required." });
  }

  const contact = await findContactByEmail(email);
  if (!contact?.id) {
    return res.status(401).json({ error: "Invalid email or code." });
  }

  const otp = parseOtp(readContactField(contact, CONTACT_ONBOARDING_OTP));
  if (!otp) {
    return res.status(410).json({ error: "No active code. Please request a new one." });
  }
  if (otp.exp < Math.floor(Date.now() / 1000)) {
    return res.status(410).json({ error: "That code expired. Please request a new one." });
  }
  if (otp.attempts >= OTP_MAX_ATTEMPTS) {
    return res.status(429).json({ error: "Too many attempts. Please request a new code." });
  }

  const matches = safeEqualHex(hashCode(code, contact.id), otp.hash);
  if (!matches) {
    // Increment attempt counter.
    const left = OTP_MAX_ATTEMPTS - (otp.attempts + 1);
    try {
      await ghl({
        method: "PUT",
        path: `/contacts/${contact.id}`,
        body: { customFields: [{ id: CONTACT_ONBOARDING_OTP, field_value: packOtp(otp.hash, otp.exp, otp.attempts + 1) }] },
      });
    } catch (_) { /* best-effort */ }
    return res.status(401).json({ error: "Incorrect code.", attemptsLeft: Math.max(0, left) });
  }

  // Success: clear the OTP, set a fresh nonce, mint the token.
  const nonce = newNonce();
  try {
    await ghl({
      method: "PUT",
      path: `/contacts/${contact.id}`,
      body: {
        customFields: [
          { id: CONTACT_ONBOARDING_OTP, field_value: "" },
          { id: CONTACT_ONBOARDING_TOKEN_NONCE, field_value: nonce },
        ],
      },
    });
  } catch (e) {
    return res.status(502).json({ error: "Could not complete verification. Please try again." });
  }

  const token = signToken({ contactId: contact.id, nonce, ttlSeconds: TOKEN_TTL_SECONDS });
  return res.status(200).json({ ok: true, token });
}
