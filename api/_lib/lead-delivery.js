// Getting the lead to the buyer, immediately.
//
// A lead that sits in a CRM is worthless — the buyer is paying for the chance
// to be the first person to call this homeowner back. So every lead fans out
// to both channels at once: a text they'll see in seconds, and an email with
// the full detail they can work from.
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
 * Text + email the buyer about a lead.
 *
 * @param {object} lead  Same shape recordLead() was given, plus `billable`
 * @returns {Promise<{sms: object, email: object}>}
 */
export async function deliverLead(lead) {
  const buyer = getBuyer();
  const url = dashboardUrl();
  const out = { sms: { skipped: true }, email: { skipped: true } };

  if (!buyer.configured) {
    out.sms = out.email = { skipped: true, reason: "BUYER_EMAIL / BUYER_PHONE not set" };
    return out;
  }

  const tasks = [];

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
