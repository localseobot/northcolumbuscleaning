// Parse GoHighLevel inbound-call webhooks and decide whether a forwarded
// call is a sellable lead.
//
// GHL does not send one payload shape. Workflows, native conversation
// webhooks, and (rarely) Twilio status callbacks all land here, so the parser
// is deliberately greedy about field names and conservative about billing.
//
// Pure functions — no GHL I/O — so the rules can be tested without a live
// sub-account.

import { toE164 } from "./phone.js";

const SMS_TYPES = new Set([
  "sms",
  "email",
  "whatsapp",
  "gmb",
  "fb",
  "ig",
  "live_chat",
  "livechat",
  "custom",
  "internalcomment",
]);

const CALL_TYPES = new Set([
  "call",
  "inboundcall",
  "inbound_call",
  "outboundcall",
  "voicecall",
  "voice",
  "callstatus",
  "call_status",
]);

const CONNECTED = new Set([
  "answered",
  "completed",
  "complete",
  "connected",
  "in-progress",
  "in_progress",
  "inprogress",
]);

const MISSED = new Set([
  "missed",
  "no-answer",
  "no_answer",
  "noanswer",
  "busy",
  "failed",
  "canceled",
  "cancelled",
  "voicemail",
  "unanswered",
]);

const EARLY = new Set(["ringing", "initiated", "queued", "new"]);

function s(v) {
  return v === null || v === undefined ? "" : String(v).trim();
}

function lower(v) {
  return s(v).toLowerCase();
}

function get(obj, path) {
  if (!obj || typeof obj !== "object") return undefined;
  const parts = path.split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[p];
  }
  return cur;
}

function pick(obj, paths) {
  for (const path of paths) {
    const v = get(obj, path);
    if (v !== undefined && v !== null && s(v) !== "") return v;
  }
  return "";
}

function asInt(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Pull a call event out of whatever GHL (or a Twilio status callback) posted.
 *
 * @param {object} body
 * @returns {{
 *   isCall: boolean,
 *   direction: "inbound"|"outbound"|"",
 *   status: string,
 *   duration: number|null,
 *   phone: string,
 *   to: string,
 *   contactId: string,
 *   opportunityId: string,
 *   messageId: string,
 *   name: string,
 *   email: string,
 *   locationId: string,
 *   recordingUrl: string,
 *   messageType: string,
 *   type: string,
 * }}
 */
export function parseGhlCallEvent(body) {
  const empty = {
    isCall: false,
    direction: "",
    status: "",
    duration: null,
    phone: "",
    from: "",
    phoneCandidates: [],
    to: "",
    contactId: "",
    opportunityId: "",
    messageId: "",
    name: "",
    email: "",
    locationId: "",
    recordingUrl: "",
    messageType: "",
    type: "",
  };
  if (!body || typeof body !== "object") return empty;

  // Workflow webhooks often nest the interesting bits under customData /
  // triggerData / contact. Flatten the obvious bags onto one lookup object
  // without losing the top-level fields GHL's native webhooks send.
  const bags = [body];
  for (const key of ["customData", "custom_data", "triggerData", "trigger_data", "data", "call", "message"]) {
    if (body[key] && typeof body[key] === "object") bags.push(body[key]);
  }
  if (body.contact && typeof body.contact === "object") bags.push(body.contact);

  const looked = (paths) => {
    for (const bag of bags) {
      const v = pick(bag, paths);
      if (v !== "") return v;
    }
    return "";
  };

  const type = s(looked(["type", "event", "eventType", "triggerName", "trigger"]));
  const messageType = s(looked(["messageType", "message_type", "contentType", "channel"]));
  const direction = lower(looked(["direction", "Direction", "callDirection", "call_direction"]));

  const status = lower(
    looked([
      "callStatus",
      "CallStatus",
      "call_status",
      "status",
      "callstate",
      "callState",
    ]),
  );

  const duration = asInt(
    looked(["callDuration", "CallDuration", "call_duration", "duration", "Duration"]),
  );

  // Prefer the GHL contact's phone (the homeowner) over `from`/`to`, which
  // on a forwarded call can be our tracking line or the buyer's number.
  const phoneCandidates = [
    looked(["contact.phone"]),
    looked(["phone", "phoneNumber", "phone_number"]),
    looked(["from", "From", "caller", "callerId", "caller_id"]),
  ]
    .map(toE164)
    .filter(Boolean);

  const phone = phoneCandidates[0] || "";
  const to = toE164(looked(["to", "To", "called", "calledNumber", "trackingNumber", "tracking_number"]));
  const from = toE164(looked(["from", "From", "caller", "callerId", "caller_id"]));

  const first = s(looked(["firstName", "first_name", "contact.firstName"]));
  const last = s(looked(["lastName", "last_name", "contact.lastName"]));
  const full = s(looked(["full_name", "fullName", "name", "contactName", "contact.name"]));
  const name = full || [first, last].filter(Boolean).join(" ");

  const attachments = body.attachments || body.attachment || [];
  const recordingUrl = Array.isArray(attachments)
    ? s(attachments.find((a) => typeof a === "string" && /^https?:/i.test(a)))
    : s(attachments);

  const messageTypeLower = lower(messageType);
  const typeLower = lower(type).replace(/\s+/g, "");
  const looksLikeCall =
    CALL_TYPES.has(messageTypeLower) ||
    CALL_TYPES.has(typeLower) ||
    Boolean(s(looked(["CallSid", "callSid", "call_sid"]))) ||
    duration !== null ||
    Boolean(status && (CONNECTED.has(status) || MISSED.has(status) || EARLY.has(status)));

  const looksLikeSms = SMS_TYPES.has(messageTypeLower);

  return {
    isCall: looksLikeCall && !looksLikeSms,
    direction: direction === "outbound" || direction === "outgoing" ? "outbound" : direction === "inbound" || direction === "incoming" ? "inbound" : "",
    status,
    duration,
    phone,
    from,
    phoneCandidates,
    to,
    contactId: s(looked(["contactId", "contact_id", "contact.id"])),
    opportunityId: s(looked(["opportunityId", "opportunity_id", "opportunity.id"])),
    messageId: s(looked(["messageId", "message_id", "CallSid", "callSid", "call_sid", "callId", "call_id"])),
    name,
    email: s(looked(["email", "Email", "contact.email"])).toLowerCase(),
    locationId: s(looked(["locationId", "location_id", "location.id"])),
    recordingUrl,
    messageType: messageTypeLower,
    type: typeLower,
  };
}

/**
 * Should this forwarded call be recorded as a billable phone lead?
 *
 * Prefer connected/answered. Missed, voicemail, no-answer and ringing-only
 * events are not sold. A workflow payload with no status (the common GHL
 * "Inbound Call → Webhook" setup) is treated as a lead unless
 * `requireAnswered` is set — wire a Call Status = completed filter in GHL
 * to be strict.
 *
 * @param {ReturnType<parseGhlCallEvent>} event
 * @param {{ requireAnswered?: boolean, minDuration?: number }} [opts]
 */
export function classifyGhlCall(event, opts = {}) {
  const requireAnswered = Boolean(opts.requireAnswered);
  const minDuration = Number.isFinite(Number(opts.minDuration)) ? Number(opts.minDuration) : 0;

  if (!event || typeof event !== "object") {
    return { skip: true, reason: "empty payload", connected: false };
  }

  if (event.direction === "outbound") {
    return { skip: true, reason: "outbound call", connected: false };
  }

  // Posted to the call endpoint but clearly an SMS/email conversation event.
  if (!event.isCall && (event.messageType && SMS_TYPES.has(event.messageType))) {
    return { skip: true, reason: `not a call (${event.messageType})`, connected: false };
  }

  if (event.status && EARLY.has(event.status)) {
    return { skip: true, reason: `early status "${event.status}" — wait for a terminal event`, connected: false };
  }

  if (event.status && MISSED.has(event.status)) {
    return { skip: true, reason: `not connected (${event.status})`, connected: false };
  }

  if (event.duration === 0 && (!event.status || event.status !== "answered")) {
    return { skip: true, reason: "zero duration — not connected", connected: false };
  }

  if (event.duration !== null && event.duration < minDuration) {
    return { skip: true, reason: `duration ${event.duration}s below minimum ${minDuration}s`, connected: false };
  }

  const connected =
    (event.status && CONNECTED.has(event.status)) ||
    (event.duration !== null && event.duration > 0);

  if (connected) {
    return { skip: false, reason: "", connected: true };
  }

  // No status, no duration: typical GHL workflow "Inbound Call" webhook.
  // Treat as a lead so tracking is live once forwarding is pointed at the
  // buyer. Set GHL_CALL_REQUIRE_ANSWERED=1 to skip these.
  const inboundish =
    event.direction === "inbound" ||
    event.type.includes("inbound") ||
    event.isCall ||
    Boolean(event.phone || event.contactId);

  if (!inboundish) {
    return { skip: true, reason: "not an inbound call", connected: false };
  }

  if (requireAnswered) {
    return { skip: true, reason: "no connected/answered signal", connected: false };
  }

  return { skip: false, reason: "inbound call with no status (treated as connected)", connected: false };
}

/**
 * Homeowner caller ID for the dashboard. Drops our tracking line, the
 * buyer's forward-to, and other GHL numbers so a forwarded call never
 * shows up as "from ourselves".
 */
export function selectCallerPhone(candidates, exclude = []) {
  const skip = new Set((exclude || []).map(toE164).filter(Boolean));
  const list = [];
  for (const raw of candidates || []) {
    const n = toE164(raw);
    if (n && !list.includes(n)) list.push(n);
  }
  return list.find((n) => !skip.has(n)) || "";
}

export const GHL_CALL_STATUS = { CONNECTED, MISSED, EARLY };
