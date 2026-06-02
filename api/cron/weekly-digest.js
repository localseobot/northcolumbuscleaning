// Weekly cron — sends the owner digest every Monday at 9am ET.
//
// Schedule (vercel.json): 0 13 * * 1 (Mondays at 13:00 UTC = 9am ET)
//
// To send to a different address, set OWNER_DIGEST_EMAIL. Defaults to
// admin@northcolumbuscleaning.com.

import { sendEmail } from "../_lib/resend.js";
import { gatherWeeklyDigestData } from "../_lib/digest-data.js";
import { buildWeeklyDigest } from "../_lib/email-templates/weekly-digest.js";

export const config = { runtime: "nodejs" };

function isAuthorized(req) {
  if (!process.env.CRON_SECRET) return true;
  return req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
}

export default async function handler(req, res) {
  if (!isAuthorized(req)) return res.status(401).json({ error: "Unauthorized" });

  // Window: previous Monday 00:00 ET → this Monday 00:00 ET. We
  // compute in UTC and accept a few hours of slop at the DST boundary
  // (the headline numbers don't shift over 1-2 boundary jobs).
  const now = new Date();
  const weekEnd = new Date(now);
  weekEnd.setUTCHours(0, 0, 0, 0);
  // Roll back to the most recent Monday
  while (weekEnd.getUTCDay() !== 1) {
    weekEnd.setUTCDate(weekEnd.getUTCDate() - 1);
  }
  const weekStart = new Date(weekEnd.getTime() - 7 * 86400000);

  const result = {
    ok: true,
    ranAt: new Date().toISOString(),
    weekStart: weekStart.toISOString(),
    weekEnd: weekEnd.toISOString(),
  };

  try {
    const data = await gatherWeeklyDigestData({ weekStart, weekEnd });
    const { subject, html } = buildWeeklyDigest(data);
    const to =
      process.env.OWNER_DIGEST_EMAIL || "admin@northcolumbuscleaning.com";
    const emailRes = await sendEmail({
      to,
      subject,
      html,
      tags: ["weekly-digest"],
    });
    result.to = to;
    result.subject = subject;
    result.metrics = data.curr;
    result.emailId = emailRes.id;
    if (!emailRes.id) {
      result.ok = false;
      result.emailError = emailRes.reason || emailRes.error;
    }
  } catch (e) {
    result.ok = false;
    result.error = e.message;
  }

  return res.status(200).json(result);
}
