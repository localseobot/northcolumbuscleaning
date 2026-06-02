// Contractor-agreement signing endpoint.
//
// POST { t, name, signaturePngBase64 }
// Generates the signed agreement PDF from the SERVER-SIDE agreement text (the
// client never supplies the legal text — only the signature), stores it in
// Drive, and records the done flag + link.

import { ghl } from "../_lib/ghl.js";
import { uploadToDrive } from "../_lib/drive.js";
import { buildAgreementPdf } from "../_lib/agreement-pdf.js";
import { completeIfDone } from "../_lib/onboarding-complete.js";
import {
  authContact,
  authErrorResponse,
  setOnboardCors,
  clientIp,
} from "../_lib/onboard-auth.js";
import {
  AGREEMENT_TEXT,
  AGREEMENT_TITLE,
  AGREEMENT_VERSION,
} from "../_lib/onboarding-content.js";
import {
  CONTACT_ONBOARDING_AGREEMENT_DONE,
  CONTACT_AGREEMENT_DRIVE_LINK,
  readContactField,
  isYes,
} from "../_lib/onboarding-fields.js";

export const config = { runtime: "nodejs", maxDuration: 30 };

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

  let contact, contactId;
  try {
    ({ contact, contactId } = await authContact(String(body.t || "")));
  } catch (e) {
    const { status, body: b } = authErrorResponse(e);
    return res.status(status).json(b);
  }

  if (isYes(readContactField(contact, CONTACT_ONBOARDING_AGREEMENT_DONE))) {
    return res.status(200).json({ ok: true, alreadyDone: true });
  }

  const name = String(body.name || "").trim().slice(0, 120);
  if (!name) {
    return res.status(422).json({ error: "Please type your full legal name to sign." });
  }

  const fullName =
    [contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.email || contactId;
  const fileBaseName = fullName.replace(/[^\w.\-]+/g, "_").replace(/_+/g, "_");
  const timestamp = new Date().toISOString();

  let pdfBytes;
  try {
    pdfBytes = await buildAgreementPdf({
      agreementText: AGREEMENT_TEXT,
      title: AGREEMENT_TITLE,
      version: AGREEMENT_VERSION,
      name,
      signaturePngBase64: body.signaturePngBase64
        ? String(body.signaturePngBase64).replace(/^data:[^;]+;base64,/, "")
        : "",
      timestamp,
      ip: clientIp(req),
    });
  } catch (e) {
    return res.status(500).json({ error: "Could not generate the signed agreement." });
  }

  const up = await uploadToDrive({
    folderId: process.env.GDRIVE_AGREEMENT_FOLDER_ID,
    name: `${fileBaseName}_Contractor_Agreement.pdf`,
    mimeType: "application/pdf",
    bytes: pdfBytes,
  });
  // The signed agreement is a required record — refuse to mark done if we
  // couldn't store it (e.g. Drive not configured), rather than lose it.
  if (!up.webViewLink) {
    return res
      .status(502)
      .json({ error: "We couldn't save the signed agreement right now. Please try again shortly." });
  }

  const customFields = [{ id: CONTACT_ONBOARDING_AGREEMENT_DONE, field_value: "yes" }];
  if (up.webViewLink) {
    customFields.push({ id: CONTACT_AGREEMENT_DRIVE_LINK, field_value: up.webViewLink });
  }
  try {
    await ghl({ method: "PUT", path: `/contacts/${contactId}`, body: { customFields } });
  } catch (e) {
    return res.status(502).json({ error: "Could not record the agreement. Please try again." });
  }

  const done = await completeIfDone(contactId);
  return res.status(200).json({ ok: true, completed: done.status === "completed" });
}
