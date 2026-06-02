// Checklist / onboarding-document review confirmation.
//
// POST { t, confirmed: true }
// Records that the contractor has reviewed the onboarding document and the
// cleaning checklist. Sets the done flag and runs the completion latch.

import { ghl } from "../_lib/ghl.js";
import { completeIfDone } from "../_lib/onboarding-complete.js";
import { authContact, authErrorResponse, setOnboardCors } from "../_lib/onboard-auth.js";
import {
  CONTACT_ONBOARDING_CHECKLIST_DONE,
  readContactField,
  isYes,
} from "../_lib/onboarding-fields.js";

export const config = { runtime: "nodejs" };

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

  if (isYes(readContactField(contact, CONTACT_ONBOARDING_CHECKLIST_DONE))) {
    return res.status(200).json({ ok: true, alreadyDone: true });
  }

  if (body.confirmed !== true) {
    return res
      .status(422)
      .json({ error: "Please confirm you've reviewed the onboarding document and checklist." });
  }

  try {
    await ghl({
      method: "PUT",
      path: `/contacts/${contactId}`,
      body: { customFields: [{ id: CONTACT_ONBOARDING_CHECKLIST_DONE, field_value: "yes" }] },
    });
  } catch (e) {
    return res.status(502).json({ error: "Could not record your confirmation. Please try again." });
  }

  const done = await completeIfDone(contactId);
  return res.status(200).json({ ok: true, completed: done.status === "completed" });
}
