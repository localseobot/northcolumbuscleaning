// Daily cron — sends the review-gate email + SMS to customers whose
// job completed in the last 24 hours and who haven't received the
// review touch yet. Both messages route through the /review smiley
// landing page so unhappy customers can submit private feedback before
// posting publicly.
//
// Schedule (vercel.json): daily at 17:00 UTC (1pm ET)

import { ghl } from "../_lib/ghl.js";
import { sendEmail } from "../_lib/resend.js";
import { CUSTOMER_LINE } from "../_lib/ghl-sms.js";
import { buildReviewRequest } from "../_lib/email-templates/review-request.js";

export const config = { runtime: "nodejs" };

const SALES_PIPELINE_ID = "6YDehH2kNtHrdfJaEQfa";
const STAGE_WON_ONE_TIME = "9253419b-4c69-4f61-814b-ee27cd165f7a";
const STAGE_RECURRING =
  process.env.STAGE_RECURRING_ID || "24ef9398-abc2-472d-9f35-59b1d8a8f4f6";

// Look back 28 hours to ensure we catch everything since the previous
// daily run (with 4h slack so customers who just finished get time to
// look around before we ask for feedback). Skip anyone older than 48h
// to avoid pinging stale data.
const LOOK_BACK_HOURS = 336; // temporarily widened to 14 days to catch backlog
const MIN_AGE_HOURS = 4;
const SENT_TAG = "review-request-sent";

function isAuthorized(req) {
  if (!process.env.CRON_SECRET) return true;
  return req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
}
function lower(v) {
  return String(v || "").toLowerCase();
}

function buildReviewSms({ firstName, email }) {
  const params = new URLSearchParams();
  if (firstName) params.set("n", firstName);
  if (email) params.set("e", email);
  const url = `https://www.northcolumbuscleaning.com/review${
    params.toString() ? "?" + params.toString() : ""
  }`;
  const name = firstName || "there";
  return (
    `Hi ${name}, North Columbus Cleaning here! Hope your home looks amazing. ` +
    `Got 30 seconds to share how we did? ${url}`
  );
}

export default async function handler(req, res) {
  if (!isAuthorized(req)) return res.status(401).json({ error: "Unauthorized" });

  const result = {
    ok: true,
    ranAt: new Date().toISOString(),
    candidates: 0,
    sent: 0,
    skipped: [],
    errors: [],
  };

  const now = Date.now();
  const sinceMs = now - LOOK_BACK_HOURS * 3600 * 1000;
  const untilMs = now - MIN_AGE_HOURS * 3600 * 1000;

  try {
    const search = await ghl({
      method: "POST",
      path: "/opportunities/search",
      body: {
        locationId: process.env.GHL_LOCATION_ID,
        pipelineId: SALES_PIPELINE_ID,
        status: "won",
        limit: 100,
      },
    }).catch(() => ({ opportunities: [] }));

    const opps = (search?.opportunities || []).filter((o) => {
      const stage = o.pipelineStageId;
      if (stage !== STAGE_WON_ONE_TIME && stage !== STAGE_RECURRING) return false;
      return true; // TEMP: skip time filter to catch backlog — restore after backfill
    });

    result.candidates = opps.length;

    const seen = new Set();
    for (const opp of opps) {
      const contactId = opp.contactId;
      if (!contactId || seen.has(contactId)) continue;
      seen.add(contactId);
      try {
        const c = await ghl({ method: "GET", path: `/contacts/${contactId}` });
        const contact = c?.contact;
        if (!contact) {
          result.skipped.push({ contactId, reason: "contact not found" });
          continue;
        }
        const tags = (contact.tags || []).map(lower);
        if (tags.includes(SENT_TAG)) {
          result.skipped.push({ contactId, reason: "already sent" });
          continue;
        }
        if (tags.includes("do-not-contact") || tags.includes("dnd")) {
          result.skipped.push({ contactId, reason: "do-not-contact" });
          continue;
        }

        const firstName = contact.firstNameRaw || contact.firstName || "";
        const email = lower(contact.email);
        const phone = contact.phone;

        // Service hint from tags for the email subject/body
        const serviceTag = tags.find((t) => t.startsWith("service:"));
        const serviceType = serviceTag ? serviceTag.replace("service:", "") : null;

        let emailOk = false;
        if (email) {
          const { subject, html } = buildReviewRequest({
            firstName,
            serviceType,
            email,
          });
          const emailRes = await sendEmail({
            to: email,
            subject,
            html,
            tags: ["review-request"],
          });
          emailOk = !!emailRes.id;
        }

        let smsOk = false;
        if (phone) {
          const smsResp = await ghl({
            method: "POST",
            path: "/conversations/messages",
            body: {
              type: "SMS",
              contactId,
              message: buildReviewSms({ firstName, email }),
              fromNumber: CUSTOMER_LINE,
            },
          }).catch(() => null);
          smsOk = !!smsResp;
        }

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
        result.errors.push({ contactId, error: e.message });
      }
    }
  } catch (e) {
    result.ok = false;
    result.error = e.message;
  }

  return res.status(200).json(result);
}
