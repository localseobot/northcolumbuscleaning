// Send an SMS to an arbitrary phone number via GHL.
//
// GHL's /conversations/messages requires a contactId, so this helper upserts
// the recipient as a contact first (idempotent — GHL matches by phone) and
// then sends the SMS to that contact. Used for internal recap messages to
// the office manager and any other system-driven SMS.

import { ghl } from "./ghl.js";

// Sub-account has two numbers. Customer-facing messages MUST come from the
// customer line so they match the number the customer sees on the website,
// in voicemails, and on caller ID. Internal cleaner/recruiter messages can
// come from the internal line.
export const CUSTOMER_LINE = "+16143522588"; // "North Columbus Cleaning - Customer Line" (A2P-verified)
export const INTERNAL_LINE = "+16147143794"; // "Internal Phone Number - Cleaners and Recruitment"

/**
 * Send an SMS via GHL to a phone number. Creates/finds the recipient contact
 * automatically.
 *
 * @param {object} opts
 * @param {string} opts.to          Recipient phone in E.164 (e.g. "+16143522588")
 * @param {string} opts.message     SMS body
 * @param {string} [opts.firstName] Optional, used when creating the contact
 * @param {string} [opts.tag]       Optional tag to apply (e.g. "internal:manager")
 * @param {string} [opts.fromNumber] Which GHL number to send from. Defaults to
 *                                    the customer-facing line so messages always
 *                                    match the number customers know. Pass
 *                                    INTERNAL_LINE for cleaner/recruiter messages.
 * @returns {Promise<{ok: boolean, contactId?: string, messageId?: string, error?: string}>}
 */
export async function sendGhlSms({ to, message, firstName, tag, fromNumber }) {
  if (!process.env.GHL_PIT) {
    return { ok: false, error: "GHL_PIT not set" };
  }
  if (!to || !message) {
    return { ok: false, error: "missing to or message" };
  }

  try {
    // 1. Upsert the recipient as a contact (idempotent — matched by phone)
    const upsert = await ghl({
      method: "POST",
      path: "/contacts/upsert",
      body: {
        locationId: process.env.GHL_LOCATION_ID,
        phone: to,
        firstName: firstName || undefined,
        country: "US",
        source: "internal",
      },
    });
    const contactId = upsert?.contact?.id || upsert?.id;
    if (!contactId) {
      return { ok: false, error: "no contactId returned from upsert" };
    }

    // 2. Tag (optional)
    if (tag) {
      try {
        await ghl({
          method: "POST",
          path: `/contacts/${contactId}/tags`,
          body: { tags: [tag] },
        });
      } catch (_) {
        // Tagging is best-effort; don't fail the SMS if tag write fails.
      }
    }

    // 3. Send the SMS via the conversations API.
    // Resolution order for the sending number:
    //   explicit fromNumber arg > GHL_FROM_NUMBER env var > CUSTOMER_LINE default.
    // Defaulting to the customer line guarantees customer-facing messages
    // never accidentally go from the internal cleaner/recruiter number.
    const from =
      fromNumber || process.env.GHL_FROM_NUMBER || CUSTOMER_LINE;
    const body = { type: "SMS", contactId, message, fromNumber: from };
    const resp = await ghl({
      method: "POST",
      path: "/conversations/messages",
      body,
    });

    return {
      ok: true,
      contactId,
      messageId: resp?.messageId || resp?.message?.id || null,
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
