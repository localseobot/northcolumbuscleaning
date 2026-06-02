// Weekly owner digest — shipped to admin@ every Monday morning. Pulls
// together the past 7 days of business activity from GHL: revenue,
// jobs completed, new bookings, recurring conversions, cancellations,
// negative feedback, and a watch list.
//
// Goal: 90 seconds to read; everything you need to decide what to focus
// on this week.

import { BRAND, wrapEmail } from "./_layout.js";

const M = BRAND;

function fmtMoney(n) {
  if (!Number.isFinite(n)) return "$0";
  return "$" + Math.round(n).toLocaleString();
}
function fmtDate(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}
function pct(curr, prev) {
  if (!prev || prev === 0) return curr > 0 ? "+∞" : "—";
  const delta = ((curr - prev) / prev) * 100;
  const sign = delta >= 0 ? "↑" : "↓";
  return `${sign} ${Math.abs(delta).toFixed(0)}%`;
}

function deltaBadge(curr, prev) {
  if (!prev || prev === 0) return "";
  const better = curr >= prev;
  const color = better ? "#047857" : "#b91c1c";
  return `<span style="display:inline-block;margin-left:6px;padding:2px 8px;border-radius:8px;font-size:11px;font-weight:900;letter-spacing:0.05em;background:${better ? "#ecfdf5" : "#fef2f2"};color:${color};">${pct(curr, prev)}</span>`;
}

function kpiCard({ label, value, sub, prev, color }) {
  const c = color || M.primary;
  return `<td style="padding:16px 14px;background:${M.bg};border:1px solid ${M.border};border-radius:12px;vertical-align:top;">
    <div style="font-size:11px;font-weight:900;letter-spacing:0.1em;text-transform:uppercase;color:${M.textMuted};margin-bottom:6px;">${label}</div>
    <div style="font-size:26px;font-weight:900;color:${c};line-height:1;">${value}${prev !== undefined && prev !== null ? deltaBadge(parseFloat(String(value).replace(/[$,]/g, "")), prev) : ""}</div>
    ${sub ? `<div style="margin-top:4px;font-size:12px;color:${M.textMuted};">${sub}</div>` : ""}
  </td>`;
}

function jobRow(job) {
  return `<tr style="border-top:1px solid ${M.border};">
    <td style="padding:10px 12px;font-size:13px;color:${M.textMuted};white-space:nowrap;">${fmtDate(job.completedAt)}</td>
    <td style="padding:10px 12px;font-size:14px;color:${M.text};">${job.customerName}</td>
    <td style="padding:10px 12px;font-size:13px;color:${M.textMuted};">${job.serviceType || "—"}${job.frequency ? ` · ${job.frequency}` : ""}</td>
    <td style="padding:10px 12px;text-align:right;font-size:14px;font-weight:700;color:${M.text};white-space:nowrap;">${job.value > 0 ? fmtMoney(job.value) : "—"}</td>
  </tr>`;
}

/**
 * Build the weekly digest email.
 *
 * @param {object} input
 * @param {string} input.weekStart            ISO date
 * @param {string} input.weekEnd              ISO date
 * @param {object} input.curr                 Current week metrics
 * @param {object} input.prev                 Previous week metrics (for deltas)
 * @param {Array}  input.completedJobs        [{date, customerName, serviceType, frequency, value}]
 * @param {Array}  input.wins                 ["Sarah moved to recurring", "..."]
 * @param {Array}  input.watchlist            ["Bob cancelled same-day", "..."]
 */
export function buildWeeklyDigest({
  weekStart,
  weekEnd,
  curr,
  prev = {},
  completedJobs = [],
  wins = [],
  watchlist = [],
}) {
  const rangeLabel = `${fmtDate(weekStart)}–${fmtDate(weekEnd)}`;
  const subject = `📊 Weekly digest · ${rangeLabel} · ${fmtMoney(curr.revenue || 0)} revenue`;

  const winsHtml =
    wins.length > 0
      ? `<div style="padding:8px 32px 24px;">
      <h2 style="margin:0 0 12px;font-size:18px;font-weight:900;color:${M.text};">🎉 Wins this week</h2>
      <ul style="margin:0;padding:0 0 0 22px;font-size:15px;line-height:1.65;color:${M.text};">
        ${wins.map((w) => `<li style="margin-bottom:6px;">${w}</li>`).join("")}
      </ul>
    </div>`
      : "";

  const watchHtml =
    watchlist.length > 0
      ? `<div style="padding:8px 32px 24px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fffbeb;border-left:4px solid #f59e0b;border-radius:6px;">
        <tr>
          <td style="padding:18px 22px;">
            <h2 style="margin:0 0 12px;font-size:16px;font-weight:900;color:#92400e;letter-spacing:0.04em;text-transform:uppercase;">⚠️ Watch list</h2>
            <ul style="margin:0;padding:0 0 0 22px;font-size:15px;line-height:1.65;color:${M.text};">
              ${watchlist.map((w) => `<li style="margin-bottom:6px;">${w}</li>`).join("")}
            </ul>
          </td>
        </tr>
      </table>
    </div>`
      : "";

  const jobsTable =
    completedJobs.length > 0
      ? `<div style="padding:8px 32px 24px;">
      <h2 style="margin:0 0 12px;font-size:18px;font-weight:900;color:${M.text};">Jobs completed (${completedJobs.length})</h2>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${M.bg};border:1px solid ${M.border};border-radius:12px;overflow:hidden;">
        <thead>
          <tr style="background:#ffffff;">
            <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:900;letter-spacing:0.08em;text-transform:uppercase;color:${M.textMuted};border-bottom:1px solid ${M.border};">Date</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:900;letter-spacing:0.08em;text-transform:uppercase;color:${M.textMuted};border-bottom:1px solid ${M.border};">Customer</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:900;letter-spacing:0.08em;text-transform:uppercase;color:${M.textMuted};border-bottom:1px solid ${M.border};">Service</th>
            <th style="padding:10px 12px;text-align:right;font-size:11px;font-weight:900;letter-spacing:0.08em;text-transform:uppercase;color:${M.textMuted};border-bottom:1px solid ${M.border};">Value</th>
          </tr>
        </thead>
        <tbody>${completedJobs.map(jobRow).join("")}</tbody>
      </table>
    </div>`
      : `<div style="padding:8px 32px 24px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${M.bg};border:1px dashed ${M.border};border-radius:12px;">
        <tr><td style="padding:24px;text-align:center;font-size:14px;color:${M.textMuted};">No jobs completed this week.</td></tr>
      </table>
    </div>`;

  const body = `
    <!-- Revenue hero -->
    <div style="padding:32px 32px 8px;text-align:center;">
      <div style="font-size:12px;font-weight:900;letter-spacing:0.12em;text-transform:uppercase;color:${M.textMuted};margin-bottom:8px;">
        ${rangeLabel}
      </div>
      <div style="font-size:48px;font-weight:900;color:${M.primary};line-height:1;letter-spacing:-1.5px;">
        ${fmtMoney(curr.revenue || 0)}
      </div>
      <div style="margin-top:6px;font-size:14px;color:${M.textMuted};">
        Revenue this week ${prev.revenue !== undefined ? deltaBadge(curr.revenue, prev.revenue) : ""}
      </div>
    </div>

    <!-- KPI grid -->
    <div style="padding:24px 32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;border-spacing:8px;">
        <tr>
          ${kpiCard({ label: "Jobs done", value: curr.jobsCompleted || 0, prev: prev.jobsCompleted })}
          ${kpiCard({ label: "New bookings", value: curr.newBookings || 0, prev: prev.newBookings })}
          ${kpiCard({ label: "Recurring +", value: curr.newRecurring || 0, sub: "first-time recurring", color: "#047857" })}
        </tr>
        <tr>
          ${kpiCard({ label: "Cancellations", value: curr.cancellations || 0, sub: curr.sameDayCancellations ? `${curr.sameDayCancellations} same-day` : "", prev: prev.cancellations, color: "#b91c1c" })}
          ${kpiCard({ label: "Avg ticket", value: fmtMoney(curr.avgTicket || 0), prev: prev.avgTicket })}
          ${kpiCard({ label: "Reviews", value: `${curr.reviewsReceived || 0}/${curr.reviewsRequested || 0}`, sub: "received / requested", color: "#047857" })}
        </tr>
      </table>
    </div>

    ${winsHtml}
    ${watchHtml}
    ${jobsTable}

    <!-- Action items -->
    <div style="padding:8px 32px 24px;">
      <h2 style="margin:0 0 12px;font-size:18px;font-weight:900;color:${M.text};">Suggested focus this week</h2>
      <ol style="margin:0;padding:0 0 0 22px;font-size:15px;line-height:1.65;color:${M.text};">
        <li style="margin-bottom:6px;">Check in on any contacts in the watch list above.</li>
        <li style="margin-bottom:6px;">Manually mark Google reviews you've spotted by tagging contacts with <code style="background:${M.bg};padding:2px 6px;border-radius:4px;font-size:13px;">left-google-review</code> so next week's digest can count them.</li>
        <li>Review the cleaner roster in GHL — anyone newly hired should be tagged <code style="background:${M.bg};padding:2px 6px;border-radius:4px;font-size:13px;">internal:cleaner</code> so they're eligible for shift coverage offers.</li>
      </ol>
    </div>
  `;

  return {
    subject,
    html: wrapEmail({
      subject,
      preheader: `${curr.jobsCompleted || 0} jobs · ${fmtMoney(curr.revenue || 0)} revenue · ${curr.newRecurring || 0} new recurring this week`,
      eyebrow: "Owner digest",
      headline: `Week of ${rangeLabel}`,
      body,
    }),
  };
}
