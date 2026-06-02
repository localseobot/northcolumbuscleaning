// Public job-application endpoint.
//
// POST { firstName, lastName, email, phone, resumeBase64?, resumeName?, resumeType?, website? }
//   - website is a honeypot field; if filled, we silently accept and drop it.
//   - resumeBase64 is the base64-encoded resume (PDF/DOC/DOCX), optional.
//
// Behavior: upsert the applicant in GHL, tag type:applicant, upload the resume
// to the Drive Resumes folder, save the link on the contact, and create an
// opportunity in the Recruitment pipeline at "Applicant for Interview".
//
// Failure mode mirrors promo-signup.js: the applicant always gets a success
// response as long as the core contact upsert worked; Drive/opportunity errors
// are surfaced in the response body for logs but don't block the application.

import { ghl } from "./_lib/ghl.js";
import { uploadToDrive } from "./_lib/drive.js";
import {
  RECRUITMENT_PIPELINE_ID,
  STAGE_APPLICANT_FOR_INTERVIEW,
} from "./_lib/onboarding-complete.js";
import { CONTACT_RESUME_DRIVE_LINK } from "./_lib/onboarding-fields.js";

export const config = { runtime: "nodejs", maxDuration: 30 };

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
// ~3 MB binary → ~4 MB base64; stays under Vercel's ~4.5 MB body cap.
const MAX_RESUME_B64 = 4_000_000;
const ALLOWED_RESUME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
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

  // Honeypot — bots fill hidden fields. Pretend success, do nothing.
  if (String(body.website || "").trim()) {
    return res.status(200).json({ ok: true });
  }

  const firstName = String(body.firstName || "").trim().slice(0, 60);
  const lastName = String(body.lastName || "").trim().slice(0, 60);
  const email = String(body.email || "").trim().toLowerCase();
  const phone = String(body.phone || "").trim().slice(0, 32);

  if (!firstName) return res.status(400).json({ error: "Please enter your name." });
  if (!email || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "Please enter a valid email address." });
  }
  if (!phone) return res.status(400).json({ error: "Please enter your phone number." });

  // Validate resume if present.
  let resumeBytes = null;
  let resumeName = "";
  let resumeType = "";
  if (body.resumeBase64) {
    const b64 = String(body.resumeBase64).replace(/^data:[^;]+;base64,/, "");
    if (b64.length > MAX_RESUME_B64) {
      return res
        .status(413)
        .json({ error: "Resume is too large. Please upload a file under 3 MB." });
    }
    resumeType = String(body.resumeType || "application/pdf");
    if (!ALLOWED_RESUME_TYPES.has(resumeType)) {
      return res
        .status(400)
        .json({ error: "Please upload a PDF, DOC, or DOCX resume." });
    }
    try {
      resumeBytes = Buffer.from(b64, "base64");
    } catch {
      return res.status(400).json({ error: "Could not read the uploaded resume." });
    }
    const safeName = String(body.resumeName || "resume")
      .replace(/[^\w.\-]+/g, "_")
      .slice(0, 80);
    resumeName = `${firstName}_${lastName}_${safeName}`.replace(/_+/g, "_");
  }

  const result = { ok: true };

  if (!process.env.GHL_PIT) {
    result.warning = "ghl-not-configured";
    return res.status(200).json(result);
  }

  // 1. Upsert applicant contact.
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
        source: "Website — job application",
      },
    });
    contactId = upsert?.contact?.id || upsert?.id || null;
    result.contactId = contactId;
  } catch (e) {
    return res.status(502).json({ ok: false, error: "ghl-upsert-failed", detail: e.message });
  }

  if (!contactId) {
    return res.status(502).json({ ok: false, error: "no-contact-id" });
  }

  // 2. Tag.
  try {
    await ghl({
      method: "POST",
      path: `/contacts/${contactId}/tags`,
      body: { tags: ["type:applicant", "source:website"] },
    });
  } catch (e) {
    result.tagWarning = e.message;
  }

  // 3. Upload resume to Drive + save link.
  if (resumeBytes) {
    const up = await uploadToDrive({
      folderId: process.env.GDRIVE_RESUME_FOLDER_ID,
      name: resumeName.endsWith(".pdf") || /\.[a-z]{2,4}$/i.test(resumeName)
        ? resumeName
        : `${resumeName}.pdf`,
      mimeType: resumeType,
      bytes: resumeBytes,
    });
    if (up.webViewLink) {
      result.resumeLink = up.webViewLink;
      try {
        await ghl({
          method: "PUT",
          path: `/contacts/${contactId}`,
          body: {
            customFields: [
              { id: CONTACT_RESUME_DRIVE_LINK, field_value: up.webViewLink },
            ],
          },
        });
      } catch (e) {
        result.resumeFieldWarning = e.message;
      }
    } else if (up.error) {
      result.resumeWarning = up.error;
    }
  }

  // 4. Create Recruitment opportunity at "Applicant for Interview".
  try {
    await ghl({
      method: "POST",
      path: "/opportunities/",
      body: {
        locationId: process.env.GHL_LOCATION_ID,
        pipelineId: RECRUITMENT_PIPELINE_ID,
        pipelineStageId: STAGE_APPLICANT_FOR_INTERVIEW,
        contactId,
        name: [firstName, lastName].filter(Boolean).join(" ") || email,
        status: "open",
      },
    });
  } catch (e) {
    result.opportunityWarning = e.message;
  }

  return res.status(200).json(result);
}
