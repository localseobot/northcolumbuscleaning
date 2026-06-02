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

export const config = { runtime: "nodejs" };

// ───────── Pipeline + stage IDs (same as retell-webhook.js) ─────────
const SALES_PIPELINE_ID = "6YDehH2kNtHrdfJaEQfa";
const STAGE_NEW_LEAD = "4bb733e7-d38d-4cb0-afb8-512406509144";
const STAGE_BOOKED = "a1df2c52-9211-4e13-a920-0c17ab00eff9";
const STAGE_WON = "9253419b-4c69-4f61-814b-ee27cd165f7a";
const STAGE_LOST = "7eaafc3f-ab36-4ebe-b2c2-c64ab998897d";

// ───────── Mapping tables ─────────
const SERVICE_TAG = {
  standard: "service:residential",
  regular: "service:residential",
  residential: "service:residential",
  deep: "service:deep-clean",
  "deep-clean": "service:deep-clean",
  "deep cleaning": "service:deep-clean",
  move_in_out: "service:move-in-out",
  "move-in-out": "service:move-in-out",
  "move in/out": "service:move-in-out",
  "move-in/move-out": "service:move-in-out",
  commercial: "service:commercial",
  post_construction: "service:post-construction",
  "post-construction": "service:post-construction",
};

const FREQUENCY_TAG = {
  one_time: "frequency:one-time",
  "one-time": "frequency:one-time",
  onetime: "frequency:one-time",
  weekly: "frequency:weekly",
  biweekly: "frequency:biweekly",
  "every 2 weeks": "frequency:biweekly",
  "every-2-weeks": "frequency:biweekly",
  every_3_weeks: "frequency:every-3-weeks",
  "every 3 weeks": "frequency:every-3-weeks",
  "every-3-weeks": "frequency:every-3-weeks",
  monthly: "frequency:monthly",
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
  const n = Number(v);
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
// Normalize Zapier/BK field-name variations into the keys we use below.
// Accepts: first_name/firstName/customer_first_name, customer_name (split),
// email/customer_email, phone/customer_phone, etc.
function normalizeBody(b) {
  const out = { ...b };

  // First / last name — handle "customer_name" full name → split
  const fullName = s(b.customer_name || b.full_name || b.name);
  if (!out.first_name && !out.firstName && fullName) {
    const parts = fullName.split(/\s+/);
    out.first_name = parts[0];
    if (parts.length > 1) out.last_name = parts.slice(1).join(" ");
  }
  if (!out.first_name && (b.customer_first_name || b.firstName))
    out.first_name = b.customer_first_name || b.firstName;
  if (!out.last_name && (b.customer_last_name || b.lastName))
    out.last_name = b.customer_last_name || b.lastName;

  // Email / phone
  if (!out.email) out.email = b.customer_email || b.email_address || b.customerEmail;
  if (!out.phone)
    out.phone = b.customer_phone || b.phone_number || b.customerPhone;

  // Booking ID
  if (!out.booking_id)
    out.booking_id = b.id || b.booking_number || b.bookingId;

  // Appointment date+time — combine BK's separate date + arrival fields
  if (!out.appointment_datetime) {
    const date = s(b.booking_date || b.appointment_date || b.service_date);
    const time = s(b.arrival_time || b.appointment_time || b.start_time);
    if (date && time) out.appointment_datetime = `${date} ${time}`;
    else if (date) out.appointment_datetime = date;
    else if (b.datetime) out.appointment_datetime = b.datetime;
  }

  // Service / frequency
  if (!out.service_type)
    out.service_type = b.service || b.service_name || b.cleaning_type;
  if (!out.frequency)
    out.frequency = b.recurring || b.cadence || b.service_frequency;

  // Property details
  if (!out.bedrooms) out.bedrooms = b.beds || b.bedroom_count || b.num_bedrooms;
  if (!out.bathrooms)
    out.bathrooms = b.baths || b.bathroom_count || b.num_bathrooms;
  if (!out.sqft) out.sqft = b.square_feet || b.square_footage || b.sq_ft;

  // Price
  if (!out.price_total)
    out.price_total = b.total || b.total_price || b.amount || b.price;

  // Notes
  if (!out.notes)
    out.notes = b.customer_notes || b.special_notes || b.special_instructions;

  // Address parts (BK often gives a single address string)
  if (!out.address) out.address = b.street_address || b.address_line_1;
  if (!out.zip) out.zip = b.postal_code || b.zipcode || b.zip_code;

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
  const svc = lower(b.service_type || b.service);
  if (SERVICE_TAG[svc]) tags.push(SERVICE_TAG[svc]);
  const freq = lower(b.frequency);
  if (FREQUENCY_TAG[freq]) tags.push(FREQUENCY_TAG[freq]);
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
    await moveOpp(opp.id, {
      stageId: STAGE_WON,
      status: "won",
      monetaryValue: price || undefined,
      customFields: buildOppCustomFields(b),
    });
    result.opportunityId = opp.id;
    result.action = "moved-opp-to-won";
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
    });
  }

  try {
    await handler(body, result);
  } catch (e) {
    result.ok = false;
    result.error = e.message;
    return res.status(200).json(result); // Return 200 so Zapier doesn't retry forever
  }

  return res.status(200).json(result);
}
