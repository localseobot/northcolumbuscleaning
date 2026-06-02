// Finds available cleaners for a target date.
//
// Source of truth: GHL contacts tagged `internal:cleaner`. The cleaner
// list grows automatically as the cron sends provider SMS (each send
// upserts + tags), so once a cleaner gets their first job, they're on
// the roster. To pre-seed cleaners who haven't worked a job yet, the
// owner can tag the contact manually in GHL.
//
// "Available" = tagged cleaner AND not assigned to any Booked-stage opp
// on the target date.

import { ghl } from "./ghl.js";
import {
  OPP_APPOINTMENT_DATE,
  OPP_PROVIDER_PHONE,
} from "./ghl-fields.js";

const SALES_PIPELINE_ID = "6YDehH2kNtHrdfJaEQfa";
const STAGE_BOOKED = "a1df2c52-9211-4e13-a920-0c17ab00eff9";

function lower(v) {
  return String(v || "").toLowerCase();
}
function normPhone(raw) {
  if (!raw) return "";
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  if (String(raw).startsWith("+") && digits.length >= 10) return "+" + digits;
  return "";
}
function getCfRaw(cfs, id) {
  if (!Array.isArray(cfs)) return null;
  const f = cfs.find((c) => c.id === id);
  if (!f) return null;
  return (
    f.fieldValueString ||
    f.fieldValueNumber ||
    (f.fieldValueDate ? new Date(f.fieldValueDate).toISOString() : null) ||
    f.fieldValue ||
    null
  );
}

/**
 * @param {object} opts
 * @param {string} opts.targetDate     YYYY-MM-DD — the day to check availability for
 * @param {string[]} [opts.excludeIds] Cleaner contact IDs to skip (e.g. the one who called out)
 * @returns {Promise<Array<{id: string, firstName: string, lastName: string, phone: string}>>}
 */
export async function findAvailableCleaners({ targetDate, excludeIds = [] }) {
  // 1. Pull all contacts tagged internal:cleaner
  const search = await ghl({
    method: "POST",
    path: "/contacts/search",
    body: {
      locationId: process.env.GHL_LOCATION_ID,
      pageLimit: 100,
      filters: [
        {
          field: "tags",
          operator: "contains",
          value: "internal:cleaner",
        },
      ],
    },
  }).catch(() => ({ contacts: [] }));

  const allCleaners = (search?.contacts || [])
    .filter((c) => !excludeIds.includes(c.id))
    .filter((c) => c.phone)
    .map((c) => ({
      id: c.id,
      firstName: c.firstNameRaw || c.firstName || "",
      lastName: c.lastNameRaw || c.lastName || "",
      phone: normPhone(c.phone),
      tags: (c.tags || []).map(lower),
    }))
    .filter((c) => c.phone && !c.tags.includes("do-not-contact"));

  if (allCleaners.length === 0) return [];

  // 2. Pull all Booked-stage opps for the target date to know who's busy
  const oppsSearch = await ghl({
    method: "POST",
    path: "/opportunities/search",
    body: {
      location_id: process.env.GHL_LOCATION_ID,
      pipeline_id: SALES_PIPELINE_ID,
      pipeline_stage_id: STAGE_BOOKED,
      status: "open",
      limit: 100,
      getCustomFields: true,
    },
  }).catch(() => ({ opportunities: [] }));

  const dayMs = new Date(targetDate + "T00:00:00Z").getTime();
  const nextDayMs = dayMs + 86400000;
  const busyPhones = new Set();
  for (const opp of oppsSearch?.opportunities || []) {
    const dt = getCfRaw(opp.customFields, OPP_APPOINTMENT_DATE);
    if (!dt) continue;
    const t = new Date(dt).getTime();
    if (t < dayMs || t >= nextDayMs) continue;
    const phone = normPhone(getCfRaw(opp.customFields, OPP_PROVIDER_PHONE));
    if (phone) busyPhones.add(phone);
  }

  // 3. Subtract busy from total
  return allCleaners.filter((c) => !busyPhones.has(c.phone));
}
