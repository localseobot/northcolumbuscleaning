// Weekly owner digest for the lead business.
//
// Replaces the old cleaning-operations digest, which reported on jobs
// completed and revenue booked — neither of which we do any more. This
// reports the only things that now matter: how many leads each channel
// produced, what the buyer owes, what they're closing, and whether anything
// needs a decision from us.
//
// Schedule (vercel.json): 0 13 * * 1 — Mondays 13:00 UTC = 9am ET.

import { listLeads, groupByMonth } from "../_lib/lead-ledger.js";
import { getBuyer, getPricing, priceLeads } from "../_lib/buyer.js";
import { sendEmail } from "../_lib/resend.js";
import { wrapEmail, BRAND } from "../_lib/email-templates/_layout.js";

export const config = { runtime: "nodejs" };

function isAuthorized(req) {
  if (!process.env.CRON_SECRET) return true;
  return req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
}

function money(n) {
  return "$" + Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function statRow(label, value, note) {
  return `<tr>
    <td style="padding:9px 0;border-bottom:1px solid ${BRAND.border};color:${BRAND.textMuted};font-size:14px;">${label}</td>
    <td style="padding:9px 0;border-bottom:1px solid ${BRAND.border};font-size:16px;font-weight:700;text-align:right;">${value}${
      note ? `<div style="font-size:12px;font-weight:400;color:${BRAND.textMuted};">${note}</div>` : ""
    }</td>
  </tr>`;
}

export default async function handler(req, res) {
  if (!isAuthorized(req)) return res.status(401).json({ error: "Unauthorized" });

  const to = process.env.OWNER_EMAIL || process.env.RESEND_BCC_OPS;
  if (!to) return res.status(200).json({ ok: true, skipped: "OWNER_EMAIL not set" });

  let leads;
  try {
    leads = await listLeads({ limit: 250 });
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }

  const weekAgo = Date.now() - 7 * 86400000;
  const week = leads.filter((l) => new Date(l.receivedAt || 0).getTime() >= weekAgo);
  const prevWeek = leads.filter((l) => {
    const t = new Date(l.receivedAt || 0).getTime();
    return t >= weekAgo - 7 * 86400000 && t < weekAgo;
  });

  const pricing = getPricing();
  const buyer = getBuyer();
  const thisMonth = groupByMonth(leads)[0];
  const monthBilling = thisMonth ? priceLeads(thisMonth[1], pricing) : null;

  const openDisputes = leads.filter((l) => l.dispute === "open");
  const unworked = week.filter((l) => l.outcome === "new").length;
  const delta = week.length - prevWeek.length;

  const body = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px;">
      ${statRow("Leads delivered", String(week.length),
        `${week.filter((l) => l.channel === "web").length} website · ${week.filter((l) => l.channel === "phone").length} phone` +
        ` · ${delta === 0 ? "level with" : delta > 0 ? `${delta} more than` : `${Math.abs(delta)} fewer than`} last week`)}
      ${statRow("Billable this week", String(week.filter((l) => l.billable).length),
        week.length - week.filter((l) => l.billable).length > 0
          ? `${week.length - week.filter((l) => l.billable).length} free (repeat or credited)`
          : "")}
      ${monthBilling ? statRow("Owed month to date", money(monthBilling.total),
        monthBilling.mode === "per_lead"
          ? `${monthBilling.billable} × ${money(monthBilling.unitPrice)}`
          : `${monthBilling.billable} of ${monthBilling.included} included`) : ""}
      ${statRow("Won by the buyer", String(week.filter((l) => l.outcome === "won").length), "From this week's leads")}
    </table>

    ${
      openDisputes.length
        ? `<p style="margin:0 0 16px;padding:12px 14px;background:#fdf8ec;border-radius:8px;font-size:14px;">
             <strong>${openDisputes.length} dispute${openDisputes.length > 1 ? "s" : ""} waiting on you.</strong>
             Review them at <code>/api/admin/resolve-dispute?token=…</code>
           </p>`
        : ""
    }
    ${
      unworked
        ? `<p style="margin:0 0 16px;padding:12px 14px;background:#f1f5f9;border-radius:8px;font-size:14px;">
             ${unworked} of this week's leads ${unworked === 1 ? "is" : "are"} still marked New —
             ${buyer.name} may not be working them.
           </p>`
        : ""
    }
    <p style="margin:0;font-size:13px;color:${BRAND.textMuted};">
      ${leads.length} leads delivered all time.
    </p>`;

  const result = await sendEmail({
    to,
    subject: `Lead week: ${week.length} delivered${monthBilling ? ` · ${money(monthBilling.total)} MTD` : ""}`,
    html: wrapEmail({
      subject: "Weekly lead digest",
      preheader: `${week.length} leads this week`,
      eyebrow: "Weekly digest",
      headline: "Your lead week",
      body,
      includeFooter: false,
    }),
  });

  return res.status(200).json({ ok: true, week: week.length, email: result });
}
