// Server-side GoHighLevel v2 API client.
//
// Mirrors mcp-ghl/src/ghl.js so the Vercel webhooks can write to GHL
// the same way the local MCP server does. Auth via Private Integration
// Token in `GHL_PIT`. Default sub-account from `GHL_LOCATION_ID`.

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
 * @param {string} opts.method
 * @param {string} opts.path     Starts with "/", e.g. "/contacts/upsert"
 * @param {object} [opts.query]
 * @param {object} [opts.body]
 * @param {string} [opts.version] Defaults to 2021-07-28
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

/**
 * Query params for GET /opportunities/search.
 *
 * POST /opportunities/search is a different "advanced search" DTO. It accepts
 * `locationId` but rejects `pipelineId` / `getCustomFields` with 422
 * "property should not exist". Pipeline/stage/contact filters belong here as
 * snake_case query params (same as outreach-review and mcp-ghl).
 *
 * GET limit is capped at 100 by GHL.
 */
export function opportunitySearchQuery({
  locationId,
  pipelineId,
  pipelineStageId,
  contactId,
  status,
  limit,
} = {}) {
  const capped = Math.min(Math.max(Number(limit) || 20, 1), 100);
  return {
    location_id: locationId || getDefaultLocationId(),
    pipeline_id: pipelineId,
    pipeline_stage_id: pipelineStageId,
    contact_id: contactId,
    status,
    limit: capped,
  };
}

/**
 * Search opportunities. Filters server-side via GET query params, then again
 * client-side so a silently ignored pipeline/stage/contact filter cannot leak
 * rows from another pipeline.
 */
export async function searchOpportunities(opts = {}) {
  const res = await ghl({
    method: "GET",
    path: "/opportunities/search",
    query: opportunitySearchQuery(opts),
  });
  let opportunities = res?.opportunities || [];
  if (opts.pipelineId) {
    opportunities = opportunities.filter((o) => o.pipelineId === opts.pipelineId);
  }
  if (opts.pipelineStageId) {
    opportunities = opportunities.filter((o) => o.pipelineStageId === opts.pipelineStageId);
  }
  if (opts.contactId) {
    opportunities = opportunities.filter((o) => o.contactId === opts.contactId);
  }
  return { ...res, opportunities };
}
