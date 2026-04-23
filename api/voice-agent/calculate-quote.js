// Retell AI custom tool — calculate a flat-rate quote for a cleaning job.
//
// Pricing source of truth: voice-agent/pricing.csv
//
// The agent collects (service, sqft, bedrooms, bathrooms, frequency) mid-call
// and calls this endpoint. We return a human-readable `result` field the
// agent reads back verbatim, plus structured fields for downstream use
// (SMS follow-up with booking link, call summary to Zapier, etc.).
//
// If any inputs are missing or malformed, we return a result the agent can
// speak naturally ("I need to know the square footage to give an exact
// number — a rough guess is fine") rather than a terse error.

export const config = { runtime: "nodejs" };

// ---------- Pricing tables (from voice-agent/pricing.csv) ----------

const BASE_RATES = {
  regular: 100,      // Standard residential
  deep: 120,         // Deep clean
  move_in_out: 120,  // Move-in / move-out
};

// Each bracket is [maxSqftInclusive, regular, deep, move_in_out]
// 0-499 sqft: no adder (studio/small apartment — base rate covers it)
const SQFT_BRACKETS = [
  [499, 0, 0, 0],
  [999, 20, 23, 23],
  [1499, 40, 46, 46],
  [1999, 60, 69, 69],
  [2499, 80, 92, 92],
  [2999, 100, 115, 115],
  [3499, 120, 138, 138],
  [3999, 140, 161, 161],
  [4499, 160, 184, 184],
  [4999, 175, 201.25, 201.25],
  [5499, 190, 218.5, 218.5],
  [Infinity, 205, 235.75, 235.75],
];

const PER_BEDROOM = 46;
const PER_BATHROOM = 20;

// Recurring discounts from the sheet
const FREQUENCY_DISCOUNTS = {
  one_time: 0,
  monthly: 0,      // 0% per the sheet
  biweekly: 0.25,  // 25%
  weekly: 0.30,    // 30%
};

// Human-readable service names for the agent's speech
const SERVICE_LABELS = {
  regular: "regular cleaning",
  deep: "deep cleaning",
  move_in_out: "move-in/move-out cleaning",
};

const FREQUENCY_LABELS = {
  one_time: "one-time",
  weekly: "weekly",
  biweekly: "bi-weekly",
  monthly: "monthly",
};

// ---------- Helpers ----------

function serviceIndex(service) {
  // maps to the column offset in SQFT_BRACKETS tuples (1=regular, 2=deep, 3=move)
  if (service === "regular") return 1;
  if (service === "deep") return 2;
  if (service === "move_in_out") return 3;
  return null;
}

function lookupSqftAdder(service, sqft) {
  const idx = serviceIndex(service);
  if (idx == null) return 0;
  for (const bracket of SQFT_BRACKETS) {
    if (sqft <= bracket[0]) return bracket[idx];
  }
  return SQFT_BRACKETS[SQFT_BRACKETS.length - 1][idx];
}

function money(n) {
  // Round to 2 decimals, strip trailing .00 for cleaner speech
  const rounded = Math.round(n * 100) / 100;
  return rounded % 1 === 0 ? `$${rounded.toFixed(0)}` : `$${rounded.toFixed(2)}`;
}

function normalizeService(raw) {
  if (!raw) return null;
  const s = String(raw).toLowerCase().trim();
  if (["regular", "standard", "residential", "basic", "normal"].some((k) => s.includes(k))) return "regular";
  if (s.includes("deep")) return "deep";
  if (["move", "moving", "movein", "moveout", "move-in", "move-out"].some((k) => s.includes(k))) return "move_in_out";
  return null;
}

function normalizeFrequency(raw) {
  if (!raw) return "one_time";
  const s = String(raw).toLowerCase().trim();
  if (s.includes("weekly") && !s.includes("bi") && !s.includes("every other")) return "weekly";
  if (s.includes("biweekly") || s.includes("bi-weekly") || s.includes("every other") || s.includes("every 2")) return "biweekly";
  if (s.includes("monthly") || s.includes("every 4")) return "monthly";
  if (s.includes("one") || s.includes("once") || s.includes("single")) return "one_time";
  return "one_time";
}

// ---------- Core pricing ----------

function calculate({ service, sqft, bedrooms, bathrooms, frequency }) {
  const svc = normalizeService(service);
  if (!svc) {
    return {
      ok: false,
      result: "I wasn't sure which service you meant — is this a regular cleaning, a deep clean, or a move-in/move-out?",
    };
  }

  // Graceful defaults for missing numerics
  const sqftNum = Number(sqft);
  const bedsNum = Number(bedrooms);
  const bathsNum = Number(bathrooms);

  if (!Number.isFinite(sqftNum) || sqftNum <= 0) {
    return {
      ok: false,
      result: "I need a rough square footage to quote accurately — even a ballpark is fine. Most 3-bedroom homes are around 1,500 to 2,000 square feet.",
    };
  }
  if (!Number.isFinite(bedsNum) || bedsNum < 0) {
    return {
      ok: false,
      result: "How many bedrooms are in the home?",
    };
  }
  if (!Number.isFinite(bathsNum) || bathsNum < 0) {
    return {
      ok: false,
      result: "How many bathrooms? Half-baths count as 0.5.",
    };
  }

  const freq = normalizeFrequency(frequency);
  const base = BASE_RATES[svc];
  const sqftAdd = lookupSqftAdder(svc, sqftNum);
  const bedroomAdd = bedsNum * PER_BEDROOM;
  const bathroomAdd = bathsNum * PER_BATHROOM;
  const subtotal = base + sqftAdd + bedroomAdd + bathroomAdd;

  const discount = FREQUENCY_DISCOUNTS[freq] || 0;
  const finalPrice = subtotal * (1 - discount);

  // Also compute alternate frequencies so the agent can offer them
  const alternatives = {};
  for (const [f, d] of Object.entries(FREQUENCY_DISCOUNTS)) {
    alternatives[f] = Math.round(subtotal * (1 - d) * 100) / 100;
  }

  // Build a natural-language result the agent reads back
  const serviceLabel = SERVICE_LABELS[svc];
  const freqLabel = FREQUENCY_LABELS[freq];
  const priceStr = money(finalPrice);

  let result = `For a ${serviceLabel} on a ${sqftNum}-square-foot home with ${bedsNum} bedroom${bedsNum === 1 ? "" : "s"} and ${bathsNum} bathroom${bathsNum === 1 ? "" : "s"}, the ${freqLabel} price is ${priceStr}.`;

  // If they asked for one-time, offer the recurring upsell
  if (freq === "one_time") {
    result += ` If you'd like it recurring, bi-weekly would be ${money(alternatives.biweekly)} each visit, or weekly ${money(alternatives.weekly)} each visit.`;
  }

  return {
    ok: true,
    result,
    price: Math.round(finalPrice * 100) / 100,
    service: svc,
    frequency: freq,
    breakdown: {
      base,
      sqftAdd,
      bedroomAdd,
      bathroomAdd,
      subtotal: Math.round(subtotal * 100) / 100,
      discountPercent: Math.round(discount * 100),
      finalPrice: Math.round(finalPrice * 100) / 100,
    },
    alternatives,
    inputs: { sqft: sqftNum, bedrooms: bedsNum, bathrooms: bathsNum },
  };
}

// ---------- HTTP handler ----------

export default async function handler(req, res) {
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

  // Retell sends: { call: {...}, name: "calculate_quote", args: { ... } }
  // Also accept direct args (for curl testing / general use)
  const args = body?.args || body || {};

  const result = calculate({
    service: args.service,
    sqft: args.sqft ?? args.square_feet ?? args.squareFootage,
    bedrooms: args.bedrooms ?? args.beds,
    bathrooms: args.bathrooms ?? args.baths,
    frequency: args.frequency ?? args.freq,
  });

  return res.status(200).json(result);
}
