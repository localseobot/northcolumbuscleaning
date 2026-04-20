// Shared Quo (formerly OpenPhone) API helper.
// Every automated SMS across the app goes through this so they all come from
// the Quo workspace number — landing in Quo's shared inbox alongside manual
// team messages. Customers reply to the same number they already know.
//
// Env vars:
//   QUO_API_KEY      — from Quo dashboard → Settings → API
//   QUO_FROM_NUMBER  — E.164 format, e.g. "+16145550100"

const QUO_BASE = "https://api.openphone.com/v1";

/**
 * Send an SMS from the Quo workspace number.
 * @param {string} to - Recipient in E.164, e.g. "+16145551234"
 * @param {string} content - Message body (1-1600 chars)
 * @param {object} [opts]
 * @param {string} [opts.userId] - Optional Quo user ID to attribute the send to
 * @param {string} [opts.setInboxStatus] - "done" to auto-close the conversation
 * @returns {Promise<{ok: boolean, status: number, body: any}>}
 */
export async function sendSms(to, content, opts = {}) {
  const apiKey = process.env.QUO_API_KEY;
  const from = process.env.QUO_FROM_NUMBER;

  if (!apiKey || !from) {
    return {
      ok: false,
      status: 0,
      body: { error: "Missing QUO_API_KEY or QUO_FROM_NUMBER env var" },
    };
  }

  const body = {
    from,
    to: [to],
    content: content.slice(0, 1600),
  };
  if (opts.userId) body.userId = opts.userId;
  if (opts.setInboxStatus) body.setInboxStatus = opts.setInboxStatus;

  try {
    const res = await fetch(`${QUO_BASE}/messages`, {
      method: "POST",
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return { ok: res.ok, status: res.status, body: parsed };
  } catch (e) {
    return { ok: false, status: 0, body: { error: String(e) } };
  }
}
