// Generate a substitute IRS Form W-9 PDF from on-page form input.
//
// The IRS permits a "substitute W-9" as long as it is substantially similar to
// the official form and includes the Part II certification language verbatim.
// Generating our own clean document avoids the brittle field-name mapping of
// the official fillable AcroForm and guarantees the output bundles cleanly on
// Vercel (no external template asset to ship).
//
// This PDF is the W-9 of record and DOES contain the TIN. It is uploaded only
// to the restricted Shared Drive — the TIN is never written to GHL or logs.
//
// (Adjustable: if a bookkeeper requires the exact official IRS form, swap this
// for an AcroForm fill against a committed fw9.pdf template — see plan notes.)

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 50;

// Part II certification, quoted from Form W-9 (Rev. 3-2024).
const CERTIFICATION = [
  "Under penalties of perjury, I certify that:",
  "1. The number shown on this form is my correct taxpayer identification number (or I am waiting for a number to be issued to me); and",
  "2. I am not subject to backup withholding because: (a) I am exempt from backup withholding, or (b) I have not been notified by the Internal Revenue Service (IRS) that I am subject to backup withholding as a result of a failure to report all interest or dividends, or (c) the IRS has notified me that I am no longer subject to backup withholding; and",
  "3. I am a U.S. citizen or other U.S. person (defined in the form instructions); and",
  "4. The FATCA code(s) entered on this form (if any) indicating that I am exempt from FATCA reporting is correct.",
];

function wrap(text, font, size, maxWidth) {
  const words = String(text).split(/\s+/);
  const out = [];
  let line = "";
  for (const w of words) {
    const trial = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(trial, size) > maxWidth && line) {
      out.push(line);
      line = w;
    } else {
      line = trial;
    }
  }
  if (line) out.push(line);
  return out;
}

/**
 * @param {object} f
 * @param {string} f.name                 line 1 — individual/entity name
 * @param {string} [f.businessName]       line 2 — business name / disregarded entity
 * @param {string} f.taxClassification    e.g. "Individual/sole proprietor"
 * @param {string} f.address              street address
 * @param {string} f.cityStateZip
 * @param {string} f.tin                  the SSN or EIN (digits, may include dashes)
 * @param {string} f.tinType             "SSN" | "EIN"
 * @param {string} f.signatureName        typed legal name
 * @param {string} [f.signaturePngBase64] base64 PNG (no data: prefix)
 * @param {string} f.timestamp            ISO string
 * @param {string} [f.ip]
 * @returns {Promise<Uint8Array>}
 */
export async function buildSubstituteW9(f) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const maxWidth = PAGE_W - MARGIN * 2;
  let y = PAGE_H - MARGIN;

  const text = (s, x, size, fnt = font, color = rgb(0.1, 0.1, 0.1)) =>
    page.drawText(String(s ?? ""), { x, y, size, font: fnt, color });

  const labelValue = (label, value) => {
    text(label, MARGIN, 8, bold, rgb(0.45, 0.45, 0.45));
    y -= 12;
    text(value || "—", MARGIN, 11);
    y -= 22;
  };

  // Header
  text("Substitute Form W-9", MARGIN, 16, bold);
  y -= 18;
  text(
    "Request for Taxpayer Identification Number and Certification",
    MARGIN,
    9,
    font,
    rgb(0.4, 0.4, 0.4),
  );
  y -= 14;
  text(
    "Collected by North Columbus Cleaning Company",
    MARGIN,
    9,
    font,
    rgb(0.4, 0.4, 0.4),
  );
  y -= 24;

  labelValue("1  Name (as shown on your income tax return)", f.name);
  labelValue("2  Business name / disregarded entity name (if different)", f.businessName);
  labelValue("3  Federal tax classification", f.taxClassification);
  labelValue("5  Address (number, street, and apt. or suite no.)", f.address);
  labelValue("6  City, state, and ZIP code", f.cityStateZip);

  // Part I — TIN
  text("Part I  ·  Taxpayer Identification Number (TIN)", MARGIN, 11, bold);
  y -= 16;
  const tinLabel = f.tinType === "EIN" ? "Employer ID Number (EIN)" : "Social Security Number (SSN)";
  text(`${tinLabel}:`, MARGIN, 11, bold);
  text(String(f.tin || ""), MARGIN + 200, 11);
  y -= 26;

  // Part II — Certification
  text("Part II  ·  Certification", MARGIN, 11, bold);
  y -= 16;
  for (const para of CERTIFICATION) {
    for (const line of wrap(para, font, 8, maxWidth)) {
      text(line, MARGIN, 8);
      y -= 10;
    }
    y -= 4;
  }
  y -= 8;

  // Signature
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_W - MARGIN, y },
    thickness: 0.75,
    color: rgb(0.7, 0.7, 0.7),
  });
  y -= 18;
  text(`Signature of U.S. person (typed): ${f.signatureName || ""}`, MARGIN, 10);
  y -= 18;

  if (f.signaturePngBase64) {
    try {
      const img = await doc.embedPng(Buffer.from(f.signaturePngBase64, "base64"));
      const scale = Math.min(220 / img.width, 60 / img.height, 1);
      const w = img.width * scale;
      const h = img.height * scale;
      text("Signature:", MARGIN, 10);
      page.drawImage(img, { x: MARGIN + 70, y: y - h + 8, width: w, height: h });
      y -= h + 8;
    } catch {
      text(`Signature: /s/ ${f.signatureName || ""}`, MARGIN, 10);
      y -= 16;
    }
  }
  y -= 4;
  text(
    `Audit: completed ${f.timestamp || ""}${f.ip ? `  ·  IP ${f.ip}` : ""}`,
    MARGIN,
    8,
    font,
    rgb(0.45, 0.45, 0.45),
  );

  return doc.save();
}
