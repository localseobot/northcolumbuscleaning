// Google Places API (New) Text Search wrapper.
//
// One call returns business name, address, location, types, website AND phone
// (via the FieldMask) — no separate Place Details call needed. Caps at 3 pages
// (≈60 results) per query to bound cost.
//
// Auth (two supported modes, checked in order):
//   1. GOOGLE_PLACES_API_KEY  → sent as X-Goog-Api-Key (simplest).
//   2. The Drive service account already in Vercel (GDRIVE_SA_EMAIL +
//      GDRIVE_SA_PRIVATE_KEY) → OAuth Bearer + X-Goog-User-Project. Requires
//      Places API enabled + billing on the SA's project and the SA granted
//      roles/serviceusage.serviceUsageConsumer there. No API key needed.

import crypto from "node:crypto";

const PLACES_URL = "https://places.googleapis.com/v1/places:searchText";
const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.nationalPhoneNumber",
  "places.internationalPhoneNumber",
  "places.websiteUri",
  "places.location",
  "places.types",
  "places.businessStatus",
  "nextPageToken",
].join(",");

export const CITIES = [
  "Worthington", "Westerville", "Dublin", "Powell", "Upper Arlington",
  "New Albany", "Gahanna", "Clintonville", "Lewis Center", "Delaware",
  "Hilliard", "Polaris",
];

export const NICHES = {
  daycare: (city) => `daycares and childcare centers in ${city}, Ohio`,
  gym: (city) => `gyms and fitness centers in ${city}, Ohio`,
};

// ── Service-account OAuth (fallback when no API key) ───────────────────────
let _saTok = null; // { token, exp }
function saProject() {
  if (process.env.GCP_PROJECT_ID) return process.env.GCP_PROJECT_ID;
  const m = String(process.env.GDRIVE_SA_EMAIL || "").match(/@([^.]+)\./);
  return m ? m[1] : "";
}
function saPrivateKey() {
  const raw = process.env.GDRIVE_SA_PRIVATE_KEY || "";
  return raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
}
async function saAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (_saTok && _saTok.exp - 60 > now) return _saTok.token;
  const email = process.env.GDRIVE_SA_EMAIL;
  if (!email) throw new Error("no SA email");
  const b64 = (i) => Buffer.from(i).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const input =
    `${b64(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.` +
    `${b64(JSON.stringify({ iss: email, scope: "https://www.googleapis.com/auth/cloud-platform", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }))}`;
  const assertion = `${input}.${b64(crypto.createSign("RSA-SHA256").update(input).sign(saPrivateKey()))}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.access_token) throw new Error("SA token exchange failed");
  _saTok = { token: data.access_token, exp: now + (data.expires_in || 3600) };
  return _saTok.token;
}

async function authHeaders() {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (key) return { "X-Goog-Api-Key": key };
  if (process.env.GDRIVE_SA_EMAIL && process.env.GDRIVE_SA_PRIVATE_KEY) {
    const proj = saProject();
    if (!proj) return null;
    return { Authorization: "Bearer " + (await saAccessToken()), "X-Goog-User-Project": proj };
  }
  return null;
}

function normalizePlace(p) {
  return {
    placeId: p.id || "",
    name: p.displayName?.text || "",
    phone: p.nationalPhoneNumber || p.internationalPhoneNumber || "",
    website: p.websiteUri || "",
    address: p.formattedAddress || "",
    types: p.types || [],
    status: p.businessStatus || "",
  };
}

/**
 * Run a Text Search, following up to maxPages of results.
 * @returns {Promise<{ok: boolean, places: object[], error?: string}>}
 */
export async function searchText(textQuery, { maxPages = 3 } = {}) {
  let auth;
  try {
    auth = await authHeaders();
  } catch (e) {
    return { ok: false, error: `Places auth failed: ${e.message}`, places: [] };
  }
  if (!auth) {
    return { ok: false, error: "No Places credential (set GOOGLE_PLACES_API_KEY or the Drive SA env)", places: [] };
  }

  const out = [];
  let pageToken;
  for (let i = 0; i < maxPages; i++) {
    const body = { textQuery, pageSize: 20, regionCode: "US", languageCode: "en" };
    if (pageToken) body.pageToken = pageToken;
    let res, data;
    try {
      res = await fetch(PLACES_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Goog-FieldMask": FIELD_MASK, ...auth },
        body: JSON.stringify(body),
      });
      data = await res.json().catch(() => ({}));
    } catch (e) {
      return { ok: false, error: e.message, places: out };
    }
    if (!res.ok) return { ok: false, error: data?.error?.message || `Places ${res.status}`, places: out };
    for (const p of data.places || []) out.push(normalizePlace(p));
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return { ok: true, places: out };
}
