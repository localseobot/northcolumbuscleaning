// Phone-number helpers shared by the public tracking-number overlay and the
// GHL call webhook. Keep these free of I/O so tests can exercise them without
// talking to GoHighLevel.

/** Fallback shown on the site and used when TRACKING_NUMBER is unset. */
export const FALLBACK_TRACKING_E164 = "+16143522588";

export function toE164(raw) {
  const s = raw === null || raw === undefined ? "" : String(raw).trim();
  if (!s) return "";
  const digits = s.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (s.startsWith("+") && digits.length >= 10) return `+${digits}`;
  return "";
}

/** +16143522588 → "(614) 352-2588". Falls back to the E.164 string. */
export function formatUsDisplay(e164) {
  const normalized = toE164(e164);
  const digits = normalized.replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (ten.length !== 10) return normalized || String(e164 || "");
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}

/**
 * The number homeowners should dial. This is the GHL tracking number, never
 * the buyer's personal line.
 *
 * Resolution: TRACKING_NUMBER → GHL_FROM_NUMBER → the number already printed
 * on the site.
 */
export function getTrackingNumber(env = process.env) {
  const raw = String(env.TRACKING_NUMBER || env.GHL_FROM_NUMBER || "").trim();
  const e164 = toE164(raw) || FALLBACK_TRACKING_E164;
  return {
    e164,
    href: `tel:${e164}`,
    display: formatUsDisplay(e164),
  };
}
