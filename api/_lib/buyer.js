// Who the lead buyer is, and how they're billed.
//
// The business sells every lead the phone and the website produce to ONE
// exclusive buyer. Everything about that buyer lives in env vars so the
// arrangement can change (new buyer, new price, per-lead → flat rate) without
// a code change or a redeploy of logic.
//
// Env vars (Vercel → Settings → Environment Variables):
//   BUYER_NAME              Display name. Confirmed: "All Clean Sol"
//   BUYER_EMAIL             Lead alerts (forms + calls) + Monday digest.
//                           Confirmed: contact@allcleansol.com
//   BUYER_PHONE             Alert SMS + GHL forward-to. Confirmed: +17409712907
//   BUYER_SECRET            Long random string; signs dashboard links.
//                           Falls back to ONBOARDING_SECRET if unset.
//   BUYER_ACCESS_NONCE      Bump this to kill every outstanding dashboard link.
//   LEAD_PRICING_MODE       "per_lead" (default) | "flat"
//   LEAD_PRICE              Per-lead price in dollars. Default 35.
//   LEAD_FLAT_MONTHLY       Flat monthly price in dollars. Default 200.
//   LEAD_MONTHLY_INCLUDED   Leads included in the flat rate. Default 10.
//                           Beyond this, flat mode bills LEAD_PRICE overage.
//   LEAD_DEDUPE_DAYS        Repeat contact inside this window is delivered but
//                           not billed. Default 30.

function env(name, fallback = "") {
  const v = process.env[name];
  return v === undefined || v === null || v === "" ? fallback : String(v).trim();
}

function num(name, fallback) {
  const v = Number(env(name));
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

export function getBuyer() {
  return {
    name: env("BUYER_NAME", "the lead buyer"),
    email: env("BUYER_EMAIL") || null,
    phone: env("BUYER_PHONE") || null,
    configured: Boolean(env("BUYER_EMAIL") || env("BUYER_PHONE")),
  };
}

/**
 * Current billing arrangement. `mode` drives what the dashboard shows and how
 * `priceLeads()` totals a month.
 */
export function getPricing() {
  const mode = env("LEAD_PRICING_MODE", "per_lead") === "flat" ? "flat" : "per_lead";
  return {
    mode,
    perLead: num("LEAD_PRICE", 35),
    flatMonthly: num("LEAD_FLAT_MONTHLY", 200),
    includedPerMonth: num("LEAD_MONTHLY_INCLUDED", 10),
    dedupeDays: num("LEAD_DEDUPE_DAYS", 30),
  };
}

/**
 * Total what a month's leads cost the buyer.
 *
 * Only billable leads count — duplicates inside the dedupe window and leads
 * whose dispute we approved are delivered but free.
 *
 * per_lead : every billable lead × LEAD_PRICE.
 * flat     : LEAD_FLAT_MONTHLY covers the first LEAD_MONTHLY_INCLUDED leads;
 *            anything past that bills at LEAD_PRICE.
 *
 * @param {Array<{billable: boolean}>} leads  Leads inside one calendar month
 * @param {ReturnType<getPricing>} [pricing]
 */
export function priceLeads(leads, pricing = getPricing()) {
  const billable = (leads || []).filter((l) => l.billable).length;

  if (pricing.mode === "flat") {
    const overage = Math.max(0, billable - pricing.includedPerMonth);
    const overageCost = overage * pricing.perLead;
    return {
      mode: "flat",
      billable,
      included: pricing.includedPerMonth,
      overage,
      base: pricing.flatMonthly,
      overageCost,
      total: pricing.flatMonthly + overageCost,
      // What each delivered lead effectively cost, the number that sells the
      // next month. Guard the divide — a month can legitimately have 0 leads.
      costPerLead: billable ? (pricing.flatMonthly + overageCost) / billable : null,
    };
  }

  const total = billable * pricing.perLead;
  return {
    mode: "per_lead",
    billable,
    unitPrice: pricing.perLead,
    total,
    costPerLead: billable ? pricing.perLead : null,
  };
}

// ---- dashboard sign-in ------------------------------------------------------
//
// Who may sign in to /dashboard by email: the buyer, the owner, and any address
// in DASHBOARD_EMAILS (comma-separated). The link we email is the same signed
// credential the admin can mint by hand, so this list IS the access policy for
// the dashboard. Keep it short.

export function dashboardLoginEmails(source = process.env) {
  const raw = [
    source.BUYER_EMAIL,
    source.OWNER_EMAIL,
    ...String(source.DASHBOARD_EMAILS || "").split(/[,;]+/),
  ];
  const seen = new Set();
  for (const v of raw) {
    const e = String(v || "").trim().toLowerCase();
    if (e.includes("@")) seen.add(e);
  }
  return [...seen];
}

export function canSignInToDashboard(email, source = process.env) {
  const e = String(email || "").trim().toLowerCase();
  return e.length > 0 && dashboardLoginEmails(source).includes(e);
}
