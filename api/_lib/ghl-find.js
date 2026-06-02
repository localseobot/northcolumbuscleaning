// Find a GHL contact by email via the v2 search endpoint.
//
// POST /contacts/search with an exact-email filter returns the contact
// including its tags and customFields in one call, so callers can check
// eligibility and read custom fields without a second GET.

import { ghl } from "./ghl.js";

/**
 * @param {string} email
 * @returns {Promise<object|null>} the first matching contact, or null
 */
export async function findContactByEmail(email) {
  const e = String(email || "").trim().toLowerCase();
  if (!e) return null;
  try {
    const resp = await ghl({
      method: "POST",
      path: "/contacts/search",
      body: {
        locationId: process.env.GHL_LOCATION_ID,
        pageLimit: 1,
        filters: [{ field: "email", operator: "eq", value: e }],
      },
    });
    return (resp?.contacts || [])[0] || null;
  } catch {
    return null;
  }
}

// True if the contact carries a given tag (case-insensitive).
export function hasTag(contact, tag) {
  const t = String(tag).toLowerCase();
  return (contact?.tags || []).some((x) => String(x).toLowerCase() === t);
}
