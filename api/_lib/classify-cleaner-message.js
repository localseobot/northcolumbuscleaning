// Classify an inbound SMS from a cleaner into one of a fixed set of
// operational intents. Returns a structured object the inbound webhook
// uses to decide what action to take.
//
// Intents we recognize:
//   - callout         Cleaner can't make a shift (sick, emergency, etc.)
//   - running_late    Will be there but late
//   - on_the_way      Heading to a job now
//   - arrived         At the job site
//   - done            Finished a job
//   - customer_issue  Something went wrong with the customer
//   - schedule_question  Asking about their own schedule
//   - ack             Just acknowledging a previous message
//   - unclear         Can't determine intent (default fallback)

import { callClaude, parseClaudeJson } from "./claude.js";

const SYSTEM_PROMPT = `You are a strict intent classifier for inbound SMS messages from cleaners ("providers") who work for North Columbus Cleaning, a residential cleaning company.

You will receive:
1. The cleaner's name and recent context about their assigned jobs.
2. The cleaner's new message.

You must output a JSON object with this exact shape — no markdown fences, no commentary, just JSON:

{
  "intent": "callout" | "running_late" | "on_the_way" | "arrived" | "done" | "customer_issue" | "schedule_question" | "ack" | "unclear",
  "confidence": "high" | "medium" | "low",
  "affected_date": "today" | "tomorrow" | "future" | "unknown",
  "summary": "one short sentence describing what they're saying",
  "suggested_reply": "a warm, brief auto-reply we'd send to acknowledge (2 sentences max). Skip pleasantries like 'thank you' — sound like a real teammate, not a bot."
}

Classification guidance:
- "callout": cleaner is REPORTING they can't work a shift. Examples: "I'm sick today", "Can't make it tomorrow", "Family emergency", "Won't be able to do the 10am". Pick this even when ambiguous about which date — set affected_date conservatively.
- "running_late": they're still coming, just slow. "Running 15 late", "Stuck in traffic".
- "on_the_way": heading to a job. "On my way", "Leaving now".
- "arrived": at the job site. "Here", "At the house".
- "done": finished. "All done", "Finished the Sunbury job".
- "customer_issue": something bad with the customer or property. "Customer is mad", "Locked out", "Dog was aggressive", "House has water damage", "Customer wants to add work". These need fast human attention.
- "schedule_question": asking about their schedule, not reporting status. "What time tomorrow?", "Where's the address?".
- "ack": short acknowledgment. "Ok", "Got it", "Thanks", "Sounds good", a thumbs-up emoji.
- "unclear": when you genuinely can't tell. Don't guess — pick this if confidence is low and the message doesn't fit elsewhere.

For "affected_date":
- "today" if the message references today or the current ongoing shift.
- "tomorrow" if explicit ("tomorrow", "tmrw", a specific future date that's tomorrow).
- "future" for further-out dates.
- "unknown" if no date hint at all (e.g. "I'm sick" without saying when — default to today for callouts).

For "suggested_reply": be human, brief, and helpful. Examples:
- callout: "Got it — we'll find coverage and circle back. Feel better."
- customer_issue: "Texting Devyn now to back you up. Sit tight."
- ack: "" (empty string — no reply needed for acknowledgments)
- unclear: "Got it, will follow up shortly."`;

/**
 * @param {object} opts
 * @param {string} opts.message            The cleaner's new SMS text
 * @param {object} opts.cleaner            Cleaner contact (firstName, etc.)
 * @param {Array}  [opts.todayJobs]        Array of {time, address, customerName, oppId}
 * @param {Array}  [opts.tomorrowJobs]     Same shape
 * @param {Array}  [opts.recentMessages]   Recent inbound/outbound messages (most-recent-first)
 * @returns {Promise<object>}              The classifier output (see SYSTEM_PROMPT)
 */
export async function classifyCleanerMessage({
  message,
  cleaner,
  todayJobs = [],
  tomorrowJobs = [],
  recentMessages = [],
}) {
  const cleanerLabel =
    cleaner?.firstName ||
    cleaner?.firstNameRaw ||
    cleaner?.contactName ||
    "Cleaner";

  const fmtJob = (j) =>
    `[${j.oppId?.slice(0, 6) || "?"}] ${j.time || "?"} ${j.address ? `at ${j.address}` : ""} for ${j.customerName || "?"}`;
  const fmtList = (jobs) =>
    jobs.length === 0
      ? "(none)"
      : jobs.map((j, i) => `  ${i + 1}. ${fmtJob(j)}`).join("\n");
  const fmtHistory = (msgs) =>
    msgs.length === 0
      ? "(none)"
      : msgs
          .slice(0, 4)
          .map(
            (m, i) =>
              `  ${i + 1}. [${m.direction || "?"}] ${String(m.body || m.text || "").slice(0, 140).replace(/\s+/g, " ")}`,
          )
          .join("\n");

  const today = new Date().toISOString().slice(0, 10);
  const userPrompt = `CLEANER: ${cleanerLabel}
TODAY'S DATE (UTC): ${today}

THEIR JOBS TODAY:
${fmtList(todayJobs)}

THEIR JOBS TOMORROW:
${fmtList(tomorrowJobs)}

RECENT MESSAGES (most recent first):
${fmtHistory(recentMessages)}

NEW INBOUND MESSAGE:
"${message}"

Classify and respond with the JSON object only.`;

  const { text, usage } = await callClaude({
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
    maxTokens: 400,
    temperature: 0,
  });

  const parsed = parseClaudeJson(text);
  if (!parsed || !parsed.intent) {
    return {
      intent: "unclear",
      confidence: "low",
      affected_date: "unknown",
      summary: message.slice(0, 120),
      suggested_reply: "Got it, we'll follow up shortly.",
      _rawResponse: text,
      _usage: usage,
    };
  }
  parsed._usage = usage;
  return parsed;
}
