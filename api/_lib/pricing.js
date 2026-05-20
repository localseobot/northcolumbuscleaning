// North Columbus Cleaning — pricing engine.
//
// Mirrors the Booking Koala admin pricing model:
//   Total = bedroom_adder + bathroom_adder + sqft_adder
//   Final = Total × (1 − frequency_discount)
//
// Source of truth for the numbers is BK's pricing pages; transcribed below.
// If you change pricing in BK, update these tables to match (or vice versa).
//
// TODOs to verify with a real BK booking:
//   1. Square Footage table is documented in BK as "Standard Cleaning" only.
//      Currently this engine applies the same sqft adders to Deep + Move In/Out.
//      If BK uses different sqft pricing for those services, swap to per-service tables.
//   2. Under 1000 sqft → currently $0 sqft adder. Verify this matches BK.
//   3. The BK admin shows an "Exclude parameters" section (Bedroom $5, Full Bath $10,
//      qty-based). This engine ignores it — assumed to be optional add-on/remove logic.

// ---- Adders ----

// Per-bedroom-count price (NOT per bedroom — this is the total bedroom adder
// for a home with N bedrooms). Same across all three service categories.
const BEDROOM_PRICE = {
  1: 25,
  2: 50,
  3: 75,
  4: 100,
  5: 115,
  6: 130,
  7: 145,
};

// Per-bathroom-count price. Includes half-baths (0.5 increments).
const BATHROOM_PRICE = {
  1: 30,
  1.5: 40,
  2: 60,
  2.5: 70,
  3: 85,
  3.5: 90,
  4: 100,
  4.5: 110,
  5: 115,
  5.5: 120,
  6: 125,
};

// Square-footage brackets. [minSqft, maxSqft, price].
// Under 1000 sqft → no adder (TODO: verify with a real booking).
const SQFT_BRACKETS = [
  [0, 999, 0],
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
];
const SQFT_OVER_6000 = 400; // Use top bracket; flag for custom quote.

// Recurring discounts.
const FREQUENCY_DISCOUNT = {
  one_time: 0,
  every_3_weeks: 0.085,
  biweekly: 0.15,
  weekly: 0.20,
  monthly: 0, // BK shows 0% for monthly
};

// Pretty labels for output formatting.
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
export const BEDROOM_OPTIONS = Object.keys(BEDROOM_PRICE).map(Number);
export const BATHROOM_OPTIONS = Object.keys(BATHROOM_PRICE).map(Number);

// ---- Lookups ----

function lookupBedroomPrice(n) {
  if (n <= 0) return { price: 0, capped: false };
  if (n in BEDROOM_PRICE) return { price: BEDROOM_PRICE[n], capped: false };
  // Above the table → cap at top tier + flag for custom quote
  const maxKey = Math.max(...Object.keys(BEDROOM_PRICE).map(Number));
  return { price: BEDROOM_PRICE[maxKey], capped: true };
}

function lookupBathroomPrice(n) {
  if (n <= 0) return { price: 0, capped: false };
  // Round to nearest 0.5 (half-bath granularity)
  const rounded = Math.round(n * 2) / 2;
  if (rounded in BATHROOM_PRICE) return { price: BATHROOM_PRICE[rounded], capped: false };
  const maxKey = Math.max(...Object.keys(BATHROOM_PRICE).map(Number));
  return { price: BATHROOM_PRICE[maxKey], capped: true };
}

function lookupSqftPrice(sqft) {
  if (!sqft || sqft < 0) return { price: 0, bracket: "not specified", capped: false };
  for (const [lo, hi, price] of SQFT_BRACKETS) {
    if (sqft >= lo && sqft <= hi) {
      return { price, bracket: `${lo}-${hi}`, capped: false };
    }
  }
  // Over the top bracket
  return { price: SQFT_OVER_6000, bracket: "6000+", capped: true };
}

// ---- Main calculation ----

/**
 * Calculate a quote.
 *
 * @param {object} input
 * @param {"standard"|"deep"|"move_in_out"} input.service
 * @param {number} input.bedrooms
 * @param {number} input.bathrooms     (half-baths = 0.5)
 * @param {number} input.sqft          (approx; bracketed)
 * @param {"one_time"|"weekly"|"biweekly"|"every_3_weeks"|"monthly"} input.frequency
 * @returns {{
 *   inputs: object,
 *   breakdown: {
 *     bedrooms: number, bathrooms: number, sqft: number,
 *     subtotal: number, discountPct: number, discount: number, total: number,
 *     sqftBracket: string, flags: string[]
 *   },
 *   summary: string
 * }}
 */
export function calculateQuote(input) {
  const service = (input.service || "standard").toLowerCase();
  const frequency = (input.frequency || "one_time").toLowerCase();
  const bedrooms = Number(input.bedrooms) || 0;
  const bathrooms = Number(input.bathrooms) || 0;
  const sqft = Number(input.sqft) || 0;

  const bed = lookupBedroomPrice(bedrooms);
  const bath = lookupBathroomPrice(bathrooms);
  const sq = lookupSqftPrice(sqft);

  const subtotal = bed.price + bath.price + sq.price;
  const discountPct = FREQUENCY_DISCOUNT[frequency] ?? 0;
  const discount = +(subtotal * discountPct).toFixed(2);
  const total = +(subtotal - discount).toFixed(2);

  const flags = [];
  if (bed.capped) flags.push("Bedrooms over standard tier — verify with a custom quote");
  if (bath.capped) flags.push("Bathrooms over standard tier — verify with a custom quote");
  if (sq.capped) flags.push("Sqft above 5,999 — verify with a custom quote");
  if (service !== "standard") {
    flags.push(
      `Service = ${SERVICE_LABEL[service] || service}: this engine currently uses the Standard pricing tables. Verify the total matches your BK booking for Deep / Move In/Out — flag the difference if any.`,
    );
  }
  if (sqft > 0 && sqft < 1000) {
    flags.push("Sqft under 1000 — $0 sqft adder applied. Verify with BK.");
  }

  const breakdown = {
    bedrooms: bed.price,
    bathrooms: bath.price,
    sqft: sq.price,
    sqftBracket: sq.bracket,
    subtotal,
    discountPct,
    discount,
    total,
    flags,
  };

  const summary = formatSummary({ service, frequency, bedrooms, bathrooms, sqft }, breakdown);

  return { inputs: { service, frequency, bedrooms, bathrooms, sqft }, breakdown, summary };
}

function formatSummary(inputs, b) {
  const lines = [
    `${SERVICE_LABEL[inputs.service] || inputs.service} — ${inputs.bedrooms}bd / ${inputs.bathrooms}ba / ${inputs.sqft || "?"} sqft`,
    `Frequency: ${FREQUENCY_LABEL[inputs.frequency] || inputs.frequency}`,
    ``,
    `Bedrooms (${inputs.bedrooms}): $${b.bedrooms.toFixed(2)}`,
    `Bathrooms (${inputs.bathrooms}): $${b.bathrooms.toFixed(2)}`,
    `Sqft (${b.sqftBracket}): $${b.sqft.toFixed(2)}`,
    `Subtotal: $${b.subtotal.toFixed(2)}`,
  ];
  if (b.discountPct > 0) {
    lines.push(
      `Recurring discount (${Math.round(b.discountPct * 1000) / 10}%): −$${b.discount.toFixed(2)}`,
    );
  }
  lines.push(`Total: $${b.total.toFixed(2)} per visit`);
  if (b.flags.length) {
    lines.push("");
    lines.push("⚠️  " + b.flags.join(" / "));
  }
  return lines.join("\n");
}

// SMS-friendly one-liner the team can paste straight to the customer.
export function formatForSms(quote, firstName) {
  const name = firstName ? firstName.trim() : "there";
  const svc = SERVICE_LABEL[quote.inputs.service] || quote.inputs.service;
  const freq = FREQUENCY_LABEL[quote.inputs.frequency] || quote.inputs.frequency;
  return (
    `Hi ${name}! Quote for your ${svc.toLowerCase()} — ` +
    `${quote.inputs.bedrooms}bd/${quote.inputs.bathrooms}ba/${quote.inputs.sqft}sqft, ${freq}: ` +
    `$${quote.breakdown.total.toFixed(2)} per visit. ` +
    `Ready to book?`
  );
}
