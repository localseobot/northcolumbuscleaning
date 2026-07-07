// Daily cron — sends the cancellation-winback email (COMEBACK15) to
// customers whose booking moved to Lost stage 3-5 days ago.
//
// Schedule (vercel.json): daily at 18:00 UTC (2pm ET)

import { ghl } from "../_lib/ghl.js";
import { sendEmail } from "../_lib/resend.js";
import { buildCancellationWinback } from "../_lib/email-templates/cancellation-winback.js";

export const config = { runtime: "nodejs" };

const SALES_PIPELINE_ID = "6YDehH2kNtHrdfJaEQfa";
const STAGE_LOST = "7eaafc3f-ab36-4ebe-b2c2-c64ab998897d";
const MIN_DAYS = 3;
const MAX_DAYS = 5;
const SENT_TAG = "winback-sent";

function isAuthorized(req) {
  if (!process.env.CRON_SECRET) return true;
  return req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
}
function lower(v) {
  return String(v || "").toLowerCase();
}
function daysAgoMs(d) {
  return Date.now() - d * 86400000;
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

  const sinceMs = daysAgoMs(MAX_DAYS);
  const untilMs = daysAgoMs(MIN_DAYS);

  try {
    const search = await ghl({
      method: "POST",
      path: "/opportunities/search",
      body: {
        locationId: process.env.GHL_LOCATION_ID,
        pipelineId: SALES_PIPELINE_ID,
        pipelineStageId: STAGE_LOST,
        status: "lost",
        limit: 100,
      },
    }).catch(() => ({ opportunities: [] }));

    const opps = (search?.opportunities || []).filter((o) => {
      const t = new Date(o.lastStatusChangeAt || o.updatedAt || 0).getTime();
      return t >= sinceMs && t <= untilMs;
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
        const email = lower(contact.email);
        if (!email) {
          result.skipped.push({ contactId, reason: "no email" });
          continue;
        }
        const firstName = contact.firstNameRaw || contact.firstName || "";
        const { subject, html } = buildCancellationWinback({ firstName });
        const emailRes = await sendEmail({
          to: email,
          subject,
          html,
          tags: ["cancellation-winback"],
        });
        await ghl({
          method: "POST",
          path: `/contacts/${contactId}/tags`,
          body: { tags: [SENT_TAG] },
        }).catch(() => null);
        if (emailRes.id) {
          result.sent++;
          result.skipped.push({ contactId, firstName, status: "sent" });
        } else {
          result.errors.push({
            contactId,
            error: emailRes.reason || emailRes.error,
          });
        }
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
