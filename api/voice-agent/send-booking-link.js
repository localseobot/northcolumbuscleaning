// Retell AI custom tool — sends the booking link via Quo SMS.
//
// Maya calls this mid-call after the caller accepts the booking-link offer.
// The text comes from the Quo workspace number so it lands in the shared
// team inbox and the caller can reply in the same thread.
//
// Retell function call format:
//   { call: {...}, name: "send_booking_link",
//     args: { phone: "+16145551234", caller_name: "Sarah" } }

import { sendSms } from "../_lib/quo.js";

export const config = { runtime: "nodejs" };

const BOOKING_URL = "https://northcolumbuscleaning.com/book-now";

function normalizePhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  if (String(raw).startsWith("+") && digits.length >= 10) return "+" + digits;
  return null;
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
  const name = (args.caller_name || "").trim();

  if (!phone) {
    return res.status(200).json({
      ok: false,
      result:
        "I need a good 10-digit number first. Could you read it back to me?",
    });
  }

  const greeting = name ? `Hi ${name}` : "Hi";
  const message =
    `${greeting} — here's the link to book your cleaning with ` +
    `North Columbus Cleaning: ${BOOKING_URL}. Pick your date and ` +
    `window, and the team will confirm within one business day. ` +
    `Questions? Reply here or call (740) 913-3693.`;

  const sent = await sendSms(phone, message);

  if (!sent.ok) {
    return res.status(200).json({
      ok: false,
      result:
        "I wasn't able to send the text from this end. I'll have the team send it to you manually within a few minutes.",
      error: sent.body,
    });
  }

  return res.status(200).json({
    ok: true,
    result:
      "The booking link is on its way to your phone now. It'll come from the North Columbus Cleaning number.",
    phone,
    bookingUrl: BOOKING_URL,
  });
}
