// GHL workflow webhook for inbound conversations.
//
// Trigger this from a GHL Workflow:
//   Automations → Workflows → New Workflow
//   Trigger: "Customer Replied" (or "Conversation - Inbound Message")
//   Filter: Channel = SMS
//   Action: Webhook → POST https://www.northcolumbuscleaning.com/api/conversations/inbound
//   (Optional) include header: X-Webhook-Secret: <your CONVERSATIONS_WEBHOOK_SECRET>
//
// On every inbound SMS, this endpoint:
//   1. Identifies the sender's GHL contact.
//   2. If the contact is tagged `internal:cleaner`, runs the AI
//      classifier on their message and routes the action.
//   3. Other contacts (customers, leads) fall through silently — GHL's
//      normal conversation flow handles them.
//
// Recognized cleaner intents (see classify-cleaner-message.js):
//   callout         → auto-trigger /api/ops/callout for their next job + ack
//   customer_issue  → urgent multi-channel manager alert + ack
//   running_late, on_the_way, arrived, done → manager alert (info-only) + ack
//   schedule_question, unclear → forward to manager for human review
//   ack             → no action (it's just an acknowledgment)
//
// Always returns 200 OK so GHL doesn't retry on transient failures.

import { ghl } from "../_lib/ghl.js";
import { sendGhlSms, INTERNAL_LINE, CUSTOMER_LINE } from "../_lib/ghl-sms.js";
import { sendOpsAlert } from "../_lib/alerts.js";
import { classifyCleanerMessage } from "../_lib/classify-cleaner-message.js";
import {
  OPP_APPOINTMENT_DATE,
  OPP_PROVIDER_PHONE,
} from "../_lib/ghl-fields.js";

export const config = { runtime: "nodejs" };

const SALES_PIPELINE_ID = "6YDehH2kNtHrdfJaEQfa";
const STAGE_BOOKED = "a1df2c52-9211-4e13-a920-0c17ab00eff9";

function s(v) { return v === null || v === undefined ? "" : String(v).trim(); }
function lower(v) { return s(v).toLowerCase(); }
function normPhone(raw) {
  if (!raw) return "";
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  if (String(raw).startsWith("+") && digits.length >= 10) return "+" + digits;
  return "";
}
function getCf(cfs, id) {
  if (!Array.isArray(cfs)) return null;
  const f = cfs.find((c) => c.id === id);
  if (!f) return null;
  return (
    f.fieldValueString ||
    f.fieldValueNumber ||
    (f.fieldValueDate ? new Date(f.fieldValueDate).toISOString() : null) ||
    f.fieldValue ||
    null
  );
}
function fmtTime(iso) {
  if (!iso) return "?";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString("en-US", {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

// Pull GHL fields out of whatever shape the workflow webhook ships.
// GHL workflows can ship contact + message under different keys depending
// on which payload preset is used; we accept the common variants.
function extractFromPayload(body) {
  const contactId =
    s(body.contact_id) ||
    s(body.contactId) ||
    s(body?.contact?.id) ||
    s(body?.customData?.contact_id) ||
    "";
  const phone =
    s(body.phone) ||
    s(body.from) ||
    s(body?.contact?.phone) ||
    s(body?.customData?.phone) ||
    "";
  const message =
    s(body.message) ||
    s(body.body) ||
    s(body.text) ||
    s(body?.last_message?.body) ||
    s(body?.lastMessage?.body) ||
    s(body?.customData?.message) ||
    "";
  return { contactId, phone, message };
}

async function findCleanerContact({ contactId, phone }) {
  if (contactId) {
    const r = await ghl({ method: "GET", path: `/contacts/${contactId}` }).catch(() => null);
    if (r?.contact) return r.contact;
  }
  if (phone) {
    const np = normPhone(phone);
    const search = await ghl({
      method: "POST",
      path: "/contacts/search",
      body: {
        locationId: process.env.GHL_LOCATION_ID,
        pageLimit: 5,
        filters: [{ field: "phone", operator: "eq", value: np }],
      },
    }).catch(() => ({ contacts: [] }));
    return search?.contacts?.[0] || null;
  }
  return null;
}

async function findCleanerJobs({ cleanerPhone, dateYmd }) {
  if (!cleanerPhone || !dateYmd) return [];
  const search = await ghl({
    method: "POST",
    path: "/opportunities/search",
    body: {
      location_id: process.env.GHL_LOCATION_ID,
      pipeline_id: SALES_PIPELINE_ID,
      pipeline_stage_id: STAGE_BOOKED,
      status: "open",
      limit: 100,
      getCustomFields: true,
    },
  }).catch(() => ({ opportunities: [] }));

  const dayMs = new Date(dateYmd + "T00:00:00Z").getTime();
  const nextDayMs = dayMs + 86400000;
  const np = normPhone(cleanerPhone);

  return (search?.opportunities || [])
    .filter((o) => normPhone(getCf(o.customFields, OPP_PROVIDER_PHONE)) === np)
    .filter((o) => {
      const dt = getCf(o.customFields, OPP_APPOINTMENT_DATE);
      if (!dt) return false;
      const t = new Date(dt).getTime();
      return t >= dayMs && t < nextDayMs;
    });
}

async function fetchRecentMessages(contactId) {
  try {
    const convSearch = await ghl({
      method: "GET",
      path: "/conversations/search",
      query: {
        locationId: process.env.GHL_LOCATION_ID,
        contactId,
        limit: 1,
      },
    });
    const convId = convSearch?.conversations?.[0]?.id;
    if (!convId) return [];
    const msgs = await ghl({
      method: "GET",
      path: `/conversations/${convId}/messages`,
    });
    return (msgs?.messages?.messages || [])
      .filter((m) => m.messageType === "TYPE_SMS")
      .slice(0, 8)
      .map((m) => ({ direction: m.direction, body: m.body }));
  } catch {
    return [];
  }
}

async function autoReply({ contactId, replyText }) {
  if (!replyText) return null;
  return ghl({
    method: "POST",
    path: "/conversations/messages",
    body: {
      type: "SMS",
      contactId,
      message: replyText,
      fromNumber: INTERNAL_LINE,
    },
  }).catch(() => null);
}

async function triggerCallout({ oppId, calledOutContactId, reason }) {
  // Direct in-process call would be cleaner, but a simple internal HTTP
  // POST keeps the seams clean and lets the callout endpoint's auth/log
  // shape match what manual triggers see.
  if (!process.env.ADMIN_TOKEN) return { ok: false, error: "ADMIN_TOKEN not set" };
  const adminToken = String(process.env.ADMIN_TOKEN).trim();
  try {
    const res = await fetch(
      `https://www.northcolumbuscleaning.com/api/ops/callout?token=${encodeURIComponent(adminToken)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oppId, calledOutContactId, reason }),
      },
    );
    return await res.json();
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Webhook-Secret");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Optional shared-secret check
  if (process.env.CONVERSATIONS_WEBHOOK_SECRET) {
    const provided =
      req.headers["x-webhook-secret"] ||
      String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (provided !== process.env.CONVERSATIONS_WEBHOOK_SECRET) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { return res.status(200).json({ ok: false, error: "Invalid JSON" }); }
  }
  body = body || {};

  const { contactId, phone, message } = extractFromPayload(body);
  const result = {
    ok: true,
    receivedAt: new Date().toISOString(),
    contactId,
    phone,
    message: message.slice(0, 200),
    actions: {},
  };

  if (!message) {
    result.skipped = "no message body";
    return res.status(200).json(result);
  }

  // Find the sender's contact
  const contact = await findCleanerContact({ contactId, phone });
  if (!contact) {
    result.skipped = "contact not found";
    return res.status(200).json(result);
  }
  result.contactId = contact.id;

  // Only act on cleaner messages
  const tags = (contact.tags || []).map(lower);
  if (!tags.includes("internal:cleaner")) {
    result.skipped = "sender is not tagged as internal:cleaner";
    return res.status(200).json(result);
  }

  // Gather job context for the classifier
  const today = new Date();
  const todayYmd = today.toISOString().slice(0, 10);
  const tomorrow = new Date(today.getTime() + 86400000);
  const tomorrowYmd = tomorrow.toISOString().slice(0, 10);

  const cleanerPhone = contact.phone;
  const [todayJobsRaw, tomorrowJobsRaw, recentMessages] = await Promise.all([
    findCleanerJobs({ cleanerPhone, dateYmd: todayYmd }),
    findCleanerJobs({ cleanerPhone, dateYmd: tomorrowYmd }),
    fetchRecentMessages(contact.id),
  ]);

  const mapJobs = async (jobs) => {
    return Promise.all(
      jobs.map(async (j) => {
        let customerName = "(unknown)";
        if (j.contactId) {
          const cc = await ghl({ method: "GET", path: `/contacts/${j.contactId}` }).catch(() => null);
          const c = cc?.contact;
          customerName =
            [c?.firstNameRaw, c?.lastNameRaw].filter(Boolean).join(" ") ||
            c?.contactName ||
            "(unknown)";
        }
        const apptIso = getCf(j.customFields, OPP_APPOINTMENT_DATE);
        return {
          oppId: j.id,
          time: fmtTime(apptIso),
          address: j.contact?.address1 || "",
          customerName,
        };
      }),
    );
  };
  const todayJobs = await mapJobs(todayJobsRaw);
  const tomorrowJobs = await mapJobs(tomorrowJobsRaw);
  result.jobs = { today: todayJobs.length, tomorrow: tomorrowJobs.length };

  // Classify with Claude
  let classification;
  try {
    classification = await classifyCleanerMessage({
      message,
      cleaner: contact,
      todayJobs,
      tomorrowJobs,
      recentMessages,
    });
  } catch (e) {
    // Fall back to "unclear" + manager alert if Claude fails
    result.classifyError = e.message;
    classification = {
      intent: "unclear",
      confidence: "low",
      summary: message.slice(0, 200),
      suggested_reply: "Got it, will follow up shortly.",
    };
  }
  result.classification = {
    intent: classification.intent,
    confidence: classification.confidence,
    affected_date: classification.affected_date,
    summary: classification.summary,
  };

  const cleanerName =
    [contact.firstNameRaw, contact.lastNameRaw].filter(Boolean).join(" ") ||
    contact.contactName ||
    "Cleaner";

  // Route by intent
  switch (classification.intent) {
    case "callout": {
      // Find the affected opp — pick by affected_date hint, fall back to today's first job
      let target = null;
      if (classification.affected_date === "tomorrow" && tomorrowJobs[0]) {
        target = tomorrowJobs[0];
      } else if (classification.affected_date === "today" && todayJobs[0]) {
        target = todayJobs[0];
      } else {
        target = todayJobs[0] || tomorrowJobs[0];
      }
      if (target) {
        const calloutRes = await triggerCallout({
          oppId: target.oppId,
          calledOutContactId: contact.id,
          reason: `Cleaner SMS: "${message.slice(0, 140)}"`,
        });
        result.actions.callout = calloutRes;
      } else {
        // No assigned job we could find — still alert manager
        await sendOpsAlert({
          title: `🚨 Cleaner callout but no matching job — ${cleanerName}`,
          body: `${cleanerName} sent: "${message}"\n\nClassifier says: ${classification.summary}\n\nWe couldn't find an assigned job to reassign. Reach out directly.`,
        });
        result.actions.alert = "no matching job";
      }
      await autoReply({
        contactId: contact.id,
        replyText:
          classification.suggested_reply ||
          "Got it, working on coverage now. Feel better.",
      });
      break;
    }

    case "customer_issue": {
      await sendOpsAlert({
        title: `🚨 Customer issue — ${cleanerName}`,
        body: `Cleaner says: "${message}"\n\nClassifier: ${classification.summary}\nConfidence: ${classification.confidence}\n\nText ${cleanerName} (${cleanerPhone}) ASAP.`,
      });
      await autoReply({
        contactId: contact.id,
        replyText:
          classification.suggested_reply ||
          "Texting Devyn right now to back you up. Sit tight.",
      });
      result.actions.alert = "sent";
      break;
    }

    case "running_late":
    case "on_the_way":
    case "arrived":
    case "done": {
      // Info-only manager update — Slack/email channels only (no SMS spam)
      await sendOpsAlert({
        title: `ℹ️ ${classification.intent.replace(/_/g, " ")} — ${cleanerName}`,
        body: `Cleaner sent: "${message}"\n\n${classification.summary}`,
        severity: "info",
      });

      // For running_late + arrived, also text the customer if we can
      // identify which job is being talked about. on_the_way is borderline
      // (don't want to spam if they're early or mid-route); done would
      // overlap with the post-job review-request cron — skip both.
      const shouldNotifyCustomer =
        classification.intent === "running_late" ||
        classification.intent === "arrived";
      if (shouldNotifyCustomer) {
        // Pick the today job (default first if multiple)
        const target = todayJobs[0];
        if (target) {
          try {
            const customerSms =
              classification.intent === "running_late"
                ? `Hi ${target.customerName?.split(" ")[0] || "there"}, ${cleanerName.split(" ")[0]} from North Columbus Cleaning here — running a few minutes late but on the way. Sorry for the wait!`
                : `Hi ${target.customerName?.split(" ")[0] || "there"}, ${cleanerName.split(" ")[0]} from North Columbus Cleaning just arrived at your place. We'll get to work!`;
            // Look up the customer's contactId via the opp
            const oppRes = await ghl({
              method: "GET",
              path: `/opportunities/${target.oppId}`,
            }).catch(() => null);
            const customerContactId = oppRes?.opportunity?.contactId;
            if (customerContactId) {
              await ghl({
                method: "POST",
                path: "/conversations/messages",
                body: {
                  type: "SMS",
                  contactId: customerContactId,
                  message: customerSms,
                  fromNumber: CUSTOMER_LINE,
                },
              }).catch(() => null);
              result.actions.customerNotified = true;
            }
          } catch (_) {}
        }
      }

      if (classification.suggested_reply) {
        await autoReply({
          contactId: contact.id,
          replyText: classification.suggested_reply,
        });
      }
      result.actions.alert = "info sent";
      break;
    }

    case "schedule_question":
    case "unclear": {
      // Hand off to a human — manager gets the message verbatim
      await sendOpsAlert({
        title: `❓ Cleaner message needs your eyes — ${cleanerName}`,
        body: `Cleaner: ${cleanerName} (${cleanerPhone})\nMessage: "${message}"\n\nClassifier intent: ${classification.intent} (${classification.confidence})\nSummary: ${classification.summary}\n\nClassifier suggested: ${classification.suggested_reply || "(no reply)"}\n\nReply to them from GHL when ready.`,
      });
      result.actions.alert = "manual review";
      break;
    }

    case "ack":
      // Don't auto-reply to acknowledgments — would spiral
      result.actions.skipped = "ack — no action";
      break;

    default:
      result.actions.skipped = `unrecognized intent: ${classification.intent}`;
  }

  return res.status(200).json(result);
}
