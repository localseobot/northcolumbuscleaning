// Thin Anthropic Messages API wrapper.
//
// Env vars (set in Vercel):
//   ANTHROPIC_API_KEY    Required. From https://console.anthropic.com/settings/keys
//   CLAUDE_MODEL         Optional override; defaults to claude-haiku-4-5
//                        (fast + cheap; right tier for short classification tasks)
//
// Returns the model's first text content block. For structured output,
// the caller is responsible for prompting JSON and parsing it.

const DEFAULT_MODEL = "claude-haiku-4-5";

/**
 * Call the Anthropic Messages API.
 *
 * @param {object} opts
 * @param {Array<{role: string, content: string}>} opts.messages
 * @param {string} [opts.system]         System prompt
 * @param {string} [opts.model]          Override model
 * @param {number} [opts.maxTokens=512]
 * @param {number} [opts.temperature=0]  0 by default for deterministic classification
 * @returns {Promise<{text: string, usage: object}>}
 */
export async function callClaude({
  messages,
  system,
  model,
  maxTokens = 512,
  temperature = 0,
}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const body = {
    model: model || process.env.CLAUDE_MODEL || DEFAULT_MODEL,
    max_tokens: maxTokens,
    temperature,
    messages,
  };
  if (system) body.system = system;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = await res.json();
  if (!res.ok) {
    throw new Error(
      `Anthropic ${res.status}: ${payload?.error?.message || JSON.stringify(payload)}`,
    );
  }
  const text = (payload?.content || [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("");
  return { text, usage: payload?.usage || {}, raw: payload };
}

/**
 * Parse JSON from Claude's response, tolerating common edge cases
 * (markdown fences, leading prose).
 * @param {string} text
 * @returns {object|null}
 */
export function parseClaudeJson(text) {
  if (!text) return null;
  // Strip ```json ... ``` fences if present
  let s = text.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  }
  // Find the first { and last } so we ignore leading/trailing prose
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch {
    return null;
  }
}
