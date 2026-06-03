// Admin: approve/skip a cold-outreach lead. POST from outreach-review.js.
// On approve: guards (quiet hours, daily cap, not-already-sent) → send SMS from
// the dedicated OUTREACH_LINE → move opp to Contacted → note → redirect back.

import { ghl } from "../_lib/ghl.js";
import { sendGhlSms, OUTREACH_LINE } from "../_lib/ghl-sms.js";
import {
  COLD_PIPELINE_ID, STAGE_NEW_LEAD, STAGE_CONTACTED, TAGS,
} from "../_lib/leads-fields.js";

export const config = { runtime: "nodejs" };

const PER_DAY_CAP = Number(process.env.OUTREACH_DAILY_CAP || 40);

function parseBody(req) {
  let b = req.body;
  if (b && typeof b === "object" && !Buffer.isBuffer(b)) return b;
  const raw = typeof b === "string" ? b : Buffer.isBuffer(b) ? b.toString("utf8") : "";
  return Object.fromEntries(new URLSearchParams(raw));
}

// Current hour in America/New_York.
function etHour() {
  const s = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }).format(new Date());
  return Number(s);
}
// Start of today (ET) as a Date for the daily-cap window.
function startOfTodayET() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const o = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return new Date(`${o.year}-${o.month}-${o.day}T00:00:00-04:00`); // ET (DST-approximate)
}

async function sentToday() {
  try {
    const r = await ghl({
      method: "GET",
      path: "/opportunities/search",
      query: { location_id: process.env.GHL_LOCATION_ID, pipeline_id: COLD_PIPELINE_ID, limit: 100 },
    });
    const since = startOfTodayET().getTime();
    return (r?.opportunities || []).filter(
      (o) => o.pipelineStageId === STAGE_CONTACTED && new Date(o.lastStageChangeAt || o.updatedAt || 0).getTime() >= since,
    ).length;
  } catch {
    return 0;
  }
}

export default async function handler(req, res) {
  const token = req.query?.token || req.headers["x-admin-token"];
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).send("Unauthorized");
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body = parseBody(req);
  const action = String(body.action || "");
  const oppId = String(body.oppId || "");
  const contactId = String(body.contactId || "");
  const phone = String(body.phone || "");
  const message = String(body.message || "");
  const back = `/api/admin/outreach-review?token=${encodeURIComponent(token)}`;
  const redirect = (q) => { res.setHeader("Location", `${back}${q ? "&" + q : ""}`); return res.status(302).end(); };

  if (!oppId || !contactId) return redirect("err=missing");

  // Skip → just tag and drop from the queue.
  if (action === "skip") {
    await ghl({ method: "POST", path: `/contacts/${contactId}/tags`, body: { tags: [TAGS.skipped] } }).catch(() => {});
    return redirect("skipped=1");
  }
  if (action !== "approve") return redirect("err=badaction");

  // Quiet hours (TCPA): 9am–8pm ET.
  const h = etHour();
  if (h < 9 || h >= 20) return redirect("err=quiet");

  // Daily cap.
  if ((await sentToday()) >= PER_DAY_CAP) return redirect("err=cap");

  if (!phone || !message) return redirect("err=missing");

  // Re-validate the opp is still in New Lead (guards stale page / double-click).
  try {
    const o = await ghl({ method: "GET", path: `/opportunities/${oppId}` });
    const stage = o?.opportunity?.pipelineStageId || o?.pipelineStageId;
    if (stage && stage !== STAGE_NEW_LEAD) return redirect("already=1");
  } catch { /* proceed; move below is idempotent enough */ }

  // Send from the dedicated outreach line.
  const sms = await sendGhlSms({ to: phone, message, fromNumber: OUTREACH_LINE, tag: TAGS.sent });
  if (!sms.ok) {
    await ghl({ method: "POST", path: `/contacts/${contactId}/tags`, body: { tags: [TAGS.smsFailed] } }).catch(() => {});
    return redirect(`err=send`);
  }

  // Move opp to Contacted + audit note.
  await ghl({ method: "PUT", path: `/opportunities/${oppId}`, body: { pipelineStageId: STAGE_CONTACTED } }).catch(() => {});
  await ghl({ method: "POST", path: `/contacts/${contactId}/notes`, body: { body: `Cold outreach sent ${new Date().toISOString()} from ${OUTREACH_LINE}:\n${message}` } }).catch(() => {});

  return redirect("sent=1");
}
