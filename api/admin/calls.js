// Tiny owner dashboard — call volume + lead pipeline status, last 7 days.
//
// Pulls live data from GHL (recent contacts tagged `source:maya` + opps in
// Sales Pipeline) and renders a single-page HTML report. Token-gated so it
// isn't crawlable.
//
// Usage: https://www.northcolumbuscleaning.com/api/admin/calls?token=<ADMIN_TOKEN>
//
// Required env vars:
//   ADMIN_TOKEN      — long random string; URL must include ?token=<this>
//   GHL_PIT          — already set for the webhook
//   GHL_LOCATION_ID  — already set for the webhook

import { ghl } from "../_lib/ghl.js";

export const config = { runtime: "nodejs" };

const SALES_PIPELINE_ID = "6YDehH2kNtHrdfJaEQfa";
const STAGES = {
  "4bb733e7-d38d-4cb0-afb8-512406509144": "New Lead",
  "06cf319d-8de6-4c09-82dd-dcc5b823c682": "Contacted",
  "e426851f-65f6-4bfe-8fe0-66b93a1309df": "Quoted",
  "a1df2c52-9211-4e13-a920-0c17ab00eff9": "Booked",
  "9253419b-4c69-4f61-814b-ee27cd165f7a": "Won — One Time",
  "7eaafc3f-ab36-4ebe-b2c2-c64ab998897d": "Lost",
  // Recurring Customer stage — set STAGE_RECURRING_ID env var to the new
  // stage's UUID after creating it in the GHL UI. Until then this entry
  // is a no-op since no opps live in that stage yet.
  [process.env.STAGE_RECURRING_ID || "__placeholder__"]: "Recurring Customer",
};

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function daysAgo(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

function relTime(iso) {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

export default async function handler(req, res) {
  const token = req.query?.token || "";
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) {
    return res.status(503).send("ADMIN_TOKEN env var not set");
  }
  if (token !== expected) {
    return res.status(401).send("unauthorized");
  }
  if (!process.env.GHL_PIT) {
    return res.status(503).send("GHL_PIT not set");
  }

  try {
    // 1. Recent Maya-tagged contacts (proxy for call count)
    // GHL contact search doesn't filter by tag directly via the basic search;
    // we pull most recent contacts and filter for source:maya in-process.
    const recent = await ghl({
      method: "GET",
      path: "/contacts/",
      query: {
        locationId: process.env.GHL_LOCATION_ID,
        limit: 100,
      },
    });
    const since = daysAgo(7);
    const mayaContacts = (recent?.contacts || []).filter((c) => {
      const tags = c.tags || [];
      if (!tags.includes("source:maya")) return false;
      const added = c.dateAdded ? new Date(c.dateAdded) : null;
      return added && added >= since;
    });

    // 2. All opportunities in Sales Pipeline
    const ops = await ghl({
      method: "GET",
      path: "/opportunities/search",
      query: {
        location_id: process.env.GHL_LOCATION_ID,
        pipeline_id: SALES_PIPELINE_ID,
        limit: 100,
      },
    });
    const opportunities = ops?.opportunities || [];

    // 3. Aggregate
    const callCount = mayaContacts.length;
    const intentCount = {};
    const serviceCount = {};
    const smsConsentYes = mayaContacts.filter((c) =>
      (c.tags || []).includes("sms-consent:yes"),
    ).length;
    const needsReview = mayaContacts.filter((c) =>
      (c.tags || []).includes("needs-review"),
    ).length;
    const existingCustomers = mayaContacts.filter((c) =>
      (c.tags || []).includes("existing-customer"),
    ).length;

    for (const c of mayaContacts) {
      for (const t of c.tags || []) {
        if (t.startsWith("intent:")) {
          const k = t.replace("intent:", "");
          intentCount[k] = (intentCount[k] || 0) + 1;
        }
        if (t.startsWith("service:")) {
          const k = t.replace("service:", "");
          serviceCount[k] = (serviceCount[k] || 0) + 1;
        }
      }
    }

    const stageCount = {};
    for (const o of opportunities) {
      const stage = STAGES[o.pipelineStageId] || "(unknown)";
      stageCount[stage] = (stageCount[stage] || 0) + 1;
    }
    const wonCount = stageCount["Won"] || 0;
    const lostCount = stageCount["Lost"] || 0;
    const closedCount = wonCount + lostCount;
    const winRate = closedCount ? Math.round((wonCount / closedCount) * 100) : null;

    // 4. Stale leads (in New Lead > 24h)
    const staleCutoff = daysAgo(1).getTime();
    const stale = opportunities
      .filter((o) => STAGES[o.pipelineStageId] === "New Lead")
      .filter((o) => o.dateAdded && new Date(o.dateAdded).getTime() < staleCutoff)
      .sort((a, b) => new Date(a.dateAdded) - new Date(b.dateAdded));

    // 5. Build HTML
    const rows = mayaContacts
      .sort((a, b) => new Date(b.dateAdded) - new Date(a.dateAdded))
      .slice(0, 20)
      .map((c) => {
        const tags = (c.tags || [])
          .filter((t) => t.startsWith("intent:") || t === "needs-review" || t === "existing-customer")
          .map((t) => `<span class="tag">${escapeHtml(t)}</span>`)
          .join(" ");
        return `<tr>
          <td>${escapeHtml(c.firstName || "")} ${escapeHtml(c.lastName || "")}</td>
          <td>${escapeHtml(c.phone || "")}</td>
          <td>${relTime(c.dateAdded)}</td>
          <td>${tags}</td>
        </tr>`;
      })
      .join("");

    const staleRows = stale
      .slice(0, 20)
      .map((o) => {
        return `<tr>
          <td>${escapeHtml(o.name || "")}</td>
          <td>${escapeHtml(o.contact?.name || "")}</td>
          <td>${relTime(o.dateAdded)}</td>
          <td>${escapeHtml(STAGES[o.pipelineStageId] || "")}</td>
        </tr>`;
      })
      .join("");

    const stageRows = Object.entries(stageCount)
      .map(([s, n]) => `<tr><td>${escapeHtml(s)}</td><td>${n}</td></tr>`)
      .join("");

    const intentRows = Object.entries(intentCount)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${v}</td></tr>`)
      .join("");

    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>NCC — Calls dashboard</title>
<style>
  body{font:14px/1.5 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#222;max-width:980px;margin:24px auto;padding:0 16px;}
  h1{margin:0 0 4px;font-size:20px}
  .sub{color:#777;margin-bottom:18px;font-size:13px}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin:16px 0}
  .stat{background:#f6f7f9;border-radius:8px;padding:12px}
  .stat .v{font-size:24px;font-weight:600}
  .stat .l{color:#666;font-size:12px;text-transform:uppercase;letter-spacing:.04em;margin-top:4px}
  section{margin:24px 0}
  h2{font-size:15px;text-transform:uppercase;letter-spacing:.04em;color:#555;border-bottom:1px solid #eee;padding-bottom:6px;margin-bottom:10px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #f0f0f0}
  th{color:#888;font-weight:500;font-size:12px;text-transform:uppercase;letter-spacing:.04em}
  .tag{display:inline-block;background:#eef;color:#447;padding:1px 6px;border-radius:4px;margin-right:3px;font-size:11px}
  .stale td{color:#a00}
  .muted{color:#999}
</style>
</head>
<body>
<h1>North Columbus Cleaning — Calls dashboard</h1>
<div class="sub">Last 7 days • generated ${new Date().toLocaleString("en-US",{timeZone:"America/New_York"})}</div>

<div class="grid">
  <div class="stat"><div class="v">${callCount}</div><div class="l">Calls (7d)</div></div>
  <div class="stat"><div class="v">${existingCustomers}</div><div class="l">Existing customers</div></div>
  <div class="stat"><div class="v">${smsConsentYes}</div><div class="l">SMS-consented</div></div>
  <div class="stat"><div class="v">${needsReview}</div><div class="l">Needs review</div></div>
  <div class="stat"><div class="v">${stale.length}</div><div class="l">Stale (>24h in New Lead)</div></div>
  <div class="stat"><div class="v">${winRate === null ? "—" : winRate + "%"}</div><div class="l">Win rate (all time)</div></div>
</div>

<section>
  <h2>Stale leads — &gt;24h in New Lead</h2>
  ${stale.length ? `<table class="stale"><tr><th>Opportunity</th><th>Contact</th><th>Aged</th><th>Stage</th></tr>${staleRows}</table>` : '<div class="muted">None — pipeline is moving 🎉</div>'}
</section>

<section>
  <h2>Recent calls</h2>
  ${rows ? `<table><tr><th>Name</th><th>Phone</th><th>When</th><th>Tags</th></tr>${rows}</table>` : '<div class="muted">No calls yet.</div>'}
</section>

<section>
  <h2>Pipeline distribution</h2>
  <table><tr><th>Stage</th><th>Count</th></tr>${stageRows || '<tr><td class="muted">No opportunities yet</td><td>—</td></tr>'}</table>
</section>

<section>
  <h2>Intent breakdown (7d)</h2>
  <table><tr><th>Intent</th><th>Count</th></tr>${intentRows || '<tr><td class="muted">No data yet</td><td>—</td></tr>'}</table>
</section>

</body>
</html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Robots-Tag", "noindex");
    return res.status(200).send(html);
  } catch (e) {
    return res.status(500).send(`Error: ${escapeHtml(e.message)}`);
  }
}
