// Admin-only: send a contractor their onboarding link.
//
// This is the ONLY place onboarding tokens are minted. Gated by ADMIN_TOKEN.
//
// POST (or GET) with ?token=ADMIN_TOKEN and one of:
//   contactId | email | phone   to identify the contractor
//
// Steps: look up the contact, write a fresh random nonce to its
// onboarding_token_nonce field (revoking any prior link), sign a token bound
// to that nonce, and send the /onboard?t=<token> link by SMS (internal line)
// and email. Tags the contact onboarding:invited.

import { ghl } from "../_lib/ghl.js";
import { sendGhlSms, INTERNAL_LINE } from "../_lib/ghl-sms.js";
import { sendEmail } from "../_lib/resend.js";
import { signToken, newNonce } from "../_lib/onboard-token.js";
import { CONTACT_ONBOARDING_TOKEN_NONCE } from "../_lib/onboarding-fields.js";

export const config = { runtime: "nodejs" };

function siteBase() {
  return (process.env.SITE_BASE_URL || "https://northcolumbuscleaning.com").replace(
    /\/$/,
    "",
  );
}

export default async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Auth.
  const token = req.query?.token || req.headers["x-admin-token"];
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }
  body = body || {};

  const contactIdIn = String(body.contactId || req.query?.contactId || "").trim();
  const email = String(body.email || req.query?.email || "").trim().toLowerCase();
  const phone = String(body.phone || req.query?.phone || "").trim();

  if (!contactIdIn && !email && !phone) {
    return res
      .status(400)
      .json({ error: "Provide contactId, email, or phone." });
  }

  if (!process.env.GHL_PIT) {
    return res.status(500).json({ error: "GHL not configured" });
  }

  // 1. Resolve the contact.
  let contact;
  try {
    if (contactIdIn) {
      const resp = await ghl({ method: "GET", path: `/contacts/${contactIdIn}` });
      contact = resp?.contact || resp;
    } else {
      const search = await ghl({
        method: "POST",
        path: "/contacts/search",
        body: {
          locationId: process.env.GHL_LOCATION_ID,
          page: 1,
          pageLimit: 1,
          filters: [
            {
              field: email ? "email" : "phone",
              operator: "eq",
              value: email || phone,
            },
          ],
        },
      });
      contact = (search?.contacts || [])[0];
    }
  } catch (e) {
    return res.status(502).json({ error: "contact lookup failed", detail: e.message });
  }

  const contactId = contact?.id;
  if (!contactId) {
    return res.status(404).json({ error: "Contact not found" });
  }

  // 2. Write a fresh nonce (revokes any older outstanding link).
  const nonce = newNonce();
  try {
    await ghl({
      method: "PUT",
      path: `/contacts/${contactId}`,
      body: {
        customFields: [{ id: CONTACT_ONBOARDING_TOKEN_NONCE, field_value: nonce }],
      },
    });
  } catch (e) {
    return res.status(502).json({ error: "could not set nonce", detail: e.message });
  }

  // 3. Mint the token + build the link.
  const tk = signToken({ contactId, nonce });
  const link = `${siteBase()}/onboard?t=${encodeURIComponent(tk)}`;
  const firstName = contact.firstName || "there";

  const result = { ok: true, contactId, link };

  // 4. Send SMS (internal line — this is a cleaner/contractor message).
  if (contact.phone) {
    const smsRes = await sendGhlSms({
      to: contact.phone,
      firstName: contact.firstName,
      fromNumber: INTERNAL_LINE,
      tag: "onboarding:invited",
      message: `Hi ${firstName}, welcome to North Columbus Cleaning! Complete your onboarding here (W-9, contractor agreement, and a quick review): ${link}`,
    });
    result.sms = smsRes.ok ? "sent" : smsRes.error;
  } else {
    result.sms = "no phone on contact";
  }

  // 5. Send email.
  if (contact.email) {
    const html = `
      <div style="font-family:Inter,Arial,sans-serif;color:#2b2b2b;max-width:520px">
        <h2 style="color:#1a4d2e">Welcome to North Columbus Cleaning, ${escapeHtml(firstName)}!</h2>
        <p>You're almost ready to start taking jobs. Please complete your onboarding — it takes just a few minutes:</p>
        <ul>
          <li>Fill out or upload your <strong>W-9</strong></li>
          <li>Sign the <strong>contractor agreement</strong></li>
          <li>Review our <strong>onboarding document &amp; checklist</strong></li>
        </ul>
        <p style="margin:24px 0">
          <a href="${link}" style="background:#1a4d2e;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:bold">Start onboarding</a>
        </p>
        <p style="font-size:14px">New to the team? Read the <a href="${siteBase()}/onboarding-guide">onboarding guide</a> to see how everything works.</p>
        <p style="font-size:13px;color:#666">If the button doesn't work, paste this link into your browser:<br>${link}</p>
        <p style="font-size:13px;color:#666">This link is personal to you and expires in 14 days.</p>
      </div>`;
    const emailRes = await sendEmail({
      to: contact.email,
      subject: "Complete your North Columbus Cleaning onboarding",
      html,
      tags: ["onboarding", "invite"],
    });
    result.email = emailRes.id ? "sent" : emailRes.skipped ? emailRes.reason : emailRes.error;
  } else {
    result.email = "no email on contact";
  }

  // 6. Tag (best-effort; SMS path may already have tagged).
  try {
    await ghl({
      method: "POST",
      path: `/contacts/${contactId}/tags`,
      body: { tags: ["onboarding:invited"] },
    });
  } catch (_) {
    /* best-effort */
  }

  return res.status(200).json(result);
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
