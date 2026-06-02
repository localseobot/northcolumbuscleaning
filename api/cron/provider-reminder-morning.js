// Morning-of — texts each assigned cleaner the comprehensive details
// for TODAY's jobs. One SMS per job. Same payload as evening reminder,
// just rephrased intro.
//
// Schedule (vercel.json): daily at 12:00 UTC (7am ET — start of workday)

import { ghl } from "../_lib/ghl.js";
import { INTERNAL_LINE } from "../_lib/ghl-sms.js";
import { buildProviderSms } from "../_lib/provider-sms.js";
import {
  OPP_APPOINTMENT_DATE,
  OPP_PROVIDER_PHONE,
  OPP_PROVIDER_NAME,
} from "../_lib/ghl-fields.js";

export const config = { runtime: "nodejs" };

const SALES_PIPELINE_ID = "6YDehH2kNtHrdfJaEQfa";
const STAGE_BOOKED = "a1df2c52-9211-4e13-a920-0c17ab00eff9";
const SENT_PREFIX = "provider-morning:";

function isAuthorized(req) {
  if (!process.env.CRON_SECRET) return true;
  return req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
}
function normalizePhone(raw) {
  if (!raw) return "";
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  if (String(raw).startsWith("+") && digits.length >= 10) return "+" + digits;
  return "";
}
function getCfRaw(cfs, id) {
  if (!Array.isArray(cfs)) return null;
  const f = cfs.find((c) => c.id === id);
  if (!f) return null;
  return (
    f.fieldValueString ||
    f.fieldValueNumber ||
    (f.fieldValueDate ? new Date(f.fieldValueDate).toISOString() : null) ||
    f.fieldValue ||
    null
  );
}
function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

export default async function handler(req, res) {
  if (!isAuthorized(req)) return res.status(401).json({ error: "Unauthorized" });

  const target = todayYmd();
  const sentTag = `${SENT_PREFIX}${target}`;
  const result = {
    ok: true,
    ranAt: new Date().toISOString(),
    targetDate: target,
    candidates: 0,
    sent: 0,
    skipped: [],
    errors: [],
  };

  try {
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

    const todayMidnightMs = new Date(target + "T00:00:00Z").getTime();
    const tomorrowMs = todayMidnightMs + 86400000;
    const opps = (search?.opportunities || []).filter((o) => {
      const dt = getCfRaw(o.customFields, OPP_APPOINTMENT_DATE);
      if (!dt) return false;
      const t = new Date(dt).getTime();
      return t >= todayMidnightMs && t < tomorrowMs;
    });
    result.candidates = opps.length;

    for (const opp of opps) {
      try {
        const providerPhone = normalizePhone(
          getCfRaw(opp.customFields, OPP_PROVIDER_PHONE),
        );
        const providerName = getCfRaw(opp.customFields, OPP_PROVIDER_NAME) || "";
        if (!providerPhone) {
          result.skipped.push({ oppId: opp.id, reason: "no provider phone" });
          continue;
        }

        const contactId = opp.contactId;
        const [contactRes, notesRes] = await Promise.all([
          ghl({ method: "GET", path: `/contacts/${contactId}` }),
          ghl({
            method: "GET",
            path: `/contacts/${contactId}/notes`,
          }).catch(() => null),
        ]);
        const contact = contactRes?.contact;
        if (!contact) {
          result.skipped.push({ oppId: opp.id, reason: "contact not found" });
          continue;
        }

        const tags = (contact.tags || []).map((t) => String(t).toLowerCase());
        const oppTag = `${sentTag}:${opp.id.slice(0, 8)}`;
        if (tags.includes(oppTag)) {
          result.skipped.push({ oppId: opp.id, reason: "already sent" });
          continue;
        }

        const providerFirst = String(providerName).split(/\s+/)[0] || "";
        const message = buildProviderSms({
          providerFirstName: providerFirst,
          opp,
          contact,
          contactNotes: notesRes?.notes || [],
          intro: "Today's clean",
        });

        // Upsert provider as a contact + tag internally
        const upsert = await ghl({
          method: "POST",
          path: "/contacts/upsert",
          body: {
            locationId: process.env.GHL_LOCATION_ID,
            phone: providerPhone,
            firstName: providerFirst || undefined,
            lastName:
              String(providerName).split(/\s+/).slice(1).join(" ") || undefined,
            source: "internal:cleaner",
            country: "US",
          },
        });
        const providerContactId = upsert?.contact?.id || upsert?.id;
        if (!providerContactId) {
          result.skipped.push({ oppId: opp.id, reason: "could not upsert provider" });
          continue;
        }
        await ghl({
          method: "POST",
          path: `/contacts/${providerContactId}/tags`,
          body: { tags: ["internal:cleaner"] },
        }).catch(() => null);

        const smsResp = await ghl({
          method: "POST",
          path: "/conversations/messages",
          body: {
            type: "SMS",
            contactId: providerContactId,
            message,
            fromNumber: INTERNAL_LINE,
          },
        }).catch((e) => ({ error: e.message }));

        await ghl({
          method: "POST",
          path: `/contacts/${contactId}/tags`,
          body: { tags: [oppTag] },
        }).catch(() => null);

        if (smsResp?.messageId || smsResp?.message?.id) {
          result.sent++;
          result.skipped.push({ oppId: opp.id, providerFirst, status: "sent" });
        } else {
          result.errors.push({
            oppId: opp.id,
            error: smsResp?.error || "unknown",
          });
        }
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
