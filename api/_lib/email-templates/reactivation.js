// Reactivation email — sent ~30 days after the customer's last completed
// service when they have no future booking scheduled. Different from the
// cancellation-winback (which fires immediately on an explicit cancel):
//
//   cancellation-winback  → "we noticed you cancelled, here's an apology"
//   reactivation          → "it's been a month, life moves on, here's a nudge"
//
// Trigger: Vercel cron (planned) that queries GHL for contacts whose last
// service date is >30 days back and who have no open opportunity in
// Booked stage.

import { BRAND, wrapEmail, fmtServiceName, cta } from "./_layout.js";

const REACTIVATE_CODE = process.env.REACTIVATE_CODE || "REFRESH10";
const REACTIVATE_PCT = process.env.REACTIVATE_PCT || "10";

/**
 * @param {object} input
 * @param {string} input.firstName
 * @param {string} [input.lastServiceType]   What they had last time
 * @param {number} [input.daysSince]          Optional — refines the headline
 */
export function buildReactivation({
  firstName,
  lastServiceType,
  daysSince,
}) {
  const name = firstName || "there";
  const lastService = fmtServiceName(lastServiceType);
  const days = Number.isFinite(daysSince) && daysSince > 0 ? daysSince : 30;
  const timeLabel =
    days >= 60 ? "a couple of months" : days >= 30 ? "about a month" : "a few weeks";
  const subject = `${name}, it's been ${timeLabel} — your home misses us 🧼`;

  const body = `
    <div style="padding:32px 32px 8px;">
      <p style="margin:0 0 14px;font-size:17px;line-height:1.55;color:${BRAND.text};">Hi ${name},</p>
      <p style="margin:0 0 16px;font-size:17px;line-height:1.55;color:${BRAND.text};">
        Just popping in to say hello — it's been ${timeLabel} since we last cleaned for you, and we wanted to check in. Life gets busy, dust definitely doesn't take a break, and a fresh space genuinely feels great.
      </p>
      <p style="margin:0 0 20px;font-size:17px;line-height:1.55;color:${BRAND.text};">
        If you're ready for another visit, we'd love to come back. Here's a small thank-you for being a returning customer:
      </p>
    </div>

    <div style="padding:8px 32px 20px;text-align:center;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border:2px solid ${BRAND.primary};border-radius:14px;">
        <tr>
          <td style="padding:28px 24px;text-align:center;">
            <div style="font-size:13px;font-weight:900;letter-spacing:0.12em;text-transform:uppercase;color:${BRAND.primary};margin-bottom:10px;">
              ✨ Welcome-back offer
            </div>
            <h2 style="margin:0 0 14px;font-size:42px;font-weight:900;color:${BRAND.text};line-height:1.05;letter-spacing:-1px;">
              ${REACTIVATE_PCT}% off
            </h2>
            <p style="margin:0 0 16px;font-size:15px;color:${BRAND.textMuted};">your next cleaning</p>
            <div style="display:inline-block;background:${BRAND.accent};color:${BRAND.primary};font-family:monospace;font-size:24px;font-weight:900;letter-spacing:0.18em;padding:14px 28px;border-radius:8px;border:2px dashed ${BRAND.primary};">${REACTIVATE_CODE}</div>
            <p style="margin:14px 0 0;font-size:12px;color:${BRAND.textMuted};">Use this code at checkout · No expiration</p>
          </td>
        </tr>
      </table>
    </div>

    <div style="padding:8px 32px 24px;text-align:center;">
      ${cta("Book my next clean →", "https://www.northcolumbuscleaning.com/book-now")}
    </div>

    <div style="padding:8px 32px 24px;">
      <h2 style="margin:0 0 14px;font-size:18px;font-weight:900;color:${BRAND.text};">Thinking about recurring service?</h2>
      <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:${BRAND.text};">
        Most of our customers find that <strong>biweekly or monthly cleanings</strong> are actually less expensive long-term than one-offs (you save on the deeper resets between visits), and you'll never have to think about it again.
      </p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.bg};border-radius:8px;">
        <tr>
          <td style="padding:14px 18px;font-size:14px;color:${BRAND.textMuted};text-align:center;">
            <strong style="color:${BRAND.primary};">Weekly</strong> 20% off · <strong style="color:${BRAND.primary};">Biweekly</strong> 15% off · <strong style="color:${BRAND.primary};">Monthly</strong> first clean discount
          </td>
        </tr>
      </table>
      <p style="margin:14px 0 0;font-size:13px;line-height:1.55;color:${BRAND.textMuted};text-align:center;">
        Stack the recurring discount with <strong>${REACTIVATE_CODE}</strong> for your first one back.
      </p>
    </div>

    <div style="padding:8px 32px 24px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.bg};border-left:4px solid ${BRAND.primary};border-radius:6px;">
        <tr>
          <td style="padding:18px 22px;">
            <p style="margin:0 0 6px;font-size:14px;font-weight:900;text-transform:uppercase;letter-spacing:0.08em;color:${BRAND.primary};">A friendly note</p>
            <p style="margin:0;font-size:15px;line-height:1.55;color:${BRAND.text};">
              No pressure either way${lastService ? ` — we just remember how good your ${lastService.toLowerCase()} turned out and wanted to say hi.` : "."} Either way, we're grateful you tried us before, and we'd be happy to have you back anytime.
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
      preheader: `It's been ${timeLabel}. Use ${REACTIVATE_CODE} for ${REACTIVATE_PCT}% off your next cleaning.`,
      eyebrow: "We miss you",
      headline: "It's been a while 👋",
      body,
    }),
  };
}
