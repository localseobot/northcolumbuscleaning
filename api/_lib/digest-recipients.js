// Who gets the Monday weekly lead digest.
//
// Default recipients (no DIGEST_EMAILS needed):
//   OWNER_EMAIL   Owner / ops copy. Documented go-live: devyn@localseobot.com
//                 Falls back to RESEND_BCC_OPS if OWNER_EMAIL is unset.
//   BUYER_EMAIL   Buyer copy. Confirmed: contact@allcleansol.com
//
// Optional:
//   DIGEST_EMAILS Comma-separated override. When set, this list is used
//                 instead of OWNER_EMAIL + BUYER_EMAIL. Roles are still
//                 inferred when an address matches those env vars.
//
// Addresses are de-duplicated case-insensitively. Each recipient is sent
// as To: (never buyer-on-BCC-only) so Resend delivers a real inbox copy.

function trimEmail(value) {
  return String(value || "").trim();
}

function normalizeEmail(value) {
  return trimEmail(value).toLowerCase();
}

export function parseEmailList(raw) {
  return String(raw || "")
    .split(/[,;]+/)
    .map((part) => trimEmail(part))
    .filter((part) => part.includes("@"));
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ email: string, role: "owner" | "buyer" | "digest" }[]}
 */
export function resolveDigestRecipients(env = process.env) {
  const owner = trimEmail(env.OWNER_EMAIL || env.RESEND_BCC_OPS);
  const buyer = trimEmail(env.BUYER_EMAIL);
  const override = parseEmailList(env.DIGEST_EMAILS);
  const seen = new Set();
  const recipients = [];

  function add(email, role) {
    const key = normalizeEmail(email);
    if (!key || seen.has(key)) return;
    seen.add(key);
    recipients.push({ email: trimEmail(email), role });
  }

  function roleFor(email) {
    const key = normalizeEmail(email);
    if (owner && key === normalizeEmail(owner)) return "owner";
    if (buyer && key === normalizeEmail(buyer)) return "buyer";
    return "digest";
  }

  if (override.length) {
    for (const email of override) add(email, roleFor(email));
    return recipients;
  }

  if (owner) add(owner, "owner");
  if (buyer) add(buyer, "buyer");
  return recipients;
}

export function digestSubject({ role, weekCount, mtdLabel }) {
  const count = Number(weekCount) || 0;
  if (role === "buyer") {
    return `Your North Columbus Cleaning leads this week · ${count} delivered`;
  }
  return `Lead week: ${count} delivered${mtdLabel ? ` · ${mtdLabel} MTD` : ""}`;
}
