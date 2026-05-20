// North Columbus Cleaning — pricing engine.
//
// Mirrors the Booking Koala admin pricing model:
//   base = sqft_price[service][sqft_range]
//   final = base × (1 − frequency_discount)
//
// Sqft is the only price driver. The Bedroom and Bathroom parameter tables
// in BK are NOT part of the formula — they're collected for scoping/time
// estimation but do not change the price. (Confirmed by operator 2026-05-20.)
//
// Frequencies are restricted per service:
//   - Standard: every frequency
//   - Deep: One-Time, Every 3 Weeks, Monthly (no Weekly or Biweekly)
//   - Move In/Out: One-Time only

// ---- Sqft pricing tables, per service ----

// Each row: [minSqft, maxSqft, price].
// Bands not listed for a service mean "custom quote — fall outside our standard pricing."
const SQFT_PRICE = {
  standard: [
    // No row under 1000 sqft for Standard (small apartments → custom quote).
    [1000, 1499, 75],
    [1500, 1999, 75],
    [2000, 2499, 110],
    [2500, 2999, 140],
    [3000, 3499, 180],
    [3500, 3999, 230],
    [4000, 4499, 280],
    [4500, 4999, 315],
    [5000, 5499, 350],
    [5500, 5999, 400],
  ],
  deep: [
    [500, 999, 135],
    [1000, 1499, 155],
    [1500, 1999, 205],
    [2000, 2499, 245],
    [2500, 2999, 245], // BK has same price for both — verified in screenshot.
    [3000, 3499, 275],
    [3500, 3999, 305],
    [4000, 4499, 335],
    [4500, 4999, 375],
    [5000, 5499, 405],
    [5500, Infinity, 410], // BK labels this row "5000+ Sq Ft" → using as 5500+.
  ],
  move_in_out: [
    [500, 999, 215],
    [1000, 1499, 235],
    [1500, 1999, 255],
    [2000, 2499, 305],
    [2500, 2999, 405],
    [3000, 3499, 405],
    [3500, 3999, 455],
    [4000, 4499, 485],
    // TODO: BK rows for 4500+ Move In/Out not yet captured. Currently
    //       quotes at this size flag for custom-quote follow-up.
  ],
};

// Recurring discounts.
const FREQUENCY_DISCOUNT = {
  one_time: 0,
  every_3_weeks: 0.085,
  biweekly: 0.15,
  weekly: 0.20,
  monthly: 0,
};

// Allowed (service, frequency) combinations.
const ALLOWED_FREQ = {
  standard: new Set(["one_time", "weekly", "biweekly", "every_3_weeks", "monthly"]),
  deep: new Set(["one_time", "every_3_weeks", "monthly"]),
  move_in_out: new Set(["one_time"]),
};

const SERVICE_LABEL = {
  standard: "Standard Cleaning",
  deep: "Deep Cleaning",
  move_in_out: "Move In/Out Cleaning",
};
const FREQUENCY_LABEL = {
  one_time: "One-Time",
  every_3_weeks: "Every 3 Weeks",
  biweekly: "Every 2 Weeks",
  weekly: "Weekly",
  monthly: "Monthly",
};

export const SERVICES = Object.keys(SERVICE_LABEL);
export const FREQUENCIES = Object.keys(FREQUENCY_DISCOUNT);
export const SQFT_BRACKETS_BY_SERVICE = SQFT_PRICE;

/** Return the frequencies that BK actually offers for a given service. */
export function frequenciesForService(service) {
  const set = ALLOWED_FREQ[service] || ALLOWED_FREQ.standard;
  return FREQUENCIES.filter((f) => set.has(f));
}

// ---- Lookups ----

function lookupSqftPrice(service, sqft) {
  const table = SQFT_PRICE[service];
  if (!table) return { price: null, bracket: null, capped: false, error: `unknown service ${service}` };
  if (!sqft || sqft < 0) return { price: null, bracket: null, capped: false, error: "no sqft provided" };
  for (const [lo, hi, price] of table) {
    if (sqft >= lo && sqft <= hi) {
      const label = hi === Infinity ? `${lo}+` : `${lo}-${hi}`;
      return { price, bracket: label, capped: false };
    }
  }
  // Below the lowest band → flag for custom quote.
  const lowest = table[0][0];
  if (sqft < lowest) {
    return {
      price: null,
      bracket: `<${lowest}`,
      capped: false,
      error: `Sqft ${sqft} is below the smallest standard band (${lowest}). Custom quote needed.`,
    };
  }
  // Above the highest band → flag for custom quote.
  const last = table[table.length - 1];
  return {
    price: null,
    bracket: `>${last[1]}`,
    capped: true,
    error: `Sqft ${sqft} exceeds the largest standard band. Custom quote needed.`,
  };
}

// ---- Main calculation ----

/**
 * Calculate a quote.
 *
 * @param {object} input
 * @param {"standard"|"deep"|"move_in_out"} input.service
 * @param {number} input.sqft      Approx, used to look up the bracket
 * @param {string} input.frequency "one_time"|"weekly"|"biweekly"|"every_3_weeks"|"monthly"
 * @param {number} [input.bedrooms]  Captured for the team; not used in price calc
 * @param {number} [input.bathrooms] Captured for the team; not used in price calc
 */
export function calculateQuote(input) {
  const service = (input.service || "standard").toLowerCase();
  const frequency = (input.frequency || "one_time").toLowerCase();
  const sqft = Number(input.sqft) || 0;
  const bedrooms = Number(input.bedrooms) || 0;
  const bathrooms = Number(input.bathrooms) || 0;

  const inputs = { service, frequency, sqft, bedrooms, bathrooms };
  const flags = [];

  // 1. Validate service/frequency combination
  const allowed = ALLOWED_FREQ[service];
  if (!allowed) {
    return {
      inputs,
      breakdown: { base: 0, discount: 0, total: 0, flags: [`Unknown service "${service}"`] },
      summary: `Unknown service: ${service}`,
      error: true,
    };
  }
  if (!allowed.has(frequency)) {
    const allowedList = [...allowed].map((f) => FREQUENCY_LABEL[f]).join(", ");
    flags.push(
      `${SERVICE_LABEL[service]} doesn't support ${FREQUENCY_LABEL[frequency]}. Valid frequencies: ${allowedList}.`,
    );
  }

  // 2. Look up sqft price
  const sq = lookupSqftPrice(service, sqft);
  if (sq.error) flags.push(sq.error);

  const base = sq.price || 0;
  const discountPct = FREQUENCY_DISCOUNT[frequency] ?? 0;
  const discount = +(base * discountPct).toFixed(2);
  const total = +(base - discount).toFixed(2);

  const breakdown = {
    sqftBracket: sq.bracket || "n/a",
    base,
    discountPct,
    discount,
    total,
    flags,
  };

  const summary = formatSummary(inputs, breakdown);

  return { inputs, breakdown, summary, error: flags.length > 0 && !sq.price };
}

function formatSummary(inputs, b) {
  const lines = [
    `${SERVICE_LABEL[inputs.service] || inputs.service} — ${inputs.sqft || "?"} sqft (${inputs.bedrooms}bd / ${inputs.bathrooms}ba)`,
    `Frequency: ${FREQUENCY_LABEL[inputs.frequency] || inputs.frequency}`,
    ``,
    `Base (${b.sqftBracket}): $${b.base.toFixed(2)}`,
  ];
  if (b.discountPct > 0) {
    lines.push(
      `Recurring discount (${(b.discountPct * 100).toFixed(1)}%): −$${b.discount.toFixed(2)}`,
    );
  }
  lines.push(`Total: $${b.total.toFixed(2)} per visit`);
  if (b.flags.length) {
    lines.push("");
    for (const f of b.flags) lines.push(`⚠️  ${f}`);
  }
  return lines.join("\n");
}

// SMS-friendly one-liner the team can paste straight to the customer.
export function formatForSms(quote, firstName) {
  const name = firstName ? firstName.trim() : "there";
  const svc = SERVICE_LABEL[quote.inputs.service] || quote.inputs.service;
  const freq = FREQUENCY_LABEL[quote.inputs.frequency] || quote.inputs.frequency;
  if (!quote.breakdown.base) {
    return (
      `Hi ${name}! We need to put together a custom quote for your ${svc.toLowerCase()} ` +
      `(${quote.inputs.sqft} sqft, ${freq}) — our team will reach out shortly.`
    );
  }
  return (
    `Hi ${name}! Quote for your ${svc.toLowerCase()} — ` +
    `${quote.inputs.sqft} sqft, ${freq}: ` +
    `$${quote.breakdown.total.toFixed(2)} per visit. ` +
    `Ready to book?`
  );
}
