// Public-facing quote endpoint. Same pricing engine as the internal
// admin tool, no token gate. Used by /quote on the marketing site.
//
// POST { service, sqft, frequency, bedrooms?, bathrooms? }
// Returns { ok, total, base, discountPct, sqftBracket, flags, summary }

import { calculateQuote } from "./_lib/pricing.js";

export const config = { runtime: "nodejs" };

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: "Invalid JSON" });
    }
  }
  body = body || {};

  const quote = calculateQuote({
    service: body.service,
    sqft: body.sqft,
    frequency: body.frequency,
    bedrooms: body.bedrooms,
    bathrooms: body.bathrooms,
  });

  return res.status(200).json({
    ok: !!quote.breakdown.base,
    inputs: quote.inputs,
    base: quote.breakdown.base,
    discountPct: quote.breakdown.discountPct,
    discount: quote.breakdown.discount,
    total: quote.breakdown.total,
    sqftBracket: quote.breakdown.sqftBracket,
    flags: quote.breakdown.flags,
    summary: quote.summary,
  });
}
