// Mint (and optionally email) the buyer's dashboard link.
//
// GET  /api/admin/buyer-link?token=ADMIN_TOKEN           → returns the link
// GET  /api/admin/buyer-link?token=ADMIN_TOKEN&send=1    → emails it to BUYER_EMAIL
//
// This is the only place buyer links are created. To revoke every link that
// has ever been issued, change BUYER_ACCESS_NONCE in Vercel and mint a new one.

import { signBuyerToken, currentNonce } from "../_lib/buyer-token.js";
import { getBuyer } from "../_lib/buyer.js";
import { sendEmail } from "../_lib/resend.js";
import { wrapEmail, cta } from "../_lib/email-templates/_layout.js";

export const config = { runtime: "nodejs" };

function isAuthorized(req) {
  const token = req.query?.token || req.headers["x-admin-token"];
  if (!process.env.ADMIN_TOKEN) return false;
  return String(token || "").trim() === String(process.env.ADMIN_TOKEN).trim();
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!isAuthorized(req)) return res.status(401).json({ error: "Unauthorized" });

  const base = (process.env.SITE_BASE_URL || "https://www.northcolumbuscleaning.com").replace(/\/$/, "");

  let url;
  try {
    url = `${base}/dashboard?t=${signBuyerToken()}`;
  } catch (e) {
    return res.status(503).json({ error: e.message });
  }

  const buyer = getBuyer();
  const out = { ok: true, url, nonce: currentNonce(), buyer: { name: buyer.name, email: buyer.email } };

  if (String(req.query?.send || "") === "1") {
    if (!buyer.email) {
      out.emailed = { skipped: true, reason: "BUYER_EMAIL not set" };
    } else {
      out.emailed = await sendEmail({
        to: buyer.email,
        subject: "Your North Columbus Cleaning lead dashboard",
        html: wrapEmail({
          subject: "Your lead dashboard",
          preheader: "Every lead we send you, tracked in one place.",
          eyebrow: "Lead dashboard",
          headline: "Your dashboard is ready",
          body: `
            <p style="margin:0 0 18px;font-size:15px;">
              Here's your private link to every lead we send you — phone and website,
              as they come in, with what each one cost and what you marked it.
            </p>
            <p style="margin:0 0 18px;">${cta("Open my dashboard", url)}</p>
            <p style="margin:0;font-size:13px;color:#475569;">
              Keep this link private — anyone with it can see your leads. Tell us if you
              ever need it replaced and we'll issue a new one.
            </p>`,
          includeFooter: false,
        }),
      }).catch((e) => ({ error: e.message }));
    }
  }

  return res.status(200).json(out);
}
