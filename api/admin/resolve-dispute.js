// Resolve a lead dispute the buyer filed.
//
// GET  /api/admin/resolve-dispute?token=ADMIN_TOKEN
//        → lists the open disputes waiting on a decision
// POST /api/admin/resolve-dispute?token=ADMIN_TOKEN
//        { id, decision: "approved" | "denied", note? }
//
// Approving credits the lead: it stops being billable, on this month's total
// and in the cost-per-lead figure the buyer sees on their dashboard.

import { listLeads, getLead, resolveDispute } from "../_lib/lead-ledger.js";

export const config = { runtime: "nodejs" };

function isAuthorized(req) {
  const token = req.query?.token || req.headers["x-admin-token"];
  if (!process.env.ADMIN_TOKEN) return false;
  return String(token || "").trim() === String(process.env.ADMIN_TOKEN).trim();
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!isAuthorized(req)) return res.status(401).json({ error: "Unauthorized" });

  if (req.method === "GET") {
    try {
      const leads = await listLeads({ limit: 250 });
      const open = leads.filter((l) => l.dispute === "open");
      // Pull the notes for each open dispute so the reason the buyer gave is
      // right there in the response — no second lookup to make a decision.
      const detailed = await Promise.all(
        open.map(async (l) => {
          const full = await getLead(l.id).catch(() => null);
          const reason = full?.notes?.find((n) => n.body.startsWith("DISPUTE FILED"));
          return { ...l, reason: reason?.body || null };
        }),
      );
      return res.status(200).json({ ok: true, open: detailed });
    } catch (e) {
      return res.status(502).json({ error: e.message });
    }
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: "Invalid JSON" });
    }
  }
  body = body || {};

  const id = String(body.id || "").trim();
  const decision = String(body.decision || "").trim();
  if (!id) return res.status(400).json({ error: "Missing lead id." });
  if (decision !== "approved" && decision !== "denied") {
    return res.status(400).json({ error: 'decision must be "approved" or "denied"' });
  }

  try {
    const result = await resolveDispute(id, decision, String(body.note || "").slice(0, 500));
    return res.status(200).json(result);
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
}
