/**
 * Open a link outside the app (docs/obli-mobile.md §3).
 * Android shell → native `openExternal` (Custom Tab for http(s), Intent for
 * mailto:/tel:/otpauth:). Browser → new tab for http(s), same-window
 * navigation for other schemes (the OS hands them to the right app).
 *
 * Use it for every target=_blank link that leaves the Obliance origin
 * (Obligate, other Obli apps, NVD/GHSA, docs, …).
 */
import { canUseNative, native } from '@/native/bridge';

const ALLOWED = /^(https?:|mailto:|tel:|otpauth:)/i;

export async function openExternal(url: string): Promise<boolean> {
  let href = url;
  try {
    href = new URL(url, window.location.href).href;
  } catch {
    return false;
  }
  if (!ALLOWED.test(href)) {
    console.warn('[openExternal] blocked scheme', href);
    return false;
  }
  if (canUseNative('openExternal')) {
    try {
      await native.openExternal(href);
      return true;
    } catch (err) {
      console.error('[openExternal] native openExternal failed', err);
      // fall through to the browser path
    }
  }
  if (/^https?:/i.test(href)) {
    window.open(href, '_blank', 'noopener,noreferrer');
  } else {
    window.location.href = href;
  }
  return true;
}
