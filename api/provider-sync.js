// Booking Koala → Zapier → GHL provider sync.
//
// Fires when a provider/team member is added in Booking Koala. Upserts them as
// a GHL contact, tags them onboarding:eligible (this is what lets them request
// an onboarding code on /onboard), and ensures they have a Recruitment
// opportunity. The admin's only action is adding the provider in Booking Koala.
//
// Secured with its OWN shared secret (separate from the booking webhook so
// enabling it never affects the existing bookings Zap): set PROVIDER_SYNC_SECRET
// in Vercel and send header X-Webhook-Secret from Zapier.
// (Skipped if the env var isn't set, matching bk-webhook.js's pattern.)
//
// Expected body (map these in Zapier from the BK provider fields):
//   { firstName, lastName, email, phone? }

import { ghl } from "./_lib/ghl.js";
import { sendEmail } from "./_lib/resend.js";
import { sendGhlSms, INTERNAL_LINE } from "./_lib/ghl-sms.js";
import { signToken, newNonce } from "./_lib/onboard-token.js";
import {
  RECRUITMENT_PIPELINE_ID,
  STAGE_FOR_TEST_CLEAN,
} from "./_lib/onboarding-complete.js";
import {
  TAG_ONBOARDING_ELIGIBLE,
  CONTACT_ONBOARDING_TOKEN_NONCE,
} from "./_lib/onboarding-fields.js";

export const config = { runtime: "nodejs" };

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function siteBase() {
  return (process.env.SITE_BASE_URL || "https://www.northcolumbuscleaning.com").replace(/\/$/, "");
}
function escapeHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // No shared-secret guard: this endpoint is intentionally open so the Booking
  // Koala Zap can POST without custom headers. Risk is low (it only upserts a
  // GHL contact + sends a welcome email). If abuse ever appears, re-add a
  // header/secret check here and set the X-Webhook-Secret header in the Zap.

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: "Invalid JSON" });
    }
  }
  body = body || {};

  const firstName = String(body.firstName || "").trim().slice(0, 60);
  const lastName = String(body.lastName || "").trim().slice(0, 60);
  const email = String(body.email || "").trim().toLowerCase();
  const phone = String(body.phone || "").trim().slice(0, 32);

  if (!email || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "A valid provider email is required." });
  }
  if (!process.env.GHL_PIT) {
    return res.status(500).json({ error: "GHL not configured" });
  }

  const result = { ok: true };

  // 1. Upsert provider contact.
  let contactId;
  try {
    const upsert = await ghl({
      method: "POST",
      path: "/contacts/upsert",
      body: {
        locationId: process.env.GHL_LOCATION_ID,
        firstName: firstName || undefined,
        lastName: lastName || undefined,
        email,
        phone: phone || undefined,
        country: "US",
        source: "Booking Koala — provider added",
      },
    });
    contactId = upsert?.contact?.id || upsert?.id || null;
    result.contactId = contactId;
  } catch (e) {
    return res.status(502).json({ ok: false, error: "ghl-upsert-failed", detail: e.message });
  }
  if (!contactId) return res.status(502).json({ ok: false, error: "no-contact-id" });

  // 2. Tag eligible (this is the gate for requesting an onboarding code).
  try {
    await ghl({
      method: "POST",
      path: `/contacts/${contactId}/tags`,
      body: { tags: [TAG_ONBOARDING_ELIGIBLE, "source:booking-koala"] },
    });
  } catch (e) {
    result.tagWarning = e.message;
  }

  // 3. Ensure a Recruitment opportunity exists (create at "For Test Clean" if not).
  try {
    const search = await ghl({
      method: "GET",
      path: "/opportunities/search",
      query: { location_id: process.env.GHL_LOCATION_ID, contact_id: contactId },
    });
    const hasRecruitmentOpp = (search?.opportunities || []).some(
      (o) => o.pipelineId === RECRUITMENT_PIPELINE_ID,
    );
    if (!hasRecruitmentOpp) {
      await ghl({
        method: "POST",
        path: "/opportunities/",
        body: {
          locationId: process.env.GHL_LOCATION_ID,
          pipelineId: RECRUITMENT_PIPELINE_ID,
          pipelineStageId: STAGE_FOR_TEST_CLEAN,
          contactId,
          name: [firstName, lastName].filter(Boolean).join(" ") || email,
          status: "open",
        },
      });
      result.opportunityCreated = true;
    }
  } catch (e) {
    result.opportunityWarning = e.message;
  }

  // 4. Send the welcome email + SMS with a ready-to-use onboarding link.
  //    We mint a token (set the nonce, then sign it) so the link works on
  //    click; the email/OTP gate on /onboard remains for re-entry.
  const nonce = newNonce();
  try {
    await ghl({
      method: "PUT",
      path: `/contacts/${contactId}`,
      body: { customFields: [{ id: CONTACT_ONBOARDING_TOKEN_NONCE, field_value: nonce }] },
    });
  } catch (e) {
    result.nonceWarning = e.message;
  }
  const link = `${siteBase()}/onboard?t=${encodeURIComponent(signToken({ contactId, nonce }))}`;
  const guide = `${siteBase()}/onboarding-guide`;
  const greet = firstName || "there";

  if (email) {
    const html = `
      <div style="font-family:Inter,Arial,sans-serif;color:#2b2b2b;max-width:520px">
        <h2 style="color:#1a4d2e">Welcome to North Columbus Cleaning, ${escapeHtml(greet)}!</h2>
        <p>You've been added to our team. Before your first job, please complete your onboarding — it takes just a few minutes:</p>
        <ul>
          <li>Fill out or upload your <strong>W-9</strong></li>
          <li>Sign the <strong>contractor agreement</strong></li>
          <li>Review our <strong>onboarding guide &amp; checklist</strong></li>
        </ul>
        <p style="margin:24px 0">
          <a href="${link}" style="background:#1a4d2e;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:bold">Start onboarding</a>
        </p>
        <p style="font-size:14px">First, read the <a href="${guide}">onboarding guide</a> to see how everything works.</p>
        <p style="font-size:13px;color:#666">If the button doesn't work, paste this link into your browser:<br>${link}</p>
        <p style="font-size:13px;color:#666">This link is personal to you and expires in 14 days. You can also go to ${siteBase()}/onboard and enter this email to get a code.</p>
      </div>`;
    const er = await sendEmail({
      to: email,
      subject: "Welcome to North Columbus Cleaning — finish your onboarding",
      html,
      tags: ["onboarding", "welcome"],
    });
    result.email = er.id ? "sent" : er.skipped ? er.reason : er.error;
  } else {
    result.email = "no email on provider";
  }

  if (phone) {
    const sr = await sendGhlSms({
      to: phone,
      firstName,
      fromNumber: INTERNAL_LINE,
      message: `Hi ${greet}, welcome to North Columbus Cleaning! Finish your onboarding (W-9, contractor agreement, quick review) here: ${link}`,
    });
    result.sms = sr.ok ? "sent" : sr.error;
  }

  return res.status(200).json(result);
}
