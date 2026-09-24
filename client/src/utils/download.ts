/**
 * File saving that works in a browser AND in the Obli Android shell
 * (docs/obli-mobile.md §3 "Téléchargements côté web").
 *
 * Never build `URL.createObjectURL` + `<a download>` in a page: an Android
 * WebView cannot hand a `blob:` URL to DownloadManager, and revoking the URL
 * synchronously also breaks some desktop browsers. Use these helpers.
 *
 * None of them reject: they resolve `true` on success, `false` on failure
 * (already logged), so callers can toast on `false` if they care.
 */
import { canUseNative, native } from '@/native/bridge';

const DEFAULT_MIME = 'application/octet-stream';
/** Blob URLs stay alive long enough for slow "Save as…" dialogs. */
const REVOKE_DELAY_MS = 60_000;

/** Read a Blob as base64 (no data: prefix). FileReader streams it, so multi-MB blobs are fine. */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
}

function clickAnchor(href: string, filename?: string): void {
  const a = document.createElement('a');
  a.href = href;
  if (filename !== undefined) a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * Save a Blob as `filename`. Android shell → native `saveFile` (Downloads +
 * notification); browser → anchor download with deferred revocation.
 * `mime` overrides `blob.type`.
 */
export async function saveBlob(blob: Blob, filename: string, mime?: string): Promise<boolean> {
  const type = mime || blob.type || DEFAULT_MIME;
  if (canUseNative('saveFile')) {
    try {
      const base64 = await blobToBase64(blob);
      await native.saveFile(filename, type, base64);
      return true;
    } catch (err) {
      console.error('[download] native saveFile failed', err);
      return false;
    }
  }
  try {
    const typed = mime && blob.type !== mime ? new Blob([blob], { type: mime }) : blob;
    const url = URL.createObjectURL(typed);
    clickAnchor(url, filename);
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
    return true;
  } catch (err) {
    console.error('[download] saveBlob failed', err);
    return false;
  }
}

/** Save a string as a file (CSV, JSON, scripts, …). Default MIME: text/plain;charset=utf-8. */
export function saveText(text: string, filename: string, mime = 'text/plain;charset=utf-8'): Promise<boolean> {
  return saveBlob(new Blob([text], { type: mime }), filename, mime);
}

/** Save a value as pretty-printed JSON. */
export function saveJson(value: unknown, filename: string, space = 2): Promise<boolean> {
  return saveText(JSON.stringify(value, null, space), filename, 'application/json');
}

/**
 * Download an authenticated SAME-ORIGIN server route (Content-Disposition:
 * attachment), e.g. `/api/reports/outputs/42/download`. Android shell →
 * native `downloadUrl` (DownloadManager with the session cookie); browser →
 * `<a href download>` (no page navigation, no popup).
 */
export async function downloadUrl(url: string, filename?: string): Promise<boolean> {
  let absolute = url;
  try {
    absolute = new URL(url, window.location.href).href;
  } catch {
    /* keep as given */
  }
  if (canUseNative('downloadUrl')) {
    try {
      await native.downloadUrl(absolute, filename);
      return true;
    } catch (err) {
      console.error('[download] native downloadUrl failed', err);
      return false;
    }
  }
  try {
    clickAnchor(absolute, filename ?? '');
    return true;
  } catch (err) {
    console.error('[download] downloadUrl failed', err);
    return false;
  }
}
