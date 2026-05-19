// Weekly call-quality audit — finds Maya calls flagged for review or with
// quality issues, summarizes them, and texts the owner via the GHL number.
//
// Designed to be invoked on a schedule:
//   - Vercel Cron (preferred — add to vercel.json):
//       { "crons": [{ "path": "/api/admin/audit-calls", "schedule": "0 14 * * 1" }] }
//     Vercel Cron jobs hit the URL with no auth headers, so we accept the
//     CRON_SECRET via either ?token= query param OR Authorization: Bearer.
//   - External cron (cron-job.org, GitHub Actions): hit the URL weekly.
//
// What it does:
//   1. Pulls last 7 days of contacts tagged source:maya
//   2. Filters those with `needs-review` tag (Taylor's call-quality flags) OR
//      that landed in New Lead and are >48h old (stale)
//   3. Builds a digest and texts it to MANAGER_PHONE via GHL
//
// Required env vars: ADMIN_TOKEN, GHL_PIT, GHL_LOCATION_ID, MANAGER_PHONE
// Optional: GHL_FROM_NUMBER

import { ghl } from "../_lib/ghl.js";
import { sendGhlSms } from "../_lib/ghl-sms.js";

export const config = { runtime: "nodejs" };

const SALES_PIPELINE_ID = "6YDehH2kNtHrdfJaEQfa";
const STAGE_NEW_LEAD = "4bb733e7-d38d-4cb0-afb8-512406509144";

function daysAgo(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

function checkAuth(req) {
  // Accept either:
  //   - ADMIN_TOKEN via ?token=… (manual trigger from browser / curl)
  //   - CRON_SECRET via Authorization: Bearer … (Vercel Cron jobs send this
  //     automatically; CRON_SECRET is provided by Vercel for the project)
  const auth = req.headers?.authorization || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (process.env.CRON_SECRET && bearer === process.env.CRON_SECRET) return true;
  if (process.env.ADMIN_TOKEN) {
    const tok = req.query?.token;
    if (tok === process.env.ADMIN_TOKEN) return true;
    if (bearer === process.env.ADMIN_TOKEN) return true;
  }
  return false;
}

export default async function handler(req, res) {
  if (!checkAuth(req)) {
    return res.status(401).json({ error: "unauthorized" });
  }
  if (!process.env.GHL_PIT) {
    return res.status(503).json({ error: "GHL_PIT not set" });
  }

  const result = { ok: true, audited: {} };

  try {
    // 1. Pull recent Maya contacts
    const recent = await ghl({
      method: "GET",
      path: "/contacts/",
      query: { locationId: process.env.GHL_LOCATION_ID, limit: 100 },
    });
    const since = daysAgo(7);
    const mayaContacts = (recent?.contacts || []).filter((c) => {
      const tags = c.tags || [];
      if (!tags.includes("source:maya")) return false;
      return c.dateAdded && new Date(c.dateAdded) >= since;
    });

    // 2. Pull stale New Lead opps (>48h)
    const ops = await ghl({
      method: "GET",
      path: "/opportunities/search",
      query: {
        location_id: process.env.GHL_LOCATION_ID,
        pipeline_id: SALES_PIPELINE_ID,
        pipeline_stage_id: STAGE_NEW_LEAD,
        limit: 100,
      },
    });
    const staleCutoff = daysAgo(2).getTime();
    const staleLeads = (ops?.opportunities || [])
      .filter((o) => o.dateAdded && new Date(o.dateAdded).getTime() < staleCutoff)
      .sort((a, b) => new Date(a.dateAdded) - new Date(b.dateAdded));

    // 3. Calls that need review
    const flagged = mayaContacts.filter((c) =>
      (c.tags || []).includes("needs-review"),
    );

    result.audited.callsLast7d = mayaContacts.length;
    result.audited.staleLeads = staleLeads.length;
    result.audited.flaggedCalls = flagged.length;

    // 4. Skip the SMS if nothing actionable
    if (!flagged.length && !staleLeads.length) {
      result.smsSent = false;
      result.reason = "nothing to report";
      return res.status(200).json(result);
    }

    // 5. Build the digest
    const lines = [
      `🧾 Weekly call audit — North Columbus Cleaning`,
      `Calls (7d): ${mayaContacts.length}`,
    ];
    if (flagged.length) {
      lines.push("");
      lines.push(`⚠️ ${flagged.length} call(s) Taylor flagged for review:`);
      for (const c of flagged.slice(0, 5)) {
        const name = [c.firstName, c.lastName].filter(Boolean).join(" ") || "(unknown)";
        lines.push(`• ${name} ${c.phone || ""}`);
      }
      if (flagged.length > 5) lines.push(`...and ${flagged.length - 5} more`);
    }
    if (staleLeads.length) {
      lines.push("");
      lines.push(`⏰ ${staleLeads.length} New Lead opp(s) >48h old:`);
      for (const o of staleLeads.slice(0, 5)) {
        const age = Math.round(
          (Date.now() - new Date(o.dateAdded).getTime()) / 86400000,
        );
        lines.push(`• ${o.name || "(unnamed)"} — ${age}d old`);
      }
      if (staleLeads.length > 5) lines.push(`...and ${staleLeads.length - 5} more`);
    }
    lines.push("");
    lines.push(`Full view: https://www.northcolumbuscleaning.com/api/admin/calls?token=…`);

    const message = lines.join("\n").slice(0, 1500);

    const to = process.env.MANAGER_PHONE;
    if (!to) {
      result.smsSent = false;
      result.reason = "MANAGER_PHONE not set";
      result.preview = message;
      return res.status(200).json(result);
    }

    const smsResp = await sendGhlSms({
      to,
      message,
      firstName: "Manager",
      tag: "internal:manager",
    });
    result.smsSent = smsResp.ok;
    if (!smsResp.ok) result.smsError = smsResp.error;
    result.preview = message;
    return res.status(200).json(result);
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
