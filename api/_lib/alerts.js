// Multi-channel operational alerts. Used wherever something urgent
// needs to land on the manager's radar (same-day cancels, cleaner
// call-outs, customer feedback, etc.).
//
// Sends in parallel to:
//   - SMS to MANAGER_PHONE env var (most reliable)
//   - Slack via SLACK_WEBHOOK_URL env var
//   - Email to FEEDBACK_NOTIFY_EMAIL env var (lowest priority backup)
//
// Each channel is best-effort — a failure on one doesn't block the
// others. Returns a result object so callers can log what landed.

import { sendGhlSms, INTERNAL_LINE } from "./ghl-sms.js";
import { sendEmail } from "./resend.js";
import { sendSlack } from "./slack.js";

/**
 * Send an operational alert to all configured channels.
 *
 * @param {object} opts
 * @param {string} opts.title    Short headline (used as email subject + SMS prefix)
 * @param {string} opts.body     Multi-line body (Markdown-ish; we strip light formatting for SMS)
 * @param {("urgent"|"info")} [opts.severity="urgent"]
 * @param {object[]} [opts.slackBlocks]  Optional Slack block-kit blocks; falls back to plain text
 * @param {string} [opts.contactUrl]     Optional GHL contact URL to link the alert to
 * @returns {Promise<{ok: boolean, channels: object}>}
 */
export async function sendOpsAlert({
  title,
  body,
  severity = "urgent",
  slackBlocks,
  contactUrl,
}) {
  const channels = {};
  const prefix = severity === "urgent" ? "🚨 " : "ℹ️ ";
  const smsBody =
    `${prefix}${title}\n\n${body}`.length > 320
      ? `${prefix}${title}\n\n${body.slice(0, 280)}…`
      : `${prefix}${title}\n\n${body}`;

  // ── SMS to manager ────────────────────────────────────────────────
  const managerPhone = process.env.MANAGER_PHONE;
  if (managerPhone) {
    try {
      const sms = await sendGhlSms({
        to: managerPhone,
        message: smsBody,
        firstName: "Manager",
        tag: "internal:manager",
        fromNumber: INTERNAL_LINE,
      });
      channels.sms = sms.ok
        ? { sent: true, messageId: sms.messageId }
        : { sent: false, reason: sms.error };
    } catch (e) {
      channels.sms = { sent: false, error: e.message };
    }
  } else {
    channels.sms = { sent: false, reason: "MANAGER_PHONE not set" };
  }

  // ── Slack ────────────────────────────────────────────────────────
  if (process.env.SLACK_WEBHOOK_URL) {
    try {
      const blocks = slackBlocks || [
        {
          type: "header",
          text: { type: "plain_text", text: `${prefix}${title}` },
        },
        {
          type: "section",
          text: { type: "mrkdwn", text: body },
        },
        ...(contactUrl
          ? [
              {
                type: "actions",
                elements: [
                  {
                    type: "button",
                    text: { type: "plain_text", text: "Open contact in GHL" },
                    url: contactUrl,
                  },
                ],
              },
            ]
          : []),
      ];
      await sendSlack(process.env.SLACK_WEBHOOK_URL, blocks, `${prefix}${title}`);
      channels.slack = { sent: true };
    } catch (e) {
      channels.slack = { sent: false, error: e.message };
    }
  } else {
    channels.slack = { sent: false, reason: "SLACK_WEBHOOK_URL not set" };
  }

  // ── Email (lowest priority, FYI channel) ──────────────────────────
  const notifyEmail =
    process.env.OPS_NOTIFY_EMAIL ||
    process.env.FEEDBACK_NOTIFY_EMAIL ||
    "admin@northcolumbuscleaning.com";
  if (notifyEmail) {
    try {
      const html = `<div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
        <h1 style="margin:0 0 16px;font-size:22px;color:${severity === "urgent" ? "#b91c1c" : "#1a4d2e"};">${prefix}${title}</h1>
        <pre style="white-space:pre-wrap;background:#faf9f5;border-left:4px solid ${severity === "urgent" ? "#b91c1c" : "#1a4d2e"};border-radius:6px;padding:18px 22px;font-family:-apple-system,sans-serif;font-size:15px;line-height:1.55;color:#0f172a;">${body}</pre>
        ${contactUrl ? `<p style="margin:16px 0 0;"><a href="${contactUrl}" style="color:#1a4d2e;font-weight:700;">Open in GHL →</a></p>` : ""}
      </div>`;
      const emailRes = await sendEmail({
        to: notifyEmail,
        subject: `${prefix}${title}`,
        html,
        tags: ["ops-alert", severity],
      });
      channels.email = emailRes.id
        ? { sent: true, id: emailRes.id }
        : { sent: false, reason: emailRes.reason || emailRes.error };
    } catch (e) {
      channels.email = { sent: false, error: e.message };
    }
  }

  const ok = Object.values(channels).some((c) => c.sent);
  return { ok, channels };
}
