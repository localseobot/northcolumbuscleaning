// Slack Incoming Webhook helper. Posts a Block Kit-formatted call recap
// to whatever channel the SLACK_WEBHOOK_URL points at.
//
// Set up:
//   1. Slack workspace → Apps → "Incoming Webhooks" → Add to Slack
//   2. Pick the channel (e.g. #leads)
//   3. Copy the webhook URL (starts with https://hooks.slack.com/services/...)
//   4. Set SLACK_WEBHOOK_URL in Vercel
//
// No-ops cleanly if SLACK_WEBHOOK_URL isn't set, so the rest of the webhook
// keeps working.

const GHL_CONTACT_URL_BASE = "https://app.gohighlevel.com/v2/location";

function escapeMrkdwn(s) {
  // Slack mrkdwn: escape only the structural chars. Quotes/apostrophes are fine.
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function pretty(v) {
  if (v === null || v === undefined) return "";
  const s = String(v).trim();
  if (!s || s === "not_stated" || s === "0") return "";
  return s;
}

/**
 * Build the Slack Block Kit payload for a single call.
 *
 * @param {object} args
 * @param {object} args.call          Retell call object (raw payload.call)
 * @param {object} args.extracted     custom_analysis_data
 * @param {string} [args.contactId]   GHL contact ID (for the deep link)
 * @param {string} [args.locationId]  GHL sub-account ID
 * @param {object} [args.quote]       result of computeQuote() if any
 * @returns {object[]} Slack blocks array
 */
export function buildCallBlocks({ call, extracted, contactId, locationId, quote }) {
  const firstName = pretty(extracted.caller_first_name);
  const lastName = pretty(extracted.caller_last_name);
  const fullName = [firstName, lastName].filter(Boolean).join(" ") || "Unknown caller";

  const phone = pretty(extracted.callback_number) || call.from_number || "";
  const phoneClean = String(phone).replace(/[^\d+]/g, "");

  const intent = pretty(extracted.intent) || "general";
  const service = pretty(extracted.service_type);
  const frequency = pretty(extracted.frequency);
  const beds = pretty(extracted.bedrooms);
  const baths = pretty(extracted.bathrooms);
  const sqft = pretty(extracted.sqft);
  const address = pretty(extracted.service_address);
  const zip = pretty(extracted.service_zip);
  const inArea = pretty(extracted.in_service_area);
  const callback = pretty(extracted.preferred_callback_window);
  const sms = pretty(extracted.sms_consent);
  const existing = pretty(extracted.existing_customer);
  const flags = pretty(extracted.call_quality_flags);
  const specialNotes = pretty(extracted.special_notes);

  const durationSec = call.duration_ms ? Math.round(call.duration_ms / 1000) : 0;
  const sentiment = call.call_analysis?.user_sentiment || "";
  const summary = call.call_analysis?.call_summary || "";

  // Header — caller + intent + existing-customer star
  const star = existing === "yes" ? " ⭐" : "";
  const headerText = `📞 ${fullName}${star} — ${intent}`;

  // Detail fields (two columns)
  const fields = [];
  if (service || frequency) fields.push({ type: "mrkdwn", text: `*Service*\n${[service, frequency].filter(Boolean).join(" / ") || "—"}` });
  const propParts = [beds && `${beds} bd`, baths && `${baths} ba`, sqft && `${sqft} sqft`].filter(Boolean);
  if (propParts.length) fields.push({ type: "mrkdwn", text: `*Property*\n${propParts.join(", ")}` });
  if (address || zip) {
    const addrLine = [address, zip].filter(Boolean).join(" ");
    const areaSuffix = inArea ? `\n_(in area: ${inArea})_` : "";
    fields.push({ type: "mrkdwn", text: `*Address*\n${escapeMrkdwn(addrLine)}${areaSuffix}` });
  }
  if (callback) fields.push({ type: "mrkdwn", text: `*Callback window*\n${escapeMrkdwn(callback)}` });
  if (sms) fields.push({ type: "mrkdwn", text: `*Text OK?*\n${sms}` });
  if (quote) {
    const quoteText = quote.ok
      ? `*$${quote.total.toFixed(2)}/visit*`
      : `_pending — ${quote.reason}_`;
    fields.push({ type: "mrkdwn", text: `*Est. quote*\n${quoteText}` });
  }
  if (specialNotes) fields.push({ type: "mrkdwn", text: `*Notes*\n${escapeMrkdwn(specialNotes)}` });

  const blocks = [
    {
      type: "header",
      text: { type: "plain_text", text: headerText.slice(0, 150), emoji: true },
    },
  ];

  if (flags) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `:warning: *Call quality flags:* ${escapeMrkdwn(flags)}` },
    });
  }

  // Slack allows max 10 fields per section block.
  if (fields.length) {
    blocks.push({ type: "section", fields: fields.slice(0, 10) });
  }

  if (summary) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*Summary*\n${escapeMrkdwn(summary).slice(0, 2900)}` },
    });
  }

  // Action buttons
  const actionButtons = [];
  if (contactId && locationId) {
    actionButtons.push({
      type: "button",
      text: { type: "plain_text", text: "Open in GHL" },
      url: `${GHL_CONTACT_URL_BASE}/${locationId}/contacts/detail/${contactId}`,
    });
  }
  if (call.recording_url) {
    actionButtons.push({
      type: "button",
      text: { type: "plain_text", text: "Listen" },
      url: call.recording_url,
    });
  }
  if (call.public_log_url) {
    actionButtons.push({
      type: "button",
      text: { type: "plain_text", text: "Transcript" },
      url: call.public_log_url,
    });
  }
  if (phoneClean) {
    actionButtons.push({
      type: "button",
      text: { type: "plain_text", text: "Call back" },
      url: `tel:${phoneClean}`,
    });
  }
  if (actionButtons.length) {
    blocks.push({ type: "actions", elements: actionButtons });
  }

  // Footer context line
  const ctxParts = [
    phone && `📞 ${phone}`,
    durationSec && `${durationSec}s`,
    sentiment && `${sentiment}`,
    call.call_id && `\`${call.call_id.slice(0, 12)}…\``,
  ].filter(Boolean);
  if (ctxParts.length) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: ctxParts.join("  ·  ") }],
    });
  }

  return blocks;
}

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
      body: JSON.stringify({ text: text || "New call", blocks }),
    });
    const body = await res.text();
    if (!res.ok) return { ok: false, status: res.status, error: body };
    return { ok: true, status: res.status };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
