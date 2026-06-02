// 24-hour reminder — sent the day before a booking. Reduces no-shows
// and gives the customer a chance to reschedule if needed.

import {
  BRAND,
  wrapEmail,
  fmtDateTime,
  fmtServiceName,
  cta,
} from "./_layout.js";

/**
 * @param {object} input
 * @param {string} input.firstName
 * @param {string} input.appointmentDateTime  ISO
 * @param {string} [input.serviceType]
 * @param {string} [input.address]
 * @param {string} [input.bookingId]
 */
export function buildReminder24h({
  firstName,
  appointmentDateTime,
  serviceType,
  address,
  bookingId,
}) {
  const name = firstName || "there";
  const when = fmtDateTime(appointmentDateTime);
  const dayOnly = when ? when.split(" at ")[0] : "tomorrow";
  const serviceName = fmtServiceName(serviceType);

  const subject = `Friendly reminder — we'll see you ${dayOnly.toLowerCase()}!`;

  const body = `
    <div style="padding:32px 32px 16px;">
      <p style="margin:0 0 14px;font-size:17px;line-height:1.55;color:${BRAND.text};">Hi ${name},</p>
      <p style="margin:0 0 18px;font-size:17px;line-height:1.55;color:${BRAND.text};">
        Just a quick heads-up — your ${serviceName.toLowerCase()} is scheduled <strong>${when || "tomorrow"}</strong>. We're excited to see you!
      </p>
    </div>

    <div style="padding:0 32px 8px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.bg};border:1px solid ${BRAND.border};border-radius:12px;">
        <tr>
          <td style="padding:18px 24px;">
            ${
              bookingId
                ? `<div style="margin-bottom:10px;">
              <span style="font-size:13px;color:${BRAND.textMuted};">Booking</span>
              <span style="font-size:15px;font-weight:600;color:${BRAND.text};margin-left:8px;">#${bookingId}</span>
            </div>`
                : ""
            }
            ${
              when
                ? `<div style="margin-bottom:10px;">
              <span style="font-size:13px;color:${BRAND.textMuted};">When</span>
              <span style="font-size:15px;font-weight:600;color:${BRAND.text};margin-left:8px;">${when}</span>
            </div>`
                : ""
            }
            ${
              address
                ? `<div>
              <span style="font-size:13px;color:${BRAND.textMuted};">Where</span>
              <span style="font-size:15px;color:${BRAND.text};margin-left:8px;">${address}</span>
            </div>`
                : ""
            }
          </td>
        </tr>
      </table>
    </div>

    <div style="padding:24px 32px 8px;">
      <h2 style="margin:0 0 12px;font-size:18px;font-weight:900;color:${BRAND.text};">Quick prep checklist (optional)</h2>
      <ul style="margin:0;padding:0 0 0 20px;font-size:16px;line-height:1.65;color:${BRAND.text};">
        <li style="margin-bottom:6px;">Clear off counters and floor surfaces if you can — we'll get to everywhere we can reach.</li>
        <li style="margin-bottom:6px;">Let us know about any pets, gate codes, or special access via the portal.</li>
        <li style="margin-bottom:6px;">Have valuables put away just to be safe.</li>
        <li>You don't need to be home — we'll text you when we arrive and when we're done.</li>
      </ul>
    </div>

    <div style="padding:24px 32px 8px;text-align:center;">
      ${cta("Manage my booking →", BRAND.portalUrl)}
      <p style="margin:14px 0 0;font-size:13px;color:${BRAND.textMuted};">
        Need to reschedule? Just <a href="${BRAND.portalUrl}" style="color:${BRAND.primary};">update it in your portal</a> or reply to this email.
      </p>
    </div>
  `;

  return {
    subject,
    html: wrapEmail({
      subject,
      preheader: `Your ${serviceName.toLowerCase()} is tomorrow${when ? ` (${when})` : ""}.`,
      eyebrow: "Reminder",
      headline: `See you ${dayOnly.toLowerCase()}!`,
      body,
    }),
  };
}
