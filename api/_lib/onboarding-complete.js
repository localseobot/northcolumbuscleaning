// Completion latch for contractor onboarding.
//
// Called after every task submission. Re-fetches the contact fresh from GHL
// (single source of truth — avoids acting on a stale in-memory copy), and if
// all three tasks are done AND we haven't already finished, fires the
// completion sequence exactly once:
//   1. set onboarding_complete = "yes" FIRST (shrinks the double-fire window)
//   2. move the Recruitment opportunity to "Onboarded Applicant"
//   3. tag the contact type:contractor + onboarding:complete
//   4. post a Slack "ready to go" notification
//
// There are no transactions in GHL, so the latch is best-effort; writing the
// complete flag before the side effects keeps the collision window tiny, which
// is acceptable for this volume (tasks are user-driven and sequential).

import { ghl } from "./ghl.js";
import { sendSlack } from "./slack.js";
import {
  CONTACT_ONBOARDING_W9_DONE,
  CONTACT_ONBOARDING_AGREEMENT_DONE,
  CONTACT_ONBOARDING_CHECKLIST_DONE,
  CONTACT_ONBOARDING_COMPLETE,
  readContactField,
  isYes,
} from "./onboarding-fields.js";

export const RECRUITMENT_PIPELINE_ID = "MG4rWvwS5GaUT2jSJHdQ";
export const STAGE_APPLICANT_FOR_INTERVIEW = "cac9a533-e524-448e-b11f-e98beafc64e0";
export const STAGE_FOR_TEST_CLEAN = "d461399f-bed2-469d-bb1c-cf0e895cded9";
export const STAGE_ONBOARDED_APPLICANT = "2ffaf224-8fc2-400b-a241-2356dab9ea58";
const GHL_CONTACT_URL_BASE = "https://app.gohighlevel.com/v2/location";

/**
 * @param {string} contactId
 * @returns {Promise<{status: "completed"|"pending"|"already"|"error", error?: string}>}
 */
export async function completeIfDone(contactId) {
  if (!contactId) return { status: "error", error: "no contactId" };

  let contact;
  try {
    const resp = await ghl({ method: "GET", path: `/contacts/${contactId}` });
    contact = resp?.contact || resp;
  } catch (e) {
    return { status: "error", error: e.message };
  }

  if (isYes(readContactField(contact, CONTACT_ONBOARDING_COMPLETE))) {
    return { status: "already" };
  }

  const w9 = isYes(readContactField(contact, CONTACT_ONBOARDING_W9_DONE));
  const agreement = isYes(readContactField(contact, CONTACT_ONBOARDING_AGREEMENT_DONE));
  const checklist = isYes(readContactField(contact, CONTACT_ONBOARDING_CHECKLIST_DONE));
  if (!(w9 && agreement && checklist)) {
    return { status: "pending" };
  }

  // 1. Latch first.
  try {
    await ghl({
      method: "PUT",
      path: `/contacts/${contactId}`,
      body: {
        customFields: [{ id: CONTACT_ONBOARDING_COMPLETE, field_value: "yes" }],
      },
    });
  } catch (e) {
    return { status: "error", error: `latch failed: ${e.message}` };
  }

  const name =
    [contact.firstName, contact.lastName].filter(Boolean).join(" ") ||
    contact.contactName ||
    contact.email ||
    contactId;
  const locationId = contact.locationId || process.env.GHL_LOCATION_ID;

  // 2. Move the Recruitment opportunity to "Onboarded Applicant" (best-effort).
  try {
    const search = await ghl({
      method: "GET",
      path: "/opportunities/search",
      query: { location_id: locationId, contact_id: contactId },
    });
    const opps = search?.opportunities || [];
    const opp = opps.find((o) => o.pipelineId === RECRUITMENT_PIPELINE_ID) || opps[0];
    if (opp?.id) {
      await ghl({
        method: "PUT",
        path: `/opportunities/${opp.id}`,
        body: {
          pipelineId: RECRUITMENT_PIPELINE_ID,
          pipelineStageId: STAGE_ONBOARDED_APPLICANT,
        },
      });
    }
  } catch (_) {
    // Non-fatal — Slack + tags still fire so the team is notified.
  }

  // 3. Tag (best-effort).
  try {
    await ghl({
      method: "POST",
      path: `/contacts/${contactId}/tags`,
      body: { tags: ["type:contractor", "onboarding:complete"] },
    });
  } catch (_) {
    /* best-effort */
  }

  // 4. Slack.
  const blocks = [
    {
      type: "header",
      text: { type: "plain_text", text: `✅ ${name} is ready to go`.slice(0, 150), emoji: true },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "Onboarding complete — W-9, signed contractor agreement, and checklist review are all done.",
      },
    },
  ];
  if (locationId) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Open in GHL" },
          url: `${GHL_CONTACT_URL_BASE}/${locationId}/contacts/detail/${contactId}`,
        },
      ],
    });
  }
  await sendSlack(
    process.env.SLACK_WEBHOOK_URL,
    blocks,
    `${name} has completed onboarding — ready to go`,
  );

  return { status: "completed" };
}
