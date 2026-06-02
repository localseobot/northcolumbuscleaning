// Builds the comprehensive provider-facing SMS body, pulling together
// everything the cleaner needs to know about a job:
//
//   - Date/time
//   - Customer name + phone
//   - Address (with maps deep-link)
//   - Service type / frequency
//   - Property size (beds / baths / sqft)
//   - Special access (gate code, pets — from contact custom fields)
//   - Customer notes (from BK booking + prior Retell calls)
//   - Price (for invoice reference)
//
// Two entry points share the same formatter:
//
//   buildProviderSms({ opp, contact, contactNotes, ... })
//       — used by the day-before / morning crons, pulls from GHL
//
//   buildProviderSmsFromBooking({ booking, ... })
//       — used by handleCreated for the immediate post-booking dispatch,
//         pulls from the raw normalized BK payload (no GHL roundtrip)
//
// SMS will be 2-4 segments — modern carriers concatenate cleanly.

import {
  OPP_SERVICE_TYPE,
  OPP_FREQUENCY,
  OPP_SQUARE_FOOTAGE,
  OPP_BEDROOMS,
  OPP_BATHROOMS,
  OPP_QUOTED_PRICE,
  OPP_APPOINTMENT_DATE,
  CONTACT_GATE_CODE,
  CONTACT_PETS,
} from "./ghl-fields.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function getCf(customFields, fieldId) {
  if (!Array.isArray(customFields)) return null;
  const cf = customFields.find((f) => f.id === fieldId);
  if (!cf) return null;
  if (cf.fieldValueDate) return new Date(cf.fieldValueDate).toISOString();
  return cf.fieldValueString || cf.fieldValueNumber || cf.fieldValue || null;
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

function fmtService(raw) {
  if (!raw) return null;
  const s = String(raw).toLowerCase();
  if (s.includes("deep")) return "Deep";
  if (s.includes("move")) return "Move In/Out";
  if (s.includes("office") || s.includes("commercial")) return "Office";
  if (s.includes("recur")) return "Recurring";
  if (s.includes("standard") || s.includes("residential") || s.includes("house")) {
    return "Standard";
  }
  return String(raw);
}

function fmtFrequency(raw) {
  if (!raw) return null;
  const s = String(raw).toLowerCase();
  if (s.includes("3") && s.includes("week")) return "Every 3 weeks";
  if (s.includes("bi") || s.includes("2week")) return "Biweekly";
  if (s.includes("week")) return "Weekly";
  if (s.includes("month") || s.includes("4week")) return "Monthly";
  if (s.includes("one") || s === "once") return "One-time";
  return String(raw);
}

// Pull cleaner-relevant content from contact notes. Skip system-generated
// notes (BK event meta, [DEBUG], ⚠️ negative-feedback).
function extractRetellNotesFromContactNotes(notes) {
  if (!Array.isArray(notes) || notes.length === 0) return null;
  for (const note of notes) {
    const body = String(note?.body || note?.bodyText || "").trim();
    if (!body) continue;
    if (body.startsWith("Booking Koala event:")) continue;
    if (body.startsWith("[DEBUG]")) continue;
    if (body.startsWith("⚠️") || body.includes("Negative-experience feedback")) continue;
    if (body.startsWith("Inbound call via")) {
      const specialMatch = body.match(/Special notes?:?\s*([^\n]+)/i);
      if (specialMatch) return specialMatch[1].trim().slice(0, 250);
      const summaryMatch = body.match(/Summary:\s*([\s\S]+?)(?:\n\n|Recording:|$)/i);
      if (summaryMatch) return summaryMatch[1].trim().slice(0, 250).replace(/\s+/g, " ");
      continue;
    }
    return body.slice(0, 250).replace(/\s+/g, " ");
  }
  return null;
}

// ─── Shape extraction ───────────────────────────────────────────────────────

// Plain shape that the formatter operates on. Both extractors normalize
// into this so the formatter is the single source of truth for layout.
function extractShapeFromOpp(opp, contact, contactNotes) {
  const oppCf = opp?.customFields || [];
  const ctCf = contact?.customFields || [];
  return {
    customerName:
      [contact?.firstNameRaw, contact?.lastNameRaw].filter(Boolean).join(" ") ||
      [contact?.firstName, contact?.lastName].filter(Boolean).join(" ") ||
      contact?.fullNameLowerCase ||
      contact?.contactName ||
      contact?.fullName ||
      contact?.name ||
      "Customer",
    customerPhone: contact?.phone || "",
    address:
      [contact?.address1, contact?.city, contact?.state, contact?.postalCode]
        .filter(Boolean)
        .join(", ") || "",
    appointmentDateTime: getCf(oppCf, OPP_APPOINTMENT_DATE),
    service: getCf(oppCf, OPP_SERVICE_TYPE),
    frequency: getCf(oppCf, OPP_FREQUENCY),
    bedrooms: getCf(oppCf, OPP_BEDROOMS),
    bathrooms: getCf(oppCf, OPP_BATHROOMS),
    sqft: getCf(oppCf, OPP_SQUARE_FOOTAGE),
    price: getCf(oppCf, OPP_QUOTED_PRICE),
    gateCode: getCf(ctCf, CONTACT_GATE_CODE),
    pets: getCf(ctCf, CONTACT_PETS),
    customerNotes: extractRetellNotesFromContactNotes(contactNotes),
  };
}

function extractShapeFromBooking(b) {
  if (!b) return {};
  const s = (v) => (v === null || v === undefined ? "" : String(v).trim());
  const num = (v) => {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    const cleaned = String(v).replace(/[$,£€¥%\s]/g, "");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  };
  const firstName = s(b.first_name || b.firstName);
  const lastName = s(b.last_name || b.lastName);
  return {
    customerName: [firstName, lastName].filter(Boolean).join(" ") || s(b.name) || "Customer",
    customerPhone: s(b.phone),
    address: [s(b.address), s(b.city), s(b.state), s(b.zip)].filter(Boolean).join(", "),
    appointmentDateTime: s(b.appointment_datetime),
    service: s(b.service_type || b.service),
    frequency: s(b.frequency),
    bedrooms: num(b.bedrooms),
    bathrooms: num(b.bathrooms),
    sqft: num(b.sqft || b.square_feet),
    price: num(b.price_total || b.total || b.price),
    gateCode: null,    // Not in BK payload — pulled from contact custom field later
    pets: null,        // Same
    customerNotes: s(b.notes || b.special_notes) || null,
  };
}

// ─── Formatter ──────────────────────────────────────────────────────────────

function formatProviderSms(shape) {
  const {
    providerFirstName,
    customerName,
    customerPhone,
    address,
    appointmentDateTime,
    service,
    frequency,
    bedrooms,
    bathrooms,
    sqft,
    price,
    gateCode,
    pets,
    customerNotes,
    intro,
  } = shape;

  const apptStr = fmtAppointment(appointmentDateTime);
  const svc = fmtService(service);
  const freq = fmtFrequency(frequency);
  const propParts = [];
  if (bedrooms) propParts.push(`${bedrooms}bd`);
  if (bathrooms) propParts.push(`${bathrooms}ba`);
  if (sqft) propParts.push(`${sqft}sqft`);

  const lines = [];
  if (providerFirstName) {
    lines.push(`Hi ${providerFirstName}, 🧼 NCC — ${intro || "Upcoming clean"}`);
  } else {
    lines.push(`🧼 NCC — ${intro || "Upcoming clean"}`);
  }
  if (apptStr) lines.push(apptStr);
  lines.push("");

  lines.push(`Customer: ${customerName}${customerPhone ? ` (${customerPhone})` : ""}`);
  if (address) lines.push(`Address: ${address}`);
  lines.push("");

  const svcLine = [svc, freq ? `(${freq})` : ""].filter(Boolean).join(" ");
  if (svcLine.trim()) lines.push(`Service: ${svcLine}`);
  if (propParts.length) lines.push(`Property: ${propParts.join(", ")}`);
  if (price) lines.push(`Price: $${Number(price).toFixed(2)}`);

  if (gateCode || pets) {
    lines.push("");
    lines.push("ACCESS:");
    if (gateCode) lines.push(`- Gate/Code: ${gateCode}`);
    if (pets) lines.push(`- Pets: ${pets}`);
  }

  if (customerNotes) {
    lines.push("");
    lines.push("NOTES:");
    lines.push(customerNotes);
  }

  const directions = mapsLink(address);
  if (directions) {
    lines.push("");
    lines.push(`Directions: ${directions}`);
  }

  return lines.join("\n");
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Build the provider SMS from a GHL opportunity + contact + notes. Used by
 * the day-before-evening and morning-of cron jobs.
 */
export function buildProviderSms({
  providerFirstName,
  opp,
  contact,
  contactNotes,
  intro,
}) {
  const shape = extractShapeFromOpp(opp, contact, contactNotes);
  return formatProviderSms({ ...shape, providerFirstName, intro });
}

/**
 * Build the provider SMS from the raw normalized BK booking payload. Used
 * by handleCreated for the immediate-on-booking dispatch (no GHL roundtrip
 * needed; data is already in hand).
 */
export function buildProviderSmsFromBooking({
  providerFirstName,
  booking,
  intro,
}) {
  const shape = extractShapeFromBooking(booking);
  return formatProviderSms({ ...shape, providerFirstName, intro });
}
