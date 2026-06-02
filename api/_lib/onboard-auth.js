// Shared auth for the onboarding task endpoints.
//
// Verifies the signed token, fetches the contact (the one GHL read we need
// anyway for state), and confirms the token's nonce still matches the
// contact's stored nonce (revocation check). Returns the contact so callers
// can reuse it. The contactId is derived ONLY from the verified token — never
// from request input.

import { ghl } from "./ghl.js";
import { verifyToken, assertNonce } from "./onboard-token.js";
import {
  CONTACT_ONBOARDING_TOKEN_NONCE,
  readContactField,
} from "./onboarding-fields.js";

/**
 * @param {string} token
 * @returns {Promise<{contact: object, contactId: string}>}
 * @throws Error with .code ("malformed"|"badsig"|"expired"|"purpose"|"revoked"|"notfound"|"ghl")
 */
export async function authContact(token) {
  const { cid, nonce } = verifyToken(token); // throws on bad/expired/forged

  let contact;
  try {
    const resp = await ghl({ method: "GET", path: `/contacts/${cid}` });
    contact = resp?.contact || resp;
  } catch (e) {
    const err = new Error("contact lookup failed");
    err.code = "ghl";
    err.detail = e.message;
    throw err;
  }
  if (!contact?.id) {
    const err = new Error("contact not found");
    err.code = "notfound";
    throw err;
  }

  assertNonce(nonce, readContactField(contact, CONTACT_ONBOARDING_TOKEN_NONCE)); // throws "revoked"

  return { contact, contactId: contact.id };
}

// Map an auth error code to an HTTP status + safe public message.
export function authErrorResponse(err) {
  switch (err?.code) {
    case "expired":
      return { status: 410, body: { error: "This onboarding link has expired. Please ask for a new one." } };
    case "revoked":
      return { status: 410, body: { error: "This onboarding link is no longer valid. Please use the most recent link we sent you." } };
    case "malformed":
    case "badsig":
    case "purpose":
      return { status: 401, body: { error: "Invalid onboarding link." } };
    case "notfound":
      return { status: 404, body: { error: "We couldn't find your record. Please contact us." } };
    default:
      return { status: 502, body: { error: "Something went wrong. Please try again." } };
  }
}

// Restrictive CORS for the PII-carrying onboarding endpoints. The onboarding
// page is same-origin, so we lock the allowed origin to the site.
export function setOnboardCors(res) {
  const origin = (process.env.SITE_BASE_URL || "https://northcolumbuscleaning.com").replace(/\/$/, "");
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Referrer-Policy", "no-referrer");
}

export function clientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (xff) return String(xff).split(",")[0].trim();
  return req.socket?.remoteAddress || "";
}
