// Put today's Sales Pipeline opportunities on the buyer dashboard.
//
// The dashboard only lists contacts tagged `lead:delivered`. Inbound form or
// call tests that created a GHL opportunity without going through recordLead()
// are invisible until we tag them.
//
// GET  /api/admin/backfill-leads?token=ADMIN_TOKEN
//        → preview today's opps (America/New_York) and what would be tagged
// POST /api/admin/backfill-leads?token=ADMIN_TOKEN
//        → tag missing rows via recordLead (existing contact + opportunity)
// POST /api/admin/backfill-leads?token=ADMIN_TOKEN&createTest=1
//        → if today has no sales opps, seed 2 labeled TEST leads
//
// Query: day=YYYY-MM-DD (default today), markTest=0 to bill backfilled rows.
// TEST / demo rows get `lead:test` and are not billed.

import { backfillTodayLeads } from "../_lib/lead-ledger.js";

export const config = { runtime: "nodejs" };

function isAuthorized(req) {
  const token = req.query?.token || req.headers["x-admin-token"];
  if (!process.env.ADMIN_TOKEN) return false;
  return String(token || "").trim() === String(process.env.ADMIN_TOKEN).trim();
}

function flag(v, fallback) {
  if (v === undefined || v === null || v === "") return fallback;
  const s = String(v).trim().toLowerCase();
  if (s === "1" || s === "true" || s === "yes") return true;
  if (s === "0" || s === "false" || s === "no") return false;
  return fallback;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!isAuthorized(req)) return res.status(401).json({ error: "Unauthorized" });
  if (!process.env.GHL_PIT) return res.status(503).json({ error: "GHL_PIT not set" });

  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const day = String(req.query?.day || "").trim() || undefined;
  const markTest = flag(req.query?.markTest, true);
  const createTestIfEmpty = flag(req.query?.createTest, false);

  try {
    const result = await backfillTodayLeads({
      day,
      dryRun: req.method === "GET",
      markTest,
      createTestIfEmpty,
    });
    return res.status(200).json(result);
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
}
