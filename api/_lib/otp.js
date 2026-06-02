// One-time passcode (OTP) helpers for self-serve onboarding.
//
// The provider proves they control the email/phone on file before they can
// submit a W-9 / sign the agreement. No DB: we store a salted HASH of the code
// (never the code itself) on the GHL contact, packed with an expiry and an
// attempt counter, in the onboarding_otp custom field as "hash:exp:attempts".
//
// Brute-force defense: 6-digit code, 10-minute expiry, max 5 attempts.

import crypto from "node:crypto";

export const OTP_TTL_SECONDS = 10 * 60;
export const OTP_MAX_ATTEMPTS = 5;

function secret() {
  const s = process.env.ONBOARDING_SECRET;
  if (!s) throw new Error("ONBOARDING_SECRET not set");
  return s;
}

// 6-digit numeric code, cryptographically random, zero-padded.
export function generateCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

// Salted hash bound to the contact so a hash can't be replayed across contacts.
export function hashCode(code, contactId) {
  return crypto
    .createHmac("sha256", secret())
    .update(`${contactId}:${String(code).trim()}`)
    .digest("hex");
}

// Pack/unpack the custom-field string.
export function packOtp(hash, expEpoch, attempts) {
  return `${hash}:${expEpoch}:${attempts}`;
}
export function parseOtp(str) {
  if (!str || typeof str !== "string") return null;
  const [hash, exp, attempts] = str.split(":");
  if (!hash || !exp) return null;
  return { hash, exp: Number(exp), attempts: Number(attempts) || 0 };
}

// Constant-time compare of two hex strings of equal length.
export function safeEqualHex(a, b) {
  const ba = Buffer.from(String(a), "utf8");
  const bb = Buffer.from(String(b), "utf8");
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
