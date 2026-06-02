// Post-job review request — sent ~4 hours after booking.completed.
// Highest-leverage email for a new business: every Google review
// compounds future trust.
//
// The CTA goes to /review (a smiley-face landing page) rather than directly
// to Google. The page lets happy customers route to Google and gives the
// owner a chance to recover any unhappy customers privately before they
// post publicly.

import { BRAND, wrapEmail, cta } from "./_layout.js";

/**
 * @param {object} input
 * @param {string} input.firstName
 * @param {string} [input.serviceType]
 * @param {string} [input.email]   Customer email — pre-fills the review landing page
 */
export function buildReviewRequest({ firstName, serviceType, email }) {
  const name = firstName || "there";
  const subject = `Hope your home is shining, ${name}! 🌟`;

  // Build the review-gate URL with name/email so the landing page can
  // personalize the greeting and pre-fill the feedback form if needed.
  const params = new URLSearchParams();
  if (firstName) params.set("n", firstName);
  if (email) params.set("e", email);
  const REVIEW_URL =
    `${BRAND.website}/review${params.toString() ? "?" + params.toString() : ""}`;

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
            <div style="font-size:34px;line-height:1;margin-bottom:8px;">
              😊&nbsp;&nbsp;&nbsp;😞
            </div>
            <h2 style="margin:0 0 14px;font-size:22px;font-weight:900;color:${BRAND.text};line-height:1.3;">
              How was your cleaning?
            </h2>
            <p style="margin:0 0 18px;font-size:15px;line-height:1.5;color:${BRAND.textMuted};">
              Click below and let us know with one tap. If you loved it, we'd be honored by a Google review. If something fell short, we want to make it right.
            </p>
            ${cta("Share your experience →", REVIEW_URL)}
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
