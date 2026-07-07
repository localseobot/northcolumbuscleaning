// Daily cron — finds customers whose last completed service was 30+ days
// ago AND who don't have a future booking in the Booked stage. Sends the
// reactivation email (REFRESH10 — 10% off) so they have a soft reason to
// come back.
//
// Schedule (set in vercel.json): daily at 15:00 UTC (11am ET)

import { ghl } from "../_lib/ghl.js";
import { sendEmail } from "../_lib/resend.js";
import { buildReactivation } from "../_lib/email-templates/reactivation.js";

export const config = { runtime: "nodejs" };

const SALES_PIPELINE_ID = "6YDehH2kNtHrdfJaEQfa";
const STAGE_WON_ONE_TIME = "9253419b-4c69-4f61-814b-ee27cd165f7a";
const STAGE_RECURRING =
  process.env.STAGE_RECURRING_ID || "24ef9398-abc2-472d-9f35-59b1d8a8f4f6";
const STAGE_BOOKED = "a1df2c52-9211-4e13-a920-0c17ab00eff9";

// We pitch at days 30-37 (one week window) so the daily run picks up
// anyone newly hitting the threshold, and the dedup tag prevents repeats.
const MIN_DAYS = 30;
const MAX_DAYS = 37;
const SENT_TAG = "reactivation-sent";

function isAuthorized(req) {
  if (!process.env.CRON_SECRET) return true;
  return req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
}

function daysAgoMs(days) {
  return Date.now() - days * 24 * 60 * 60 * 1000;
}

function lower(v) {
  return String(v || "").toLowerCase();
}

export default async function handler(req, res) {
  if (!isAuthorized(req)) return res.status(401).json({ error: "Unauthorized" });

  const result = {
    ok: true,
    ranAt: new Date().toISOString(),
    window: `${MIN_DAYS}-${MAX_DAYS} days since last service`,
    candidates: 0,
    sent: 0,
    skipped: [],
    errors: [],
  };

  const sinceMs = daysAgoMs(MAX_DAYS);
  const untilMs = daysAgoMs(MIN_DAYS);

  try {
    // Pull all Won opportunities (one-time + recurring), then filter by
    // last status change in the window.
    const search = await ghl({
      method: "POST",
      path: "/opportunities/search",
      body: {
        locationId: process.env.GHL_LOCATION_ID,
        pipelineId: SALES_PIPELINE_ID,
        status: "won",
        limit: 200,
      },
    }).catch(() => ({ opportunities: [] }));

    const opps = (search?.opportunities || []).filter((o) => {
      const stage = o.pipelineStageId;
      // Only one-time/recurring completions, not still-open Booked.
      if (stage !== STAGE_WON_ONE_TIME && stage !== STAGE_RECURRING) return false;
      const t = new Date(o.lastStatusChangeAt || o.updatedAt || 0).getTime();
      return t >= sinceMs && t <= untilMs;
    });

    result.candidates = opps.length;

    // Dedup by contact (a contact may have multiple won opps in the window).
    const byContact = new Map();
    for (const o of opps) {
      if (o.contactId && !byContact.has(o.contactId)) {
        byContact.set(o.contactId, o);
      }
    }

    for (const [contactId, opp] of byContact) {
      try {
        const c = await ghl({ method: "GET", path: `/contacts/${contactId}` });
        const contact = c?.contact;
        if (!contact) {
          result.skipped.push({ contactId, reason: "contact not found" });
          continue;
        }

        const tags = (contact.tags || []).map(lower);
        if (tags.includes(SENT_TAG)) {
          result.skipped.push({ contactId, reason: "already reactivated" });
          continue;
        }
        if (tags.includes("do-not-contact") || tags.includes("dnd")) {
          result.skipped.push({ contactId, reason: "do-not-contact" });
          continue;
        }

        // Skip if they already have a future booking (open opp in Booked)
        const openOpps = await ghl({
          method: "POST",
          path: "/opportunities/search",
          body: {
            locationId: process.env.GHL_LOCATION_ID,
            pipelineId: SALES_PIPELINE_ID,
            pipelineStageId: STAGE_BOOKED,
            contactId,
            status: "open",
            limit: 5,
          },
        }).catch(() => ({ opportunities: [] }));
        if ((openOpps?.opportunities || []).length > 0) {
          result.skipped.push({ contactId, reason: "has future booking" });
          continue;
        }

        const email = lower(contact.email);
        if (!email) {
          result.skipped.push({ contactId, reason: "no email" });
          continue;
        }

        const firstName = contact.firstNameRaw || contact.firstName || "";
        // Pick a service hint from existing service tags
        const serviceTag = tags.find((t) => t.startsWith("service:"));
        const lastServiceType = serviceTag
          ? serviceTag.replace("service:", "")
          : null;

        const daysSince = Math.floor(
          (Date.now() - new Date(opp.lastStatusChangeAt).getTime()) /
            (24 * 60 * 60 * 1000),
        );

        const { subject, html } = buildReactivation({
          firstName,
          lastServiceType,
          daysSince,
        });
        const emailRes = await sendEmail({
          to: email,
          subject,
          html,
          tags: ["reactivation"],
        });

        // Tag so we don't repeat
        await ghl({
          method: "POST",
          path: `/contacts/${contactId}/tags`,
          body: { tags: [SENT_TAG] },
        }).catch(() => null);

        if (emailRes.id) {
          result.sent++;
          result.skipped.push({ contactId, firstName, daysSince, status: "sent" });
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
