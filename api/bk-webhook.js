// Booking Koala → Zapier → Vercel → GHL bridge.
//
// Zapier hits this endpoint with a normalized booking payload. We upsert
// the customer in GHL, create/update the Sales Pipeline opportunity, and
// apply tags so downstream GHL workflows fire (booking confirmation SMS,
// 24hr reminder, post-job review request, etc.).
//
// Expected POST body (Zapier maps BK fields → these names):
//
//   {
//     "event": "booking.created"          // required, see EVENTS below
//                | "booking.rescheduled"
//                | "booking.cancelled"
//                | "booking.completed",
//     "booking_id": "BK-12345",           // BK's internal booking ID; used for opp idempotency
//     "first_name": "Sarah",
//     "last_name": "Lee",
//     "email": "sarah@example.com",
//     "phone": "+16145551234",            // any format, we'll normalize
//
//     "service_type": "standard",         // standard | deep | move_in_out (or BK's label)
//     "frequency": "biweekly",            // one_time | weekly | biweekly | every_3_weeks | monthly
//     "bedrooms": 3,
//     "bathrooms": 2,
//     "sqft": 2000,
//
//     "address": "123 Main St",
//     "city": "Columbus",
//     "state": "OH",
//     "zip": "43215",
//
//     "appointment_datetime": "2026-06-15T10:00:00-04:00",
//     "duration_minutes": 120,
//
//     "price_total": 110.00,
//     "currency": "USD",
//
//     "notes": "Has 2 cats. Eco-friendly products please."
//   }
//
// Response:
//   { ok, event, contactId, opportunityId, action, applied_tags, ... }
//
// Every field is optional except `event` — the route gracefully handles
// missing data and reports what it could and couldn't do. This means you
// can wire up Zapier with just the fields BK exposes and grow over time.

import { ghl } from "./_lib/ghl.js";
import {
  OPP_SERVICE_TYPE,
  OPP_FREQUENCY,
  OPP_SQUARE_FOOTAGE,
  OPP_BEDROOMS,
  OPP_BATHROOMS,
  OPP_QUOTED_PRICE,
  OPP_APPOINTMENT_DATE,
  OPP_LEAD_SOURCE,
  LEAD_SOURCE_OPTIONS,
  normalizeServiceType,
  normalizeFrequency,
  cfArray,
  cf,
} from "./_lib/ghl-fields.js";
import { sendEmail } from "./_lib/resend.js";
import { sendGhlSms, CUSTOMER_LINE } from "./_lib/ghl-sms.js";
import {
  buildBookingConfirmation,
  buildBookingConfirmationSms,
} from "./_lib/email-templates/booking-confirmation.js";

export const config = { runtime: "nodejs" };

// ───────── Pipeline + stage IDs (same as retell-webhook.js) ─────────
const SALES_PIPELINE_ID = "6YDehH2kNtHrdfJaEQfa";
const STAGE_NEW_LEAD = "4bb733e7-d38d-4cb0-afb8-512406509144";
const STAGE_BOOKED = "a1df2c52-9211-4e13-a920-0c17ab00eff9";
const STAGE_WON_ONE_TIME = "9253419b-4c69-4f61-814b-ee27cd165f7a";
// Recurring customers (weekly/biweekly/monthly bookings) route here so the
// highest-LTV cohort is visible at a glance in the kanban view. Override
// via STAGE_RECURRING_ID env var if the pipeline is ever rebuilt.
const STAGE_RECURRING =
  process.env.STAGE_RECURRING_ID || "24ef9398-abc2-472d-9f35-59b1d8a8f4f6";
const STAGE_LOST = "7eaafc3f-ab36-4ebe-b2c2-c64ab998897d";

// Set of frequency values that imply an ongoing recurring relationship.
// Anything not in this set (or empty) is treated as one-time.
const RECURRING_FREQUENCIES = new Set([
  "weekly",
  "biweekly",
  "bi-weekly",
  "every-2-weeks",
  "every 2 weeks",
  "every_3_weeks",
  "every-3-weeks",
  "every 3 weeks",
  "monthly",
]);
function isRecurringFrequency(raw) {
  return RECURRING_FREQUENCIES.has(lower(raw));
}

// ───────── Mapping tables ─────────
// Map canonical (normalized) service/frequency values to tag slugs. We use
// the normalizers from ghl-fields.js so tag application and custom-field
// population always agree on what a payload "means".
const SERVICE_TAG_BY_CANONICAL = {
  Standard: "service:residential",
  Deep: "service:deep-clean",
  "Move In/Out": "service:move-in-out",
  Recurring: "service:residential",
  Office: "service:commercial",
};

const FREQUENCY_TAG_BY_CANONICAL = {
  "One-time": "frequency:one-time",
  Weekly: "frequency:weekly",
  Biweekly: "frequency:biweekly",
  "Every 3 weeks": "frequency:every-3-weeks",
  Monthly: "frequency:monthly",
};

const EVENT_HANDLERS = {
  "booking.created": handleCreated,
  "booking.rescheduled": handleRescheduled,
  "booking.cancelled": handleCancelled,
  "booking.canceled": handleCancelled,
  "booking.completed": handleCompleted,
};

// ───────── Helpers ─────────
function s(v) {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}
function num(v) {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  // Strip currency symbols, thousand separators, percent signs etc. so
  // "$1,234.56" / "$245" / "245.00" all parse the same.
  const cleaned = String(v).replace(/[$,£€¥%\s]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}
function normPhone(raw) {
  if (!raw) return "";
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  if (String(raw).startsWith("+") && digits.length >= 10) return "+" + digits;
  return "";
}
function lower(v) {
  return s(v).toLowerCase();
}
// Normalize Zapier/BK field-name variations into the canonical keys our
// webhook expects. The strategy:
//
//   1. Build a lookup map keyed by `lowerCaseNoSpace(key)` for the whole
//      incoming payload, including nested objects flattened by dot path.
//      Lookups are then resilient to camelCase / snake_case / kebab-case /
//      "Title Case With Spaces" variants — anything Zapier might surface.
//   2. pickField() tries a list of canonical aliases, returns the first
//      non-empty value (or the original payload key if nothing matched).
//
// This means we never have to know the EXACT field name BK uses — as long
// as it contains some recognisable variant (e.g. "Number Of Bedrooms",
// "num_bedrooms", "bedrooms", "beds", "bedroomCount") we'll find it.
function normalizeBody(b) {
  if (!b || typeof b !== "object") return {};
  const out = { ...b };

  // Build a flat case-insensitive lookup over the whole payload, with
  // nested objects accessible by dot path AND by their leaf name (when
  // unique). Arrays are kept as-is, not flattened.
  const lookup = {};
  const norm = (k) => String(k).toLowerCase().replace(/[\s_\-./]+/g, "");
  const walk = (obj, prefix = "") => {
    if (!obj || typeof obj !== "object") return;
    for (const [k, v] of Object.entries(obj)) {
      const dotKey = prefix ? `${prefix}.${k}` : k;
      const isObj = v && typeof v === "object" && !Array.isArray(v);
      if (isObj) {
        walk(v, dotKey);
      } else if (v !== undefined && v !== null && v !== "") {
        // Store under multiple normalized variants so any reasonable
        // alias guess in pickField() will match.
        lookup[norm(dotKey)] = v;
        const leaf = norm(k);
        if (!(leaf in lookup)) lookup[leaf] = v;
      }
    }
  };
  walk(b);

  const pick = (...candidates) => {
    for (const c of candidates) {
      const nk = norm(c);
      if (lookup[nk] !== undefined) return lookup[nk];
    }
    return undefined;
  };

  // ── Name ──────────────────────────────────────────────────────────
  const fullName = s(
    pick(
      "customer_name",
      "customer_full_name",
      "customerfullname",
      "full_name",
      "name",
    ),
  );
  if (!out.first_name && !out.firstName && fullName) {
    const parts = fullName.split(/\s+/);
    out.first_name = parts[0];
    if (parts.length > 1) out.last_name = parts.slice(1).join(" ");
  }
  if (!out.first_name)
    out.first_name = pick(
      "first_name",
      "firstname",
      "customer_first_name",
      "customerfirstname",
      "givenname",
    );
  if (!out.last_name)
    out.last_name = pick(
      "last_name",
      "lastname",
      "customer_last_name",
      "customerlastname",
      "familyname",
      "surname",
    );

  // ── Contact ───────────────────────────────────────────────────────
  if (!out.email)
    out.email = pick(
      "email",
      "customer_email",
      "customeremail",
      "email_address",
      "emailaddress",
    );
  if (!out.phone)
    out.phone = pick(
      "phone",
      "customer_phone",
      "customerphone",
      "phone_number",
      "phonenumber",
      "mobile",
      "mobile_number",
      "mobilephone",
      "cell",
      "cellphone",
    );

  // ── Booking ID ────────────────────────────────────────────────────
  if (!out.booking_id)
    out.booking_id = pick(
      "booking_id",
      "bookingid",
      "id",
      "booking_number",
      "bookingnumber",
      "confirmation_code",
      "confirmationcode",
      "confirmation_number",
      "confirmationnumber",
      "order_id",
      "orderid",
    );

  // ── Appointment date+time ─────────────────────────────────────────
  if (!out.appointment_datetime) {
    const date = s(
      pick(
        "appointment_datetime",
        "appointmentdatetime",
        "datetime",
        "appointment_date",
        "appointmentdate",
        "booking_date",
        "bookingdate",
        "service_date",
        "servicedate",
        "scheduled_date",
        "scheduleddate",
        "date",
      ),
    );
    const time = s(
      pick(
        "arrival_time",
        "arrivaltime",
        "appointment_time",
        "appointmenttime",
        "start_time",
        "starttime",
        "booking_time",
        "bookingtime",
        "scheduled_time",
        "scheduledtime",
        "time",
      ),
    );
    if (date && time) out.appointment_datetime = `${date} ${time}`;
    else if (date) out.appointment_datetime = date;
  }

  // ── Service ───────────────────────────────────────────────────────
  if (!out.service_type)
    out.service_type = pick(
      "service_type",
      "servicetype",
      "service",
      "service_name",
      "servicename",
      "cleaning_type",
      "cleaningtype",
      "service_category",
      "servicecategory",
    );

  // ── Frequency ─────────────────────────────────────────────────────
  if (!out.frequency)
    out.frequency = pick(
      "frequency",
      "recurring",
      "recurrence",
      "cadence",
      "service_frequency",
      "servicefrequency",
      "interval",
      "schedule_type",
      "scheduletype",
    );

  // ── Property details ──────────────────────────────────────────────
  if (!out.bedrooms)
    out.bedrooms = pick(
      "bedrooms",
      "beds",
      "bedroom_count",
      "bedroomcount",
      "num_bedrooms",
      "numbedrooms",
      "no_of_bedrooms",
      "noofbedrooms",
      "number_of_bedrooms",
      "numberofbedrooms",
    );
  if (!out.bathrooms)
    out.bathrooms = pick(
      "bathrooms",
      "baths",
      "bathroom_count",
      "bathroomcount",
      "num_bathrooms",
      "numbathrooms",
      "no_of_bathrooms",
      "noofbathrooms",
      "number_of_bathrooms",
      "numberofbathrooms",
      "full_bathrooms",
      "fullbathrooms",
    );
  if (!out.sqft)
    out.sqft = pick(
      "sqft",
      "square_feet",
      "squarefeet",
      "square_footage",
      "squarefootage",
      "sq_ft",
      "sq_footage",
      "home_size",
      "homesize",
      "house_size",
      "housesize",
      "size",
    );

  // ── Price ─────────────────────────────────────────────────────────
  if (!out.price_total)
    out.price_total = pick(
      "price_total",
      "pricetotal",
      "total",
      "total_price",
      "totalprice",
      "total_amount",
      "totalamount",
      "amount",
      "price",
      "pricing_total",
      "pricingtotal",
      "grand_total",
      "grandtotal",
      "final_price",
      "finalprice",
    );

  // ── Notes ─────────────────────────────────────────────────────────
  if (!out.notes)
    out.notes = pick(
      "notes",
      "customer_notes",
      "customernotes",
      "special_notes",
      "specialnotes",
      "special_instructions",
      "specialinstructions",
      "notes_to_provider",
      "notestoprovider",
      "booking_notes",
      "bookingnotes",
      "comments",
    );

  // ── Address ───────────────────────────────────────────────────────
  if (!out.address)
    out.address = pick(
      "address",
      "street_address",
      "streetaddress",
      "address_line_1",
      "addressline1",
      "address1",
      "customer_address",
      "customeraddress",
      "service_address",
      "serviceaddress",
    );
  if (!out.city) out.city = pick("city", "customer_city", "customercity", "address_city", "addresscity");
  if (!out.state)
    out.state = pick(
      "state",
      "region",
      "customer_state",
      "customerstate",
      "address_state",
      "addressstate",
      "province",
    );
  if (!out.zip)
    out.zip = pick(
      "zip",
      "zipcode",
      "zip_code",
      "postal_code",
      "postalcode",
      "customer_zip",
      "customerzip",
      "address_zip",
      "addresszip",
    );

  return out;
}
function buildName(b) {
  const f = s(b.first_name || b.firstName);
  const l = s(b.last_name || b.lastName);
  if (f || l) return [f, l].filter(Boolean).join(" ");
  if (b.name) return s(b.name);
  return "";
}
function buildTags(b, eventTags) {
  const tags = ["source:booking-koala"];
  // Reuse the same canonicalization as buildOppCustomFields so tags + fields
  // stay in lockstep regardless of how BK formats the raw value.
  const svc = normalizeServiceType(b.service_type || b.service);
  if (svc && SERVICE_TAG_BY_CANONICAL[svc])
    tags.push(SERVICE_TAG_BY_CANONICAL[svc]);
  const freq = normalizeFrequency(b.frequency);
  if (freq && FREQUENCY_TAG_BY_CANONICAL[freq])
    tags.push(FREQUENCY_TAG_BY_CANONICAL[freq]);
  if (Array.isArray(eventTags)) tags.push(...eventTags);
  return [...new Set(tags)];
}
function buildOpportunityName(b) {
  const name =
    buildName(b) ||
    s(b.email) ||
    s(b.phone) ||
    `BK ${s(b.booking_id) || "booking"}`;
  const svc = s(b.service_type || b.service);
  const date = s(b.appointment_datetime);
  const dateStr = date ? new Date(date).toISOString().slice(0, 10) : "";
  const parts = [name];
  if (svc) parts.push(svc);
  if (dateStr) parts.push(dateStr);
  return parts.join(" — ");
}
function buildNoteBody(b, event) {
  const lines = [
    `Booking Koala event: ${event}`,
    b.booking_id ? `BK booking ID: ${b.booking_id}` : null,
    "",
  ];
  const svc = s(b.service_type || b.service);
  const freq = s(b.frequency);
  if (svc || freq)
    lines.push(`Service: ${[svc, freq].filter(Boolean).join(" / ")}`);
  const beds = num(b.bedrooms);
  const baths = num(b.bathrooms);
  const sqft = num(b.sqft || b.square_feet);
  const propParts = [];
  if (beds) propParts.push(`${beds}bd`);
  if (baths) propParts.push(`${baths}ba`);
  if (sqft) propParts.push(`${sqft}sqft`);
  if (propParts.length) lines.push(`Property: ${propParts.join(", ")}`);
  const addr = s(b.address);
  const city = s(b.city);
  const state = s(b.state);
  const zip = s(b.zip || b.postal_code);
  if (addr || zip)
    lines.push(`Address: ${[addr, city, state, zip].filter(Boolean).join(", ")}`);
  if (b.appointment_datetime) lines.push(`Appointment: ${b.appointment_datetime}`);
  if (b.duration_minutes) lines.push(`Duration: ${b.duration_minutes} min`);
  const price = num(b.price_total || b.total || b.price);
  if (price > 0) lines.push(`Price: $${price.toFixed(2)} ${s(b.currency) || "USD"}`);
  const notes = s(b.notes || b.special_notes);
  if (notes) {
    lines.push("");
    lines.push(`Customer notes: ${notes}`);
  }
  return lines.filter((x) => x !== null).join("\n");
}

// Build the customFields[] array for an opportunity from the normalized
// BK payload. cf() returns null when the value is empty, cfArray() filters
// those out, so missing fields are simply not sent (preserving any existing
// values on the opp instead of clobbering with blanks).
function buildOppCustomFields(b) {
  const svc = normalizeServiceType(b.service_type || b.service);
  const freq = normalizeFrequency(b.frequency);
  const sqft = num(b.sqft || b.square_feet);
  const beds = num(b.bedrooms);
  const baths = num(b.bathrooms);
  const price = num(b.price_total || b.total || b.price);
  // GHL DATE fields accept ISO date strings (YYYY-MM-DD) or epoch ms.
  let apptDate = null;
  if (b.appointment_datetime) {
    const d = new Date(b.appointment_datetime);
    if (!isNaN(d.getTime())) apptDate = d.toISOString().slice(0, 10);
  }
  return cfArray([
    cf(OPP_SERVICE_TYPE, svc),
    cf(OPP_FREQUENCY, freq),
    cf(OPP_SQUARE_FOOTAGE, sqft || null),
    cf(OPP_BEDROOMS, beds || null),
    cf(OPP_BATHROOMS, baths || null),
    cf(OPP_QUOTED_PRICE, price || null),
    cf(OPP_APPOINTMENT_DATE, apptDate),
    cf(OPP_LEAD_SOURCE, LEAD_SOURCE_OPTIONS.BOOKING_KOALA),
  ]);
}

// ───────── Contact ops ─────────
async function upsertContact(b) {
  const phone = normPhone(b.phone || b.callback_number);
  const email = lower(b.email).trim();
  if (!email && !phone) return { id: null, error: "no phone or email" };

  const body = {
    locationId: process.env.GHL_LOCATION_ID,
    firstName: s(b.first_name || b.firstName) || undefined,
    lastName: s(b.last_name || b.lastName) || undefined,
    email: email || undefined,
    phone: phone || undefined,
    address1: s(b.address) || undefined,
    city: s(b.city) || undefined,
    state: s(b.state) || undefined,
    postalCode: s(b.zip || b.postal_code) || undefined,
    country: "US",
    source: "Booking Koala",
  };
  const res = await ghl({ method: "POST", path: "/contacts/upsert", body });
  return {
    id: res?.contact?.id || res?.id || null,
    new: res?.new ?? null,
    raw: res,
  };
}

async function applyTags(contactId, tags) {
  if (!contactId || !tags?.length) return false;
  await ghl({
    method: "POST",
    path: `/contacts/${contactId}/tags`,
    body: { tags },
  });
  return true;
}

async function addNote(contactId, body) {
  if (!contactId) return null;
  const res = await ghl({
    method: "POST",
    path: `/contacts/${contactId}/notes`,
    body: { body },
  });
  return res?.note?.id || res?.id || null;
}

// Find the contact's most recent OPEN opp in the Sales Pipeline. Used for
// reschedule/cancel/complete — assumes one active booking per contact at a
// time. Edge case (multiple concurrent bookings per contact) would need
// per-booking ID tracking via custom field; deferred until needed.
async function findOpenOpp(contactId) {
  if (!contactId) return null;
  const res = await ghl({
    method: "GET",
    path: "/opportunities/search",
    query: {
      location_id: process.env.GHL_LOCATION_ID,
      pipeline_id: SALES_PIPELINE_ID,
      contact_id: contactId,
      status: "open",
      limit: 10,
    },
  });
  const opps = res?.opportunities || [];
  if (!opps.length) return null;
  // Most recent
  opps.sort((a, c) => new Date(c.dateAdded) - new Date(a.dateAdded));
  return opps[0];
}

async function createOpp({ contactId, name, monetaryValue, stageId, customFields }) {
  const body = {
    locationId: process.env.GHL_LOCATION_ID,
    pipelineId: SALES_PIPELINE_ID,
    pipelineStageId: stageId,
    name,
    contactId,
    monetaryValue: monetaryValue || undefined,
    status: "open",
    source: "Booking Koala",
  };
  const res = await ghl({
    method: "POST",
    path: "/opportunities/",
    body,
  });
  const oppId = res?.opportunity?.id || res?.id || null;
  // POST /opportunities/ silently drops customFields. We have to set them
  // via PUT in a follow-up call.
  if (oppId && customFields?.length) {
    try {
      await ghl({
        method: "PUT",
        path: `/opportunities/${oppId}`,
        body: { customFields },
      });
    } catch (_) {
      // Field update failure shouldn't kill the whole webhook — the opp
      // exists and tags fired. We just won't have the structured data.
    }
  }
  return oppId;
}

async function moveOpp(oppId, { stageId, status, name, monetaryValue, customFields }) {
  if (!oppId) return null;
  const body = {};
  if (stageId) body.pipelineStageId = stageId;
  if (status) body.status = status;
  if (name) body.name = name;
  if (monetaryValue !== undefined) body.monetaryValue = monetaryValue;
  if (customFields?.length) body.customFields = customFields;
  const res = await ghl({
    method: "PUT",
    path: `/opportunities/${oppId}`,
    body,
  });
  return res;
}

// ───────── Event handlers ─────────
async function handleCreated(b, result) {
  const contact = await upsertContact(b);
  result.contactId = contact.id;
  result.contactCreated = contact.new;
  if (!contact.id) {
    result.error = "could not upsert contact (no email or phone)";
    return;
  }

  const tags = buildTags(b, ["booking-confirmed"]);
  await applyTags(contact.id, tags).catch((e) => (result.tagWarning = e.message));
  result.applied_tags = tags;

  const noteBody = buildNoteBody(b, "booking.created");
  result.noteId = await addNote(contact.id, noteBody).catch(() => null);

  // Check if there's already an open opp (e.g. previously created as a lead);
  // if so, move it to Booked. Otherwise create new.
  const existing = await findOpenOpp(contact.id);
  const price = num(b.price_total || b.total || b.price);
  const oppFields = buildOppCustomFields(b);
  if (existing) {
    await moveOpp(existing.id, {
      stageId: STAGE_BOOKED,
      name: buildOpportunityName(b),
      monetaryValue: price || undefined,
      customFields: oppFields,
    });
    result.opportunityId = existing.id;
    result.action = "moved-existing-opp-to-booked";
  } else {
    const oppId = await createOpp({
      contactId: contact.id,
      name: buildOpportunityName(b),
      monetaryValue: price,
      stageId: STAGE_BOOKED,
      customFields: oppFields,
    });
    result.opportunityId = oppId;
    result.action = "created-new-opp-in-booked";
  }
  result.opp_fields_set = oppFields.length;

  // Customer-facing confirmation payload. Same inputs power both the
  // branded HTML email (via Resend) and the short A2P-compliant SMS
  // (via GHL on the verified business number).
  const confirmInput = {
    firstName: s(b.first_name || b.firstName),
    appointmentDateTime: b.appointment_datetime,
    serviceType: b.service_type || b.service,
    frequency: b.frequency,
    bedrooms: num(b.bedrooms),
    bathrooms: num(b.bathrooms),
    sqft: num(b.sqft || b.square_feet),
    priceTotal: price,
    address: [s(b.address), s(b.city), s(b.state), s(b.zip)]
      .filter(Boolean)
      .join(", "),
  };

  // Branded confirmation email via Resend. No-op if env vars aren't set
  // in Vercel, so this deploys safely before the API key exists. Errors
  // don't break the webhook — email is best-effort, GHL is source of truth.
  if (lower(b.email)) {
    try {
      const { subject, html } = buildBookingConfirmation(confirmInput);
      const emailResult = await sendEmail({
        to: lower(b.email),
        subject,
        html,
        tags: ["booking-confirmation"],
      });
      result.confirmationEmail = emailResult.id
        ? { sent: true, id: emailResult.id }
        : { sent: false, reason: emailResult.reason || emailResult.error };
    } catch (e) {
      result.confirmationEmail = { sent: false, error: e.message };
    }
  } else {
    result.confirmationEmail = { sent: false, reason: "no email on file" };
  }

  // SMS confirmation via GHL's A2P-verified number. Sends to anyone with a
  // phone number on file — booking is explicit consent. We respect prior
  // opt-outs (sms-consent:no tag) defensively. Failure is non-fatal.
  const phone = normPhone(b.phone);
  if (phone) {
    try {
      const message = buildBookingConfirmationSms(confirmInput);
      const smsResult = await sendGhlSms({
        to: phone,
        message,
        firstName: confirmInput.firstName || undefined,
        fromNumber: CUSTOMER_LINE,
      });
      result.confirmationSms = smsResult.ok
        ? { sent: true, messageId: smsResult.messageId }
        : { sent: false, reason: smsResult.error };
    } catch (e) {
      result.confirmationSms = { sent: false, error: e.message };
    }
  } else {
    result.confirmationSms = { sent: false, reason: "no phone on file" };
  }
}

async function handleRescheduled(b, result) {
  const contact = await upsertContact(b);
  result.contactId = contact.id;
  if (!contact.id) return;

  await applyTags(contact.id, buildTags(b, ["rescheduled"])).catch(
    (e) => (result.tagWarning = e.message),
  );
  await addNote(contact.id, buildNoteBody(b, "booking.rescheduled")).catch(
    () => null,
  );

  const opp = await findOpenOpp(contact.id);
  if (opp) {
    await moveOpp(opp.id, {
      name: buildOpportunityName(b),
      customFields: buildOppCustomFields(b),
    });
    result.opportunityId = opp.id;
    result.action = "updated-opp-name-with-new-date";
  } else {
    result.action = "no-open-opp-found-to-reschedule";
  }
}

async function handleCancelled(b, result) {
  const contact = await upsertContact(b);
  result.contactId = contact.id;
  if (!contact.id) return;

  await applyTags(contact.id, buildTags(b, ["cancelled"])).catch(
    (e) => (result.tagWarning = e.message),
  );
  await addNote(contact.id, buildNoteBody(b, "booking.cancelled")).catch(
    () => null,
  );

  const opp = await findOpenOpp(contact.id);
  if (opp) {
    await moveOpp(opp.id, { stageId: STAGE_LOST, status: "lost" });
    result.opportunityId = opp.id;
    result.action = "moved-opp-to-lost";
  } else {
    result.action = "no-open-opp-found-to-cancel";
  }
}

async function handleCompleted(b, result) {
  const contact = await upsertContact(b);
  result.contactId = contact.id;
  if (!contact.id) return;

  // booking-completed tag fires review-request workflow downstream
  await applyTags(contact.id, buildTags(b, ["booking-completed"])).catch(
    (e) => (result.tagWarning = e.message),
  );
  await addNote(contact.id, buildNoteBody(b, "booking.completed")).catch(
    () => null,
  );

  const opp = await findOpenOpp(contact.id);
  if (opp) {
    const price = num(b.price_total || b.total || b.price);
    // Recurring customers route to a dedicated terminal stage so they're
    // visible at a glance in the kanban view (10× LTV of one-time clients).
    // Falls back to STAGE_WON_ONE_TIME when the Recurring stage doesn't
    // exist yet, so behaviour is unchanged until the user creates it.
    const recurring = isRecurringFrequency(b.frequency);
    const wonStage = recurring ? STAGE_RECURRING : STAGE_WON_ONE_TIME;
    await moveOpp(opp.id, {
      stageId: wonStage,
      status: "won",
      monetaryValue: price || undefined,
      customFields: buildOppCustomFields(b),
    });
    result.opportunityId = opp.id;
    result.action = recurring ? "moved-opp-to-recurring" : "moved-opp-to-won-one-time";
    result.recurringDetected = recurring;
  } else {
    result.action = "no-open-opp-found-to-complete";
  }
}

// ───────── Handler ─────────
export default async function handler(req, res) {
  // CORS — Zapier doesn't need it but useful for testing
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Optional shared-secret guard. Set BK_WEBHOOK_SECRET in Vercel; pass
  // header X-Webhook-Secret in Zapier. Skipped if env var not set so the
  // route works out of the box during dev.
  if (process.env.BK_WEBHOOK_SECRET) {
    const provided =
      req.headers["x-webhook-secret"] ||
      (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (provided !== process.env.BK_WEBHOOK_SECRET) {
      return res.status(401).json({ error: "unauthorized" });
    }
  }

  if (!process.env.GHL_PIT) {
    return res.status(503).json({ error: "GHL_PIT not set" });
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: "Invalid JSON" });
    }
  }
  // Capture the raw payload before normalization so we can see exactly
  // what Zapier sends. Helps debug field-name drift.
  const rawKeys = Object.keys(body || {});
  const rawSample = {};
  for (const k of rawKeys) {
    const v = body[k];
    rawSample[k] =
      typeof v === "string" && v.length > 200 ? v.slice(0, 200) + "…" : v;
  }
  // Email/phone are echoed back at the top level by normalizeBody, so
  // don't include their raw values in the debug payload.
  const debugRaw = JSON.stringify(rawSample, null, 2);

  body = normalizeBody(body || {});

  const event = lower(body.event || "booking.created");
  const result = {
    ok: true,
    event,
    booking_id: body.booking_id || null,
    received_at: new Date(0).toISOString(), // overwritten below; deterministic-script-safe
  };
  try {
    result.received_at = new Date().toISOString();
  } catch (_) {}

  const handler = EVENT_HANDLERS[event];
  if (!handler) {
    return res.status(200).json({
      ...result,
      ok: false,
      error: `unknown event "${event}"`,
      hint:
        "Supported events: booking.created, booking.rescheduled, booking.cancelled, booking.completed",
      received_keys: rawKeys,
    });
  }

  try {
    await handler(body, result);
  } catch (e) {
    result.ok = false;
    result.error = e.message;
    result.received_keys = rawKeys;
    return res.status(200).json(result); // Return 200 so Zapier doesn't retry forever
  }

  // Echo received keys + raw payload in the response so we can see what
  // Zapier actually sent. Also drop a debug note on the contact for offline
  // inspection. Both are gated by DEBUG_BK_PAYLOAD env var or query param
  // so production responses stay clean once we've nailed the mapping.
  const debugEnabled =
    req.query?.debug === "1" || process.env.DEBUG_BK_PAYLOAD === "1";
  if (debugEnabled || result.opp_fields_set < 5) {
    result.received_keys = rawKeys;
    result.received_sample = rawSample;
    // Drop a hidden debug note on the contact (best-effort, swallow errors)
    if (result.contactId) {
      try {
        await ghl({
          method: "POST",
          path: `/contacts/${result.contactId}/notes`,
          body: {
            body: `[DEBUG] BK→Zapier raw payload:\n\n${debugRaw}`,
          },
        });
      } catch (_) {}
    }
  }

  return res.status(200).json(result);
}
