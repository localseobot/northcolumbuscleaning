// Signed claim tokens for the cleaner shift-coverage flow.
//
// We don't store offer state in a database — instead we encode the
// offer details (oppId, cleanerId, expiresAt) into an HMAC-signed token
// that the cleaner gets in their offer SMS. When they tap the link, the
// /api/ops/claim endpoint verifies the signature and processes the claim
// atomically by reassigning the opp (which acts as our race-condition
// gate — two cleaners can't both claim the same opp since the second
// PUT will see provider already updated).
//
// Token format: base64url(payloadJson).hex(hmacSha256(payloadJson))
//
// CLAIM_SECRET env var is required for production. We fall back to a
// dev-only secret so local tests don't crash, but log a warning.

import crypto from "node:crypto";

const DEV_FALLBACK = "ncc-dev-only-claim-secret-do-not-use-in-prod";

function getSecret() {
  return process.env.CLAIM_SECRET || DEV_FALLBACK;
}

function b64url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
function b64urlDecode(s) {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 ? 4 - (padded.length % 4) : 0;
  return Buffer.from(padded + "=".repeat(pad), "base64");
}

function sign(payloadStr) {
  return crypto
    .createHmac("sha256", getSecret())
    .update(payloadStr)
    .digest("hex");
}

/**
 * Build a signed claim token.
 *
 * @param {object} payload
 * @param {string} payload.oppId
 * @param {string} payload.cleanerId
 * @param {number} [payload.expiresInMinutes=30]
 * @returns {string}
 */
export function buildClaimToken({ oppId, cleanerId, expiresInMinutes = 30 }) {
  const payload = {
    oppId,
    cleanerId,
    expiresAt: Date.now() + expiresInMinutes * 60 * 1000,
  };
  const json = JSON.stringify(payload);
  const encoded = b64url(json);
  const sig = sign(json);
  return `${encoded}.${sig}`;
}

/**
 * Verify and decode a token.
 *
 * @param {string} token
 * @returns {{ok: true, payload: {oppId, cleanerId, expiresAt}} | {ok: false, reason: string}}
 */
export function verifyClaimToken(token) {
  if (!token || typeof token !== "string") {
    return { ok: false, reason: "missing token" };
  }
  const [encoded, sig] = token.split(".");
  if (!encoded || !sig) return { ok: false, reason: "malformed token" };
  let json;
  try {
    json = b64urlDecode(encoded).toString("utf8");
  } catch {
    return { ok: false, reason: "decode failed" };
  }
  const expectedSig = sign(json);
  // Constant-time compare to prevent timing attacks
  const a = Buffer.from(sig, "hex");
  const b = Buffer.from(expectedSig, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: "invalid signature" };
  }
  let payload;
  try {
    payload = JSON.parse(json);
  } catch {
    return { ok: false, reason: "payload not json" };
  }
  if (!payload.oppId || !payload.cleanerId) {
    return { ok: false, reason: "missing required payload fields" };
  }
  if (payload.expiresAt && Date.now() > payload.expiresAt) {
    return { ok: false, reason: "token expired" };
  }
  return { ok: true, payload };
}
