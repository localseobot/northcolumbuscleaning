// What the buyer tells us about a lead.
//
// POST /api/buyer/lead-update?t=<token>
//   { id, outcome }             → record what happened with the lead
//   { id, dispute, reason }     → flag a bad lead for credit
//
// Filing a dispute opens it; it does not credit the lead. We review and
// resolve disputes from the admin side. A buyer who could approve their own
// refunds isn't disputing, they're just not paying.

import { setOutcome, fileDispute, OUTCOME_KEYS } from "../_lib/lead-ledger.js";
import { verifyBuyerToken, buyerAuthError, tokenFromRequest, setBuyerCors } from "../_lib/buyer-token.js";

export const config = { runtime: "nodejs" };

export default async function handler(req, res) {
  setBuyerCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    verifyBuyerToken(tokenFromRequest(req));
  } catch (e) {
    const { status, body } = buyerAuthError(e);
    return res.status(status).json(body);
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: "Invalid JSON" });
    }
  }
  body = body || {};

  const id = String(body.id || "").trim();
  if (!id) return res.status(400).json({ error: "Missing lead id." });

  try {
    if (body.dispute) {
      const reason = String(body.reason || "").trim().slice(0, 500);
      if (!reason) {
        return res.status(400).json({ error: "Please tell us what was wrong with this lead." });
      }
      const result = await fileDispute(id, reason);
      return res.status(200).json(result);
    }

    const outcome = String(body.outcome || "").trim();
    if (!OUTCOME_KEYS.includes(outcome)) {
      return res.status(400).json({ error: `Outcome must be one of: ${OUTCOME_KEYS.join(", ")}` });
    }
    const result = await setOutcome(id, outcome);
    return res.status(200).json(result);
  } catch (e) {
    return res.status(502).json({ error: "Couldn't save that. Please try again.", detail: e.message });
  }
}
