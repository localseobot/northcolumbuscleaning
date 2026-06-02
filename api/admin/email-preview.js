// Preview transactional email templates without sending.
//
//   GET /api/admin/email-preview?template=booking-confirmation&token=...
//     → renders the HTML directly in the browser so you can review styling
//
//   GET /api/admin/email-preview?template=booking-confirmation&token=...&send=you@example.com
//     → sends a real email to that address (uses Resend; respects env vars)
//
// Token-gated via ADMIN_TOKEN (same as /api/admin/calls).

import { buildBookingConfirmation } from "../_lib/email-templates/booking-confirmation.js";
import { buildReminder24h } from "../_lib/email-templates/reminder-24h.js";
import { buildReviewRequest } from "../_lib/email-templates/review-request.js";
import { buildRescheduleNotice } from "../_lib/email-templates/reschedule-notice.js";
import { buildCancellationWinback } from "../_lib/email-templates/cancellation-winback.js";
import { buildRetellFollowup } from "../_lib/email-templates/retell-followup.js";
import { sendEmail } from "../_lib/resend.js";

export const config = { runtime: "nodejs" };

// Realistic sample data so you see what a real send will look like.
const SAMPLE = {
  "booking-confirmation": {
    builder: buildBookingConfirmation,
    fixture: {
      firstName: "Sarah",
      appointmentDateTime: "2026-07-15T10:00:00-04:00",
      serviceType: "deep",
      frequency: "biweekly",
      bedrooms: 3,
      bathrooms: 2,
      sqft: 1850,
      priceTotal: 275,
      address: "1234 High St, Columbus, OH 43215",
      bookingId: "28",
    },
  },
  "reminder-24h": {
    builder: buildReminder24h,
    fixture: {
      firstName: "Sarah",
      appointmentDateTime: "2026-07-15T10:00:00-04:00",
      serviceType: "deep",
      address: "1234 High St, Columbus, OH 43215",
      bookingId: "28",
    },
  },
  "review-request": {
    builder: buildReviewRequest,
    fixture: {
      firstName: "Sarah",
      serviceType: "deep",
    },
  },
  "reschedule-notice": {
    builder: buildRescheduleNotice,
    fixture: {
      firstName: "Sarah",
      appointmentDateTime: "2026-07-22T14:00:00-04:00",
      previousDateTime: "2026-07-15T10:00:00-04:00",
      serviceType: "deep",
      address: "1234 High St, Columbus, OH 43215",
      bookingId: "28",
    },
  },
  "cancellation-winback": {
    builder: buildCancellationWinback,
    fixture: { firstName: "Sarah" },
  },
  "retell-followup": {
    builder: buildRetellFollowup,
    fixture: {
      firstName: "Sarah",
      serviceType: "deep",
      frequency: "biweekly",
      bedrooms: 3,
      bathrooms: 2,
      sqft: 1850,
      quotedPrice: 275,
      notes: "Pets at home (dog), gate code 4321",
    },
  },
};

export default async function handler(req, res) {
  const token = req.query?.token || "";
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
    res.statusCode = 401;
    res.setHeader("Content-Type", "text/plain");
    res.end("Unauthorized");
    return;
  }

  const name = (req.query?.template || "booking-confirmation").toString();
  const tpl = SAMPLE[name];
  if (!tpl) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain");
    res.end(`Unknown template "${name}". Known: ${Object.keys(SAMPLE).join(", ")}`);
    return;
  }

  const { subject, html } = tpl.builder(tpl.fixture);

  const sendTo = req.query?.send;
  if (sendTo) {
    const result = await sendEmail({
      to: String(sendTo),
      subject: `[PREVIEW] ${subject}`,
      html,
      tags: ["preview", name],
    });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: !result.error, template: name, sendTo, result }));
    return;
  }

  // Render in browser — wrap with a thin debug header showing the subject
  const wrapper = `<!doctype html><html><head><meta charset="utf-8"><title>${subject}</title>
<style>body{margin:0;font-family:-apple-system,sans-serif;background:#0f172a;color:#f1f5f9;}
.bar{padding:12px 20px;background:#1e293b;border-bottom:1px solid #334155;font-size:14px;}
.bar code{background:#0f172a;padding:2px 6px;border-radius:4px;font-size:13px;}
.frame{padding:20px;}</style></head><body>
<div class="bar">
  <strong>Preview:</strong> <code>${name}</code> ·
  <strong>Subject:</strong> ${subject} ·
  <a href="?template=${name}&token=${token}&send=YOUR_EMAIL_HERE" style="color:#60a5fa;">send test</a>
</div>
<div class="frame">${html}</div>
</body></html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(wrapper);
}
