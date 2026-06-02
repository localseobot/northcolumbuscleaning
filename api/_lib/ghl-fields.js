// GHL custom field IDs for North Columbus Cleaning.
// Source of truth: voice-agent/ghl-field-ids.json
//
// Naming convention: SCREAMING_SNAKE for the field-key constants,
// grouped by model ("OPP_*" or "CONTACT_*").
//
// Setting opportunity custom fields:
//   await ghl({ method: "PUT", path: `/opportunities/${oppId}`, body: {
//     customFields: [{ id: OPP_SERVICE_TYPE, key: "service_type", field_value: "Deep" }]
//   }});
//
// Setting contact custom fields uses contact.customFields the same way.

// ── Opportunity ────────────────────────────────────────────────────────────
export const OPP_SERVICE_TYPE = "E2Bh43nuHLeR7pLewBoU";
export const OPP_FREQUENCY = "Bq6J61VYXz1uVWV4GOT1";
export const OPP_SQUARE_FOOTAGE = "w079jKRYalPH42AcpgP1";
export const OPP_BEDROOMS = "vYkGR1dkB7ZjHjvC7yY4";
export const OPP_BATHROOMS = "L1M8gcHUS1jLUNaLNpkU";
export const OPP_QUOTED_PRICE = "j5fbTWAKZFS2F9jwlYss";
export const OPP_APPOINTMENT_DATE = "f0kFsl9R7qqvH2NJonUf";
export const OPP_LEAD_SOURCE = "f18VFRw0fSCjdH2aQHNx";
// Lost Reason is a GHL built-in STANDARD_FIELD — set via opportunity.lostReasonId
// on the opportunity update when status === "lost". See:
// https://highlevel.stoplight.io/docs/integrations/3c0a52e8a26b3-update-opportunity
export const OPP_LOST_REASON_ID = "3GuRvwNmfbdpxBwnlBNe";

// ── Contact ────────────────────────────────────────────────────────────────
export const CONTACT_GATE_CODE = "N9nprluvSbdcAsMe5lzw";
export const CONTACT_PETS = "ffaJWuTCjxbNr9I4ZBB8";
export const CONTACT_PREFERRED_CLEANER = "kCUfiZjJJ8NqmtBbULLV";
export const CONTACT_LTV = "8tGAElu4Z4GODFH9RF1h";

// ── Dropdown option canonical values (match exactly what GHL stores) ───────
export const SERVICE_TYPE_OPTIONS = {
  STANDARD: "Standard",
  DEEP: "Deep",
  MOVE_IN_OUT: "Move In/Out",
  RECURRING: "Recurring",
  OFFICE: "Office",
};

export const FREQUENCY_OPTIONS = {
  ONE_TIME: "One-time",
  WEEKLY: "Weekly",
  BIWEEKLY: "Biweekly",
  EVERY_3_WEEKS: "Every 3 weeks",
  MONTHLY: "Monthly",
};

export const LEAD_SOURCE_OPTIONS = {
  RETELL_CALL: "Retell call",
  WEB_FORM: "Web form",
  BOOKING_KOALA: "Booking Koala",
  REFERRAL: "Referral",
  GOOGLE: "Google",
  FACEBOOK: "Facebook",
  OTHER: "Other",
};

// ── Normalizers: map raw payload strings to canonical dropdown values ──────
// Returns null if no match (caller should skip the field rather than set bad data).

export function normalizeServiceType(raw) {
  if (!raw) return null;
  const s = String(raw).toLowerCase().replace(/[\s_-]+/g, "");
  if (s.includes("deep")) return SERVICE_TYPE_OPTIONS.DEEP;
  if (s.includes("move")) return SERVICE_TYPE_OPTIONS.MOVE_IN_OUT;
  if (s.includes("office") || s.includes("commercial"))
    return SERVICE_TYPE_OPTIONS.OFFICE;
  if (s.includes("recur") || s.includes("regular"))
    return SERVICE_TYPE_OPTIONS.RECURRING;
  if (s.includes("standard") || s.includes("residential"))
    return SERVICE_TYPE_OPTIONS.STANDARD;
  return null;
}

export function normalizeFrequency(raw) {
  if (!raw) return null;
  const s = String(raw).toLowerCase().replace(/[\s_-]+/g, "");
  if (s.includes("week") && !s.includes("bi") && !s.includes("3"))
    return FREQUENCY_OPTIONS.WEEKLY;
  if (s.includes("bi") || s.includes("twoweek") || s.includes("2week"))
    return FREQUENCY_OPTIONS.BIWEEKLY;
  if (s.includes("3week") || s.includes("threeweek") || s.includes("every3"))
    return FREQUENCY_OPTIONS.EVERY_3_WEEKS;
  if (s.includes("month")) return FREQUENCY_OPTIONS.MONTHLY;
  if (s.includes("onetime") || s === "once") return FREQUENCY_OPTIONS.ONE_TIME;
  return null;
}

// ── Helper to build a customFields[] entry safely ──────────────────────────
// Skips entries where value is null/undefined/"" so we don't overwrite
// existing data with blanks.
export function cf(id, value) {
  if (value === null || value === undefined || value === "") return null;
  return { id, field_value: value };
}

// Convenience: filters out nulls from cf() calls so callers can do
// `customFields: cfArray([cf(A, x), cf(B, y)])`
export function cfArray(entries) {
  return entries.filter(Boolean);
}
