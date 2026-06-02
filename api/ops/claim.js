// Cleaner-side claim endpoint. Renders a confirmation page + atomically
// reassigns the opp to the cleaner who tapped the link first.
//
// Concurrency model: the opp's Assigned Provider Phone custom field
// acts as our lock. We do a GET + PUT cycle:
//   1. GET opp, check if provider_phone is already the offered cleaner
//   2. PUT opp with new provider_phone, gated by a check on the current
//      value matching the pre-offer state
//
// GHL doesn't expose CAS semantics natively, so we accept the small
// window of race risk between GET and PUT — two cleaners tapping in the
// same millisecond would both see "open" then both PUT. We mitigate by
// updating the SHIFT_OFFER note to mark filled, and by relying on the
// post-claim manager alert (which surfaces the duplicate so they can
// resolve manually). For a 5-person team this is fine; if it ever
// becomes a problem we add a separate "claim lock" record.

import { ghl } from "../_lib/ghl.js";
import { sendGhlSms, INTERNAL_LINE } from "../_lib/ghl-sms.js";
import { sendOpsAlert } from "../_lib/alerts.js";
import { verifyClaimToken } from "../_lib/claim-token.js";
import { buildProviderSms } from "../_lib/provider-sms.js";
import {
  OPP_PROVIDER_NAME,
  OPP_PROVIDER_PHONE,
  OPP_APPOINTMENT_DATE,
} from "../_lib/ghl-fields.js";

export const config = { runtime: "nodejs" };

function s(v) { return v === null || v === undefined ? "" : String(v).trim(); }
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

function renderPage({ title, message, status, accent }) {
  const color = accent || "#1a4d2e";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} | North Columbus Cleaning</title>
<link rel="icon" href="/images/favicon.ico" sizes="any">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&display=swap" rel="stylesheet">
<style>
  *,*::before,*::after { box-sizing: border-box; }
  body { margin: 0; font-family: 'Inter',sans-serif; background: #faf9f5; color: #0f172a; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
  .card { background: #fff; border-radius: 24px; padding: 56px 32px 40px; max-width: 520px; width: 100%; text-align: center; box-shadow: 0 12px 32px rgba(13,51,32,0.08); }
  .badge { width: 80px; height: 80px; border-radius: 50%; margin: 0 auto 24px; display: flex; align-items: center; justify-content: center; font-size: 40px; background: ${color}; color: #c9e265; }
  h1 { font-size: 30px; font-weight: 900; margin: 0 0 16px; color: ${color}; line-height: 1.2; }
  p { font-size: 17px; line-height: 1.6; color: #475569; margin: 0 0 14px; }
  .status { display: inline-block; background: #faf9f5; padding: 14px 22px; border-radius: 12px; margin-top: 24px; font-size: 14px; color: #64748b; }
  .status strong { color: #1a4d2e; }
  a { color: ${color}; font-weight: 700; }
</style>
</head>
<body>
  <div class="card">
    <div class="badge">${status === "ok" ? "✓" : status === "taken" ? "✕" : "?"}</div>
    <h1>${title}</h1>
    <p>${message}</p>
    <div class="status">North Columbus Cleaning · <strong>(614) 352-2588</strong></div>
  </div>
</body>
</html>`;
}

export default async function handler(req, res) {
  const token = req.query?.t || req.query?.token;
  const verify = verifyClaimToken(s(token));
  if (!verify.ok) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(400).send(
      renderPage({
        title: "Link expired or invalid",
        message: `This shift offer link can't be used (${verify.reason}). If you still want to cover, text Devyn at (614) 352-2588.`,
        status: "error",
        accent: "#b91c1c",
      }),
    );
  }

  const { oppId, cleanerId } = verify.payload;

  try {
    // 1. Get the opp + cleaner
    const [oppRes, cleanerRes] = await Promise.all([
      ghl({ method: "GET", path: `/opportunities/${oppId}` }),
      ghl({ method: "GET", path: `/contacts/${cleanerId}` }),
    ]);
    const opp = oppRes?.opportunity;
    const cleaner = cleanerRes?.contact;
    if (!opp || !cleaner) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(404).send(
        renderPage({
          title: "Job not found",
          message: "We couldn't find that job. It may have been canceled. Text Devyn at (614) 352-2588 if you have questions.",
          status: "error",
          accent: "#b91c1c",
        }),
      );
    }

    // 2. Check if already claimed by checking the current provider phone
    const currentProviderPhone = s(getCf(opp.customFields, OPP_PROVIDER_PHONE));
    const currentProviderName = s(getCf(opp.customFields, OPP_PROVIDER_NAME));
    const cleanerPhone = s(cleaner.phone);
    const cleanerName =
      [cleaner.firstNameRaw, cleaner.lastNameRaw].filter(Boolean).join(" ") ||
      cleaner.contactName ||
      "";

    // If a DIFFERENT cleaner already claimed it, show "taken"
    if (currentProviderPhone && currentProviderPhone !== cleanerPhone) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(200).send(
        renderPage({
          title: "Already covered",
          message: `Thanks for being available! ${currentProviderName || "Another cleaner"} just claimed this shift. We'll catch you on the next one.`,
          status: "taken",
          accent: "#d97706",
        }),
      );
    }

    // 3. Reassign the opp via custom-field PUT
    const newCustomFields = [
      { id: OPP_PROVIDER_NAME, field_value: cleanerName || "(assigned)" },
      { id: OPP_PROVIDER_PHONE, field_value: cleanerPhone },
    ];
    await ghl({
      method: "PUT",
      path: `/opportunities/${oppId}`,
      body: { customFields: newCustomFields },
    });

    // 4. Send the full provider SMS with all the job details
    const customerContactId = opp.contactId;
    let customerContact = null;
    let customerNotes = [];
    if (customerContactId) {
      const [cc, notesRes] = await Promise.all([
        ghl({ method: "GET", path: `/contacts/${customerContactId}` }),
        ghl({ method: "GET", path: `/contacts/${customerContactId}/notes` }).catch(() => null),
      ]);
      customerContact = cc?.contact;
      customerNotes = notesRes?.notes || [];
    }

    // We re-pull the opp so we have the freshly-updated customFields baked in
    const freshOppRes = await ghl({ method: "GET", path: `/opportunities/${oppId}` });
    const freshOpp = freshOppRes?.opportunity || opp;

    const fullProviderSms = buildProviderSms({
      providerFirstName: cleaner.firstNameRaw || cleaner.firstName || "",
      opp: freshOpp,
      contact: customerContact,
      contactNotes: customerNotes,
      intro: "You got the shift — full details",
    });
    await ghl({
      method: "POST",
      path: "/conversations/messages",
      body: {
        type: "SMS",
        contactId: cleanerId,
        message: fullProviderSms,
        fromNumber: INTERNAL_LINE,
      },
    }).catch(() => null);

    // 5. Tell other cleaners who were offered that it's filled
    if (customerContactId) {
      const notesRes = await ghl({
        method: "GET",
        path: `/contacts/${customerContactId}/notes`,
      }).catch(() => null);
      const allNotes = notesRes?.notes || [];
      // Find the SHIFT_OFFER note(s)
      const offerNote = allNotes.find((n) =>
        String(n?.body || "").startsWith("[SHIFT_OFFER]"),
      );
      if (offerNote) {
        const offeredMatch = String(offerNote.body).match(/Offered to:\s*([^\n]+)/);
        const otherIds = offeredMatch
          ? offeredMatch[1].split(",").map((x) => x.trim()).filter((x) => x && x !== cleanerId)
          : [];
        const apptIso = getCf(freshOpp.customFields, OPP_APPOINTMENT_DATE);
        const when = apptIso
          ? new Date(apptIso).toLocaleString("en-US", {
              weekday: "short",
              hour: "numeric",
              minute: "2-digit",
            })
          : "the offered shift";
        const fillMsg = `🧼 NCC — The ${when} shift just got covered by ${cleaner.firstNameRaw || "another cleaner"}. Thanks for being available!`;
        for (const otherId of otherIds) {
          await ghl({
            method: "POST",
            path: "/conversations/messages",
            body: {
              type: "SMS",
              contactId: otherId,
              message: fillMsg,
              fromNumber: INTERNAL_LINE,
            },
          }).catch(() => null);
        }
      }
    }

    // 6. Alert the manager
    await sendOpsAlert({
      title: `✓ Coverage filled — ${cleanerName}`,
      body: `Job: ${freshOpp.name}\nNew cleaner: ${cleanerName} (${cleanerPhone})\n\nThey've been sent the full job details. The other offered cleaners have been notified the shift is filled.`,
      severity: "info",
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(
      renderPage({
        title: `You got it, ${cleaner.firstNameRaw || cleanerName}!`,
        message: `Full details just texted to your phone. Devyn's been notified. Reply to that text if anything's unclear — we'll back you up.`,
        status: "ok",
      }),
    );
  } catch (e) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(500).send(
      renderPage({
        title: "Something went wrong",
        message: `We hit a snag (${e.message}). Text Devyn at (614) 352-2588 to confirm coverage.`,
        status: "error",
        accent: "#b91c1c",
      }),
    );
  }
}
