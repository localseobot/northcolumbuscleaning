// Retell AI custom tool — look up a caller in GHL by phone, return whether
// they're an existing customer so Taylor can personalize the call.
//
// Retell function calls arrive as POST with body:
//   { call: {...}, name: "lookup_contact", args: { phone: "+16145551234" } }
//
// We return a `result` string Taylor reads back verbatim (or uses to decide
// how to continue), plus structured fields the agent can route on.

import { ghl } from "../_lib/ghl.js";

export const config = { runtime: "nodejs" };

function normalizePhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  if (String(raw).startsWith("+") && digits.length >= 10) return "+" + digits;
  return null;
}

function describeFrequency(tags) {
  const found = tags.find((t) => t.startsWith("frequency:"));
  if (!found) return null;
  const map = {
    "frequency:one-time": "one-time",
    "frequency:weekly": "weekly",
    "frequency:biweekly": "bi-weekly",
    "frequency:monthly": "monthly",
  };
  return map[found] || found.replace("frequency:", "");
}

function describeService(tags) {
  const found = tags.find((t) => t.startsWith("service:"));
  if (!found) return null;
  const map = {
    "service:residential": "regular residential",
    "service:commercial": "commercial",
    "service:deep-clean": "deep",
    "service:move-in-out": "move-in/out",
    "service:post-construction": "post-construction",
  };
  return map[found] || found.replace("service:", "");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: "Invalid JSON" });
    }
  }

  const args = body?.args || {};
  const phone = normalizePhone(args.phone);

  if (!phone) {
    return res.status(200).json({
      result:
        "I'll need a 10-digit phone number to look you up. Could you read it back to me?",
      found: false,
    });
  }

  if (!process.env.GHL_PIT) {
    // Fail open — Taylor proceeds with normal intake.
    return res.status(200).json({
      result: "I'll go ahead and gather your details.",
      found: false,
    });
  }

  try {
    const search = await ghl({
      method: "GET",
      path: "/contacts/",
      query: {
        locationId: process.env.GHL_LOCATION_ID,
        query: phone,
        limit: 5,
      },
    });

    const contacts = search?.contacts || [];
    const match = contacts.find((c) => {
      const p = (c.phone || "").replace(/\D/g, "");
      return p && phone.replace(/\D/g, "").endsWith(p.slice(-10));
    });

    if (!match) {
      return res.status(200).json({
        result:
          "You're not in our system yet — happy to get you set up. Let me grab a few details.",
        found: false,
      });
    }

    const tags = match.tags || [];
    const isExisting = tags.some(
      (t) => t.startsWith("frequency:") || tags.includes("vip-client"),
    );
    const firstName = match.firstName || "";
    const lastName = match.lastName || "";
    const service = describeService(tags);
    const frequency = describeFrequency(tags);
    const isVip = tags.includes("vip-client");
    const doNotContact = tags.includes("do-not-contact");

    let result;
    if (doNotContact) {
      result =
        "I see you in our system. Let me take your details and have the team reach out.";
    } else if (isExisting && frequency && service) {
      result = `Welcome back${firstName ? `, ${firstName}` : ""}! I see you're on our ${frequency} ${service} cleaning schedule. What can I help you with today?`;
    } else if (firstName) {
      result = `Welcome back, ${firstName}! What can I help you with today?`;
    } else {
      result =
        "I see you've reached out before. What can I help you with today?";
    }

    return res.status(200).json({
      result,
      found: true,
      existingCustomer: isExisting,
      vip: isVip,
      doNotContact,
      contactId: match.id,
      firstName,
      lastName,
      service,
      frequency,
      tagCount: tags.length,
    });
  } catch (e) {
    // Fail open — Taylor proceeds with normal intake on any GHL error.
    return res.status(200).json({
      result:
        "Let me get you set up. I'll need a few details about your home and what you're looking for.",
      found: false,
      lookupError: e.message,
    });
  }
}
