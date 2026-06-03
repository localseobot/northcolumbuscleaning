// W-9 task endpoint. Two modes:
//   mode "fill"   — contractor filled the W-9 fields on the page. We validate
//                   the TIN, generate a substitute W-9 PDF, and store it.
//   mode "upload" — contractor uploaded a completed W-9. We run a Claude vision
//                   check to confirm an SSN/EIN is present, then store the file.
//
// PRIVACY: the raw TIN is used only to render the PDF (fill mode) and is never
// logged, never echoed in a response, and never written to GHL. Only the
// ssn_ein_verified flag + the Drive link land in GHL.

import { ghl } from "../_lib/ghl.js";
import { uploadToDrive } from "../_lib/drive.js";
import { fillIrsW9, buildSubstituteW9 } from "../_lib/w9-pdf.js";
import { verifyW9Tin } from "../_lib/anthropic-vision.js";
import { completeIfDone } from "../_lib/onboarding-complete.js";
import {
  authContact,
  authErrorResponse,
  setOnboardCors,
  clientIp,
} from "../_lib/onboard-auth.js";
import {
  CONTACT_ONBOARDING_W9_DONE,
  CONTACT_W9_DRIVE_LINK,
  CONTACT_SSN_EIN_VERIFIED,
  readContactField,
  isYes,
} from "../_lib/onboarding-fields.js";

export const config = { runtime: "nodejs", maxDuration: 30 };

const MAX_UPLOAD_B64 = 4_000_000; // ~3 MB binary
const ALLOWED_UPLOAD_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export default async function handler(req, res) {
  setOnboardCors(res);
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

  // Auth.
  let contact, contactId;
  try {
    ({ contact, contactId } = await authContact(String(body.t || "")));
  } catch (e) {
    const { status, body: b } = authErrorResponse(e);
    return res.status(status).json(b);
  }

  // Idempotent: already done → no-op.
  if (isYes(readContactField(contact, CONTACT_ONBOARDING_W9_DONE))) {
    return res.status(200).json({ ok: true, alreadyDone: true });
  }

  const fullName =
    [contact.firstName, contact.lastName].filter(Boolean).join(" ") ||
    contact.email ||
    contactId;
  const fileBaseName = fullName.replace(/[^\w.\-]+/g, "_").replace(/_+/g, "_");
  const timestamp = new Date().toISOString();
  const ip = clientIp(req);

  const mode = String(body.mode || "").toLowerCase();
  let pdfBytes;
  let mimeType = "application/pdf";
  let verified = "";
  const out = { ok: true };

  if (mode === "fill") {
    const tinTypeRaw = String(body.tinType || "SSN").toUpperCase();
    const tinType = tinTypeRaw === "EIN" ? "EIN" : "SSN";
    const tinDigits = String(body.tin || "").replace(/\D/g, "");
    if (tinDigits.length !== 9) {
      return res
        .status(422)
        .json({ error: `Please enter a valid 9-digit ${tinType}.` });
    }
    const name = String(body.name || fullName).trim().slice(0, 120);
    const signatureName = String(body.signatureName || name).trim().slice(0, 120);
    if (!signatureName) {
      return res.status(422).json({ error: "Please type your legal name to sign." });
    }
    // Pretty-print the TIN for the PDF only.
    const tinPretty =
      tinType === "EIN"
        ? `${tinDigits.slice(0, 2)}-${tinDigits.slice(2)}`
        : `${tinDigits.slice(0, 3)}-${tinDigits.slice(3, 5)}-${tinDigits.slice(5)}`;
    const w9Fields = {
      name,
      businessName: String(body.businessName || "").slice(0, 120),
      taxClassification: String(body.taxClassification || "Individual/sole proprietor").slice(0, 80),
      address: String(body.address || "").slice(0, 160),
      cityStateZip: String(body.cityStateZip || "").slice(0, 120),
      tin: tinPretty,
      tinType,
      signatureName,
      signaturePngBase64: stripDataUrl(body.signaturePngBase64),
      timestamp,
      ip,
    };
    // Fill the official IRS W-9; fall back to the substitute if that ever fails.
    try {
      pdfBytes = await fillIrsW9(w9Fields);
    } catch (e) {
      try {
        pdfBytes = await buildSubstituteW9(w9Fields);
      } catch (_) {
        return res.status(500).json({ error: "Could not generate the W-9 PDF." });
      }
    }
    verified = "yes"; // TIN was validated as 9 digits and rendered.
  } else if (mode === "upload") {
    const b64 = stripDataUrl(body.fileBase64);
    if (!b64) return res.status(400).json({ error: "No file uploaded." });
    if (b64.length > MAX_UPLOAD_B64) {
      return res
        .status(413)
        .json({ error: "File is too large. Please upload under 3 MB (try a lower-resolution photo)." });
    }
    mimeType = String(body.fileType || "application/pdf");
    if (!ALLOWED_UPLOAD_TYPES.has(mimeType)) {
      return res.status(400).json({ error: "Please upload a PDF or photo (PNG/JPG) of your W-9." });
    }
    let bytes;
    try {
      bytes = Buffer.from(b64, "base64");
    } catch {
      return res.status(400).json({ error: "Could not read the uploaded file." });
    }

    // AI check: confirm SSN/EIN is present.
    const check = await verifyW9Tin(bytes, mimeType);
    if (check.ok) {
      if (!check.hasTin) {
        return res.status(422).json({
          error:
            "We couldn't find a completed SSN or EIN on that W-9. Please make sure the taxpayer ID section is filled in and re-upload.",
        });
      }
      verified = "yes";
      out.tinType = check.tinType || null; // type only — never the number
    } else {
      // Vision unavailable (e.g. key not set) — accept but flag for manual review.
      verified = "manual-review";
      out.verifyWarning = check.error;
    }
    pdfBytes = bytes;
  } else {
    return res.status(400).json({ error: "Invalid mode." });
  }

  // Store in Drive.
  const ext = mimeType.includes("pdf") ? "pdf" : mimeType.split("/")[1] || "bin";
  const up = await uploadToDrive({
    folderId: process.env.GDRIVE_W9_FOLDER_ID,
    name: `${fileBaseName}_W9.${ext}`,
    mimeType,
    bytes: pdfBytes,
  });
  // The W-9 is a required record — refuse to mark the task done if we couldn't
  // actually store it (e.g. Drive not configured), rather than lose the doc.
  if (!up.webViewLink) {
    return res
      .status(502)
      .json({ error: "We couldn't save your W-9 right now. Please try again shortly." });
  }

  // Persist flags (no TIN, ever).
  const customFields = [
    { id: CONTACT_ONBOARDING_W9_DONE, field_value: "yes" },
    { id: CONTACT_SSN_EIN_VERIFIED, field_value: verified },
  ];
  if (up.webViewLink) customFields.push({ id: CONTACT_W9_DRIVE_LINK, field_value: up.webViewLink });
  try {
    await ghl({ method: "PUT", path: `/contacts/${contactId}`, body: { customFields } });
  } catch (e) {
    return res.status(502).json({ error: "Could not record your W-9. Please try again." });
  }

  const done = await completeIfDone(contactId);
  out.completed = done.status === "completed";
  return res.status(200).json(out);
}

function stripDataUrl(s) {
  return s ? String(s).replace(/^data:[^;]+;base64,/, "") : "";
}
