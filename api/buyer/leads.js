// The dashboard's data feed.
//
// GET /api/buyer/leads?t=<token>            → every lead + the month rollups
// GET /api/buyer/leads?t=<token>&id=<id>    → one lead, with its notes trail
//
// Auth is the signed link itself (see _lib/buyer-token.js). Everything this
// returns is scoped to leads we actually delivered — there is no parameter a
// caller can use to reach anything else in the CRM.

import { listLeads, getLead, groupByMonth } from "../_lib/lead-ledger.js";
import { getBuyer, getPricing, priceLeads } from "../_lib/buyer.js";
import { verifyBuyerToken, buyerAuthError, tokenFromRequest, setBuyerCors } from "../_lib/buyer-token.js";

export const config = { runtime: "nodejs" };

function monthLabel(key) {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  });
}

export default async function handler(req, res) {
  setBuyerCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    verifyBuyerToken(tokenFromRequest(req));
  } catch (e) {
    const { status, body } = buyerAuthError(e);
    return res.status(status).json(body);
  }

  if (!process.env.GHL_PIT) {
    return res.status(503).json({ error: "Lead data is temporarily unavailable." });
  }

  // Single-lead detail view.
  const id = String(req.query?.id || "").trim();
  if (id) {
    try {
      const lead = await getLead(id);
      if (!lead) return res.status(404).json({ error: "Lead not found." });
      return res.status(200).json({ ok: true, lead });
    } catch (e) {
      return res.status(502).json({ error: "Couldn't load that lead.", detail: e.message });
    }
  }

  let leads;
  try {
    leads = await listLeads({ limit: 250 });
  } catch (e) {
    return res.status(502).json({ error: "Couldn't load your leads.", detail: e.message });
  }

  const pricing = getPricing();
  const buyer = getBuyer();

  // Per-month rollups drive both the invoice figures and the trend chart.
  const months = groupByMonth(leads).map(([key, rows]) => ({
    key,
    label: monthLabel(key),
    total: rows.length,
    web: rows.filter((l) => l.channel === "web").length,
    phone: rows.filter((l) => l.channel === "phone").length,
    won: rows.filter((l) => l.outcome === "won").length,
    billing: priceLeads(rows, pricing),
  }));

  const thisMonth = months[0] || null;
  const worked = leads.filter((l) => l.outcome !== "new").length;
  const won = leads.filter((l) => l.outcome === "won").length;

  return res.status(200).json({
    ok: true,
    buyer: { name: buyer.name },
    pricing: {
      mode: pricing.mode,
      perLead: pricing.perLead,
      flatMonthly: pricing.flatMonthly,
      includedPerMonth: pricing.includedPerMonth,
    },
    totals: {
      leads: leads.length,
      won,
      // Close rate is only meaningful against leads the buyer has actually
      // worked — counting untouched leads as losses would flatter nobody.
      // `worked` ships alongside it so the dashboard can label the rate with
      // the denominator it was really calculated from.
      worked,
      closeRate: worked ? won / worked : null,
      openDisputes: leads.filter((l) => l.dispute === "open").length,
    },
    thisMonth,
    months,
    leads,
  });
}
