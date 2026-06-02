// Post-job review request — sent ~4 hours after booking.completed.
// Highest-leverage email for a new business: every Google review
// compounds future trust.

import { BRAND, wrapEmail, cta } from "./_layout.js";

// Replace with your real Place ID once you have it
const REVIEW_URL =
  process.env.GOOGLE_REVIEW_URL ||
  "https://search.google.com/local/writereview?placeid=YOUR_PLACE_ID";

/**
 * @param {object} input
 * @param {string} input.firstName
 * @param {string} [input.serviceType]
 */
export function buildReviewRequest({ firstName, serviceType }) {
  const name = firstName || "there";
  const subject = `Hope your home is shining, ${name}! 🌟`;

  const body = `
    <div style="padding:32px 32px 8px;">
      <p style="margin:0 0 14px;font-size:17px;line-height:1.55;color:${BRAND.text};">Hi ${name},</p>
      <p style="margin:0 0 16px;font-size:17px;line-height:1.55;color:${BRAND.text};">
        Thank you so much for choosing North Columbus Cleaning. We hope your space is feeling fresh and you're loving the results!
      </p>
      <p style="margin:0 0 20px;font-size:17px;line-height:1.55;color:${BRAND.text};">
        If we earned it, we'd be incredibly grateful for a quick Google review. As a small local team, every honest review genuinely helps another family in the area find us. It takes about 30 seconds.
      </p>
    </div>

    <div style="padding:8px 32px 24px;text-align:center;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fef3c7;border:2px solid #fbbf24;border-radius:12px;">
        <tr>
          <td style="padding:28px 24px;">
            <div style="font-size:14px;font-weight:900;letter-spacing:0.1em;text-transform:uppercase;color:#92400e;margin-bottom:10px;">
              ⭐⭐⭐⭐⭐
            </div>
            <h2 style="margin:0 0 14px;font-size:22px;font-weight:900;color:${BRAND.text};line-height:1.3;">
              Would you leave us a quick Google review?
            </h2>
            <p style="margin:0 0 18px;font-size:15px;line-height:1.5;color:${BRAND.textMuted};">
              30 seconds. Means the world to a new local business.
            </p>
            ${cta("Leave a Google review →", REVIEW_URL)}
          </td>
        </tr>
      </table>
    </div>

    <div style="padding:8px 32px 24px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.bg};border-left:4px solid ${BRAND.primary};border-radius:6px;">
        <tr>
          <td style="padding:18px 22px;">
            <p style="margin:0 0 8px;font-size:14px;font-weight:900;text-transform:uppercase;letter-spacing:0.08em;color:${BRAND.primary};">Something wasn't right?</p>
            <p style="margin:0;font-size:15px;line-height:1.55;color:${BRAND.text};">
              Please reply to this email or call <a href="tel:${BRAND.phoneHref}" style="color:${BRAND.primary};font-weight:700;">${BRAND.phone}</a> first. Our 100% satisfaction guarantee means we'll come back and re-clean, free. Your feedback matters more than a star count.
            </p>
          </td>
        </tr>
      </table>
    </div>

    <div style="padding:8px 32px 24px;">
      <p style="margin:0 0 8px;font-size:17px;line-height:1.55;color:${BRAND.text};">
        Thanks for trusting us with your home${serviceType ? " for your " + String(serviceType).toLowerCase() : ""}. We'd love to see you again!
      </p>
      <p style="margin:0;font-size:16px;line-height:1.55;color:${BRAND.text};">
        Need another clean? <a href="${BRAND.portalUrl}" style="color:${BRAND.primary};font-weight:700;">Book through your portal</a> in under a minute.
      </p>
    </div>
  `;

  return {
    subject,
    html: wrapEmail({
      subject,
      preheader: "If we earned it, would you leave us a quick Google review? Means the world to a small local team.",
      eyebrow: "Thank You",
      headline: "Your home is sparkling ✨",
      body,
    }),
  };
}
