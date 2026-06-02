// Generate a flattened, signed contractor-agreement PDF with pdf-lib.
//
// The agreement text is rendered top-to-bottom across as many US-Letter pages
// as needed, followed by a signature block containing the typed legal name,
// the drawn-signature image, and an audit line (timestamp + IP + agreement
// version). The output is a static PDF (no form fields) suitable for archiving
// in Drive as the signed record.

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 56;
const BODY_SIZE = 10.5;
const LINE_GAP = 4;

function wrapLine(text, font, size, maxWidth) {
  const out = [];
  const paragraphs = String(text).replace(/\r\n/g, "\n").split("\n");
  for (const para of paragraphs) {
    if (para.trim() === "") {
      out.push("");
      continue;
    }
    const words = para.split(/\s+/);
    let line = "";
    for (const word of words) {
      const trial = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(trial, size) > maxWidth && line) {
        out.push(line);
        line = word;
      } else {
        line = trial;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

/**
 * @param {object} opts
 * @param {string} opts.agreementText  full agreement body
 * @param {string} opts.title          document title
 * @param {string} opts.version        agreement version label
 * @param {string} opts.name           signer's typed legal name
 * @param {string} [opts.signaturePngBase64]  base64 PNG of the drawn signature (no data: prefix)
 * @param {string} opts.timestamp      ISO timestamp string
 * @param {string} [opts.ip]           signer IP for the audit line
 * @returns {Promise<Uint8Array>}
 */
export async function buildAgreementPdf({
  agreementText,
  title = "Independent Contractor Agreement",
  version = "v1",
  name,
  signaturePngBase64,
  timestamp,
  ip,
}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const maxWidth = PAGE_W - MARGIN * 2;

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  const draw = (text, f, size, color = rgb(0.1, 0.1, 0.1)) => {
    page.drawText(text, { x: MARGIN, y, size, font: f, color });
  };
  const newPageIfNeeded = (needed) => {
    if (y - needed < MARGIN) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
    }
  };

  // Title
  draw(title, bold, 16);
  y -= 22;
  draw(`North Columbus Cleaning Company  ·  ${version}`, font, 9, rgb(0.4, 0.4, 0.4));
  y -= 22;

  // Body
  const lines = wrapLine(agreementText, font, BODY_SIZE, maxWidth);
  for (const line of lines) {
    newPageIfNeeded(BODY_SIZE + LINE_GAP);
    if (line) draw(line, font, BODY_SIZE);
    y -= BODY_SIZE + LINE_GAP;
  }

  // Signature block — keep it together on the current/next page.
  newPageIfNeeded(170);
  y -= 16;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_W - MARGIN, y },
    thickness: 0.75,
    color: rgb(0.7, 0.7, 0.7),
  });
  y -= 24;
  draw("ACCEPTED AND AGREED", bold, 11);
  y -= 20;
  draw(`Signed by (typed legal name): ${name || ""}`, font, 10);
  y -= 18;

  // Drawn signature image
  if (signaturePngBase64) {
    try {
      const img = await doc.embedPng(Buffer.from(signaturePngBase64, "base64"));
      const maxImgW = 240;
      const scale = Math.min(maxImgW / img.width, 70 / img.height, 1);
      const w = img.width * scale;
      const h = img.height * scale;
      newPageIfNeeded(h + 30);
      page.drawText("Signature:", { x: MARGIN, y, size: 10, font });
      page.drawImage(img, { x: MARGIN + 70, y: y - h + 8, width: w, height: h });
      y -= h + 10;
    } catch {
      // If the signature image is unreadable, fall back to a typed line.
      draw(`Signature: /s/ ${name || ""}`, font, 10);
      y -= 18;
    }
  } else {
    draw(`Signature: /s/ ${name || ""}`, font, 10);
    y -= 18;
  }

  y -= 6;
  draw(
    `Audit: signed ${timestamp || ""}${ip ? `  ·  IP ${ip}` : ""}`,
    font,
    8.5,
    rgb(0.4, 0.4, 0.4),
  );

  return doc.save();
}
