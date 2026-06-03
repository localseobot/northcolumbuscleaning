// Optional line-type lookup via Twilio Lookup v2.
//
// Business listings skew landline/VoIP, which can't receive SMS. When Twilio
// creds are set we tag each lead's line type at scrape time so the review page
// can sort landlines out of the textable list. No-ops (returns null) when
// TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN are absent — the flow still works,
// we just can't pre-filter.

/**
 * @param {string} e164  phone in E.164 (e.g. "+16145551234")
 * @returns {Promise<"mobile"|"landline"|"voip"|null>}
 */
export async function lookupLineType(e164) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token || !e164) return null;

  const url =
    `https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(e164)}` +
    `?Fields=line_type_intelligence`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64") },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return null;
    const t = data?.line_type_intelligence?.type || "";
    if (t === "mobile") return "mobile";
    if (t === "landline") return "landline";
    if (t && t.toLowerCase().includes("voip")) return "voip";
    return t ? "landline" : null; // unknown non-mobile → treat as landline
  } catch {
    return null;
  }
}
