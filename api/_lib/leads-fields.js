// Constants + helpers for the commercial lead-gen / cold-outreach flow.
//
// Leads live in GHL's existing "Cold Outreach Pipeline". The New Lead stage is
// the review queue; approving a lead sends the SMS and moves it to Contacted.

// ── Pipeline + stages (Cold Outreach Pipeline) ─────────────────────────────
export const COLD_PIPELINE_ID = "tpasmu00dKTR2o0AyGcQ";
export const STAGE_NEW_LEAD = "335c0d38-32d4-49c5-aa19-8bc41e4070fa";
export const STAGE_CONTACTED = "008cccae-e223-4c97-a6a9-87518847c9ea";
export const STAGE_WALKTHROUGH_SCHEDULED = "17adf74b-e659-4c5f-8a68-582b8f349997";
export const STAGE_WALKTHROUGH_COMPLETED = "44a6a866-b8ae-493d-8c23-786d32f86e6f";
export const STAGE_CLOSED_BOOKED = "04a87353-1ca8-441f-960d-5e3136dde149";

// ── Contact custom field (dedupe key) ──────────────────────────────────────
export const CONTACT_PLACE_ID = "N39q95fUPacEmMh6IT1X"; // "Google Place ID" (text)

// ── Tags ───────────────────────────────────────────────────────────────────
export const TAGS = {
  source: "source:places",
  commercial: "lead:commercial",
  niche: (n) => `niche:${n}`, // daycare | gym
  city: (c) => `city:${slug(c)}`,
  sent: "outreach:sent",
  skipped: "outreach:skipped",
  smsFailed: "sms-failed",
  noPhone: "no-phone",
  line: (t) => `line:${t}`, // mobile | landline | voip
};

export function slug(s) {
  return String(s || "").toLowerCase().trim().replace(/[^\w]+/g, "-").replace(/^-+|-+$/g, "");
}

// Human-friendly niche word for the message.
function nicheWord(niche) {
  if (niche === "daycare") return "daycares & childcare centers";
  if (niche === "gym") return "gyms & fitness studios";
  return "local businesses";
}

/**
 * Build the cold-outreach SMS. Includes business identity, relevance, ONE link
 * (the booking calendar), and an explicit opt-out — the compliance essentials.
 *
 * @param {object} o
 * @param {string} o.name       business name
 * @param {string} o.city
 * @param {string} o.niche      "daycare" | "gym"
 * @param {string} o.calendarUrl
 */
export function buildOutreachMessage({ name, city, niche, calendarUrl }) {
  const biz = String(name || "there").trim();
  const where = city ? ` around ${city}` : "";
  const link = calendarUrl ? ` Grab a time: ${calendarUrl}` : " Reply here and we'll set a time.";
  return (
    `Hi ${biz} — this is North Columbus Cleaning. We do professional commercial ` +
    `cleaning for ${nicheWord(niche)}${where}. Could we stop by for a quick, free ` +
    `walkthrough & quote?${link}\nReply STOP to opt out.`
  );
}
