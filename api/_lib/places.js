// Google Places API (New) Text Search wrapper.
//
// One call returns business name, address, location, types, website AND phone
// (via the FieldMask) — no separate Place Details call needed. Requires
// GOOGLE_PLACES_API_KEY (a Places-API-restricted key on a billing-enabled GCP
// project). New API page tokens are usable immediately; we cap at 3 pages
// (≈60 results) per query to bound cost.

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

// Service-area cities to sweep.
export const CITIES = [
  "Worthington", "Westerville", "Dublin", "Powell", "Upper Arlington",
  "New Albany", "Gahanna", "Clintonville", "Lewis Center", "Delaware",
  "Hilliard", "Polaris",
];

// Niche → text query builder.
export const NICHES = {
  daycare: (city) => `daycares and childcare centers in ${city}, Ohio`,
  gym: (city) => `gyms and fitness centers in ${city}, Ohio`,
};

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
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return { ok: false, error: "GOOGLE_PLACES_API_KEY not set", places: [] };

  const out = [];
  let pageToken;
  for (let i = 0; i < maxPages; i++) {
    const body = { textQuery, pageSize: 20, regionCode: "US", languageCode: "en" };
    if (pageToken) body.pageToken = pageToken;

    let res, data;
    try {
      res = await fetch(PLACES_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": key,
          "X-Goog-FieldMask": FIELD_MASK,
        },
        body: JSON.stringify(body),
      });
      data = await res.json().catch(() => ({}));
    } catch (e) {
      return { ok: false, error: e.message, places: out };
    }
    if (!res.ok) {
      return { ok: false, error: data?.error?.message || `Places ${res.status}`, places: out };
    }
    for (const p of data.places || []) out.push(normalizePlace(p));
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return { ok: true, places: out };
}
