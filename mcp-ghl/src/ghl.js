// Thin GoHighLevel v2 API client.
//
// Auth: Private Integration Token in `GHL_PIT` env var.
// Default location: `GHL_LOCATION_ID` env var (used when a tool omits it).
//
// Most v2 endpoints require `Authorization: Bearer <token>` and
// `Version: 2021-07-28`. Payments endpoints use `2021-04-15`.

const BASE = process.env.GHL_BASE_URL || "https://services.leadconnectorhq.com";

export function getDefaultLocationId() {
  return process.env.GHL_LOCATION_ID || null;
}

function getToken() {
  const t = process.env.GHL_PIT;
  if (!t) throw new Error("GHL_PIT env var is not set");
  return t;
}

/**
 * Call a GHL v2 endpoint.
 *
 * @param {object} opts
 * @param {string} opts.method   HTTP verb (GET/POST/PUT/DELETE)
 * @param {string} opts.path     Path beginning with "/", e.g. "/contacts/"
 * @param {object} [opts.query]  Query-string params (values stringified)
 * @param {object} [opts.body]   JSON body for non-GET
 * @param {string} [opts.version] API version header (default 2021-07-28)
 */
export async function ghl({ method, path, query, body, version }) {
  const url = new URL(BASE + path);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(v)) {
        for (const item of v) url.searchParams.append(k, String(item));
      } else {
        url.searchParams.set(k, String(v));
      }
    }
  }

  const headers = {
    Authorization: `Bearer ${getToken()}`,
    Version: version || "2021-07-28",
    Accept: "application/json",
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }

  if (!res.ok) {
    const err = new Error(
      `GHL ${method} ${path} -> ${res.status} ${res.statusText}: ${
        typeof parsed === "string" ? parsed : JSON.stringify(parsed)
      }`,
    );
    err.status = res.status;
    err.body = parsed;
    throw err;
  }

  return parsed;
}
