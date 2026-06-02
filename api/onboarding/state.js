// Hydrate the onboarding page: which tasks are done, plus the content to show.
//
// GET /api/onboarding/state?t=<token>
// Returns per-task done flags, prefill for the W-9, the agreement text, the
// onboarding document sections, the review checklist, and tax classifications.

import { authContact, authErrorResponse, setOnboardCors } from "../_lib/onboard-auth.js";
import {
  CONTACT_ONBOARDING_W9_DONE,
  CONTACT_ONBOARDING_AGREEMENT_DONE,
  CONTACT_ONBOARDING_CHECKLIST_DONE,
  CONTACT_ONBOARDING_COMPLETE,
  readContactField,
  isYes,
} from "../_lib/onboarding-fields.js";
import {
  AGREEMENT_TEXT,
  AGREEMENT_TITLE,
  AGREEMENT_VERSION,
  ONBOARDING_DOC_TITLE,
  ONBOARDING_DOC_SECTIONS,
  REVIEW_CHECKLIST,
  TAX_CLASSIFICATIONS,
} from "../_lib/onboarding-content.js";

export const config = { runtime: "nodejs" };

export default async function handler(req, res) {
  setOnboardCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const token = String(req.query?.t || "");
  let contact;
  try {
    ({ contact } = await authContact(token));
  } catch (e) {
    const { status, body } = authErrorResponse(e);
    return res.status(status).json(body);
  }

  const cityStateZip = [contact.city, contact.state, contact.postalCode]
    .filter(Boolean)
    .join(", ");

  return res.status(200).json({
    ok: true,
    contact: {
      firstName: contact.firstName || "",
      lastName: contact.lastName || "",
      fullName: [contact.firstName, contact.lastName].filter(Boolean).join(" "),
    },
    tasks: {
      w9: isYes(readContactField(contact, CONTACT_ONBOARDING_W9_DONE)),
      agreement: isYes(readContactField(contact, CONTACT_ONBOARDING_AGREEMENT_DONE)),
      checklist: isYes(readContactField(contact, CONTACT_ONBOARDING_CHECKLIST_DONE)),
      complete: isYes(readContactField(contact, CONTACT_ONBOARDING_COMPLETE)),
    },
    prefill: {
      name: [contact.firstName, contact.lastName].filter(Boolean).join(" "),
      address: contact.address1 || "",
      cityStateZip,
    },
    content: {
      agreement: { title: AGREEMENT_TITLE, version: AGREEMENT_VERSION, text: AGREEMENT_TEXT },
      onboardingDoc: { title: ONBOARDING_DOC_TITLE, sections: ONBOARDING_DOC_SECTIONS },
      checklist: REVIEW_CHECKLIST,
      taxClassifications: TAX_CLASSIFICATIONS,
    },
  });
}
