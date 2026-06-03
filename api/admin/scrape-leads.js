// Admin: scrape local daycares/gyms from Google Places into GHL's Cold
// Outreach Pipeline (New Lead stage = review queue). ADMIN_TOKEN-gated.
//
//   GET /api/admin/scrape-leads?token=ADMIN_TOKEN&niche=daycare&city=Worthington
//   GET /api/admin/scrape-leads?token=ADMIN_TOKEN&niche=gym            (all cities)
//   GET /api/admin/scrape-leads?token=ADMIN_TOKEN                      (both niches, all cities)
//
// Dedupes by the "Google Place ID" contact custom field, so re-runs are safe
// and resumable. Returns a JSON summary. Does NOT send anything — texting
// happens later via the review/approve pages.

import { ghl } from "../_lib/ghl.js";
import { searchText, CITIES, NICHES } from "../_lib/places.js";
import { lookupLineType } from "../_lib/twilio-lookup.js";
import {
  COLD_PIPELINE_ID,
  STAGE_NEW_LEAD,
  CONTACT_PLACE_ID,
  TAGS,
} from "../_lib/leads-fields.js";

export const config = { runtime: "nodejs", maxDuration: 60 };

const RUN_CAP = Number(process.env.SCRAPE_RUN_CAP || 50); // max NEW leads per run
const TIME_BUDGET_MS = 50_000;

function normPhone(raw) {
  if (!raw) return "";
  const d = String(raw).replace(/\D/g, "");
  if (d.length === 10) return "+1" + d;
  if (d.length === 11 && d.startsWith("1")) return "+" + d;
  if (String(raw).startsWith("+") && d.length >= 10) return "+" + d;
  return "";
}

async function findByPlaceId(placeId) {
  try {
    const r = await ghl({
      method: "POST",
      path: "/contacts/search",
      body: {
        locationId: process.env.GHL_LOCATION_ID,
        pageLimit: 1,
        filters: [{ field: `customFields.${CONTACT_PLACE_ID}`, operator: "eq", value: placeId }],
      },
    });
    return (r?.contacts || [])[0] || null;
  } catch {
    return null;
  }
}

async function hasOpenColdOpp(contactId) {
  try {
    const r = await ghl({
      method: "GET",
      path: "/opportunities/search",
      query: {
        location_id: process.env.GHL_LOCATION_ID,
        pipeline_id: COLD_PIPELINE_ID,
        contact_id: contactId,
        status: "open",
        limit: 1,
      },
    });
    return (r?.opportunities || []).length > 0;
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  const token = req.query?.token || req.headers["x-admin-token"];
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!process.env.GHL_PIT) return res.status(500).json({ error: "GHL not configured" });

  const nicheParam = String(req.query?.niche || "").toLowerCase();
  const niches = nicheParam && NICHES[nicheParam] ? [nicheParam] : Object.keys(NICHES);
  const cityParam = String(req.query?.city || "").trim();
  const cities = cityParam
    ? CITIES.filter((c) => c.toLowerCase() === cityParam.toLowerCase()).concat(
        CITIES.some((c) => c.toLowerCase() === cityParam.toLowerCase()) ? [] : [cityParam],
      )
    : CITIES;
  const maxPages = Math.min(Number(req.query?.pages || 2), 3);

  const started = Date.now();
  const summary = {
    ok: true, niches, cities: cities.length, scanned: 0, added: 0,
    dupes: 0, noPhone: 0, errors: [], stoppedEarly: false,
  };

  outer: for (const niche of niches) {
    for (const city of cities) {
      if (Date.now() - started > TIME_BUDGET_MS || summary.added >= RUN_CAP) {
        summary.stoppedEarly = true;
        break outer;
      }
      const q = NICHES[niche](city);
      const r = await searchText(q, { maxPages });
      if (!r.ok) { summary.errors.push(`${niche}/${city}: ${r.error}`); continue; }

      for (const place of r.places) {
        summary.scanned++;
        if (Date.now() - started > TIME_BUDGET_MS || summary.added >= RUN_CAP) {
          summary.stoppedEarly = true; break outer;
        }
        if (!place.placeId) continue;
        const phone = normPhone(place.phone);
        if (!phone) { summary.noPhone++; continue; }

        // Dedupe by place_id.
        const existing = await findByPlaceId(place.placeId);
        if (existing) {
          summary.dupes++;
          if (!(await hasOpenColdOpp(existing.id))) {
            await createColdOpp(existing.id, place, city, niche).catch(() => {});
          }
          continue;
        }

        // Create the lead.
        try {
          const lineType = await lookupLineType(phone); // null if Twilio not set
          const tags = [
            TAGS.source, TAGS.commercial, TAGS.niche(niche), TAGS.city(city),
          ];
          if (lineType) tags.push(TAGS.line(lineType));

          const up = await ghl({
            method: "POST",
            path: "/contacts/upsert",
            body: {
              locationId: process.env.GHL_LOCATION_ID,
              firstName: place.name.slice(0, 100),
              companyName: place.name.slice(0, 100),
              phone,
              address1: place.address || undefined,
              city,
              state: "OH",
              website: place.website || undefined,
              country: "US",
              source: "Google Places",
              tags,
              customFields: [{ id: CONTACT_PLACE_ID, field_value: place.placeId }],
            },
          });
          const contactId = up?.contact?.id || up?.id;
          if (!contactId) { summary.errors.push(`${place.name}: no contactId`); continue; }
          await createColdOpp(contactId, place, city, niche);
          summary.added++;
        } catch (e) {
          summary.errors.push(`${place.name}: ${e.message}`);
        }
      }
    }
  }

  summary.elapsedMs = Date.now() - started;
  summary.errors = summary.errors.slice(0, 20);
  return res.status(200).json(summary);
}

async function createColdOpp(contactId, place, city, niche) {
  await ghl({
    method: "POST",
    path: "/opportunities/",
    body: {
      locationId: process.env.GHL_LOCATION_ID,
      pipelineId: COLD_PIPELINE_ID,
      pipelineStageId: STAGE_NEW_LEAD,
      contactId,
      name: `${place.name} — ${city} (${niche})`.slice(0, 120),
      status: "open",
      source: "Google Places",
    },
  });
}
