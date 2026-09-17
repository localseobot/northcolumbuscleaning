// The lead hand-off email — the product, delivered.
//
// This is the single most important message the business sends. The buyer
// should be able to act on it from a phone notification without opening
// anything else: who it is, how to reach them, what they want, in that order.

import { wrapEmail, cta, BRAND } from "./_layout.js";

function esc(v) {
  return String(v === null || v === undefined ? "" : v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function row(label, value) {
  if (!value) return "";
  return `<tr>
    <td style="padding:10px 0;border-bottom:1px solid ${BRAND.border};color:${BRAND.textMuted};font-size:14px;width:34%;vertical-align:top;">${esc(label)}</td>
    <td style="padding:10px 0;border-bottom:1px solid ${BRAND.border};font-size:15px;font-weight:600;vertical-align:top;">${value}</td>
  </tr>`;
}

/**
 * @param {object} o
 * @param {"web"|"phone"} o.channel
 * @param {string} o.name
 * @param {string} [o.phone]
 * @param {string} [o.email]
 * @param {string} [o.service]
 * @param {string} [o.detail]      Their own words, or the call summary
 * @param {string} [o.dashboardUrl]
 * @param {boolean} [o.billable]
 */
export function buildLeadAlert(o) {
  const via = o.channel === "phone" ? "Phone call" : "Website form";
  const headline = o.channel === "phone" ? "New call" : "New quote request";

  const phoneLink = o.phone
    ? `<a href="tel:${esc(o.phone)}" style="color:${BRAND.primary};text-decoration:none;">${esc(o.phone)}</a>`
    : "";
  const emailLink = o.email
    ? `<a href="mailto:${esc(o.email)}" style="color:${BRAND.primary};text-decoration:none;word-break:break-all;">${esc(o.email)}</a>`
    : "";

  const body = `
    <p style="margin:0 0 6px;font-size:17px;font-weight:700;">${esc(o.name || "New lead")}</p>
    <p style="margin:0 0 22px;color:${BRAND.textMuted};font-size:14px;">Came in via ${esc(via)} · ${esc(
      new Date().toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" }),
    )} ET</p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;">
      ${row("Phone", phoneLink)}
      ${row("Email", emailLink)}
      ${row("Service", esc(o.service || ""))}
      ${row("What they said", o.detail ? esc(o.detail).replace(/\n/g, "<br>") : "")}
    </table>

    <p style="margin:0 0 20px;font-size:15px;color:${BRAND.textMuted};">
      Call them back first — speed to the phone is what wins these.
    </p>

    ${o.phone ? `<p style="margin:0 0 18px;">${cta("Call now", `tel:${esc(o.phone)}`)}</p>` : ""}
    ${
      o.dashboardUrl
        ? `<p style="margin:0;font-size:14px;"><a href="${esc(o.dashboardUrl)}" style="color:${BRAND.primary};font-weight:600;">Open your lead dashboard →</a></p>`
        : ""
    }
    ${
      o.billable === false
        ? `<p style="margin:22px 0 0;padding:12px 14px;background:#f1f5f9;border-radius:8px;font-size:13px;color:${BRAND.textMuted};">
             You've heard from this person recently, so this one isn't billed.
           </p>`
        : ""
    }
  `;

  return {
    subject: `${headline}: ${o.name || "new lead"}${o.phone ? ` · ${o.phone}` : ""}`,
    html: wrapEmail({
      subject: `${headline} — ${o.name || "new lead"}`,
      preheader: `${via} · ${o.service || "cleaning enquiry"}${o.phone ? ` · ${o.phone}` : ""}`,
      eyebrow: "New lead",
      headline,
      body,
      includeFooter: false,
    }),
  };
}

/** The same lead, compressed to fit an SMS notification. */
export function buildLeadSms({ channel, name, phone, service, dashboardUrl }) {
  const via = channel === "phone" ? "CALL" : "WEB";
  return [
    `NEW LEAD (${via}) — North Columbus Cleaning`,
    name || "(no name)",
    phone || "",
    service ? `Wants: ${service}` : "",
    dashboardUrl ? `Details: ${dashboardUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
