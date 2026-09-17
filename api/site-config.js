// Public, secret-free config the static site needs at runtime.
//
// Today that is just the click-to-call tracking number, so a Vercel env
// change can retarget every `tel:` link without regenerating HTML.

import { getTrackingNumber } from "./_lib/phone.js";

export const config = { runtime: "nodejs" };

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const tracking = getTrackingNumber();
  return res.status(200).json({
    trackingNumber: tracking.e164,
    trackingHref: tracking.href,
    trackingDisplay: tracking.display,
  });
}
