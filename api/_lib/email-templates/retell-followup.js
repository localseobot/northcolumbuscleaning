// Retell call follow-up — sent after Taylor (the voice agent) takes a call
// that ends with quote intent. Captures the 70% of callers who hang up
// "thinking about it" by giving them a clear quote + 1-click book link.

import {
  BRAND,
  wrapEmail,
  fmtServiceName,
  fmtFrequencyName,
  cta,
} from "./_layout.js";

/**
 * @param {object} input
 * @param {string} input.firstName
 * @param {string} [input.serviceType]
 * @param {string} [input.frequency]
 * @param {number} [input.bedrooms]
 * @param {number} [input.bathrooms]
 * @param {number} [input.sqft]
 * @param {number} [input.quotedPrice]      Estimated price per visit
 * @param {string} [input.notes]            Special notes captured by Taylor
 */
export function buildRetellFollowup({
  firstName,
  serviceType,
  frequency,
  bedrooms,
  bathrooms,
  sqft,
  quotedPrice,
  notes,
}) {
  const name = firstName || "there";
  const serviceName = fmtServiceName(serviceType);
  const freqName = fmtFrequencyName(frequency);
  const priceLine =
    quotedPrice && quotedPrice > 0
      ? `$${Number(quotedPrice).toFixed(2)}`
      : null;
  const subject = priceLine
    ? `Your cleaning quote: ${priceLine}/visit — North Columbus Cleaning`
    : "Following up on our call — North Columbus Cleaning";

  const body = `
    <div style="padding:32px 32px 8px;">
      <p style="margin:0 0 14px;font-size:17px;line-height:1.55;color:${BRAND.text};">Hi ${name},</p>
      <p style="margin:0 0 16px;font-size:17px;line-height:1.55;color:${BRAND.text};">
        Thanks for calling us today! Here's a recap of what we discussed, so you have everything in one place:
      </p>
    </div>

    <div style="padding:0 32px 8px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.bg};border:1px solid ${BRAND.border};border-radius:12px;">
        <tr>
          <td style="padding:18px 24px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="padding:8px 0;font-size:14px;color:${BRAND.textMuted};width:40%;">Service</td>
                <td style="padding:8px 0;font-size:15px;font-weight:600;color:${BRAND.text};">${serviceName}</td>
              </tr>
              ${
                freqName
                  ? `<tr>
                <td style="padding:8px 0;font-size:14px;color:${BRAND.textMuted};">Frequency</td>
                <td style="padding:8px 0;font-size:15px;color:${BRAND.text};">${freqName}</td>
              </tr>`
                  : ""
              }
              ${
                bedrooms
                  ? `<tr>
                <td style="padding:8px 0;font-size:14px;color:${BRAND.textMuted};">Bedrooms</td>
                <td style="padding:8px 0;font-size:15px;color:${BRAND.text};">${bedrooms}</td>
              </tr>`
                  : ""
              }
              ${
                bathrooms
                  ? `<tr>
                <td style="padding:8px 0;font-size:14px;color:${BRAND.textMuted};">Bathrooms</td>
                <td style="padding:8px 0;font-size:15px;color:${BRAND.text};">${bathrooms}</td>
              </tr>`
                  : ""
              }
              ${
                sqft
                  ? `<tr>
                <td style="padding:8px 0;font-size:14px;color:${BRAND.textMuted};">Size</td>
                <td style="padding:8px 0;font-size:15px;color:${BRAND.text};">${sqft.toLocaleString()} sq ft</td>
              </tr>`
                  : ""
              }
            </table>
            ${
              notes
                ? `<div style="margin-top:14px;padding-top:12px;border-top:1px solid ${BRAND.border};">
              <div style="font-size:13px;font-weight:700;color:${BRAND.textMuted};margin-bottom:6px;">Your notes</div>
              <div style="font-size:15px;line-height:1.5;color:${BRAND.text};">${notes}</div>
            </div>`
                : ""
            }
          </td>
        </tr>
        ${
          priceLine
            ? `<tr>
          <td style="padding:14px 24px 18px;border-top:2px solid ${BRAND.primary};background:#ffffff;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="font-size:14px;font-weight:900;letter-spacing:0.05em;text-transform:uppercase;color:${BRAND.textMuted};">Estimated price</td>
                <td style="text-align:right;font-size:24px;font-weight:900;color:${BRAND.text};">${priceLine}<span style="font-size:14px;font-weight:400;color:${BRAND.textMuted};">/visit</span></td>
              </tr>
            </table>
          </td>
        </tr>`
            : ""
        }
      </table>
    </div>

    <div style="padding:24px 32px 8px;text-align:center;">
      <h2 style="margin:0 0 14px;font-size:22px;font-weight:900;color:${BRAND.text};line-height:1.3;">Ready to book?</h2>
      <p style="margin:0 0 18px;font-size:15px;line-height:1.55;color:${BRAND.textMuted};">
        Lock in your spot in under a minute. No payment required to schedule.
      </p>
      ${cta("Book my cleaning →", "https://www.northcolumbuscleaning.com/book-now")}
    </div>

    <div style="padding:24px 32px 8px;">
      <p style="margin:0 0 10px;font-size:14px;line-height:1.55;color:${BRAND.text};font-weight:700;">
        Why North Columbus Cleaning?
      </p>
      <ul style="margin:0;padding:0 0 0 18px;font-size:14px;line-height:1.65;color:${BRAND.text};">
        <li>Insured, bonded, background-checked teams</li>
        <li>100% satisfaction guarantee — we re-clean free if anything's off</li>
        <li>Locally owned and operated in North Columbus</li>
        <li>Transparent pricing — no surprise fees</li>
      </ul>
    </div>

    <div style="padding:16px 32px 8px;">
      <p style="margin:0;font-size:15px;line-height:1.55;color:${BRAND.text};">
        Questions before you book? Just reply to this email or call <a href="tel:${BRAND.phoneHref}" style="color:${BRAND.primary};font-weight:700;">${BRAND.phone}</a>.
      </p>
    </div>
  `;

  return {
    subject,
    html: wrapEmail({
      subject,
      preheader: priceLine
        ? `Estimated ${priceLine}/visit for your ${serviceName.toLowerCase()}. Book in 1 minute.`
        : `Here's a recap of what we discussed. Book in 1 minute.`,
      eyebrow: "Following Up",
      headline: priceLine
        ? `Your quote: ${priceLine}/visit`
        : "Thanks for calling!",
      body,
    }),
  };
}
