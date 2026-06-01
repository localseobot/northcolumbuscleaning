// Email-capture endpoint for the Summer Shine popup.
//
// POST { email, firstName? }
// Returns { ok, code }
//
// Behavior:
//   - Upserts the visitor as a contact in GHL (matched by email)
//   - Applies tags: source:website, promo:summer-shine, intent:quote
//   - Returns the promo code so the popup can display it client-side
//
// Failure mode: if GHL is unreachable, we still return the code so the
// visitor isn't punished by infrastructure. The error is logged in the
// response body so we can see it in Vercel function logs.

import { ghl } from "./_lib/ghl.js";

export const config = { runtime: "nodejs" };

const PROMO_CODE = "SUMMER30";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default async function handler(req, res) {
  // CORS — same origin in practice but be permissive for the static site.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

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
  const firstName = String(body.firstName || "").trim().slice(0, 60);

  if (!email || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "Please enter a valid email address." });
  }

  const result = { ok: true, code: PROMO_CODE };

  if (!process.env.GHL_PIT) {
    result.warning = "ghl-not-configured";
    return res.status(200).json(result);
  }

  try {
    const upsert = await ghl({
      method: "POST",
      path: "/contacts/upsert",
      body: {
        locationId: process.env.GHL_LOCATION_ID,
        email,
        firstName: firstName || undefined,
        country: "US",
        source: "Website — Summer Shine popup",
      },
    });
    const contactId = upsert?.contact?.id || upsert?.id || null;
    result.contactId = contactId;

    if (contactId) {
      try {
        await ghl({
          method: "POST",
          path: `/contacts/${contactId}/tags`,
          body: {
            tags: ["source:website", "promo:summer-shine", "intent:quote"],
          },
        });
      } catch (e) {
        result.tagWarning = e.message;
      }
    }
  } catch (e) {
    result.ghlError = e.message;
    // Still send the code — visitor experience first.
  }

  return res.status(200).json(result);
}
