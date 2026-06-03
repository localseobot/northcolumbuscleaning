// Admin review queue for cold outreach. Lists open New Lead opps in the Cold
// Outreach Pipeline; each is a form with an editable message + Approve/Skip.
// ADMIN_TOKEN-gated. GET only — sending happens in outreach-approve.js.

import { ghl } from "../_lib/ghl.js";
import {
  COLD_PIPELINE_ID, STAGE_NEW_LEAD, TAGS, buildOutreachMessage,
} from "../_lib/leads-fields.js";

export const config = { runtime: "nodejs" };

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function tagVal(tags, prefix) {
  const t = (tags || []).find((x) => String(x).startsWith(prefix));
  return t ? t.slice(prefix.length) : "";
}

export default async function handler(req, res) {
  const token = req.query?.token || req.headers["x-admin-token"];
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
    res.setHeader("Content-Type", "text/plain");
    return res.status(401).send("Unauthorized");
  }

  const calUrl = process.env.WALKTHROUGH_CALENDAR_URL || "";
  let opps = [];
  try {
    const r = await ghl({
      method: "GET",
      path: "/opportunities/search",
      query: { location_id: process.env.GHL_LOCATION_ID, pipeline_id: COLD_PIPELINE_ID, status: "open", limit: 100 },
    });
    opps = (r?.opportunities || []).filter((o) => o.pipelineStageId === STAGE_NEW_LEAD);
  } catch (e) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(502).send(`<p>Could not load leads: ${esc(e.message)}</p>`);
  }

  const textable = [];
  const notTextable = [];
  for (const o of opps) {
    const c = o.contact || {};
    const tags = c.tags || [];
    if (tags.includes(TAGS.sent) || tags.includes(TAGS.skipped)) continue; // already handled
    const phone = c.phone || "";
    const line = tagVal(tags, "line:");
    const lead = {
      oppId: o.id,
      contactId: c.id,
      name: c.name || o.name || "(unknown)",
      phone,
      city: tagVal(tags, "city:"),
      niche: tagVal(tags, "niche:"),
      line,
      failed: tags.includes(TAGS.smsFailed),
    };
    if (phone && line !== "landline" && line !== "voip" && !lead.failed) textable.push(lead);
    else notTextable.push(lead);
  }

  const t = encodeURIComponent(token);
  const card = (l) => {
    const msg = buildOutreachMessage({ name: l.name, city: l.city, niche: l.niche, calendarUrl: calUrl });
    return `<div class="lead">
      <div class="head"><strong>${esc(l.name)}</strong> <span class="meta">${esc(l.phone)} · ${esc(l.city)} · ${esc(l.niche)}${l.line ? " · " + esc(l.line) : ""}</span></div>
      <form method="POST" action="/api/admin/outreach-approve?token=${t}">
        <input type="hidden" name="oppId" value="${esc(l.oppId)}" />
        <input type="hidden" name="contactId" value="${esc(l.contactId)}" />
        <input type="hidden" name="phone" value="${esc(l.phone)}" />
        <textarea name="message" rows="4">${esc(msg)}</textarea>
        <div class="actions">
          <button name="action" value="approve" class="approve">Approve &amp; text</button>
          <button name="action" value="skip" class="skip">Skip</button>
        </div>
      </form>
    </div>`;
  };

  const notList = notTextable.map((l) =>
    `<li>${esc(l.name)} — ${esc(l.phone || "no phone")}${l.line ? " (" + esc(l.line) + ")" : ""}${l.failed ? " — send failed" : ""}</li>`
  ).join("");

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Outreach review · NCC</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&display=swap" rel="stylesheet">
<style>
  *,*::before,*::after{box-sizing:border-box}
  body{margin:0;font-family:'Inter',-apple-system,sans-serif;background:#faf9f5;color:#0f172a;padding:24px}
  .wrap{max-width:760px;margin:0 auto}
  h1{font-size:26px;font-weight:900;color:#0d3320;margin:0 0 4px}
  p.sub{color:#475569;margin:0 0 20px;font-size:14px}
  .warn{background:#fffbeb;border-left:4px solid #d97706;padding:10px 14px;border-radius:8px;font-size:13px;color:#92400e;margin-bottom:20px}
  .lead{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:16px;margin-bottom:14px}
  .head{margin-bottom:8px}
  .meta{color:#64748b;font-size:13px}
  textarea{width:100%;padding:10px 12px;border:1.5px solid #e2e8f0;border-radius:10px;font:inherit;font-size:14px;resize:vertical}
  .actions{display:flex;gap:8px;margin-top:8px}
  button{padding:10px 16px;border:0;border-radius:9px;font-weight:900;font-size:13px;cursor:pointer;font-family:inherit}
  .approve{background:#1a4d2e;color:#c9e265}
  .skip{background:#e2e8f0;color:#334155}
  .empty{background:#fff;border:1px dashed #cbd5e1;border-radius:14px;padding:28px;text-align:center;color:#64748b}
  .nottext{margin-top:28px}
  .nottext h2{font-size:16px;color:#334155}
  .nottext ul{font-size:13px;color:#64748b;line-height:1.7}
</style></head><body><div class="wrap">
  <h1>Cold outreach — review queue</h1>
  <p class="sub">${textable.length} textable lead(s) awaiting approval. Edit the message if you like, then Approve to text. Skip removes it from the queue.</p>
  ${!calUrl ? `<div class="warn">No WALKTHROUGH_CALENDAR_URL set — messages will ask them to reply instead of linking a booking page.</div>` : ""}
  ${textable.length ? textable.map(card).join("") : `<div class="empty">Nothing to review. Run a scrape, then refresh.</div>`}
  ${notTextable.length ? `<div class="nottext"><h2>Not textable (${notTextable.length}) — landline/VoIP/no-phone/failed</h2><ul>${notList}</ul></div>` : ""}
</div></body></html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");
  return res.status(200).send(html);
}
