// Stateless, signed onboarding link tokens — a mini-JWT without the dependency.
//
// The site has no database, so onboarding links carry their own proof of
// authenticity: an HMAC-SHA256 signature over a small payload, keyed by
// ONBOARDING_SECRET. The token also embeds a per-contact `nonce` that is
// stored on the GHL contact; the verify path re-fetches the contact and
// requires the nonce to match, which makes tokens revocable (bump the nonce
// → every outstanding link dies) despite there being no server-side store.
//
// Token format:  base64url(payloadJson) + "." + base64url(hmac)
// Payload:       { cid, nonce, purpose: "onboarding", exp, v }

import crypto from "node:crypto";

const PURPOSE = "onboarding";
const VERSION = 1;
const DEFAULT_TTL_SECONDS = 14 * 24 * 60 * 60; // 14 days

function getSecret() {
  const s = process.env.ONBOARDING_SECRET;
  if (!s) throw new Error("ONBOARDING_SECRET env var is not set");
  return s;
}

function b64urlEncode(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64urlDecode(str) {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  return Buffer.from(str.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function sign(payloadJson) {
  return crypto.createHmac("sha256", getSecret()).update(payloadJson).digest();
}

/**
 * Mint an onboarding token for a contact.
 *
 * @param {object} opts
 * @param {string} opts.contactId
 * @param {string} opts.nonce       Current value of the contact's nonce field
 * @param {number} [opts.ttlSeconds]
 * @returns {string} token
 */
export function signToken({ contactId, nonce, ttlSeconds = DEFAULT_TTL_SECONDS }) {
  if (!contactId) throw new Error("signToken: contactId required");
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = {
    cid: contactId,
    nonce: String(nonce ?? ""),
    purpose: PURPOSE,
    exp,
    v: VERSION,
  };
  const payloadJson = JSON.stringify(payload);
  const sig = sign(payloadJson);
  return `${b64urlEncode(payloadJson)}.${b64urlEncode(sig)}`;
}

/**
 * Verify a token's signature, purpose and expiry. Does NOT check the nonce
 * against GHL — callers must do that with assertNonce() after fetching the
 * contact (so we only pay one GHL read, shared with state hydration).
 *
 * @param {string} token
 * @returns {{cid: string, nonce: string, exp: number}}  on success
 * @throws  Error with a `.code` of "malformed" | "badsig" | "expired" | "purpose"
 */
export function verifyToken(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) {
    throw withCode(new Error("malformed token"), "malformed");
  }
  const [payloadPart, sigPart] = token.split(".");
  if (!payloadPart || !sigPart) {
    throw withCode(new Error("malformed token"), "malformed");
  }

  let payloadJson;
  let payload;
  try {
    payloadJson = b64urlDecode(payloadPart).toString("utf8");
    payload = JSON.parse(payloadJson);
  } catch {
    throw withCode(new Error("malformed token"), "malformed");
  }

  // Constant-time signature comparison. Guard lengths first — timingSafeEqual
  // throws on length mismatch, which would itself leak a bit of info.
  const expected = sign(payloadJson);
  const given = b64urlDecode(sigPart);
  if (
    expected.length !== given.length ||
    !crypto.timingSafeEqual(expected, given)
  ) {
    throw withCode(new Error("bad signature"), "badsig");
  }

  if (payload.purpose !== PURPOSE) {
    throw withCode(new Error("wrong purpose"), "purpose");
  }
  if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) {
    throw withCode(new Error("token expired"), "expired");
  }

  return { cid: payload.cid, nonce: String(payload.nonce ?? ""), exp: payload.exp };
}

/**
 * Confirm the nonce baked into the token still matches the contact's current
 * nonce. Throws (code "revoked") if not. A blank stored nonce never matches a
 * blank token nonce by design — a contact must have been explicitly invited.
 */
export function assertNonce(tokenNonce, contactNonce) {
  const a = String(tokenNonce ?? "");
  const b = String(contactNonce ?? "");
  if (!a || !b || a !== b) {
    throw withCode(new Error("token revoked"), "revoked");
  }
}

// Generate a fresh random nonce to store on the contact at invite time.
export function newNonce() {
  return crypto.randomBytes(12).toString("hex");
}

function withCode(err, code) {
  err.code = code;
  return err;
}
