// Receives "Not great" feedback from the /review review-gate page.
//
// Triple delivery so the owner can't miss it:
//   1. Email to admin@ (rich HTML, easy to act on from inbox)
//   2. GHL contact note (if we can match by email — also tags the contact)
//   3. Slack ping (if SLACK_WEBHOOK_URL is configured)
//
// Returns ok: true unless input validation fails. Network errors on the
// downstream channels are logged in the response but don't fail the call —
// we don't want a Slack outage to break customer feedback capture.

import { ghl } from "./_lib/ghl.js";
import { sendEmail } from "./_lib/resend.js";
import { sendSlack } from "./_lib/slack.js";

export const config = { runtime: "nodejs" };

function s(v) {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}
function lower(v) {
  return s(v).toLowerCase();
}
function escapeHtml(x) {
  return String(x || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export default async function handler(req, res) {
  // CORS — page is same-origin so this is mostly belt-and-suspenders
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: "Invalid JSON" }); }
  }
  body = body || {};

  const message = s(body.message);
  if (!message || message.length < 3) {
    return res.status(400).json({ error: "Please describe what happened." });
  }
  const name = s(body.name) || s(body.referrerName) || "(no name)";
  const email = lower(body.email || body.referrerEmail);
  const source = s(body.source) || "review-gate";

  const result = {
    ok: true,
    receivedAt: new Date().toISOString(),
    channels: {},
  };

  // ── 1. Send to admin via Resend ─────────────────────────────────────────
  try {
    const subject = `⚠️ Customer feedback: "${message.slice(0, 50)}${message.length > 50 ? "…" : ""}"`;
    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:24px;">
        <h1 style="font-size:22px;margin:0 0 16px;color:#b91c1c;">Negative-experience feedback received</h1>
        <p style="margin:0 0 16px;font-size:15px;color:#475569;">
          A customer chose the "Not great" path on the review page. Reach out fast — every recovered customer matters.
        </p>
        <table style="width:100%;border-collapse:collapse;background:#faf9f5;border-radius:8px;margin:16px 0;">
          <tr><td style="padding:12px 16px;font-size:13px;color:#64748b;width:30%;">Name</td><td style="padding:12px 16px;font-size:15px;color:#0f172a;font-weight:600;">${escapeHtml(name)}</td></tr>
          <tr><td style="padding:12px 16px;font-size:13px;color:#64748b;">Email</td><td style="padding:12px 16px;font-size:15px;"><a href="mailto:${escapeHtml(email)}" style="color:#1a4d2e;">${escapeHtml(email || "(not provided)")}</a></td></tr>
          <tr><td style="padding:12px 16px;font-size:13px;color:#64748b;">Source</td><td style="padding:12px 16px;font-size:14px;color:#475569;">${escapeHtml(source)}</td></tr>
          <tr><td style="padding:12px 16px;font-size:13px;color:#64748b;">Received</td><td style="padding:12px 16px;font-size:14px;color:#475569;">${escapeHtml(result.receivedAt)}</td></tr>
        </table>
        <div style="background:#fef3c7;border-left:4px solid #f59e0b;border-radius:6px;padding:16px 18px;margin:16px 0;">
          <p style="margin:0 0 6px;font-size:13px;font-weight:900;text-transform:uppercase;letter-spacing:0.08em;color:#92400e;">What they said</p>
          <p style="margin:0;font-size:16px;line-height:1.55;color:#0f172a;white-space:pre-wrap;">${escapeHtml(message)}</p>
        </div>
        ${email ? `<a href="mailto:${escapeHtml(email)}?subject=Re%3A%20Your%20cleaning%20experience" style="display:inline-block;background:#1a4d2e;color:#c9e265;font-weight:900;text-decoration:none;padding:12px 22px;border-radius:8px;">Reply to ${escapeHtml(email)} →</a>` : ""}
      </div>`;
    const emailRes = await sendEmail({
      to: process.env.FEEDBACK_NOTIFY_EMAIL || "admin@northcolumbuscleaning.com",
      subject,
      html,
      tags: ["customer-feedback", "review-gate"],
    });
    result.channels.email = emailRes.id ? { sent: true, id: emailRes.id } : { sent: false, reason: emailRes.reason || emailRes.error };
  } catch (e) {
    result.channels.email = { sent: false, error: e.message };
  }

  // ── 2. Drop a note on the GHL contact (if matchable) ────────────────────
  if (email && process.env.GHL_PIT) {
    try {
      const upsert = await ghl({
        method: "POST",
        path: "/contacts/upsert",
        body: {
          locationId: process.env.GHL_LOCATION_ID,
          email,
          firstName: name && name !== "(no name)" ? name.split(" ")[0] : undefined,
          source: "Feedback form",
        },
      });
      const contactId = upsert?.contact?.id || upsert?.id;
      if (contactId) {
        await ghl({
          method: "POST",
          path: `/contacts/${contactId}/notes`,
          body: {
            body: `⚠️ Negative-experience feedback (source: ${source})\n\n${message}`,
          },
        });
        // Tag the contact for follow-up
        await ghl({
          method: "POST",
          path: `/contacts/${contactId}/tags`,
          body: { tags: ["needs-recovery", "feedback:negative"] },
        }).catch(() => null);
        result.channels.ghl = { ok: true, contactId };
      } else {
        result.channels.ghl = { ok: false, reason: "no contactId returned" };
      }
    } catch (e) {
      result.channels.ghl = { ok: false, error: e.message };
    }
  }

  // ── 3. Slack ping (if configured) ───────────────────────────────────────
  if (process.env.SLACK_WEBHOOK_URL) {
    try {
      const text = `⚠️ *Customer feedback received* (review gate)\n*From:* ${name}${email ? ` <${email}>` : ""}\n*Message:* ${message}`;
      await sendSlack({
        text,
        blocks: [
          { type: "header", text: { type: "plain_text", text: "⚠️ Negative-experience feedback" } },
          {
            type: "section",
            fields: [
              { type: "mrkdwn", text: `*From:*\n${name}${email ? ` <${email}>` : ""}` },
              { type: "mrkdwn", text: `*Source:*\n${source}` },
            ],
          },
          { type: "section", text: { type: "mrkdwn", text: `*Message:*\n>${message.replace(/\n/g, "\n>")}` } },
          { type: "context", elements: [{ type: "mrkdwn", text: `Received ${result.receivedAt}` }] },
        ],
      });
      result.channels.slack = { sent: true };
    } catch (e) {
      result.channels.slack = { sent: false, error: e.message };
    }
  }

  return res.status(200).json(result);
}
