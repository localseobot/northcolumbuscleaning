// Getting the lead to the buyer, immediately.
//
// A lead that sits in a CRM is worthless — the buyer is paying for the chance
// to be the first person to call this homeowner back. So every lead fans out
// to both channels at once: a text they'll see in seconds, and an email with
// the full detail they can work from.
//
// The owner (OWNER_EMAIL) also gets a copy of every website form lead, so
// they can see exactly what was sold without opening the dashboard. Phone
// leads aren't copied: the call itself went to the buyer, not to a form.
//
// Nothing here is allowed to fail the capture that triggered it. If Resend is
// down or the buyer's number is wrong, the lead is still recorded — we return
// the errors so they show up in the function logs instead of losing the lead.

import { sendEmail } from "./resend.js";
import { sendGhlSms, INTERNAL_LINE } from "./ghl-sms.js";
import { buildLeadAlert, buildLeadSms } from "./email-templates/lead-alert.js";
import { getBuyer } from "./buyer.js";
import { signBuyerToken } from "./buyer-token.js";

function siteBase() {
  return (process.env.SITE_BASE_URL || "https://www.northcolumbuscleaning.com").replace(/\/$/, "");
}

/** The buyer's standing dashboard link. Safe to embed — it's their credential. */
export function dashboardUrl() {
  try {
    return `${siteBase()}/dashboard?t=${signBuyerToken()}`;
  } catch {
    // No signing secret configured yet — link out to the bare page rather than
    // blocking the alert. They'll be asked for their link when they land.
    return `${siteBase()}/dashboard`;
  }
}

/**
 * Where the owner's copy of each website form lead goes. None when
 * OWNER_EMAIL is unset, or when it is the buyer's own address: they already
 * get the lead, and a second identical email is just noise.
 */
export function ownerCopyEmail(env = process.env) {
  const owner = String(env.OWNER_EMAIL || "").trim();
  const buyer = String(env.BUYER_EMAIL || "").trim();
  if (!owner.includes("@")) return null;
  if (buyer && owner.toLowerCase() === buyer.toLowerCase()) return null;
  return owner;
}

/**
 * Text + email the buyer about a lead, and copy website leads to the owner.
 *
 * @param {object} lead  Same shape recordLead() was given, plus `billable`
 * @returns {Promise<{sms: object, email: object, ownerCopy: object}>}
 */
export async function deliverLead(lead) {
  const buyer = getBuyer();
  const url = dashboardUrl();
  const out = { sms: { skipped: true }, email: { skipped: true }, ownerCopy: { skipped: true } };
  const tasks = [];

  // The owner's copy goes out even before a buyer is set up — then it's the
  // only record anyone gets by email.
  const ownerTo = lead.channel === "web" ? ownerCopyEmail() : null;
  if (ownerTo) {
    const { subject, html } = buildLeadAlert({
      ...lead,
      dashboardUrl: url,
      copyNote: buyer.configured
        ? `Your copy. This lead was also sent to ${buyer.name}.`
        : "Your copy. No buyer is set up yet, so nobody else was sent this lead.",
    });
    tasks.push(
      sendEmail({ to: ownerTo, subject: `Copy: ${subject}`, html, tags: ["lead-alert-owner-copy"] })
        .then((r) => {
          out.ownerCopy = r;
        })
        .catch((e) => {
          out.ownerCopy = { error: e.message };
        }),
    );
  }

  if (!buyer.configured) {
    out.sms = out.email = { skipped: true, reason: "BUYER_EMAIL / BUYER_PHONE not set" };
    await Promise.all(tasks);
    return out;
  }

  if (buyer.phone) {
    tasks.push(
      sendGhlSms({
        to: buyer.phone,
        message: buildLeadSms({ ...lead, dashboardUrl: url }),
        firstName: buyer.name,
        tag: "internal:lead-buyer",
        // Internal line: this is a business-to-business notification, and it
        // must never come from the number homeowners know.
        fromNumber: INTERNAL_LINE,
      })
        .then((r) => {
          out.sms = r;
        })
        .catch((e) => {
          out.sms = { ok: false, error: e.message };
        }),
    );
  }

  if (buyer.email) {
    const { subject, html } = buildLeadAlert({ ...lead, dashboardUrl: url });
    tasks.push(
      sendEmail({ to: buyer.email, subject, html, tags: ["lead-alert"] })
        .then((r) => {
          out.email = r;
        })
        .catch((e) => {
          out.email = { error: e.message };
        }),
    );
  }

  await Promise.all(tasks);
  return out;
}
