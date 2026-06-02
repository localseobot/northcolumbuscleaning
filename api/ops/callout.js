// Triggered when a cleaner can't make a shift (called out, or you're
// just reassigning). This endpoint:
//
//   1. Looks up the affected opportunity
//   2. Finds available cleaners for that day (tagged internal:cleaner,
//      not already assigned to another job on that date)
//   3. Sends each available cleaner an SMS "open shift" offer with a
//      signed claim URL
//   4. Drops a [SHIFT_OFFER] note on the opp tracking who got offered
//   5. Alerts the manager (SMS + Slack + email) with current status
//
// Auth: requires ADMIN_TOKEN passed as ?token=... since this can spam
// the cleaner pool if abused. The manager-side trigger is intentionally
// manual for now — the inbound SMS classifier will trigger this auto-
// matically once we wire that up.
//
// Inputs:
//   POST /api/ops/callout?token=ADMIN_TOKEN
//   body: { oppId: string, calledOutContactId?: string, reason?: string }
//
// Returns:
//   { ok, oppId, offersSent, manager: {...}, cleaners: [...] }

import { ghl } from "../_lib/ghl.js";
import { sendGhlSms, INTERNAL_LINE } from "../_lib/ghl-sms.js";
import { sendOpsAlert } from "../_lib/alerts.js";
import { findAvailableCleaners } from "../_lib/cleaner-roster.js";
import { buildClaimToken } from "../_lib/claim-token.js";
import {
  OPP_APPOINTMENT_DATE,
  OPP_PROVIDER_NAME,
  OPP_PROVIDER_PHONE,
} from "../_lib/ghl-fields.js";

export const config = { runtime: "nodejs" };

const SITE_URL = "https://www.northcolumbuscleaning.com";

function s(v) { return v === null || v === undefined ? "" : String(v).trim(); }
function lower(v) { return s(v).toLowerCase(); }
function getCf(cfs, id) {
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

function isAuthorized(req) {
  const token = req.query?.token || req.headers["x-admin-token"];
  if (!process.env.ADMIN_TOKEN) return false;
  // Trim trailing whitespace/newline from env value defensively
  const expected = process.env.ADMIN_TOKEN.trim();
  return s(token).trim() === expected;
}

function fmtTime(iso) {
  if (!iso) return "TBD";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!isAuthorized(req)) {
    return res.status(401).json({ error: "Unauthorized — pass ?token=..." });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: "Invalid JSON" }); }
  }
  body = body || {};
  const oppId = s(body.oppId);
  if (!oppId) return res.status(400).json({ error: "Missing oppId" });
  const calledOutContactId = s(body.calledOutContactId);
  const reason = s(body.reason);

  const result = {
    ok: true,
    oppId,
    calledOutContactId: calledOutContactId || null,
    offersSent: 0,
    skipped: [],
    cleaners: [],
  };

  try {
    // 1. Get the opp
    const oppRes = await ghl({ method: "GET", path: `/opportunities/${oppId}` });
    const opp = oppRes?.opportunity;
    if (!opp) return res.status(404).json({ error: "Opp not found" });

    const apptIso = getCf(opp.customFields, OPP_APPOINTMENT_DATE);
    if (!apptIso) {
      return res.status(400).json({ error: "Opp has no Appointment Date set" });
    }
    const apptDate = new Date(apptIso);
    const targetDate = apptDate.toISOString().slice(0, 10);
    result.targetDate = targetDate;
    result.appointmentTime = fmtTime(apptIso);

    // 2. Customer + city for the offer SMS (we hide full address until accepted)
    const customerContactId = opp.contactId;
    let city = "";
    let customerName = "";
    let customerPhone = "";
    if (customerContactId) {
      const c = await ghl({ method: "GET", path: `/contacts/${customerContactId}` });
      const contact = c?.contact;
      if (contact) {
        city = s(contact.city);
        customerName =
          [contact.firstNameRaw, contact.lastNameRaw].filter(Boolean).join(" ") ||
          contact.contactName ||
          "";
        customerPhone = s(contact.phone);
      }
    }

    // 3. Find available cleaners (skip the one who called out)
    const excludeIds = calledOutContactId ? [calledOutContactId] : [];
    const cleaners = await findAvailableCleaners({ targetDate, excludeIds });
    result.availableCleaners = cleaners.length;

    if (cleaners.length === 0) {
      // No-one available — alert manager and bail
      await sendOpsAlert({
        title: `⚠️ NO COVERAGE AVAILABLE — ${result.appointmentTime}`,
        body: `Job: ${opp.name}\nCustomer: ${customerName || "(unknown)"}\nReason: ${reason || "callout"}\n\nNo cleaners tagged \`internal:cleaner\` are free today. You'll need to call the customer to reschedule.`,
      });
      result.manager = "alerted (no coverage available)";
      return res.status(200).json(result);
    }

    // 4. Send offer SMS to each available cleaner
    const offeredIds = [];
    for (const cleaner of cleaners) {
      try {
        const token = buildClaimToken({
          oppId,
          cleanerId: cleaner.id,
          expiresInMinutes: 60,
        });
        const claimUrl = `${SITE_URL}/api/ops/claim?t=${token}`;
        const offerMessage =
          `🧼 NCC URGENT: Open shift ${result.appointmentTime}` +
          (city ? ` in ${city}, OH` : "") +
          `. Can you cover? Tap to claim: ${claimUrl}`;

        const smsResp = await ghl({
          method: "POST",
          path: "/conversations/messages",
          body: {
            type: "SMS",
            contactId: cleaner.id,
            message: offerMessage,
            fromNumber: INTERNAL_LINE,
          },
        }).catch((e) => ({ error: e.message }));

        if (smsResp?.messageId || smsResp?.message?.id) {
          offeredIds.push(cleaner.id);
          result.offersSent++;
          result.cleaners.push({
            id: cleaner.id,
            firstName: cleaner.firstName,
            phone: cleaner.phone,
            status: "offered",
          });
        } else {
          result.skipped.push({
            cleanerId: cleaner.id,
            reason: smsResp?.error || "sms send failed",
          });
        }
      } catch (e) {
        result.skipped.push({ cleanerId: cleaner.id, error: e.message });
      }
    }

    // 5. Track who got offered on the opp via a note (so /claim can notify
    //    the others when the shift fills)
    if (offeredIds.length > 0) {
      const noteBody =
        `[SHIFT_OFFER]\n` +
        `Offered to: ${offeredIds.join(",")}\n` +
        `Sent at: ${new Date().toISOString()}\n` +
        `Reason: ${reason || "callout"}`;
      await ghl({
        method: "POST",
        path: `/contacts/${customerContactId}/notes`,
        body: { body: noteBody },
      }).catch(() => null);
    }

    // 6. Alert the manager
    const cleanerList = result.cleaners
      .map((c, i) => `  ${i + 1}. ${c.firstName} (${c.phone})`)
      .join("\n");
    await sendOpsAlert({
      title: `Shift coverage requested — ${result.appointmentTime}`,
      body:
        `Job: ${opp.name}\n` +
        `Customer: ${customerName || "(unknown)"}${customerPhone ? ` · ${customerPhone}` : ""}\n` +
        `Reason: ${reason || "callout"}\n\n` +
        `Offered to ${offeredIds.length} cleaner(s):\n${cleanerList}\n\n` +
        `First to tap the claim link wins. You'll get another alert when someone accepts.`,
    });
    result.manager = "alerted";
  } catch (e) {
    result.ok = false;
    result.error = e.message;
  }

  return res.status(200).json(result);
}
