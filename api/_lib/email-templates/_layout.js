// Shared brand tokens + email layout wrapper.
//
// Each customer email follows the same visual shell — header, body card,
// footer with call/email CTA — so they all feel like they came from one
// brand. Templates only supply the in-between content via wrapEmail().

export const BRAND = {
  name: "North Columbus Cleaning",
  primary: "#1a4d2e",
  primaryDark: "#0d3320",
  accent: "#c9e265",
  bg: "#faf9f5",
  text: "#0f172a",
  textMuted: "#475569",
  border: "#e2e8f0",
  phone: "(614) 352-2588",
  phoneHref: "+16143522588",
  website: "https://www.northcolumbuscleaning.com",
  portalUrl: "https://www.northcolumbuscleaning.com/login",
  reviewGateUrl: "https://www.northcolumbuscleaning.com/review",
  googleReviewUrl: "https://g.page/r/CVq2-VaRu5iKEAI/review",
  email: "admin@northcolumbuscleaning.com",
  address: "Columbus, OH",
};

/**
 * Render a complete email document.
 *
 * @param {object} opts
 * @param {string} opts.subject               (used in <title>)
 * @param {string} [opts.preheader]            Hidden preview text
 * @param {string} [opts.eyebrow]              Small text above headline
 * @param {string} opts.headline               Big white headline
 * @param {string} [opts.headerColor]          Override header bg (default brand)
 * @param {string} opts.body                   HTML for the main body
 * @param {boolean} [opts.includeFooter=true]  Include call/email + footer
 */
export function wrapEmail({
  subject,
  preheader,
  eyebrow,
  headline,
  headerColor,
  body,
  includeFooter = true,
}) {
  const eb = eyebrow || BRAND.name;
  const hc = headerColor || BRAND.primary;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${BRAND.text};">
  ${
    preheader
      ? `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${preheader}</div>`
      : ""
  }
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.bg};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid ${BRAND.border};border-radius:12px;overflow:hidden;">
          <!-- Header -->
          <tr>
            <td style="background:${hc};padding:32px 32px 28px;text-align:center;">
              <div style="color:${BRAND.accent};font-size:13px;font-weight:900;letter-spacing:0.15em;text-transform:uppercase;">${eb}</div>
              <h1 style="margin:12px 0 0;color:#ffffff;font-size:30px;font-weight:900;line-height:1.2;letter-spacing:-0.5px;">${headline}</h1>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td>${body}</td>
          </tr>
          ${includeFooter ? renderFooter() : ""}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function renderFooter() {
  return `
          <!-- Call / Email CTA -->
          <tr>
            <td style="padding:24px 32px 8px;border-top:1px solid ${BRAND.border};">
              <p style="margin:0 0 16px;font-size:16px;line-height:1.55;color:${BRAND.text};text-align:center;">
                Questions? We&rsquo;d love to hear from you.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
                <tr>
                  <td style="padding-right:8px;">
                    <a href="tel:${BRAND.phoneHref}" style="display:inline-block;background:${BRAND.primary};color:${BRAND.accent};font-weight:900;font-size:15px;letter-spacing:0.05em;text-decoration:none;padding:12px 22px;border-radius:8px;">📞 Call ${BRAND.phone}</a>
                  </td>
                  <td>
                    <a href="mailto:${BRAND.email}" style="display:inline-block;background:#ffffff;color:${BRAND.primary};font-weight:900;font-size:15px;letter-spacing:0.05em;text-decoration:none;padding:12px 22px;border:2px solid ${BRAND.primary};border-radius:8px;">✉️ Email us</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Brand Footer -->
          <tr>
            <td style="padding:24px 32px 28px;">
              <p style="margin:0;font-size:14px;line-height:1.5;color:${BRAND.textMuted};text-align:center;">
                — The ${BRAND.name} team
              </p>
              <p style="margin:16px 0 0;font-size:12px;line-height:1.5;color:${BRAND.textMuted};text-align:center;">
                <a href="${BRAND.website}" style="color:${BRAND.textMuted};text-decoration:underline;">${BRAND.website.replace(/^https?:\/\//, "")}</a>
                &nbsp;·&nbsp;
                ${BRAND.address}
              </p>
            </td>
          </tr>`;
}

// ── Shared formatters ────────────────────────────────────────────────────────

export function fmtDateTime(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const dateOpts = { weekday: "long", month: "long", day: "numeric" };
    const timeOpts = { hour: "numeric", minute: "2-digit" };
    return `${d.toLocaleDateString("en-US", dateOpts)} at ${d.toLocaleTimeString("en-US", timeOpts)}`;
  } catch {
    return iso;
  }
}

export function fmtServiceName(serviceType) {
  if (!serviceType) return "Cleaning";
  const s = String(serviceType).toLowerCase();
  if (s.includes("deep")) return "Deep Cleaning";
  if (s.includes("move")) return "Move In/Out Cleaning";
  if (s.includes("office") || s.includes("commercial")) return "Office Cleaning";
  if (s.includes("recur")) return "Recurring Cleaning";
  return "Standard Cleaning";
}

export function fmtFrequencyName(frequency) {
  if (!frequency) return null;
  const f = String(frequency).toLowerCase();
  if (f.includes("week") && !f.includes("bi")) return "Weekly";
  if (f.includes("bi")) return "Bi-Weekly";
  if (f.includes("month")) return "Monthly";
  if (f.includes("3")) return "Every 3 Weeks";
  if (f.includes("one") || f === "once") return "One-Time";
  return frequency;
}

export function cta(label, href, opts = {}) {
  const bg = opts.bg || BRAND.primary;
  const color = opts.color || BRAND.accent;
  return `<a href="${href}" style="display:inline-block;background:${bg};color:${color};font-weight:900;font-size:15px;letter-spacing:0.1em;text-transform:uppercase;text-decoration:none;padding:14px 28px;border-radius:8px;">${label}</a>`;
}
