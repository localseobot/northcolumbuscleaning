// Upload a file to Google Drive (Shared Drive) via the REST multipart upload.
//
// Service accounts have ZERO My Drive storage quota, so uploads must target a
// folder that lives inside a Shared Drive (where files are owned by the Drive,
// not the uploader). The service account must be a member (Content manager) of
// that Shared Drive. We always pass supportsAllDrives=true.
//
// Env vars:
//   GDRIVE_SHARED_DRIVE_ID      the Shared Drive id (driveId)
//   GDRIVE_RESUME_FOLDER_ID     target folder for resumes
//   GDRIVE_W9_FOLDER_ID         target folder for W-9s
//   GDRIVE_AGREEMENT_FOLDER_ID  target folder for signed agreements
//
// No-ops gracefully (returns { skipped }) when Drive isn't configured, so the
// surrounding flow keeps working before env vars are set.

import { getAccessToken, driveConfigured } from "./gdrive-auth.js";

const UPLOAD_URL =
  "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink,name";

/**
 * Upload bytes to a Drive folder.
 *
 * @param {object} opts
 * @param {string} opts.folderId   parent folder id (inside the Shared Drive)
 * @param {string} opts.name       file name
 * @param {string} opts.mimeType   e.g. "application/pdf"
 * @param {Buffer|Uint8Array} opts.bytes
 * @returns {Promise<{fileId?: string, webViewLink?: string, name?: string, skipped?: boolean, error?: string}>}
 */
export async function uploadToDrive({ folderId, name, mimeType, bytes }) {
  if (!driveConfigured()) return { skipped: true, error: "drive not configured" };
  if (!folderId) return { skipped: true, error: "no folderId" };
  if (!bytes) return { error: "no bytes" };

  let token;
  try {
    token = await getAccessToken();
  } catch (e) {
    return { error: e.message };
  }

  const metadata = {
    name: name || "upload",
    mimeType,
    parents: [folderId],
  };
  const driveId = process.env.GDRIVE_SHARED_DRIVE_ID;
  if (driveId) {
    metadata.driveId = driveId;
  }

  // Build a multipart/related body by hand (no form-data dependency).
  const boundary = "ncc" + Math.random().toString(16).slice(2) + "boundary";
  const enc = (s) => Buffer.from(s, "utf8");
  const parts = [
    enc(`--${boundary}\r\n`),
    enc("Content-Type: application/json; charset=UTF-8\r\n\r\n"),
    enc(JSON.stringify(metadata)),
    enc(`\r\n--${boundary}\r\n`),
    enc(`Content-Type: ${mimeType || "application/octet-stream"}\r\n\r\n`),
    Buffer.from(bytes),
    enc(`\r\n--${boundary}--\r\n`),
  ];
  const body = Buffer.concat(parts);

  try {
    const res = await fetch(UPLOAD_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
        "Content-Length": String(body.length),
      },
      body,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        error:
          data?.error?.message || `Drive upload ${res.status} ${res.statusText}`,
      };
    }
    return { fileId: data.id, webViewLink: data.webViewLink, name: data.name };
  } catch (e) {
    return { error: e.message };
  }
}
