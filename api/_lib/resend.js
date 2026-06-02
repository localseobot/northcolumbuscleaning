// Resend transactional email client.
//
// Env vars (set in Vercel — never commit):
//   RESEND_API_KEY      Required. From https://resend.com/api-keys
//   RESEND_FROM         Required. "North Columbus Cleaning <hello@northcolumbuscleaning.com>"
//   RESEND_REPLY_TO     Optional. Defaults to RESEND_FROM. Set to admin@northcolumbuscleaning.com
//                        so customer replies land in your real inbox.
//   RESEND_BCC_OPS      Optional. BCC every transactional email to your own ops inbox
//                        (useful early on to verify what's going out).
//
// Behaviour:
//   - If RESEND_API_KEY or RESEND_FROM is missing, sendEmail() is a no-op
//     that returns { skipped: true, reason }. This means we can deploy the
//     wiring before the env vars exist, then flip the switch in Vercel
//     without a code change.
//   - Sends via https://api.resend.com/emails (POST)
//   - Returns { id } on success, { error } on Resend rejection.

const RESEND_API = "https://api.resend.com/emails";

function getFrom() {
  return process.env.RESEND_FROM || null;
}
function getReplyTo() {
  return process.env.RESEND_REPLY_TO || process.env.RESEND_FROM || null;
}

/**
 * Send a transactional email via Resend.
 *
 * @param {object} opts
 * @param {string|string[]} opts.to       Recipient(s)
 * @param {string} opts.subject
 * @param {string} [opts.html]            HTML body (preferred)
 * @param {string} [opts.text]            Plain text fallback (auto-derived if absent)
 * @param {object} [opts.headers]         Extra headers (e.g. List-Unsubscribe)
 * @param {object[]} [opts.attachments]   Resend attachment objects
 * @param {string[]} [opts.tags]          Tagging for Resend analytics (max 10)
 * @returns {Promise<{id?: string, skipped?: boolean, reason?: string, error?: string}>}
 */
export async function sendEmail({
  to,
  subject,
  html,
  text,
  headers,
  attachments,
  tags,
}) {
  const key = process.env.RESEND_API_KEY;
  const from = getFrom();
  if (!key) return { skipped: true, reason: "RESEND_API_KEY not set" };
  if (!from) return { skipped: true, reason: "RESEND_FROM not set" };
  if (!to) return { skipped: true, reason: "no recipient" };
  if (!subject) return { skipped: true, reason: "no subject" };
  if (!html && !text) return { skipped: true, reason: "no body" };

  const body = {
    from,
    to: Array.isArray(to) ? to : [to],
    subject,
  };
  const replyTo = getReplyTo();
  if (replyTo && replyTo !== from) body.reply_to = replyTo;
  if (html) body.html = html;
  if (text) body.text = text;
  if (headers) body.headers = headers;
  if (attachments) body.attachments = attachments;
  if (tags?.length) {
    body.tags = tags.slice(0, 10).map((t) =>
      typeof t === "string" ? { name: t } : t,
    );
  }
  // Always BCC ops if configured — lets us see real outbound during ramp-up.
  if (process.env.RESEND_BCC_OPS) body.bcc = [process.env.RESEND_BCC_OPS];

  const res = await fetch(RESEND_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      error: payload?.message || payload?.error || `Resend ${res.status}`,
      raw: payload,
    };
  }
  return { id: payload?.id };
}

// Strip HTML tags for a plain-text fallback. Not perfect but good enough
// for the simple branded templates we're using.
export function htmlToText(html) {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>(\s*)/gi, "\n")
    .replace(/<\/(p|div|h\d|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
