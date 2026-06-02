// Claude vision check for uploaded W-9 documents.
//
// Confirms an uploaded W-9 actually has a taxpayer ID (SSN or EIN) filled in,
// per the requirement that "AI must check that SSN/EIN is filled out".
//
// PRIVACY: we explicitly instruct the model to return ONLY a boolean, the TIN
// type, and the last 4 digits — never the full number. The full SSN/EIN never
// enters our logs or variables; it stays inside the document bytes (which we
// upload to the restricted Drive and then discard).
//
// Env vars:
//   ANTHROPIC_API_KEY   required
//   ANTHROPIC_MODEL     optional, defaults to claude-sonnet-4-6

const API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-4-6";

const PROMPT = [
  "You are verifying a US IRS Form W-9 that a contractor uploaded.",
  "Look at the document and determine whether the taxpayer identification",
  "number section is actually filled in — either a Social Security Number",
  "(SSN, format XXX-XX-XXXX) or an Employer Identification Number",
  "(EIN, format XX-XXXXXXX). Also confirm the document appears to be a W-9",
  "and that the name and signature areas are present.",
  "",
  "Respond with ONLY a compact JSON object, no prose, of the exact shape:",
  '{"isW9": boolean, "hasTin": boolean, "tinType": "SSN"|"EIN"|null, "last4": string|null, "signaturePresent": boolean, "notes": string}',
  "",
  "CRITICAL PRIVACY RULE: never output the full SSN or EIN. For last4 include",
  "at most the final four digits. Keep notes free of any full tax ID.",
].join("\n");

/**
 * @param {Buffer|Uint8Array} bytes   the uploaded document
 * @param {string} mimeType           image/png, image/jpeg, or application/pdf
 * @returns {Promise<{ok: boolean, isW9?: boolean, hasTin?: boolean, tinType?: string|null, last4?: string|null, signaturePresent?: boolean, notes?: string, error?: string}>}
 */
export async function verifyW9Tin(bytes, mimeType) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, error: "ANTHROPIC_API_KEY not set" };
  if (!bytes) return { ok: false, error: "no document bytes" };

  const base64 = Buffer.from(bytes).toString("base64");
  const isPdf = (mimeType || "").includes("pdf");
  const sourceBlock = isPdf
    ? {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: base64 },
      }
    : {
        type: "image",
        source: {
          type: "base64",
          media_type: mimeType || "image/jpeg",
          data: base64,
        },
      };

  let res;
  try {
    res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
        max_tokens: 300,
        messages: [
          {
            role: "user",
            content: [sourceBlock, { type: "text", text: PROMPT }],
          },
        ],
      }),
    });
  } catch (e) {
    return { ok: false, error: e.message };
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      error: data?.error?.message || `Anthropic ${res.status}`,
    };
  }

  const text = (data?.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  const parsed = extractJson(text);
  if (!parsed) {
    return { ok: false, error: "could not parse model response" };
  }

  return {
    ok: true,
    isW9: Boolean(parsed.isW9),
    hasTin: Boolean(parsed.hasTin),
    tinType: parsed.tinType || null,
    last4: parsed.last4 ? String(parsed.last4).slice(-4) : null,
    signaturePresent: Boolean(parsed.signaturePresent),
    notes: typeof parsed.notes === "string" ? parsed.notes.slice(0, 300) : "",
  };
}

function extractJson(text) {
  if (!text) return null;
  // Model is told to return bare JSON, but tolerate code fences / stray prose.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}
