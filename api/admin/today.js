// Manager command center — single page showing today's Booked-stage
// opportunities + cleaner assignments + one-tap actions.
//
// GET /api/admin/today?token=ADMIN_TOKEN
//   → renders an HTML dashboard
//
// GET /api/admin/today?token=ADMIN_TOKEN&format=json
//   → returns the structured data (useful for sanity checks or building
//     a separate UI later)

import { ghl } from "../_lib/ghl.js";
import {
  OPP_APPOINTMENT_DATE,
  OPP_PROVIDER_NAME,
  OPP_PROVIDER_PHONE,
  OPP_SERVICE_TYPE,
  OPP_FREQUENCY,
  OPP_QUOTED_PRICE,
  OPP_BEDROOMS,
  OPP_BATHROOMS,
  OPP_SQUARE_FOOTAGE,
} from "../_lib/ghl-fields.js";

export const config = { runtime: "nodejs" };

const SALES_PIPELINE_ID = "6YDehH2kNtHrdfJaEQfa";
const STAGE_BOOKED = "a1df2c52-9211-4e13-a920-0c17ab00eff9";
const GHL_CONTACT_BASE =
  "https://app.gohighlevel.com/v2/location/XIA5AmegWaylDoPVe3r8/contacts/detail";
const GHL_OPP_BASE =
  "https://app.gohighlevel.com/v2/location/XIA5AmegWaylDoPVe3r8/opportunities/list";

function s(v) { return v === null || v === undefined ? "" : String(v).trim(); }
function lower(v) { return s(v).toLowerCase(); }
function isAuthorized(req) {
  const token = req.query?.token || req.headers["x-admin-token"];
  if (!process.env.ADMIN_TOKEN) return false;
  return s(token).trim() === String(process.env.ADMIN_TOKEN).trim();
}
function getCf(cfs, id) {
  if (!Array.isArray(cfs)) return null;
  const f = cfs.find((c) => c.id === id);
  if (!f) return null;
  return (
    f.fieldValueString ||
    f.fieldValueNumber ||
    (f.fieldValueDate ? new Date(f.fieldValueDate).toISOString() : null) ||
    f.fieldValue ||
    null
  );
}
function escapeHtml(x) {
  return String(x || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function fmtTime(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-US", { hour: "numeric", minute: "2-digit" });
  } catch {
    return iso;
  }
}
function todayUtcYmd() {
  return new Date().toISOString().slice(0, 10);
}

async function gatherToday() {
  const targetDate = todayUtcYmd();
  const search = await ghl({
    method: "POST",
    path: "/opportunities/search",
    body: {
      location_id: process.env.GHL_LOCATION_ID,
      pipeline_id: SALES_PIPELINE_ID,
      pipeline_stage_id: STAGE_BOOKED,
      status: "open",
      limit: 100,
      getCustomFields: true,
    },
  }).catch(() => ({ opportunities: [] }));

  const dayMs = new Date(targetDate + "T00:00:00Z").getTime();
  const nextMs = dayMs + 86400000;

  const todayOpps = (search?.opportunities || []).filter((o) => {
    const dt = getCf(o.customFields, OPP_APPOINTMENT_DATE);
    if (!dt) return false;
    const t = new Date(dt).getTime();
    return t >= dayMs && t < nextMs;
  });

  // Hydrate each with the customer contact
  const jobs = await Promise.all(
    todayOpps.map(async (o) => {
      const contact = await ghl({
        method: "GET",
        path: `/contacts/${o.contactId}`,
      })
        .then((r) => r?.contact)
        .catch(() => null);
      const apptIso = getCf(o.customFields, OPP_APPOINTMENT_DATE);
      return {
        oppId: o.id,
        name: o.name,
        contactId: o.contactId,
        customerName: contact
          ? [contact.firstNameRaw, contact.lastNameRaw].filter(Boolean).join(" ") ||
            contact.contactName ||
            "(unknown)"
          : "(unknown)",
        customerPhone: contact?.phone || "",
        customerEmail: contact?.email || "",
        address: contact
          ? [contact.address1, contact.city, contact.state, contact.postalCode]
              .filter(Boolean)
              .join(", ")
          : "",
        appointmentIso: apptIso,
        appointmentTime: fmtTime(apptIso),
        serviceType: getCf(o.customFields, OPP_SERVICE_TYPE),
        frequency: getCf(o.customFields, OPP_FREQUENCY),
        bedrooms: getCf(o.customFields, OPP_BEDROOMS),
        bathrooms: getCf(o.customFields, OPP_BATHROOMS),
        sqft: getCf(o.customFields, OPP_SQUARE_FOOTAGE),
        price: o.monetaryValue || Number(getCf(o.customFields, OPP_QUOTED_PRICE)) || 0,
        providerName: getCf(o.customFields, OPP_PROVIDER_NAME),
        providerPhone: getCf(o.customFields, OPP_PROVIDER_PHONE),
        tags: (contact?.tags || []).map(lower),
      };
    }),
  );

  jobs.sort(
    (a, b) =>
      new Date(a.appointmentIso || 0).getTime() -
      new Date(b.appointmentIso || 0).getTime(),
  );

  return { targetDate, jobs };
}

function renderHtml({ targetDate, jobs, token }) {
  const totalRevenue = jobs.reduce((sum, j) => sum + (j.price || 0), 0);
  const unassigned = jobs.filter((j) => !j.providerPhone).length;
  const rows = jobs.length
    ? jobs.map((j) => renderJobRow(j, token)).join("")
    : `<tr><td colspan="5" style="padding:48px;text-align:center;color:#64748b;font-size:15px;">No bookings scheduled for today.</td></tr>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Today · NCC Command Center</title>
<link rel="icon" href="/images/favicon.ico" sizes="any">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&display=swap" rel="stylesheet">
<style>
  *,*::before,*::after { box-sizing: border-box; }
  body { margin: 0; font-family: 'Inter',-apple-system,sans-serif; background: #faf9f5; color: #0f172a; }
  .topbar { background: #1a4d2e; color: #c9e265; padding: 16px 24px; font-size: 14px; font-weight: 900; letter-spacing: 0.08em; text-transform: uppercase; }
  .container { max-width: 1240px; margin: 0 auto; padding: 32px 24px; }
  h1 { margin: 0 0 4px; font-size: 32px; font-weight: 900; color: #0d3320; letter-spacing: -0.5px; }
  .sub { color: #475569; font-size: 15px; margin-bottom: 24px; }
  .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 24px; }
  .kpi { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 18px 20px; }
  .kpi .label { font-size: 11px; font-weight: 900; letter-spacing: 0.1em; text-transform: uppercase; color: #64748b; margin-bottom: 6px; }
  .kpi .value { font-size: 28px; font-weight: 900; color: #0d3320; line-height: 1; }
  .kpi.warn .value { color: #b91c1c; }
  table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; }
  th { background: #faf9f5; padding: 12px 16px; text-align: left; font-size: 11px; font-weight: 900; letter-spacing: 0.08em; text-transform: uppercase; color: #64748b; border-bottom: 1px solid #e2e8f0; }
  td { padding: 14px 16px; border-bottom: 1px solid #e2e8f0; font-size: 14px; vertical-align: top; }
  tr:last-child td { border-bottom: none; }
  .time { font-size: 18px; font-weight: 900; color: #0d3320; white-space: nowrap; }
  .customer { font-weight: 700; color: #0f172a; }
  .meta { font-size: 12px; color: #64748b; margin-top: 4px; }
  .meta a { color: #1a4d2e; text-decoration: none; font-weight: 600; }
  .meta a:hover { text-decoration: underline; }
  .provider-pill { display: inline-block; padding: 6px 12px; border-radius: 999px; background: #f0fdf4; color: #047857; font-weight: 700; font-size: 13px; }
  .provider-pill.unassigned { background: #fef2f2; color: #b91c1c; }
  .actions { white-space: nowrap; }
  .btn { display: inline-block; padding: 8px 14px; border-radius: 8px; font-size: 12px; font-weight: 900; letter-spacing: 0.05em; text-transform: uppercase; text-decoration: none; cursor: pointer; border: 0; font-family: inherit; }
  .btn-danger { background: #b91c1c; color: #fff; }
  .btn-danger:hover { background: #991b1b; }
  .btn-outline { background: #fff; color: #1a4d2e; border: 1.5px solid #1a4d2e; margin-left: 6px; }
  .btn-outline:hover { background: #f0fdf4; }
  .tags { margin-top: 6px; }
  .tag { display: inline-block; padding: 2px 8px; border-radius: 6px; background: #f1f5f9; color: #475569; font-size: 11px; font-weight: 600; margin-right: 4px; }
  .tag.warn { background: #fef2f2; color: #b91c1c; }
  .refresh { margin-left: 12px; font-size: 13px; color: #64748b; }
  .refresh a { color: #1a4d2e; font-weight: 700; }
  @media (max-width: 720px) {
    .container { padding: 18px 14px; }
    table, thead, tbody, th, td, tr { display: block; }
    thead { display: none; }
    tr { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; margin-bottom: 12px; padding: 14px 16px; }
    td { padding: 6px 0; border-bottom: 0; }
  }
</style>
</head>
<body>
  <div class="topbar">North Columbus Cleaning · Command Center</div>
  <div class="container">
    <h1>Today · ${escapeHtml(new Date(targetDate + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }))}</h1>
    <p class="sub">${jobs.length} booking${jobs.length === 1 ? "" : "s"} scheduled<span class="refresh">· <a href="javascript:location.reload()">↻ refresh</a></span></p>

    <div class="kpis">
      <div class="kpi"><div class="label">Jobs today</div><div class="value">${jobs.length}</div></div>
      <div class="kpi"><div class="label">Day revenue</div><div class="value">$${Math.round(totalRevenue).toLocaleString()}</div></div>
      <div class="kpi ${unassigned > 0 ? "warn" : ""}"><div class="label">Unassigned</div><div class="value">${unassigned}</div></div>
    </div>

    <table>
      <thead>
        <tr>
          <th style="width: 100px;">Time</th>
          <th>Customer</th>
          <th>Service</th>
          <th>Cleaner</th>
          <th style="width: 280px; text-align: right;">Actions</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <p class="sub" style="margin-top:32px;">Endpoint: <code>/api/admin/today</code>. Pin this URL to your home screen for one-tap access.</p>
  </div>

  <script>
    async function callOut(oppId, calledOutContactId, button) {
      if (!confirm("Trigger callout? This will SMS all available cleaners with an open-shift offer.")) return;
      const reason = prompt("Reason for the callout (visible to manager only)?", "") || "manual";
      button.disabled = true;
      button.textContent = "Sending...";
      const token = new URLSearchParams(location.search).get("token");
      try {
        const res = await fetch("/api/ops/callout?token=" + encodeURIComponent(token), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ oppId, calledOutContactId, reason }),
        });
        const data = await res.json();
        if (data.ok) {
          alert("✓ Callout sent — " + data.offersSent + " cleaner(s) offered.\\n\\nYou'll get a notification when someone claims it.");
          location.reload();
        } else {
          alert("Failed: " + (data.error || JSON.stringify(data)));
          button.disabled = false;
          button.textContent = "🚨 Callout";
        }
      } catch (e) {
        alert("Error: " + e.message);
        button.disabled = false;
        button.textContent = "🚨 Callout";
      }
    }
  </script>
</body>
</html>`;
}

function renderJobRow(j, token) {
  const tags = j.tags
    .filter((t) => t.startsWith("service:") || t.startsWith("frequency:") || t === "same-day-cancel" || t === "needs-recovery")
    .map((t) => `<span class="tag ${t === "needs-recovery" || t === "same-day-cancel" ? "warn" : ""}">${escapeHtml(t)}</span>`)
    .join("");
  const providerHtml = j.providerPhone
    ? `<span class="provider-pill">${escapeHtml(j.providerName || "(no name)")}</span><div class="meta"><a href="tel:${escapeHtml(j.providerPhone)}">${escapeHtml(j.providerPhone)}</a></div>`
    : `<span class="provider-pill unassigned">⚠️ unassigned</span>`;
  const propLine = [
    j.bedrooms ? `${j.bedrooms}bd` : null,
    j.bathrooms ? `${j.bathrooms}ba` : null,
    j.sqft ? `${j.sqft}sqft` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return `<tr>
    <td><div class="time">${escapeHtml(j.appointmentTime)}</div></td>
    <td>
      <div class="customer">${escapeHtml(j.customerName)}</div>
      <div class="meta">
        ${j.customerPhone ? `<a href="tel:${escapeHtml(j.customerPhone)}">${escapeHtml(j.customerPhone)}</a> · ` : ""}
        ${j.customerEmail ? `<a href="mailto:${escapeHtml(j.customerEmail)}">${escapeHtml(j.customerEmail)}</a>` : ""}
      </div>
      <div class="meta">${escapeHtml(j.address || "")}</div>
      ${tags ? `<div class="tags">${tags}</div>` : ""}
    </td>
    <td>
      <div>${escapeHtml(j.serviceType || "—")}${j.frequency ? ` · ${escapeHtml(j.frequency)}` : ""}</div>
      <div class="meta">${propLine || ""}</div>
      <div class="meta">${j.price > 0 ? "$" + Number(j.price).toLocaleString() : ""}</div>
    </td>
    <td>${providerHtml}</td>
    <td class="actions">
      ${j.providerPhone ? `<button class="btn btn-danger" onclick="callOut('${escapeHtml(j.oppId)}', null, this)">🚨 Callout</button>` : ""}
      <a class="btn btn-outline" href="${GHL_OPP_BASE}/${escapeHtml(j.oppId)}" target="_blank">Open in GHL</a>
    </td>
  </tr>`;
}

export default async function handler(req, res) {
  if (!isAuthorized(req)) {
    res.setHeader("Content-Type", "text/plain");
    return res.status(401).send("Unauthorized — pass ?token=...");
  }

  try {
    const data = await gatherToday();
    if (req.query?.format === "json") {
      res.setHeader("Content-Type", "application/json");
      return res.status(200).json(data);
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(
      renderHtml({ ...data, token: req.query?.token }),
    );
  } catch (e) {
    res.setHeader("Content-Type", "text/plain");
    return res.status(500).send("Error: " + e.message);
  }
}
