// Reschedule confirmation — sent when BK reports a booking has been moved.
// Reassures the customer the change went through and shows the new time.

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
 * @param {string} input.appointmentDateTime     New scheduled datetime
 * @param {string} [input.previousDateTime]      Old datetime (optional)
 * @param {string} [input.serviceType]
 * @param {string} [input.address]
 * @param {string} [input.bookingId]
 */
export function buildRescheduleNotice({
  firstName,
  appointmentDateTime,
  previousDateTime,
  serviceType,
  address,
  bookingId,
}) {
  const name = firstName || "there";
  const newWhen = fmtDateTime(appointmentDateTime);
  const oldWhen = fmtDateTime(previousDateTime);
  const serviceName = fmtServiceName(serviceType);
  const subject = `Your cleaning has been rescheduled — ${newWhen ? newWhen.split(" at ")[0] : ""}`;

  const body = `
    <div style="padding:32px 32px 16px;">
      <p style="margin:0 0 14px;font-size:17px;line-height:1.55;color:${BRAND.text};">Hi ${name},</p>
      <p style="margin:0 0 18px;font-size:17px;line-height:1.55;color:${BRAND.text};">
        Good news — your ${serviceName.toLowerCase()} has been successfully rescheduled. Here are the updated details:
      </p>
    </div>

    <div style="padding:0 32px 8px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.bg};border:1px solid ${BRAND.border};border-radius:12px;">
        <tr>
          <td style="padding:18px 24px;">
            ${
              oldWhen
                ? `<div style="margin-bottom:14px;padding-bottom:12px;border-bottom:1px dashed ${BRAND.border};">
              <div style="font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${BRAND.textMuted};">Previously</div>
              <div style="margin-top:4px;font-size:15px;color:${BRAND.text};text-decoration:line-through;text-decoration-color:#cbd5e1;">${oldWhen}</div>
            </div>`
                : ""
            }
            <div>
              <div style="font-size:12px;font-weight:900;letter-spacing:0.08em;text-transform:uppercase;color:${BRAND.primary};">✓ New Date &amp; Time</div>
              <div style="margin-top:6px;font-size:20px;font-weight:900;color:${BRAND.text};line-height:1.3;">${newWhen || "TBD"}</div>
            </div>
            ${
              address
                ? `<div style="margin-top:14px;padding-top:12px;border-top:1px solid ${BRAND.border};">
              <span style="font-size:13px;color:${BRAND.textMuted};">Location</span>
              <span style="font-size:15px;color:${BRAND.text};margin-left:8px;">${address}</span>
            </div>`
                : ""
            }
            ${
              bookingId
                ? `<div style="margin-top:10px;">
              <span style="font-size:13px;color:${BRAND.textMuted};">Booking</span>
              <span style="font-size:14px;color:${BRAND.text};margin-left:8px;">#${bookingId}</span>
            </div>`
                : ""
            }
          </td>
        </tr>
      </table>
    </div>

    <div style="padding:24px 32px 8px;text-align:center;">
      ${cta("View in portal →", BRAND.portalUrl)}
      <p style="margin:14px 0 0;font-size:13px;color:${BRAND.textMuted};">
        Wrong date? <a href="${BRAND.portalUrl}" style="color:${BRAND.primary};">Update it in your portal</a> or reply to this email.
      </p>
    </div>

    <div style="padding:24px 32px 8px;">
      <p style="margin:0;font-size:15px;line-height:1.55;color:${BRAND.text};">
        Thanks for the flexibility! See you ${newWhen ? "on " + newWhen.split(" at ")[0] : "soon"}.
      </p>
    </div>
  `;

  return {
    subject,
    html: wrapEmail({
      subject,
      preheader: `Your ${serviceName.toLowerCase()}${newWhen ? " is now " + newWhen : " has been rescheduled"}.`,
      eyebrow: "Rescheduled",
      headline: "Date updated ✓",
      body,
    }),
  };
}
