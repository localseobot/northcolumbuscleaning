// Builds the comprehensive provider-facing SMS body, pulling together
// everything the cleaner needs to know about a job:
//
//   - Date/time
//   - Customer name + phone
//   - Address (with maps deep-link)
//   - Service type / frequency
//   - Property size (beds / baths / sqft)
//   - Special access (gate code, pets — from contact custom fields)
//   - Customer notes (from BK booking)
//   - Notes from prior Retell calls (from contact notes)
//   - Price (for invoice reference)
//
// SMS will be 2-3 segments — modern carriers concatenate cleanly. We
// prioritize clarity over brevity since cleaners reference this from
// the job site.

import {
  OPP_SERVICE_TYPE,
  OPP_FREQUENCY,
  OPP_SQUARE_FOOTAGE,
  OPP_BEDROOMS,
  OPP_BATHROOMS,
  OPP_QUOTED_PRICE,
  OPP_APPOINTMENT_DATE,
  OPP_PROVIDER_NAME,
  OPP_PROVIDER_PHONE,
  CONTACT_GATE_CODE,
  CONTACT_PETS,
} from "./ghl-fields.js";

function getCf(customFields, fieldId) {
  if (!Array.isArray(customFields)) return null;
  const cf = customFields.find((f) => f.id === fieldId);
  if (!cf) return null;
  if (cf.fieldValueDate) return new Date(cf.fieldValueDate).toISOString();
  return (
    cf.fieldValueString ||
    cf.fieldValueNumber ||
    cf.fieldValue ||
    null
  );
}

function fmtAppointment(value) {
  if (!value) return null;
  try {
    const d = new Date(value);
    if (isNaN(d.getTime())) return String(value);
    return d.toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return String(value);
  }
}

function mapsLink(address) {
  if (!address) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
}

// Strip a contact note down to its first ~250 chars of cleaner-relevant
// content. We skip our own webhook-generated notes ("Booking Koala event:
// booking.created") since the cleaner doesn't need that meta.
function extractCustomerNotesFromContactNotes(notes) {
  if (!Array.isArray(notes) || notes.length === 0) return null;
  for (const note of notes) {
    const body = String(note?.body || note?.bodyText || "").trim();
    if (!body) continue;
    if (body.startsWith("Booking Koala event:")) continue;
    if (body.startsWith("[DEBUG]")) continue;
    // Retell call notes — extract the "Special notes:" / "Summary:" snippets
    if (body.startsWith("Inbound call via")) {
      const specialMatch = body.match(/Special notes?:?\s*([^\n]+)/i);
      if (specialMatch) return specialMatch[1].trim().slice(0, 250);
      const summaryMatch = body.match(/Summary:\s*([\s\S]+?)(?:\n\n|Recording:|$)/i);
      if (summaryMatch)
        return summaryMatch[1].trim().slice(0, 250).replace(/\s+/g, " ");
      continue;
    }
    return body.slice(0, 250).replace(/\s+/g, " ");
  }
  return null;
}

/**
 * Build the comprehensive provider SMS.
 *
 * @param {object} input
 * @param {string} input.providerFirstName  Best name we have for the cleaner
 * @param {object} input.opp                GHL opportunity (with customFields)
 * @param {object} input.contact            GHL contact (with customFields, notes)
 * @param {Array}  [input.contactNotes]     Recent notes on the contact (sorted newest first)
 * @param {string} [input.intro]            Leading line, e.g. "Tomorrow's clean" or "Today, 10am"
 * @returns {string} SMS body
 */
export function buildProviderSms({
  providerFirstName,
  opp,
  contact,
  contactNotes,
  intro,
}) {
  const oppCf = opp?.customFields || [];
  const ctCf = contact?.customFields || [];

  const apptIso = getCf(oppCf, OPP_APPOINTMENT_DATE);
  const apptStr = fmtAppointment(apptIso);
  const service = getCf(oppCf, OPP_SERVICE_TYPE) || "Cleaning";
  const frequency = getCf(oppCf, OPP_FREQUENCY);
  const beds = getCf(oppCf, OPP_BEDROOMS);
  const baths = getCf(oppCf, OPP_BATHROOMS);
  const sqft = getCf(oppCf, OPP_SQUARE_FOOTAGE);
  const price = getCf(oppCf, OPP_QUOTED_PRICE);

  const gateCode = getCf(ctCf, CONTACT_GATE_CODE);
  const pets = getCf(ctCf, CONTACT_PETS);

  const customerName =
    contact?.fullName ||
    [contact?.firstNameRaw, contact?.lastNameRaw].filter(Boolean).join(" ") ||
    contact?.contactName ||
    "Customer";
  const customerPhone = contact?.phone || "";

  const addressParts = [
    contact?.address1,
    contact?.city,
    contact?.state,
    contact?.postalCode,
  ].filter(Boolean);
  const address = addressParts.join(", ");

  const customerNoteFromHistory = extractCustomerNotesFromContactNotes(contactNotes);

  const propParts = [];
  if (beds) propParts.push(`${beds}bd`);
  if (baths) propParts.push(`${baths}ba`);
  if (sqft) propParts.push(`${sqft}sqft`);

  // Compose
  const greeting = providerFirstName ? `Hi ${providerFirstName}, ` : "";
  const lines = [];
  if (intro) lines.push(`🧼 NCC — ${intro}`);
  else lines.push(`🧼 NCC — Upcoming clean`);

  if (apptStr) lines.push(apptStr);
  lines.push("");

  lines.push(`Customer: ${customerName}${customerPhone ? ` (${customerPhone})` : ""}`);
  if (address) lines.push(`Address: ${address}`);
  lines.push("");

  const svcLine = [String(service), frequency ? `(${frequency})` : ""]
    .filter(Boolean)
    .join(" ");
  lines.push(`Service: ${svcLine}`);
  if (propParts.length) lines.push(`Property: ${propParts.join(", ")}`);
  if (price) lines.push(`Price: $${Number(price).toFixed(2)}`);

  if (gateCode || pets) {
    lines.push("");
    lines.push("ACCESS:");
    if (gateCode) lines.push(`- Gate/Code: ${gateCode}`);
    if (pets) lines.push(`- Pets: ${pets}`);
  }

  if (customerNoteFromHistory) {
    lines.push("");
    lines.push("NOTES:");
    lines.push(customerNoteFromHistory);
  }

  const directions = mapsLink(address);
  if (directions) {
    lines.push("");
    lines.push(`Directions: ${directions}`);
  }

  // Prepend greeting only if there's room and a name
  if (greeting) {
    return greeting + lines.join("\n");
  }
  return lines.join("\n");
}
