// Booking confirmation email — sent on BK booking.created.
//
// Tone goal: warm and professional, like a thank-you note from a real
// person. NOT a system notification. No platform branding, no "do not reply
// to this email" disclaimers, no big legal footer that makes it feel
// corporate.

const BRAND = {
  name: "North Columbus Cleaning",
  shortName: "NCC",
  primary: "#1a4d2e", // forest green (site brand)
  primaryDark: "#0d3320",
  accent: "#c9e265", // lime accent
  bg: "#faf9f5",
  text: "#0f172a",
  textMuted: "#475569",
  border: "#e2e8f0",
  phone: "(614) 352-2588",
  phoneHref: "+16143522588",
  website: "https://www.northcolumbuscleaning.com",
  portalUrl: "https://www.northcolumbuscleaning.com/login",
  email: "admin@northcolumbuscleaning.com",
  address: "Columbus, OH",
};

function fmtDateTime(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const dateOpts = { weekday: "long", month: "long", day: "numeric" };
    const timeOpts = { hour: "numeric", minute: "2-digit" };
    const datePart = d.toLocaleDateString("en-US", dateOpts);
    const timePart = d.toLocaleTimeString("en-US", timeOpts);
    return `${datePart} at ${timePart}`;
  } catch {
    return iso;
  }
}

function fmtServiceLine({ serviceType, frequency, bedrooms, bathrooms, sqft }) {
  const parts = [];
  if (serviceType) {
    const s = String(serviceType).toLowerCase();
    if (s.includes("deep")) parts.push("Deep cleaning");
    else if (s.includes("move")) parts.push("Move-in/out cleaning");
    else if (s.includes("office") || s.includes("commercial"))
      parts.push("Office cleaning");
    else parts.push("Standard cleaning");
  } else {
    parts.push("Cleaning service");
  }
  if (frequency) {
    const f = String(frequency).toLowerCase();
    if (f.includes("week") && !f.includes("bi")) parts.push("(weekly)");
    else if (f.includes("bi")) parts.push("(biweekly)");
    else if (f.includes("month")) parts.push("(monthly)");
    else if (f.includes("3")) parts.push("(every 3 weeks)");
  }
  const propParts = [];
  if (bedrooms) propParts.push(`${bedrooms} bd`);
  if (bathrooms) propParts.push(`${bathrooms} ba`);
  if (sqft) propParts.push(`${sqft} sqft`);
  if (propParts.length) parts.push(`— ${propParts.join(", ")}`);
  return parts.join(" ");
}

function fmtServiceName(serviceType) {
  if (!serviceType) return "Cleaning";
  const s = String(serviceType).toLowerCase();
  if (s.includes("deep")) return "Deep Cleaning";
  if (s.includes("move")) return "Move In/Out Cleaning";
  if (s.includes("office") || s.includes("commercial")) return "Office Cleaning";
  if (s.includes("recur")) return "Recurring Cleaning";
  return "Standard Cleaning";
}

function fmtFrequencyName(frequency) {
  if (!frequency) return null;
  const f = String(frequency).toLowerCase();
  if (f.includes("week") && !f.includes("bi")) return "Weekly";
  if (f.includes("bi")) return "Bi-Weekly";
  if (f.includes("month")) return "Monthly";
  if (f.includes("3")) return "Every 3 Weeks";
  if (f.includes("one") || f === "once") return "One-Time";
  return frequency;
}

/**
 * Build the booking confirmation email.
 *
 * @param {object} input
 * @param {string} input.firstName
 * @param {string} input.appointmentDateTime  ISO or BK format
 * @param {string} [input.serviceType]
 * @param {string} [input.frequency]
 * @param {number} [input.bedrooms]
 * @param {number} [input.bathrooms]
 * @param {number} [input.sqft]
 * @param {number} [input.priceTotal]
 * @param {string} [input.address]
 * @param {string} [input.bookingId]
 * @returns {{ subject: string, html: string }}
 */
export function buildBookingConfirmation({
  firstName,
  appointmentDateTime,
  serviceType,
  frequency,
  bedrooms,
  bathrooms,
  sqft,
  priceTotal,
  address,
  bookingId,
}) {
  const name = firstName || "there";
  const when = fmtDateTime(appointmentDateTime);
  const serviceName = fmtServiceName(serviceType);
  const freqName = fmtFrequencyName(frequency);
  const priceLine =
    priceTotal && priceTotal > 0 ? `$${Number(priceTotal).toFixed(2)}` : null;

  const subject = when
    ? `Your cleaning is confirmed for ${when.split(" at ")[0]} — North Columbus Cleaning`
    : "Your cleaning is confirmed — North Columbus Cleaning";

  // Email-safe HTML. Inline styles, table-based layout, max 600px wide,
  // no external CSS, no JS. Tested against Gmail / Apple Mail / Outlook.
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${BRAND.text};">
  <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
    ${firstName ? `Hi ${firstName}, ` : ""}your cleaning${when ? ` on ${when}` : ""} is confirmed. We can't wait to make your space shine.
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.bg};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid ${BRAND.border};border-radius:12px;overflow:hidden;">
          <!-- Header -->
          <tr>
            <td style="background:${BRAND.primary};padding:32px 32px 28px;text-align:center;">
              <div style="color:${BRAND.accent};font-size:13px;font-weight:900;letter-spacing:0.15em;text-transform:uppercase;">
                North Columbus Cleaning
              </div>
              <h1 style="margin:12px 0 0;color:#ffffff;font-size:30px;font-weight:900;line-height:1.2;letter-spacing:-0.5px;">
                You're booked!
              </h1>
            </td>
          </tr>

          <!-- Greeting -->
          <tr>
            <td style="padding:32px 32px 8px;">
              <p style="margin:0 0 16px;font-size:17px;line-height:1.55;color:${BRAND.text};">
                Hi ${name},
              </p>
              <p style="margin:0 0 16px;font-size:17px;line-height:1.55;color:${BRAND.text};">
                Thank you so much for booking with us! We're excited to make your space sparkle. Here's your invoice and appointment details:
              </p>
            </td>
          </tr>

          <!-- Invoice / booking summary card -->
          <tr>
            <td style="padding:0 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.bg};border:1px solid ${BRAND.border};border-radius:12px;overflow:hidden;">
                <tr>
                  <td style="padding:18px 24px;border-bottom:1px solid ${BRAND.border};background:#ffffff;">
                    <div style="font-size:13px;font-weight:900;letter-spacing:0.1em;text-transform:uppercase;color:${BRAND.primary};">
                      Booking Summary
                    </div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:8px 24px 4px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      ${
                        bookingId
                          ? `<tr>
                        <td style="padding:10px 0;font-size:14px;color:${BRAND.textMuted};width:40%;">Booking ID</td>
                        <td style="padding:10px 0;font-size:15px;font-weight:600;color:${BRAND.text};">#${bookingId}</td>
                      </tr>`
                          : ""
                      }
                      ${
                        when
                          ? `<tr>
                        <td style="padding:10px 0;font-size:14px;color:${BRAND.textMuted};">Date &amp; time</td>
                        <td style="padding:10px 0;font-size:15px;font-weight:600;color:${BRAND.text};">${when}</td>
                      </tr>`
                          : ""
                      }
                      ${
                        address
                          ? `<tr>
                        <td style="padding:10px 0;font-size:14px;color:${BRAND.textMuted};vertical-align:top;">Location</td>
                        <td style="padding:10px 0;font-size:15px;color:${BRAND.text};">${address}</td>
                      </tr>`
                          : ""
                      }
                      <tr>
                        <td style="padding:10px 0;font-size:14px;color:${BRAND.textMuted};">Service</td>
                        <td style="padding:10px 0;font-size:15px;color:${BRAND.text};">${serviceName}</td>
                      </tr>
                      ${
                        freqName
                          ? `<tr>
                        <td style="padding:10px 0;font-size:14px;color:${BRAND.textMuted};">Frequency</td>
                        <td style="padding:10px 0;font-size:15px;color:${BRAND.text};">${freqName}</td>
                      </tr>`
                          : ""
                      }
                      ${
                        bedrooms
                          ? `<tr>
                        <td style="padding:10px 0;font-size:14px;color:${BRAND.textMuted};">Bedrooms</td>
                        <td style="padding:10px 0;font-size:15px;color:${BRAND.text};">${bedrooms}</td>
                      </tr>`
                          : ""
                      }
                      ${
                        bathrooms
                          ? `<tr>
                        <td style="padding:10px 0;font-size:14px;color:${BRAND.textMuted};">Bathrooms</td>
                        <td style="padding:10px 0;font-size:15px;color:${BRAND.text};">${bathrooms}</td>
                      </tr>`
                          : ""
                      }
                      ${
                        sqft
                          ? `<tr>
                        <td style="padding:10px 0;font-size:14px;color:${BRAND.textMuted};">Square footage</td>
                        <td style="padding:10px 0;font-size:15px;color:${BRAND.text};">${sqft.toLocaleString()} sq ft</td>
                      </tr>`
                          : ""
                      }
                    </table>
                  </td>
                </tr>
                ${
                  priceLine
                    ? `<tr>
                  <td style="padding:12px 24px 18px;border-top:2px solid ${BRAND.primary};background:#ffffff;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="font-size:14px;font-weight:900;letter-spacing:0.05em;text-transform:uppercase;color:${BRAND.textMuted};">Total</td>
                        <td style="text-align:right;font-size:22px;font-weight:900;color:${BRAND.text};">${priceLine}</td>
                      </tr>
                    </table>
                  </td>
                </tr>`
                    : ""
                }
              </table>
            </td>
          </tr>

          <!-- Account / portal setup -->
          <tr>
            <td style="padding:28px 32px 4px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fffbeb;border:1px solid #fbbf24;border-radius:12px;">
                <tr>
                  <td style="padding:20px 24px;">
                    <div style="font-size:13px;font-weight:900;letter-spacing:0.1em;text-transform:uppercase;color:#92400e;margin-bottom:6px;">
                      📬 One more email coming
                    </div>
                    <p style="margin:0 0 6px;font-size:16px;font-weight:600;color:${BRAND.text};">
                      Look for an email titled <em>"Set Up Your New Password"</em>
                    </p>
                    <p style="margin:0;font-size:14px;line-height:1.55;color:${BRAND.text};">
                      That email contains a one-click link to create your customer portal login. Once you set your password, you can manage your booking, reschedule, or update details anytime.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Customer portal CTA -->
          <tr>
            <td style="padding:20px 32px 4px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border:2px solid ${BRAND.primary};border-radius:12px;">
                <tr>
                  <td style="padding:24px 24px 20px;text-align:center;">
                    <div style="font-size:13px;font-weight:900;letter-spacing:0.12em;text-transform:uppercase;color:${BRAND.primary};margin-bottom:8px;">
                      ⚡ Already have an account?
                    </div>
                    <h3 style="margin:0 0 14px;font-size:18px;font-weight:900;color:${BRAND.text};line-height:1.3;">
                      Open your customer portal
                    </h3>
                    <a href="${BRAND.portalUrl}" style="display:inline-block;background:${BRAND.primary};color:${BRAND.accent};font-weight:900;font-size:15px;letter-spacing:0.1em;text-transform:uppercase;text-decoration:none;padding:14px 28px;border-radius:8px;">
                      Open my portal →
                    </a>
                    <p style="margin:14px 0 0;font-size:12px;color:${BRAND.textMuted};">
                      <a href="${BRAND.portalUrl}" style="color:${BRAND.primary};text-decoration:underline;">northcolumbuscleaning.com/login</a>
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- What to expect -->
          <tr>
            <td style="padding:28px 32px 8px;">
              <h2 style="margin:0 0 12px;font-size:18px;font-weight:700;color:${BRAND.text};">A few quick notes before we arrive</h2>
              <ul style="margin:0;padding:0 0 0 20px;font-size:16px;line-height:1.6;color:${BRAND.text};">
                <li style="margin-bottom:8px;">We bring all our own supplies and equipment — you don't need to do anything to prep.</li>
                <li style="margin-bottom:8px;">If you have pets, no need to crate them — our team is pet-friendly. Just let us know any quirks.</li>
                <li style="margin-bottom:8px;">Need to update access notes, gate codes, or special instructions? Use the portal above or reply to this email.</li>
                <li>Our cleaners are background-checked, insured, and trained to our checklist.</li>
              </ul>
            </td>
          </tr>

          <!-- Guarantee -->
          <tr>
            <td style="padding:24px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;">
                <tr>
                  <td style="padding:16px 20px;">
                    <div style="font-size:14px;font-weight:700;color:#047857;">✓ 100% satisfaction guarantee</div>
                    <div style="margin-top:4px;font-size:14px;line-height:1.5;color:#065f46;">If anything's not right, tell us within 24 hours and we'll come back and re-clean — free.</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Contact / CTA -->
          <tr>
            <td style="padding:8px 32px 32px;">
              <p style="margin:0 0 16px;font-size:16px;line-height:1.55;color:${BRAND.text};">
                Need to reschedule, ask a question, or share special instructions?
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

          <!-- Footer -->
          <tr>
            <td style="padding:24px 32px 28px;border-top:1px solid ${BRAND.border};">
              <p style="margin:0;font-size:14px;line-height:1.5;color:${BRAND.textMuted};text-align:center;">
                See you soon!<br>
                — The ${BRAND.name} team
              </p>
              <p style="margin:16px 0 0;font-size:12px;line-height:1.5;color:${BRAND.textMuted};text-align:center;">
                <a href="${BRAND.website}" style="color:${BRAND.textMuted};text-decoration:underline;">${BRAND.website.replace(/^https?:\/\//, "")}</a>
                &nbsp;·&nbsp;
                ${BRAND.address}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  return { subject, html };
}

/**
 * Build the short SMS confirmation. Aims for 1–2 segments. Always includes
 * STOP opt-out language to satisfy A2P 10DLC compliance.
 *
 * @param {object} input  same shape as buildBookingConfirmation
 * @returns {string}
 */
export function buildBookingConfirmationSms({
  firstName,
  appointmentDateTime,
}) {
  const name = firstName || "there";
  const when = fmtDateTime(appointmentDateTime);
  const whenStr = when ? ` for ${when}` : "";
  // GHL automatically appends "Reply STOP to unsubscribe." to every outbound
  // SMS for A2P 10DLC compliance, so we don't add our own opt-out language.
  return (
    `Hi ${name}, North Columbus Cleaning here — your cleaning is confirmed${whenStr}. ` +
    `Manage your booking at northcolumbuscleaning.com/login.`
  );
}
