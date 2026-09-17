// Signed access links for the buyer dashboard.
//
// There is one buyer and no database, so there is no account to log into.
// Instead the buyer gets a long, unguessable, HMAC-signed link. Holding the
// link IS the credential — the same model as a private calendar feed.
//
// Two properties make that safe enough for what the dashboard exposes:
//   * Unforgeable. The signature is HMAC-SHA256 over the payload, keyed by a
//     secret that never leaves the server. You cannot mint a link.
//   * Revocable. The token embeds BUYER_ACCESS_NONCE. Change that env var and
//     every link ever issued stops working, immediately.
//
// Token format:  base64url(payloadJson) + "." + base64url(hmac)
// Payload:       { sub: "buyer", nonce, purpose: "buyer-dashboard", exp, v }

import crypto from "node:crypto";

const PURPOSE = "buyer-dashboard";
const VERSION = 1;
const DEFAULT_TTL_SECONDS = 365 * 24 * 60 * 60; // a year — this is their standing link

function getSecret() {
  const s = process.env.BUYER_SECRET || process.env.ONBOARDING_SECRET;
  if (!s) throw new Error("BUYER_SECRET (or ONBOARDING_SECRET) env var is not set");
  return s;
}

// The revocation handle. Defaults to a constant so the dashboard works before
// anyone sets it; rotating it later is what kills outstanding links.
export function currentNonce() {
  return process.env.BUYER_ACCESS_NONCE || "v1";
}

function b64urlEncode(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(str) {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  return Buffer.from(str.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function sign(payloadJson) {
  return crypto.createHmac("sha256", getSecret()).update(payloadJson).digest();
}

function withCode(err, code) {
  err.code = code;
  return err;
}

/** Mint the buyer's dashboard token. */
export function signBuyerToken({ ttlSeconds = DEFAULT_TTL_SECONDS } = {}) {
  const payload = {
    sub: "buyer",
    nonce: currentNonce(),
    purpose: PURPOSE,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    v: VERSION,
  };
  const payloadJson = JSON.stringify(payload);
  return `${b64urlEncode(payloadJson)}.${b64urlEncode(sign(payloadJson))}`;
}

/**
 * Verify signature, purpose, expiry and nonce.
 * @throws Error with .code of "malformed" | "badsig" | "purpose" | "expired" | "revoked"
 */
export function verifyBuyerToken(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) {
    throw withCode(new Error("malformed token"), "malformed");
  }
  const [payloadPart, sigPart] = token.split(".");
  if (!payloadPart || !sigPart) throw withCode(new Error("malformed token"), "malformed");

  let payloadJson;
  let payload;
  try {
    payloadJson = b64urlDecode(payloadPart).toString("utf8");
    payload = JSON.parse(payloadJson);
  } catch {
    throw withCode(new Error("malformed token"), "malformed");
  }

  // Guard the length before timingSafeEqual — it throws on a mismatch, and
  // that throw would itself leak a bit about the signature.
  const expected = sign(payloadJson);
  const given = b64urlDecode(sigPart);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) {
    throw withCode(new Error("bad signature"), "badsig");
  }

  if (payload.purpose !== PURPOSE) throw withCode(new Error("wrong purpose"), "purpose");
  if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) {
    throw withCode(new Error("token expired"), "expired");
  }
  if (String(payload.nonce ?? "") !== currentNonce()) {
    throw withCode(new Error("token revoked"), "revoked");
  }

  return { sub: payload.sub, exp: payload.exp };
}

/** Map an auth failure to a status + a message that gives nothing away. */
export function buyerAuthError(err) {
  switch (err?.code) {
    case "expired":
      return { status: 410, body: { error: "This dashboard link has expired. Ask us for a new one." } };
    case "revoked":
      return { status: 410, body: { error: "This dashboard link is no longer valid. Ask us for a new one." } };
    default:
      return { status: 401, body: { error: "Invalid dashboard link." } };
  }
}

/** Read the token from the Authorization header or a `t` query param. */
export function tokenFromRequest(req) {
  const auth = req.headers?.authorization || "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return String(req.query?.t || "").trim();
}

/** Lock the buyer endpoints to our own origin — they carry lead PII. */
export function setBuyerCors(res) {
  const origin = (process.env.SITE_BASE_URL || "https://northcolumbuscleaning.com").replace(/\/$/, "");
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
}
