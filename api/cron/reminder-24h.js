// Daily cron — sends a friendly reminder email + SMS to customers whose
// next booking is ~24 hours out. Uses the Booked-stage opp's Appointment
// Date custom field as the source of truth.
//
// Schedule (vercel.json): daily at 22:00 UTC (6pm ET — fires evening
// before the appointment).

import { ghl } from "../_lib/ghl.js";
import { sendEmail } from "../_lib/resend.js";
import { CUSTOMER_LINE } from "../_lib/ghl-sms.js";
import { buildReminder24h } from "../_lib/email-templates/reminder-24h.js";
import { OPP_APPOINTMENT_DATE } from "../_lib/ghl-fields.js";

export const config = { runtime: "nodejs" };

const SALES_PIPELINE_ID = "6YDehH2kNtHrdfJaEQfa";
const STAGE_BOOKED = "a1df2c52-9211-4e13-a920-0c17ab00eff9";
const SENT_TAG_PREFIX = "reminded:"; // we append the appointment date YYYY-MM-DD

function isAuthorized(req) {
  if (!process.env.CRON_SECRET) return true;
  return req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
}
function lower(v) {
  return String(v || "").toLowerCase();
}
function tomorrowYmd() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function buildReminderSms({ firstName, appointmentDateTime }) {
  let when = "tomorrow";
  if (appointmentDateTime) {
    try {
      const d = new Date(appointmentDateTime);
      if (!isNaN(d.getTime())) {
        when = d.toLocaleString("en-US", {
          weekday: "long",
          hour: "numeric",
          minute: "2-digit",
        });
      }
    } catch (_) {}
  }
  const name = firstName || "there";
  return (
    `Hi ${name}, North Columbus Cleaning here — just a reminder we'll see you ${when}. ` +
    `Manage your booking at northcolumbuscleaning.com/login.`
  );
}

export default async function handler(req, res) {
  if (!isAuthorized(req)) return res.status(401).json({ error: "Unauthorized" });

  const result = {
    ok: true,
    ranAt: new Date().toISOString(),
    targetDate: tomorrowYmd(),
    candidates: 0,
    sent: 0,
    skipped: [],
    errors: [],
  };

  try {
    const target = tomorrowYmd(); // YYYY-MM-DD
    const sentTag = `${SENT_TAG_PREFIX}${target}`;

    const search = await ghl({
      method: "POST",
      path: "/opportunities/search",
      body: {
        location_id: process.env.GHL_LOCATION_ID,
        pipeline_id: SALES_PIPELINE_ID,
        pipeline_stage_id: STAGE_BOOKED,
        status: "open",
        limit: 100,
        getCustomFields: true,
      },
    }).catch(() => ({ opportunities: [] }));

    const opps = (search?.opportunities || []).filter((o) => {
      const cf = (o.customFields || []).find(
        (f) => f.id === OPP_APPOINTMENT_DATE,
      );
      if (!cf) return false;
      // Date can be in fieldValueDate (epoch ms) or fieldValueString
      let dateStr = "";
      if (cf.fieldValueDate) {
        dateStr = new Date(cf.fieldValueDate).toISOString().slice(0, 10);
      } else if (cf.fieldValueString) {
        dateStr = String(cf.fieldValueString).slice(0, 10);
      } else if (cf.fieldValue) {
        dateStr = String(cf.fieldValue).slice(0, 10);
      }
      return dateStr === target;
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
        if (tags.includes(sentTag)) {
          result.skipped.push({ contactId, reason: "already reminded today" });
          continue;
        }
        if (tags.includes("do-not-contact") || tags.includes("dnd")) {
          result.skipped.push({ contactId, reason: "do-not-contact" });
          continue;
        }

        const firstName = contact.firstNameRaw || contact.firstName || "";
        const email = lower(contact.email);
        const phone = contact.phone;
        const address = [contact.address1, contact.city, contact.state, contact.postalCode]
          .filter(Boolean)
          .join(", ");
        const serviceTag = tags.find((t) => t.startsWith("service:"));
        const serviceType = serviceTag ? serviceTag.replace("service:", "") : null;

        // Appointment ISO from the same custom field
        const apptCf = (opp.customFields || []).find(
          (f) => f.id === OPP_APPOINTMENT_DATE,
        );
        let appointmentDateTime = null;
        if (apptCf) {
          if (apptCf.fieldValueDate)
            appointmentDateTime = new Date(apptCf.fieldValueDate).toISOString();
          else if (apptCf.fieldValueString)
            appointmentDateTime = String(apptCf.fieldValueString);
        }

        let emailOk = false;
        if (email) {
          const { subject, html } = buildReminder24h({
            firstName,
            appointmentDateTime,
            serviceType,
            address,
            bookingId: null,
          });
          const emailRes = await sendEmail({
            to: email,
            subject,
            html,
            tags: ["reminder-24h"],
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
              message: buildReminderSms({ firstName, appointmentDateTime }),
              fromNumber: CUSTOMER_LINE,
            },
          }).catch(() => null);
          smsOk = !!smsResp;
        }

        await ghl({
          method: "POST",
          path: `/contacts/${contactId}/tags`,
          body: { tags: [sentTag] },
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
