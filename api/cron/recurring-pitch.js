// Daily cron — finds one-time customers whose job completed 3-5 days ago
// and pitches them recurring service via branded email + SMS.
//
// Schedule (set in vercel.json):  daily at 14:00 UTC (10am ET)
//
// Auth: optional. Set CRON_SECRET env var on Vercel; cron's auto-included
// Authorization: Bearer header gets validated. Without the env var, the
// endpoint runs anyone-can-trigger (fine for an internal-only path).

import { ghl } from "../_lib/ghl.js";
import { sendEmail } from "../_lib/resend.js";
import { sendGhlSms, CUSTOMER_LINE } from "../_lib/ghl-sms.js";
import {
  buildRecurringPitch,
  buildRecurringPitchSms,
} from "../_lib/email-templates/recurring-pitch.js";

export const config = { runtime: "nodejs" };

const SALES_PIPELINE_ID = "6YDehH2kNtHrdfJaEQfa";
// Targeting window — completions between 3 and 5 days ago.
const WINDOW_MIN_DAYS = 3;
const WINDOW_MAX_DAYS = 5;

const SENT_TAG = "recurring-pitch-sent";

function isAuthorized(req) {
  if (!process.env.CRON_SECRET) return true;
  const auth = req.headers.authorization || "";
  return auth === `Bearer ${process.env.CRON_SECRET}`;
}

function daysAgoISO(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

function lower(v) {
  return String(v || "").toLowerCase();
}

export default async function handler(req, res) {
  if (!isAuthorized(req)) return res.status(401).json({ error: "Unauthorized" });

  const result = {
    ok: true,
    ranAt: new Date().toISOString(),
    window: `${WINDOW_MIN_DAYS}-${WINDOW_MAX_DAYS} days ago`,
    candidates: 0,
    sent: 0,
    skipped: [],
    errors: [],
  };

  try {
    // Find recently completed Won opportunities (One-Time stage) within the
    // window. monetaryValue change date approximates completion time.
    const since = daysAgoISO(WINDOW_MAX_DAYS);
    const until = daysAgoISO(WINDOW_MIN_DAYS);

    const search = await ghl({
      method: "POST",
      path: "/opportunities/search",
      body: {
        locationId: process.env.GHL_LOCATION_ID,
        pipelineId: SALES_PIPELINE_ID,
        pipelineStageId: "9253419b-4c69-4f61-814b-ee27cd165f7a",
        status: "won",
        limit: 100,
      },
    }).catch(() => ({ opportunities: [] }));

    const opps = (search?.opportunities || []).filter((o) => {
      const t = new Date(o.lastStatusChangeAt || o.updatedAt || 0).getTime();
      return t >= new Date(since).getTime() && t <= new Date(until).getTime();
    });

    result.candidates = opps.length;

    for (const opp of opps) {
      try {
        // Get the contact to check tags + email/phone
        const contactId = opp.contactId;
        if (!contactId) {
          result.skipped.push({ oppId: opp.id, reason: "no contactId" });
          continue;
        }
        const c = await ghl({
          method: "GET",
          path: `/contacts/${contactId}`,
        });
        const contact = c?.contact;
        if (!contact) {
          result.skipped.push({ contactId, reason: "contact not found" });
          continue;
        }

        const tags = (contact.tags || []).map(lower);
        if (tags.includes(SENT_TAG)) {
          result.skipped.push({ contactId, reason: "already pitched" });
          continue;
        }
        if (tags.includes("do-not-contact") || tags.includes("dnd")) {
          result.skipped.push({ contactId, reason: "do-not-contact" });
          continue;
        }
        // Confirm it was actually one-time (not recurring already)
        const isOneTime =
          tags.includes("frequency:one-time") ||
          (!tags.some((t) => /^frequency:(weekly|biweekly|every-3-weeks|monthly)$/.test(t)));
        if (!isOneTime) {
          result.skipped.push({ contactId, reason: "already recurring" });
          continue;
        }

        const firstName = contact.firstNameRaw || contact.firstName || "";
        const email = lower(contact.email);
        const phone = contact.phone;

        // Send email
        let emailOk = false;
        if (email) {
          const { subject, html } = buildRecurringPitch({ firstName });
          const emailRes = await sendEmail({
            to: email,
            subject,
            html,
            tags: ["recurring-pitch"],
          });
          emailOk = !!emailRes.id;
        }

        // Send SMS via customer line
        let smsOk = false;
        if (phone) {
          const smsResp = await ghl({
            method: "POST",
            path: "/conversations/messages",
            body: {
              type: "SMS",
              contactId,
              message: buildRecurringPitchSms({ firstName }),
              fromNumber: CUSTOMER_LINE,
            },
          }).catch(() => null);
          smsOk = !!smsResp;
        }

        // Tag so we never double-pitch
        await ghl({
          method: "POST",
          path: `/contacts/${contactId}/tags`,
          body: { tags: [SENT_TAG] },
        }).catch(() => null);

        result.sent++;
        result.skipped.push({
          contactId,
          firstName,
          emailSent: emailOk,
          smsSent: smsOk,
          status: "sent",
        });
      } catch (e) {
        result.errors.push({ oppId: opp.id, error: e.message });
      }
    }
  } catch (e) {
    result.ok = false;
    result.error = e.message;
  }

  return res.status(200).json(result);
}
