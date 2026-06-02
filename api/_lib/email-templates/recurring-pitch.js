// Recurring upsell — sent 3-5 days after a one-time customer's job
// completes. They've had time to enjoy the clean home, the novelty's
// still fresh, but dust hasn't started building up yet. Best moment
// to convert them to recurring service.

import { BRAND, wrapEmail, fmtServiceName, cta } from "./_layout.js";

/**
 * @param {object} input
 * @param {string} input.firstName
 * @param {string} [input.lastServiceType]
 * @param {number} [input.lastPrice]            What they paid one-time
 */
export function buildRecurringPitch({
  firstName,
  lastServiceType,
  lastPrice,
}) {
  const name = firstName || "there";
  const lastService = fmtServiceName(lastServiceType);
  // Rough estimate: biweekly recurring price ~85% of one-time. We don't
  // know the customer's actual recurring price without rerunning the
  // pricing engine, so we just show the discount tiers and let them book.
  const subject = `${name}, keep your home this clean (and save) 🧼`;

  const body = `
    <div style="padding:32px 32px 8px;">
      <p style="margin:0 0 14px;font-size:17px;line-height:1.55;color:${BRAND.text};">Hi ${name},</p>
      <p style="margin:0 0 16px;font-size:17px;line-height:1.55;color:${BRAND.text};">
        We hope you're still loving how fresh your home feels after our ${lastService.toLowerCase()}! Quick question — are you thinking about <strong>keeping it that way</strong>?
      </p>
      <p style="margin:0 0 20px;font-size:17px;line-height:1.55;color:${BRAND.text};">
        Most one-time customers tell us the hardest part of cleaning is the deep-reset every couple of months. With recurring service we just <strong>maintain the clean</strong> — it stays this nice between visits, no big buildup, no big bill.
      </p>
    </div>

    <!-- Discount tiers card -->
    <div style="padding:8px 32px 24px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.primary};border-radius:14px;overflow:hidden;">
        <tr>
          <td style="padding:24px 24px 16px;text-align:center;">
            <div style="font-size:13px;font-weight:900;letter-spacing:0.12em;text-transform:uppercase;color:${BRAND.accent};margin-bottom:6px;">
              Recurring discount tiers
            </div>
            <h2 style="margin:0;font-size:24px;font-weight:900;color:#ffffff;line-height:1.2;">
              Save up to 20% — forever
            </h2>
          </td>
        </tr>
        <tr>
          <td style="padding:0 24px 24px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border-radius:10px;overflow:hidden;">
              <tr style="background:#ecfdf5;">
                <td style="padding:14px 18px;font-size:15px;font-weight:900;color:${BRAND.primary};">Weekly</td>
                <td style="padding:14px 18px;text-align:right;font-size:22px;font-weight:900;color:${BRAND.primary};">20% off</td>
              </tr>
              <tr>
                <td style="padding:14px 18px;font-size:15px;font-weight:700;color:${BRAND.text};border-top:1px solid ${BRAND.border};">Biweekly</td>
                <td style="padding:14px 18px;text-align:right;font-size:20px;font-weight:900;color:${BRAND.primary};border-top:1px solid ${BRAND.border};">15% off</td>
              </tr>
              <tr>
                <td style="padding:14px 18px;font-size:15px;font-weight:700;color:${BRAND.text};border-top:1px solid ${BRAND.border};">Every 3 weeks</td>
                <td style="padding:14px 18px;text-align:right;font-size:20px;font-weight:900;color:${BRAND.primary};border-top:1px solid ${BRAND.border};">8.5% off</td>
              </tr>
              <tr>
                <td style="padding:14px 18px;font-size:15px;font-weight:700;color:${BRAND.text};border-top:1px solid ${BRAND.border};">Monthly</td>
                <td style="padding:14px 18px;text-align:right;font-size:15px;font-weight:700;color:${BRAND.textMuted};border-top:1px solid ${BRAND.border};">Standard rate</td>
              </tr>
            </table>
            <p style="margin:14px 0 0;font-size:12px;color:${BRAND.accent};text-align:center;opacity:0.9;">
              Discounts apply automatically — same crew, same checklist, every visit.
            </p>
          </td>
        </tr>
      </table>
    </div>

    <div style="padding:8px 32px 28px;text-align:center;">
      ${cta("Set up recurring service →", "https://www.northcolumbuscleaning.com/book-now")}
      <p style="margin:14px 0 0;font-size:13px;color:${BRAND.textMuted};">
        No commitment — pause, skip, or cancel anytime from your portal.
      </p>
    </div>

    <!-- Why customers choose recurring -->
    <div style="padding:8px 32px 24px;">
      <h2 style="margin:0 0 14px;font-size:18px;font-weight:900;color:${BRAND.text};">Why most of our customers go recurring</h2>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="vertical-align:top;padding:8px 12px 8px 0;width:32px;font-size:20px;line-height:1;">✓</td>
          <td style="padding:8px 0;font-size:15px;line-height:1.55;color:${BRAND.text};"><strong>Same crew</strong> — they learn your home, your preferences, your pets.</td>
        </tr>
        <tr>
          <td style="vertical-align:top;padding:8px 12px 8px 0;font-size:20px;line-height:1;">✓</td>
          <td style="padding:8px 0;font-size:15px;line-height:1.55;color:${BRAND.text};"><strong>Less time per visit</strong> as maintenance replaces deep-resets.</td>
        </tr>
        <tr>
          <td style="vertical-align:top;padding:8px 12px 8px 0;font-size:20px;line-height:1;">✓</td>
          <td style="padding:8px 0;font-size:15px;line-height:1.55;color:${BRAND.text};"><strong>No scheduling hassle</strong> — your slot is locked in, just live your life.</td>
        </tr>
        <tr>
          <td style="vertical-align:top;padding:8px 12px 8px 0;font-size:20px;line-height:1;">✓</td>
          <td style="padding:8px 0;font-size:15px;line-height:1.55;color:${BRAND.text};">Auto-billing through the portal — <strong>no invoicing back-and-forth</strong>.</td>
        </tr>
      </table>
    </div>

    <div style="padding:8px 32px 24px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.bg};border-left:4px solid ${BRAND.primary};border-radius:6px;">
        <tr>
          <td style="padding:18px 22px;">
            <p style="margin:0;font-size:15px;line-height:1.55;color:${BRAND.text};">
              <strong style="color:${BRAND.primary};">Want to keep it one-time?</strong> Totally fine — we'll be ready whenever you book the next one. <a href="https://www.northcolumbuscleaning.com/book-now" style="color:${BRAND.primary};font-weight:700;">Book your next clean here</a>.
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
      preheader: "Recurring service customers save 8.5-20% per visit. No commitment. Pause anytime.",
      eyebrow: "Recurring Savings",
      headline: "Keep it spotless ✨",
      body,
    }),
  };
}

/**
 * Short SMS variant — sent at the same time as the email.
 * GHL auto-appends "Reply STOP to unsubscribe."
 */
export function buildRecurringPitchSms({ firstName }) {
  const name = firstName || "there";
  return (
    `Hi ${name}, North Columbus Cleaning here — hope your home still looks amazing! ` +
    `Want us back regularly? Customers save 8.5-20% with recurring service. ` +
    `Set it up: northcolumbuscleaning.com/book-now`
  );
}
