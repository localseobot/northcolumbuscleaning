// Cancellation win-back — sent ~3 days after a booking is cancelled.
// Soft re-engagement with an incentive code that's easy to redeem.

import { BRAND, wrapEmail, cta } from "./_layout.js";

const WINBACK_CODE = process.env.WINBACK_CODE || "COMEBACK15";
const WINBACK_PCT = process.env.WINBACK_PCT || "15";

/**
 * @param {object} input
 * @param {string} input.firstName
 */
export function buildCancellationWinback({ firstName }) {
  const name = firstName || "there";
  const subject = `${name}, ${WINBACK_PCT}% off when you're ready to come back 🧼`;

  const body = `
    <div style="padding:32px 32px 8px;">
      <p style="margin:0 0 14px;font-size:17px;line-height:1.55;color:${BRAND.text};">Hi ${name},</p>
      <p style="margin:0 0 16px;font-size:17px;line-height:1.55;color:${BRAND.text};">
        We noticed your recent booking didn't work out. No hard feelings — life happens! If anything went wrong on our end, we'd genuinely love to hear about it so we can do better.
      </p>
      <p style="margin:0 0 20px;font-size:17px;line-height:1.55;color:${BRAND.text};">
        Whenever you're ready to try us, here's a little something to say sorry for the friction:
      </p>
    </div>

    <div style="padding:8px 32px 24px;text-align:center;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.primary};border-radius:12px;">
        <tr>
          <td style="padding:32px 24px;text-align:center;">
            <div style="font-size:14px;font-weight:900;letter-spacing:0.12em;text-transform:uppercase;color:${BRAND.accent};margin-bottom:8px;">Welcome-back offer</div>
            <h2 style="margin:0 0 18px;font-size:38px;font-weight:900;color:#ffffff;line-height:1.1;letter-spacing:-0.5px;">
              ${WINBACK_PCT}% OFF
            </h2>
            <p style="margin:0 0 16px;font-size:15px;color:${BRAND.accent};">Use this code at checkout:</p>
            <div style="display:inline-block;background:#ffffff;color:${BRAND.primary};font-family:monospace;font-size:26px;font-weight:900;letter-spacing:0.15em;padding:14px 28px;border-radius:8px;">${WINBACK_CODE}</div>
            <p style="margin:18px 0 0;font-size:13px;color:${BRAND.accent};opacity:0.9;">Valid on your next cleaning. One per household.</p>
          </td>
        </tr>
      </table>
    </div>

    <div style="padding:8px 32px 24px;text-align:center;">
      ${cta("Book your clean →", "https://www.northcolumbuscleaning.com/book-now")}
    </div>

    <div style="padding:8px 32px 24px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.bg};border-left:4px solid ${BRAND.primary};border-radius:6px;">
        <tr>
          <td style="padding:18px 22px;">
            <p style="margin:0 0 6px;font-size:14px;font-weight:900;text-transform:uppercase;letter-spacing:0.08em;color:${BRAND.primary};">Was something off?</p>
            <p style="margin:0;font-size:15px;line-height:1.55;color:${BRAND.text};">
              We're a small local team and feedback is gold. Reply to this email or call <a href="tel:${BRAND.phoneHref}" style="color:${BRAND.primary};font-weight:700;">${BRAND.phone}</a> — even a one-liner helps us improve.
            </p>
          </td>
        </tr>
      </table>
    </div>
  `;

  return {
    subject,
    html: wrapEmail({
      subject,
      preheader: `${WINBACK_PCT}% off your next cleaning when you're ready. Use code ${WINBACK_CODE}.`,
      eyebrow: "We miss you",
      headline: `${WINBACK_PCT}% off when you come back`,
      body,
    }),
  };
}
