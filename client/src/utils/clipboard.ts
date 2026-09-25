/**
 * Clipboard helpers that survive plain-http self-hosted origins and the
 * Android WebView (docs/obli-mobile.md §3).
 *
 * copyText order: async Clipboard API → hidden textarea + execCommand('copy')
 * → native bridge. Resolves true/false and never rejects: the CALLER shows
 * the success / failure toast, e.g.
 *
 *   copyText(key).then((ok) => ok ? toast.success(t('common.copied')) : toast.error(t('common.error')));
 */
import { canUseNative, native } from '@/native/bridge';

function execCommandCopy(text: string): boolean {
  if (typeof document === 'undefined' || !document.body) return false;
  const active = document.activeElement as HTMLElement | null;
  const selection = document.getSelection();
  const savedRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.setAttribute('aria-hidden', 'true');
  // 12pt avoids the iOS zoom-on-focus; off-screen but still "visible" for selection.
  ta.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0;font-size:12pt;pointer-events:none;';
  document.body.appendChild(ta);
  let ok = false;
  try {
    ta.select();
    ta.setSelectionRange(0, text.length);
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  } finally {
    ta.remove();
    if (savedRange && selection) {
      selection.removeAllRanges();
      selection.addRange(savedRange);
    }
    if (active && typeof active.focus === 'function') {
      try { active.focus({ preventScroll: true }); } catch { /* ignore */ }
    }
  }
  return ok;
}

export async function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* permission denied / not focused — try the fallbacks */
    }
  }
  if (execCommandCopy(text)) return true;
  if (canUseNative('copyText')) {
    try {
      await native.copyText(text);
      return true;
    } catch (err) {
      console.error('[clipboard] native copyText failed', err);
    }
  }
  return false;
}

/**
 * Copy text that is still being fetched (e.g. an export built by the
 * server). WebKit (iOS / iPadOS browsers, macOS Safari) only allows a
 * clipboard write that STARTS inside the click / tap gesture — after an
 * `await` it throws NotAllowedError. So the write is started synchronously
 * with a promised ClipboardItem that resolves once `textPromise` settles;
 * when that is unsupported or rejected, it falls back to copyText() once
 * the text has arrived.
 *
 * Call it directly from the event handler, before any `await`. Resolves
 * false (never rejects) when the copy failed OR `textPromise` rejected —
 * the caller can await `textPromise` itself to tell the two apart.
 */
export async function copyTextDeferred(textPromise: Promise<string>): Promise<boolean> {
  if (
    typeof ClipboardItem !== 'undefined'
    && typeof navigator !== 'undefined'
    && typeof navigator.clipboard?.write === 'function'
    && window.isSecureContext
  ) {
    const blobPromise = textPromise.then((text) => new Blob([text], { type: 'text/plain' }));
    blobPromise.catch(() => { /* surfaced by the fallback's await below */ });
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blobPromise })]);
      return true;
    } catch {
      /* unsupported promised item / permission denied — fall back below */
    }
  }
  let text: string;
  try {
    text = await textPromise;
  } catch {
    return false;
  }
  return copyText(text);
}

/**
 * Read the clipboard as text. Native bridge first (the WebView denies the
 * async Clipboard read permission), then navigator.clipboard.readText.
 * Resolves null when nothing can read it (or the user refused).
 */
export async function readClipboardText(): Promise<string | null> {
  if (canUseNative('readClipboard')) {
    try {
      const text = await native.readClipboard();
      return typeof text === 'string' ? text : '';
    } catch (err) {
      console.error('[clipboard] native readClipboard failed', err);
    }
  }
  if (typeof navigator !== 'undefined' && navigator.clipboard?.readText && window.isSecureContext) {
    try {
      return await navigator.clipboard.readText();
    } catch {
      /* denied */
    }
  }
  return null;
}
