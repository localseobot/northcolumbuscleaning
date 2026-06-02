// Quick tagging helper — when you see a new Google review, paste the
// customer's name (or phone or email) here and we'll tag their GHL
// contact with `left-google-review`. The weekly digest counts these
// to give you a real reviews-per-week metric.
//
// GET  /api/admin/mark-review?token=ADMIN_TOKEN
//   → renders a tiny single-input form
//
// POST /api/admin/mark-review?token=ADMIN_TOKEN
//   { query: "search string (name/phone/email)" }
//   → searches GHL, tags matching contact, returns result

import { ghl } from "../_lib/ghl.js";

export const config = { runtime: "nodejs" };

function s(v) { return v === null || v === undefined ? "" : String(v).trim(); }

function isAuthorized(req) {
  const token = req.query?.token || req.headers["x-admin-token"];
  if (!process.env.ADMIN_TOKEN) return false;
  return s(token).trim() === String(process.env.ADMIN_TOKEN).trim();
}

function renderPage(token, msg = "", error = "") {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mark review · NCC</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&display=swap" rel="stylesheet">
<style>
  *,*::before,*::after { box-sizing: border-box; }
  body { margin:0;font-family:'Inter',-apple-system,sans-serif;background:#faf9f5;color:#0f172a;padding:32px 24px; }
  .container { max-width: 520px; margin: 0 auto; }
  h1 { font-size: 28px; font-weight: 900; color: #0d3320; margin: 0 0 8px; }
  p { font-size: 15px; line-height: 1.55; color: #475569; margin: 0 0 20px; }
  form { background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 24px; }
  label { font-size: 12px; font-weight: 900; letter-spacing: 0.08em; text-transform: uppercase; color: #64748b; display: block; margin-bottom: 8px; }
  input { width: 100%; padding: 14px 16px; border: 1.5px solid #e2e8f0; border-radius: 10px; font-size: 16px; margin-bottom: 16px; font-family: inherit; }
  input:focus { outline: none; border-color: #1a4d2e; }
  button { width: 100%; padding: 14px; background: #1a4d2e; color: #c9e265; border: 0; border-radius: 10px; font-size: 15px; font-weight: 900; letter-spacing: 0.08em; text-transform: uppercase; cursor: pointer; font-family: inherit; }
  .msg { background: #ecfdf5; border-left: 4px solid #047857; padding: 14px 18px; border-radius: 8px; margin-bottom: 16px; font-size: 14px; color: #065f46; }
  .err { background: #fef2f2; border-left: 4px solid #b91c1c; padding: 14px 18px; border-radius: 8px; margin-bottom: 16px; font-size: 14px; color: #991b1b; }
</style>
</head><body><div class="container">
  <h1>Mark a Google review</h1>
  <p>Paste a customer's name, email, or phone — we'll tag them with <code>left-google-review</code> so the weekly digest counts them.</p>
  ${msg ? `<div class="msg">${msg}</div>` : ""}
  ${error ? `<div class="err">${error}</div>` : ""}
  <form method="POST" action="/api/admin/mark-review?token=${encodeURIComponent(token)}">
    <label>Customer (name / email / phone)</label>
    <input type="text" name="query" required autofocus placeholder="Sarah Johnson, sarah@example.com, +16145551234" />
    <button type="submit">Tag this contact</button>
  </form>
</div></body></html>`;
}

export default async function handler(req, res) {
  if (!isAuthorized(req)) {
    res.setHeader("Content-Type", "text/plain");
    return res.status(401).send("Unauthorized");
  }

  if (req.method === "GET") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(renderPage(req.query?.token || ""));
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Accept form-encoded or JSON
  let query = "";
  if (req.headers["content-type"]?.includes("application/json")) {
    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { body = {}; }
    }
    query = s(body?.query);
  } else {
    const raw = typeof req.body === "string" ? req.body : "";
    const params = new URLSearchParams(raw);
    query = s(params.get("query"));
  }

  if (!query) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(400).send(renderPage(req.query?.token || "", "", "Please enter a search term."));
  }

  try {
    const search = await ghl({
      method: "POST",
      path: "/contacts/search",
      body: {
        locationId: process.env.GHL_LOCATION_ID,
        query,
        pageLimit: 5,
      },
    });
    const contacts = search?.contacts || [];
    if (contacts.length === 0) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(200).send(
        renderPage(req.query?.token || "", "", `No matching contact found for "${query}".`),
      );
    }
    if (contacts.length > 1) {
      // Pick the most-recently-updated, but warn
      contacts.sort(
        (a, b) =>
          new Date(b.dateUpdated || 0).getTime() -
          new Date(a.dateUpdated || 0).getTime(),
      );
    }
    const c = contacts[0];
    const name =
      [c.firstNameRaw, c.lastNameRaw].filter(Boolean).join(" ") ||
      c.contactName ||
      c.email ||
      c.phone ||
      "(unknown)";

    await ghl({
      method: "POST",
      path: `/contacts/${c.id}/tags`,
      body: { tags: ["left-google-review"] },
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(
      renderPage(
        req.query?.token || "",
        `✓ Tagged <strong>${name}</strong> with <code>left-google-review</code>. Next week's digest will count this.${contacts.length > 1 ? ` (Matched ${contacts.length} contacts; tagged the most recently updated one.)` : ""}`,
      ),
    );
  } catch (e) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(500).send(renderPage(req.query?.token || "", "", `Error: ${e.message}`));
  }
}
