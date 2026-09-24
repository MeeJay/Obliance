import type { Request, Response } from 'express';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';

// ── Obli mobile app (Android) — public version + APK download ───────────────
//
// Contract: docs/obli-mobile.md §6. Same routes for every Obli app, so one
// shared Android shell / updater module works against all of them:
//
//   GET /api/mobile/android/version   → JSON read from mobile/release/manifest.json
//   GET /api/mobile/android/download  → the signed APK (attachment, Range/ETag)
//
// Both are deliberately unauthenticated: the shell checks for updates before
// (and independently of) any web session, and the version is public info.
// Authenticity is NOT provided by this endpoint: the shell verifies the
// SHA-256 of the file AND the signing-certificate fingerprint (signerSha256)
// against its own signature before handing the APK to PackageInstaller.
//
// Drop zone (see mobile/release/README.md), written by the release script:
//   mobile/release/manifest.json     required (placeholder committed: versionCode 0)
//   mobile/release/RELEASE_NOTES.md  optional
//   mobile/release/obliance.apk      optional (gitignored) — missing → available:false / 404
//
// process.cwd() is the server directory both in dev (server/) and in Docker
// (WORKDIR /app/server), same convention as app.ts → <root>/mobile/release.

const RELEASE_DIR = path.resolve(process.cwd(), '..', 'mobile', 'release');
const MANIFEST_FILE = path.join(RELEASE_DIR, 'manifest.json');
const NOTES_FILE = path.join(RELEASE_DIR, 'RELEASE_NOTES.md');
const APK_FILE = path.join(RELEASE_DIR, 'obliance.apk');

const APP_ID = 'obliance';
const DOWNLOAD_PATH = '/api/mobile/android/download';
const APK_MIME = 'application/vnd.android.package-archive';

interface AndroidManifest {
  app: string;
  packageName: string | null;
  version: string;
  versionCode: number;
  minSupportedVersionCode: number;
  minSdk: number | null;
  sha256: string | null;
  sizeBytes: number | null;
  signerSha256: string | null;
  builtAt: string | null;
}

/** Lowercase hex without separators (apksigner / Get-FileHash / keytool
 *  formats all normalise to this); null when not a 32-byte digest. */
function normalizeSha256(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const hex = v.replace(/[\s:]/g, '').toLowerCase();
  return /^[0-9a-f]{64}$/.test(hex) ? hex : null;
}

function nonNegInt(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null;
}

function nonEmptyString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** Reads and validates manifest.json. null = missing or invalid (→ 503). */
async function readManifest(): Promise<AndroidManifest | null> {
  let raw: unknown;
  try {
    raw = JSON.parse(await fs.promises.readFile(MANIFEST_FILE, 'utf-8'));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const m = raw as Record<string, unknown>;

  const version = nonEmptyString(m.version);
  const versionCode = nonNegInt(m.versionCode);
  if (!version || versionCode === null) return null;

  return {
    app: nonEmptyString(m.app) ?? APP_ID,
    packageName: nonEmptyString(m.packageName),
    version,
    versionCode,
    minSupportedVersionCode: nonNegInt(m.minSupportedVersionCode) ?? 0,
    minSdk: nonNegInt(m.minSdk),
    sha256: normalizeSha256(m.sha256),
    sizeBytes: nonNegInt(m.sizeBytes),
    signerSha256: normalizeSha256(m.signerSha256),
    builtAt: nonEmptyString(m.builtAt),
  };
}

async function statApk(): Promise<fs.Stats | null> {
  try {
    const st = await fs.promises.stat(APK_FILE);
    return st.isFile() && st.size > 0 ? st : null;
  } catch {
    return null;
  }
}

// Fallback only, for a manifest written without `sha256`: hash the APK once
// per (size, mtime) and memoise it — never per request (the file is tens of MB).
let hashCache: { key: string; sha256: string } | null = null;

async function apkSha256(st: fs.Stats): Promise<string | null> {
  const key = `${st.size}:${st.mtimeMs}`;
  if (hashCache?.key === key) return hashCache.sha256;
  try {
    const sha256 = await new Promise<string>((resolve, reject) => {
      const h = createHash('sha256');
      fs.createReadStream(APK_FILE)
        .on('data', (chunk) => h.update(chunk))
        .on('end', () => resolve(h.digest('hex')))
        .on('error', reject);
    });
    hashCache = { key, sha256 };
    return sha256;
  } catch (err) {
    logger.warn({ err }, 'mobileApp: failed to hash APK');
    return null;
  }
}

/** Filename-safe version for Content-Disposition. */
function safeVersion(v: string): string {
  return v.replace(/[^0-9A-Za-z._-]/g, '_') || 'latest';
}

export async function androidVersion(_req: Request, res: Response): Promise<void> {
  // Update checks must never be answered from a cache (browser, WebView,
  // proxy): a stale "no update" would pin old shells for hours.
  res.setHeader('Cache-Control', 'no-store');

  const manifest = await readManifest();
  if (!manifest) {
    res.status(503).json({ error: 'Android app version unavailable' });
    return;
  }

  const apk = await statApk();
  // versionCode 0 is the committed placeholder: never advertise a download
  // for it, even if a stray APK sits in the drop zone.
  const available = !!apk && manifest.versionCode > 0;

  let releaseNotes: string | null = null;
  try {
    releaseNotes = (await fs.promises.readFile(NOTES_FILE, 'utf-8')).trim() || null;
  } catch { /* optional */ }

  let sha256 = manifest.sha256;
  if (available && !sha256 && apk) sha256 = await apkSha256(apk);

  res.json({
    app: manifest.app,
    packageName: manifest.packageName,
    version: manifest.version,
    versionCode: manifest.versionCode,
    minSupportedVersionCode: manifest.minSupportedVersionCode,
    minSdk: manifest.minSdk,
    sha256,
    // The file on disk is the truth when it is served; the manifest otherwise.
    sizeBytes: available && apk ? apk.size : manifest.sizeBytes,
    signerSha256: manifest.signerSha256,
    builtAt: manifest.builtAt,
    available,
    downloadUrl: DOWNLOAD_PATH,
    releaseNotes,
  });
}

export async function androidDownload(_req: Request, res: Response): Promise<void> {
  // Served exactly when /version reports `available: true` (valid manifest,
  // versionCode > 0, non-empty APK) — a stray APK next to the placeholder
  // manifest is never handed out.
  const [apk, manifest] = await Promise.all([statApk(), readManifest()]);
  if (!apk || !manifest || manifest.versionCode <= 0) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(404).json({ error: 'Android app not available' });
    return;
  }

  const version = safeVersion(manifest.version);
  const sha256 = manifest.sha256 ?? await apkSha256(apk);

  // Content-Type first: `send` (behind res.sendFile) keeps an existing type.
  res.type(APK_MIME);
  res.attachment(`Obliance-${version}.apk`);
  if (sha256) res.setHeader('X-Content-SHA256', sha256);

  // res.sendFile → Range/If-Range (resumable DownloadManager), ETag and
  // Last-Modified for free. `no-cache` = always revalidate (cheap 304) so a
  // cached copy can never outlive a release and fail the shell's SHA check.
  res.sendFile(APK_FILE, {
    acceptRanges: true,
    cacheControl: false,
    lastModified: true,
    headers: { 'Cache-Control': 'no-cache' },
  }, (err) => {
    if (!err) return;
    // Client aborts after streaming started are not ours to report.
    if (res.headersSent) return;
    const e = err as Error & { status?: number; headers?: Record<string, string> };
    const status = e.status ?? 500;
    if (status >= 500) logger.warn({ err }, 'mobileApp: APK download failed');
    // e.g. 416 carries `Content-Range: bytes */<size>`.
    if (e.headers) res.set(e.headers);
    // res.json keeps an existing Content-Type: drop the APK one first.
    res.removeHeader('Content-Type');
    res.removeHeader('Content-Disposition');
    res.removeHeader('X-Content-SHA256');
    res.setHeader('Cache-Control', 'no-store');
    res.status(status).json({ error: 'Android app download failed' });
  });
}
