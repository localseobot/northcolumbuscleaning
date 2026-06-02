// GHL contact custom field IDs for the contractor onboarding flow.
// Created 2026-06-02 against location XIA5AmegWaylDoPVe3r8.
// Mirrors the style of ghl-fields.js (SCREAMING_SNAKE constants).
//
// All of these are simple TEXT fields. Boolean-ish flags store the string
// "yes" when true and are left blank otherwise. SSN/EIN itself is NEVER
// stored here — only the ssn_ein_verified flag. The raw number lives only
// inside the W-9 PDF in the (admin-restricted) Shared Drive.

// ── Onboarding state flags (TEXT, "yes" = done) ────────────────────────────
export const CONTACT_ONBOARDING_W9_DONE = "YWi32AUFWkbgqQqAGqL6";
export const CONTACT_ONBOARDING_AGREEMENT_DONE = "zdzXJQFiEMiPU3ODlCrx";
export const CONTACT_ONBOARDING_CHECKLIST_DONE = "dRuXeY0Pjy3S1iGZB5rU";
export const CONTACT_ONBOARDING_COMPLETE = "KOhD0wihh05dK1MqAQ48";
export const CONTACT_SSN_EIN_VERIFIED = "j9zAdrMNrOTOf23bTtwS";

// ── Drive links (TEXT, webViewLink) ────────────────────────────────────────
export const CONTACT_W9_DRIVE_LINK = "qrCUwCMdiin1J6BR4Jei";
export const CONTACT_AGREEMENT_DRIVE_LINK = "Gj2tlATMn2pmeuX7cCqT";
export const CONTACT_RESUME_DRIVE_LINK = "TZ7iFW0hZ65F2A1E9KFw";

// ── Token revocation nonce (TEXT) ──────────────────────────────────────────
// Bumped each time an onboarding token is minted (admin invite OR OTP verify).
// The signed token embeds the nonce value at mint time; verify re-fetches the
// contact and requires a match, so minting a new token invalidates older ones.
export const CONTACT_ONBOARDING_TOKEN_NONCE = "X0t2n66xJMUc4gT92YUT";

// ── One-time code for self-serve onboarding (TEXT) ─────────────────────────
// Stores "hash:expiryEpoch:attempts" — see otp.js. The raw code is never
// stored; only a salted hash.
export const CONTACT_ONBOARDING_OTP = "KvL4HMzezoopDRDd5itD";

// ── Tags ───────────────────────────────────────────────────────────────────
// Set when a provider is added in Booking Koala (via provider-sync). Gates who
// is allowed to request an onboarding code.
export const TAG_ONBOARDING_ELIGIBLE = "onboarding:eligible";

// Truthy when a flag field holds an affirmative value.
export function isYes(value) {
  if (value === null || value === undefined) return false;
  const s = String(value).trim().toLowerCase();
  return s === "yes" || s === "true" || s === "1" || s === "done";
}

// Read a custom field value off a GHL contact object by field id.
// GHL returns contact.customFields as [{ id, value }] on GET but the same
// array may use { id, field_value } in other shapes — handle both.
export function readContactField(contact, fieldId) {
  const arr = contact?.customFields || contact?.customField || [];
  if (!Array.isArray(arr)) return null;
  const hit = arr.find((f) => f && (f.id === fieldId || f.key === fieldId));
  if (!hit) return null;
  const v = hit.value ?? hit.field_value ?? hit.fieldValue;
  return v === undefined ? null : v;
}
