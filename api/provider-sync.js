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
import {
  RECRUITMENT_PIPELINE_ID,
  STAGE_FOR_TEST_CLEAN,
} from "./_lib/onboarding-complete.js";
import { TAG_ONBOARDING_ELIGIBLE } from "./_lib/onboarding-fields.js";

export const config = { runtime: "nodejs" };

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Shared-secret guard (dedicated secret; same header convention as bk-webhook).
  if (process.env.PROVIDER_SYNC_SECRET) {
    const provided =
      req.headers["x-webhook-secret"] ||
      (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (provided !== process.env.PROVIDER_SYNC_SECRET) {
      return res.status(401).json({ error: "unauthorized" });
    }
  }

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

  return res.status(200).json(result);
}
