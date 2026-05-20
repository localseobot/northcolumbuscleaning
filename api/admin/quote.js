// Internal quoting tool. Token-gated. Renders a form, calculates a quote
// against the BK pricing model, and gives an SMS-friendly summary to paste.
//
// Usage:
//   GET /api/admin/quote?token=<ADMIN_TOKEN>             → form
//   GET /api/admin/quote?token=<...>&service=...&...     → form + result
//
// Required env: ADMIN_TOKEN
// Pricing engine lives in api/_lib/pricing.js.

import {
  calculateQuote,
  formatForSms,
  SERVICES,
  FREQUENCIES,
  frequenciesForService,
} from "../_lib/pricing.js";

export const config = { runtime: "nodejs" };

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const SERVICE_LABELS = {
  standard: "Standard Cleaning",
  deep: "Deep Cleaning",
  move_in_out: "Move In/Out Cleaning",
};
const FREQUENCY_LABELS = {
  one_time: "One-Time",
  weekly: "Weekly (20% off)",
  biweekly: "Every 2 Weeks (15% off)",
  every_3_weeks: "Every 3 Weeks (8.5% off)",
  monthly: "Monthly",
};

// Bedroom/bathroom dropdowns aren't part of the formula but the team still
// captures them for scoping. Hardcoded here since the pricing engine no
// longer exports them.
const BEDROOM_OPTIONS = [1, 2, 3, 4, 5, 6, 7];
const BATHROOM_OPTIONS = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6];

function renderForm(query, quote) {
  const token = query.token || "";
  const sel = (val, key) => (query[key] === String(val) ? "selected" : "");
  const v = (k) => escapeHtml(query[k] ?? "");

  const serviceOpts = SERVICES
    .map((s) => `<option value="${s}" ${sel(s, "service")}>${escapeHtml(SERVICE_LABELS[s])}</option>`)
    .join("");

  // Frequency dropdown: limit to what the selected service supports so the
  // team can't pick an invalid combo. Default to Standard's full list if no
  // service is selected yet.
  const activeService = query.service || "standard";
  const validFreqs = new Set(frequenciesForService(activeService));
  const freqOpts = FREQUENCIES
    .filter((f) => validFreqs.has(f))
    .map((f) => `<option value="${f}" ${sel(f, "frequency")}>${escapeHtml(FREQUENCY_LABELS[f])}</option>`)
    .join("");

  const bedOpts = BEDROOM_OPTIONS
    .map((n) => `<option value="${n}" ${sel(n, "bedrooms")}>${n}</option>`)
    .join("");
  const bathOpts = BATHROOM_OPTIONS
    .map((n) => `<option value="${n}" ${sel(n, "bathrooms")}>${n}</option>`)
    .join("");

  const quoteBlock = quote
    ? renderQuoteBlock(quote, query)
    : "";

  // When user changes service we want the frequency list to update. Tiny
  // inline script reloads the form with the new service so server-side
  // re-renders with the right options.
  const onChangeScript = `
    document.querySelector('select[name=service]').addEventListener('change', function() {
      const f = this.form;
      // Drop frequency so server picks the default for the new service.
      f.querySelector('select[name=frequency]').value = '';
      f.submit();
    });
  `;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>NCC — Quote tool</title>
<style>
  body{font:14px/1.5 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#222;max-width:640px;margin:24px auto;padding:0 16px}
  h1{margin:0 0 4px;font-size:22px}
  .sub{color:#777;margin-bottom:18px;font-size:13px}
  form{display:grid;grid-template-columns:1fr 1fr;gap:12px;background:#f6f7f9;padding:16px;border-radius:8px}
  label{display:flex;flex-direction:column;font-size:12px;color:#666;text-transform:uppercase;letter-spacing:.04em}
  select,input{font:inherit;padding:8px 10px;border:1px solid #ddd;border-radius:6px;background:white;margin-top:4px;color:#222}
  .span2{grid-column:span 2}
  button{grid-column:span 2;padding:12px;background:#222;color:white;border:none;border-radius:6px;font-size:14px;cursor:pointer;margin-top:4px}
  button:hover{background:#000}
  .result{background:white;border:1px solid #eee;border-radius:8px;padding:18px;margin-top:18px}
  .result h2{margin:0;font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:#666}
  .big{font-size:42px;font-weight:700;margin:8px 0 16px;color:#0d8043}
  .big.custom{color:#b07020}
  .big .muted{font-size:14px;color:#888;font-weight:400}
  table.breakdown{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:14px}
  table.breakdown td{padding:6px 0;border-bottom:1px solid #f0f0f0}
  table.breakdown td:last-child{text-align:right;font-variant-numeric:tabular-nums}
  table.breakdown .discount td{color:#0d8043}
  table.breakdown .total td{font-weight:700;font-size:15px;border-top:2px solid #222;border-bottom:none}
  .flags{background:#fff5e6;border-left:3px solid #f0a020;padding:10px 12px;margin:12px 0;font-size:12px;color:#7a5500;border-radius:0 6px 6px 0}
  .flags div{margin:2px 0}
  textarea{width:100%;font:13px/1.4 ui-monospace,Menlo,monospace;padding:10px;border:1px solid #ddd;border-radius:6px;background:#fafafa;margin:6px 0 14px;resize:vertical;color:#222}
  h3{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#666;margin:14px 0 4px}
  .info{background:#eef5ff;border-left:3px solid #4080d0;padding:10px 12px;margin:0 0 14px;font-size:12px;color:#234670;border-radius:0 6px 6px 0}
</style>
</head>
<body>
<h1>NCC — Quote tool</h1>
<div class="sub">Internal calculator. Price = sqft band × (1 − recurring discount). Bedrooms / bathrooms captured for scope only.</div>

<form method="GET" action="/api/admin/quote">
  <input type="hidden" name="token" value="${escapeHtml(token)}">
  <label class="span2">Customer first name (optional, for SMS personalization)
    <input type="text" name="first_name" value="${v("first_name")}" placeholder="Sarah">
  </label>
  <label>Service
    <select name="service">${serviceOpts}</select>
  </label>
  <label>Frequency
    <select name="frequency">${freqOpts}</select>
  </label>
  <label>Bedrooms
    <select name="bedrooms">${bedOpts}</select>
  </label>
  <label>Bathrooms
    <select name="bathrooms">${bathOpts}</select>
  </label>
  <label class="span2">Square footage (approx)
    <input type="number" name="sqft" value="${v("sqft")}" placeholder="2000" min="0" step="100" required>
  </label>
  <button type="submit">Calculate quote</button>
</form>

${quoteBlock}

<script>${onChangeScript}</script>
</body>
</html>`;
}

function renderQuoteBlock(quote, query) {
  const isCustom = !quote.breakdown.base;
  const total = quote.breakdown.total;

  return `
    <section class="result">
      <h2>Quote</h2>
      <div class="big ${isCustom ? "custom" : ""}">
        ${isCustom ? "Custom" : "$" + total.toFixed(2)}
        ${!isCustom ? '<span class="muted">per visit</span>' : ""}
      </div>
      ${
        isCustom
          ? '<div class="info">This combination is outside the standard pricing bands. Take details and the team will follow up with a tailored quote.</div>'
          : `<table class="breakdown">
              <tr><td>${escapeHtml(SERVICE_LABELS[quote.inputs.service])} — ${escapeHtml(quote.breakdown.sqftBracket)} sqft</td><td>$${quote.breakdown.base.toFixed(2)}</td></tr>
              ${quote.breakdown.discountPct > 0 ? `<tr class="discount"><td>${escapeHtml(FREQUENCY_LABELS[quote.inputs.frequency])} discount (${(quote.breakdown.discountPct * 100).toFixed(1)}%)</td><td>−$${quote.breakdown.discount.toFixed(2)}</td></tr>` : ""}
              <tr class="total"><td>Total</td><td>$${quote.breakdown.total.toFixed(2)}</td></tr>
             </table>`
      }
      ${quote.breakdown.flags.length ? `<div class="flags">${quote.breakdown.flags.map((f) => `<div>⚠️ ${escapeHtml(f)}</div>`).join("")}</div>` : ""}
      <h3>Copy/paste to customer</h3>
      <textarea readonly rows="3" onclick="this.select()">${escapeHtml(formatForSms(quote, query.first_name))}</textarea>
      <h3>Full breakdown (internal)</h3>
      <textarea readonly rows="8" onclick="this.select()">${escapeHtml(quote.summary)}</textarea>
    </section>`;
}

export default async function handler(req, res) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return res.status(503).send("ADMIN_TOKEN env var not set");
  const token = req.query?.token || "";
  if (token !== expected) return res.status(401).send("unauthorized");

  let quote = null;
  if (req.query.service && req.query.sqft) {
    quote = calculateQuote({
      service: req.query.service,
      sqft: req.query.sqft,
      bedrooms: req.query.bedrooms,
      bathrooms: req.query.bathrooms,
      frequency: req.query.frequency || "one_time",
    });
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");
  return res.status(200).send(renderForm(req.query, quote));
}
