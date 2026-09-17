// Slack Incoming Webhook helper.
//
// Used as a safety net: when a lead can't be written to the CRM or delivered
// to the buyer, it still surfaces in Slack so nothing is silently lost.
//
// Set up:
//   1. Slack workspace → Apps → "Incoming Webhooks" → Add to Slack
//   2. Pick the channel (e.g. #leads)
//   3. Copy the webhook URL (starts with https://hooks.slack.com/services/...)
//   4. Set SLACK_WEBHOOK_URL in Vercel
//
// No-ops cleanly if SLACK_WEBHOOK_URL isn't set, so the caller keeps working.

/**
 * POST a block payload to Slack. Returns { ok, status, error }.
 *
 * @param {string} webhookUrl
 * @param {object[]} blocks
 * @param {string} [text]  Fallback text for notifications/screen readers
 */
export async function sendSlack(webhookUrl, blocks, text) {
  if (!webhookUrl) return { ok: false, skipped: "SLACK_WEBHOOK_URL not set" };
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text || "Notification", blocks }),
    });
    const body = await res.text();
    if (!res.ok) return { ok: false, status: res.status, error: body };
    return { ok: true, status: res.status };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
