import type { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';

// ── Oblireach Desktop App — public version + download ───────────────────────
//
// This controller serves two things to anyone who can reach the server:
//
//   1. `GET /api/oblireach-desktop/version` — JSON with the current version
//      so the desktop app can poll and decide whether to show its "update
//      available" button. Deliberately unauthenticated: the desktop app
//      doesn't carry credentials, and the version number is public info.
//
//   2. `GET /api/oblireach-desktop/download` — streams the MSI installer
//      with Content-Disposition: attachment so the browser downloads it.
//
// The binaries + VERSION live at `<repo>/oblireach-desktop/` — see
// `oblireach-desktop/README.md` for the exact layout.

const ROOT = path.resolve(__dirname, '../../../../oblireach-desktop');
const VERSION_FILE = path.join(ROOT, 'VERSION');
const RELEASE_NOTES = path.join(ROOT, 'RELEASE_NOTES.md');
const MSI_FILE = path.join(ROOT, 'dist', 'OblireachDesktop.msi');

function readVersion(): string | null {
  try {
    if (!fs.existsSync(VERSION_FILE)) return null;
    const raw = fs.readFileSync(VERSION_FILE, 'utf-8').trim();
    return raw || null;
  } catch { return null; }
}

export function oblireachDesktopVersion(_req: Request, res: Response): void {
  const version = readVersion();
  if (!version) {
    res.status(503).json({ error: 'Oblireach Desktop version unavailable' });
    return;
  }
  // Releases notes are optional — if the file is missing we skip the field.
  let releaseNotes: string | undefined;
  try {
    if (fs.existsSync(RELEASE_NOTES)) {
      releaseNotes = fs.readFileSync(RELEASE_NOTES, 'utf-8');
    }
  } catch { /* ignore */ }

  // The MSI's mtime is the best "released at" signal we have without a
  // dedicated field — cheap, accurate, no extra file to maintain.
  let releasedAt: string | undefined;
  try {
    if (fs.existsSync(MSI_FILE)) {
      releasedAt = fs.statSync(MSI_FILE).mtime.toISOString();
    }
  } catch { /* ignore */ }

  res.json({
    version,
    downloadUrl: '/api/oblireach-desktop/download',
    releasedAt,
    releaseNotes,
  });
}

export function oblireachDesktopDownload(_req: Request, res: Response): void {
  if (!fs.existsSync(MSI_FILE)) {
    res.status(404).json({ error: 'Installer not available' });
    return;
  }
  const stat = fs.statSync(MSI_FILE);
  res.setHeader('Content-Type', 'application/x-msi');
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Content-Disposition', 'attachment; filename="OblireachDesktop.msi"');
  // Caching: the installer changes rarely (on each release bump) and is
  // keyed by filename, so a short public cache is safe. We include the
  // mtime as a weak etag so clients can re-validate.
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.setHeader('ETag', `W/"${stat.size}-${stat.mtimeMs}"`);

  fs.createReadStream(MSI_FILE).pipe(res);
}
