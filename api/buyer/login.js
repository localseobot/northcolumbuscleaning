// Self-serve sign-in for the buyer dashboard.
//
// POST /api/buyer/login  { email }
//
// If the address may see the dashboard (BUYER_EMAIL, OWNER_EMAIL or one of
// DASHBOARD_EMAILS) we email it a fresh signed link. The reply is the same
// whether or not the address is on the account, so this endpoint cannot be
// used to discover who is.
//
// Why a link and not a six-digit code: a code needs somewhere to count wrong
// guesses, and this app has no database. A signed link is unguessable, so
// there is nothing to brute-force. Opening it lands on /dashboard, which keeps
// it in that browser; the device then stays signed in until the link expires.

import { signBuyerToken, setBuyerCors } from "../_lib/buyer-token.js";
import { canSignInToDashboard } from "../_lib/buyer.js";
import { sendEmail } from "../_lib/resend.js";
import { wrapEmail, cta } from "../_lib/email-templates/_layout.js";

export const config = { runtime: "nodejs" };

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// A sign-in from the dashboard lasts this long on that device. The standing
// link the admin mints by hand (/api/admin/buyer-link) keeps its one-year life.
export const SIGN_IN_TTL_DAYS = 30;
export const SIGN_IN_TTL_SECONDS = SIGN_IN_TTL_DAYS * 24 * 60 * 60;

// Nuisance guard so nobody can flood the buyer's inbox by hammering the form.
// Per warm instance only; a real attacker gets at most one email a minute per
// address per instance, which is the most we can do without a store.
const COOLDOWN_MS = 60 * 1000;
const lastSent = new Map();

const GENERIC_REPLY = {
  ok: true,
  message:
    "If that address is on the account, a sign-in link is on its way. " +
    "Give it a minute and check your spam folder if it hasn't arrived.",
};

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function siteBase() {
  return (process.env.SITE_BASE_URL || "https://www.northcolumbuscleaning.com").replace(/\/$/, "");
}

/** The email that carries the sign-in link. Exported so it can be previewed. */
export function signInEmail({ url, ttlDays = SIGN_IN_TTL_DAYS }) {
  return {
    subject: "Your North Columbus Cleaning dashboard sign-in link",
    html: wrapEmail({
      subject: "Sign in to your lead dashboard",
      preheader: "Tap the button to open your lead dashboard.",
      eyebrow: "Lead dashboard",
      headline: "Here's your sign-in link",
      body: `
        <p style="margin:0 0 18px;font-size:15px;">
          Tap the button to open your lead dashboard. It signs you in on this
          device for ${ttlDays} days, so you won't need to do this every time.
        </p>
        <p style="margin:0 0 18px;">${cta("Open my dashboard", url)}</p>
        <p style="margin:0 0 12px;font-size:13px;color:#475569;">
          If the button doesn't work, copy this address into your browser:<br>
          <a href="${esc(url)}" style="color:#1a4d2e;word-break:break-all;">${esc(url)}</a>
        </p>
        <p style="margin:0;font-size:13px;color:#475569;">
          Didn't ask for this? Ignore it &mdash; nothing changes unless the link is
          opened. Keep it private: anyone holding it can see your leads.
        </p>`,
      includeFooter: false,
    }),
  };
}

export default async function handler(req, res) {
  setBuyerCors(res);
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: "Invalid JSON" });
    }
  }
  body = body || {};

  const email = String(body.email || "").trim().toLowerCase();
  if (!email || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "Please enter a valid email address." });
  }

  // Unknown address: same reply, no email, no hint.
  if (!canSignInToDashboard(email)) return res.status(200).json(GENERIC_REPLY);

  const now = Date.now();
  if (now - (lastSent.get(email) || 0) < COOLDOWN_MS) return res.status(200).json(GENERIC_REPLY);
  lastSent.set(email, now);

  let url;
  try {
    url = `${siteBase()}/dashboard?t=${signBuyerToken({ ttlSeconds: SIGN_IN_TTL_SECONDS })}`;
  } catch {
    return res.status(503).json({ error: "Sign-in isn't switched on yet. Please contact us for your link." });
  }

  const { subject, html } = signInEmail({ url });
  const sent = await sendEmail({ to: email, subject, html, tags: ["dashboard-signin"] }).catch((e) => ({
    error: e.message,
  }));

  // A known address whose email failed to go out needs to hear that, even
  // though it confirms the address is on the account. There are two addresses
  // on it and both are printed on the site, so that is no secret worth a
  // silent failure.
  if (!sent || sent.error || sent.skipped) {
    lastSent.delete(email);
    return res.status(502).json({ error: "We couldn't send the email just now. Please try again in a minute." });
  }

  return res.status(200).json(GENERIC_REPLY);
}
