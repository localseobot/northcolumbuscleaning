// Google service-account auth without any npm dependency.
//
// We sign the OAuth2 JWT assertion ourselves (RS256, via Node crypto) using
// the service account's private key, then exchange it at Google's token
// endpoint for a short-lived access token. The token is cached in module
// scope until shortly before it expires, so warm invocations skip the round
// trip.
//
// NOTE: service accounts have ZERO My Drive storage quota, so uploads MUST
// target a folder inside a Shared Drive (drive.js handles this via
// GDRIVE_SHARED_DRIVE_ID + supportsAllDrives=true). The service account must
// be a member (Content manager) of that Shared Drive.
//
// Env vars (set in Vercel):
//   GDRIVE_SA_EMAIL        service account client_email
//   GDRIVE_SA_PRIVATE_KEY  service account private_key (PEM). Vercel stores
//                          newlines as literal "\n" — we restore them here.
//
// Scope is drive.file: the app can only see/manage files it created, which is
// the least privilege needed to upload onboarding documents.

import crypto from "node:crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/drive.file";

let cached = null; // { token, exp }

function b64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function getPrivateKey() {
  const raw = process.env.GDRIVE_SA_PRIVATE_KEY;
  if (!raw) throw new Error("GDRIVE_SA_PRIVATE_KEY not set");
  // Vercel-stored keys keep newlines as the two-char sequence \n.
  return raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
}

/**
 * Returns true when Drive credentials are configured. Lets callers no-op
 * gracefully (matching slack.js / resend.js house style).
 */
export function driveConfigured() {
  return Boolean(process.env.GDRIVE_SA_EMAIL && process.env.GDRIVE_SA_PRIVATE_KEY);
}

/**
 * Get a valid Google access token, minting a new one if the cache is empty or
 * within 60s of expiry.
 * @returns {Promise<string>}
 */
export async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.exp - 60 > now) return cached.token;

  const email = process.env.GDRIVE_SA_EMAIL;
  if (!email) throw new Error("GDRIVE_SA_EMAIL not set");

  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(
    JSON.stringify({
      iss: email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  );
  const signingInput = `${header}.${claim}`;
  const signature = crypto
    .createSign("RSA-SHA256")
    .update(signingInput)
    .sign(getPrivateKey());
  const assertion = `${signingInput}.${b64url(signature)}`;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(
      `Google token exchange failed: ${res.status} ${
        data.error_description || data.error || JSON.stringify(data)
      }`,
    );
  }

  cached = { token: data.access_token, exp: now + (data.expires_in || 3600) };
  return cached.token;
}
