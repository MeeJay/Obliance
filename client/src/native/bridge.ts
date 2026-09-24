/**
 * Obli Android shell bridge — docs/obli-mobile.md §2-§3.
 *
 * The ONLY module allowed to touch `window.__obli_native` / `window.ObliNative`.
 * Pages go through the helpers below (or through utils/download.ts,
 * utils/openExternal.ts, utils/clipboard.ts), never through `window.*`.
 *
 * Note: `__obliance_is_native_app` (ObliTools desktop shell) is a different
 * thing and is intentionally NOT handled here.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type NativeCapability =
  | 'saveFile'
  | 'downloadUrl'
  | 'openExternal'
  | 'clipboard'
  | 'share'
  | 'notify'
  | 'settings'
  | 'back'
  | 'systemBars'
  | 'update';

/** Injected by the shell at document start (docs §2). */
export interface ObliNativeInfo {
  platform: 'android';
  /** Flavor id, e.g. 'obliance'. */
  app: string;
  appVersion: string;
  versionCode: number;
  bridgeVersion: number;
  capabilities: string[];
}

export interface NativeSaveFileResult { uri: string }
export interface NativeUpdateInfo { available: boolean; versionName: string; versionCode: number }
export interface NativeAppInfo {
  app: string;
  appVersion: string;
  versionCode: number;
  webViewVersion: string;
  serverUrl: string;
}

/** `window.ObliNative` — bridgeVersion 1 (docs §3). Every method returns a Promise. */
export interface ObliNativeApi {
  saveFile(filename: string, mime: string, base64: string): Promise<NativeSaveFileResult>;
  downloadUrl(url: string, filename?: string): Promise<unknown>;
  openExternal(url: string): Promise<unknown>;
  copyText(text: string): Promise<unknown>;
  readClipboard(): Promise<string>;
  share(text: string, title?: string): Promise<unknown>;
  notify(title: string, body: string, navigateTo?: string): Promise<unknown>;
  openSettings(): Promise<unknown>;
  setSystemBars(colorHex: string, lightIcons: boolean): Promise<unknown>;
  requestNotificationPermission(): Promise<'granted' | 'denied'>;
  checkForUpdate(): Promise<NativeUpdateInfo>;
  getInfo(): Promise<NativeAppInfo>;
}

export type NativeMethod = keyof ObliNativeApi;

declare global {
  interface Window {
    __obli_native?: ObliNativeInfo;
    ObliNative?: Partial<ObliNativeApi>;
    /** Called by the Android shell on the system back button (docs §3). */
    __obliHandleBack?: () => boolean;
  }
}

/** Rejection reason of `native.*` when the bridge / method / capability is absent. */
export class NativeUnavailableError extends Error {
  readonly method: string;
  constructor(method: string) {
    super(`Native bridge method "${method}" is not available`);
    this.name = 'NativeUnavailableError';
    this.method = method;
  }
}

// ── Detection ────────────────────────────────────────────────────────────────

/** Shell info injected by the Android app, or null in a normal browser. */
export function nativeInfo(): ObliNativeInfo | null {
  if (typeof window === 'undefined') return null;
  const info = window.__obli_native;
  return info && typeof info === 'object' ? info : null;
}

/** True when running inside the Obli Android shell (WebView). */
export function isAndroidApp(): boolean {
  return nativeInfo()?.platform === 'android';
}

/** True when the shell advertises capability `c` (always false in a browser). */
export function hasCapability(c: NativeCapability): boolean {
  const caps = nativeInfo()?.capabilities;
  return Array.isArray(caps) && caps.includes(c);
}

/** True for touch-first devices (primary pointer is coarse). Not reactive — use useIsCoarsePointer() in components. */
export function isTouchDevice(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(pointer: coarse)').matches;
}

// Capability required by each bridge method (getInfo is always allowed).
const METHOD_CAPABILITY: Record<NativeMethod, NativeCapability | null> = {
  saveFile: 'saveFile',
  downloadUrl: 'downloadUrl',
  openExternal: 'openExternal',
  copyText: 'clipboard',
  readClipboard: 'clipboard',
  share: 'share',
  notify: 'notify',
  requestNotificationPermission: 'notify',
  openSettings: 'settings',
  setSystemBars: 'systemBars',
  checkForUpdate: 'update',
  getInfo: null,
};

/**
 * True when `window.ObliNative[method]` can be called: Android shell present,
 * method injected, and its capability advertised.
 */
export function canUseNative(method: NativeMethod): boolean {
  if (!isAndroidApp()) return false;
  const api = window.ObliNative;
  if (!api || typeof api[method] !== 'function') return false;
  const cap = METHOD_CAPABILITY[method];
  return cap === null || hasCapability(cap);
}

function call<M extends NativeMethod>(
  method: M,
  ...args: Parameters<ObliNativeApi[M]>
): ReturnType<ObliNativeApi[M]> {
  if (!canUseNative(method)) {
    return Promise.reject(new NativeUnavailableError(method)) as ReturnType<ObliNativeApi[M]>;
  }
  try {
    const fn = window.ObliNative![method] as unknown as (...a: unknown[]) => unknown;
    return Promise.resolve(fn.apply(window.ObliNative, args)) as ReturnType<ObliNativeApi[M]>;
  } catch (err) {
    return Promise.reject(err) as ReturnType<ObliNativeApi[M]>;
  }
}

/**
 * Typed wrappers around `window.ObliNative`. Every call returns a Promise that
 * rejects with NativeUnavailableError when the bridge/method/capability is
 * absent (never throws synchronously). Check `canUseNative('x')` first when
 * you have a browser fallback.
 */
export const native = {
  saveFile: (filename: string, mime: string, base64: string) => call('saveFile', filename, mime, base64),
  downloadUrl: (url: string, filename?: string) => call('downloadUrl', url, filename),
  openExternal: (url: string) => call('openExternal', url),
  copyText: (text: string) => call('copyText', text),
  readClipboard: () => call('readClipboard'),
  share: (text: string, title?: string) => call('share', text, title),
  notify: (title: string, body: string, navigateTo?: string) => call('notify', title, body, navigateTo),
  openSettings: () => call('openSettings'),
  setSystemBars: (colorHex: string, lightIcons: boolean) => call('setSystemBars', colorHex, lightIcons),
  requestNotificationPermission: () => call('requestNotificationPermission'),
  checkForUpdate: () => call('checkForUpdate'),
  getInfo: () => call('getInfo'),
} as const;

// ── Android back button stack ────────────────────────────────────────────────

/**
 * A back handler. `source` tells whether the Android back button or the
 * Escape key triggered it. Return `false` to let the event fall through to
 * the next handler (and, for back, ultimately to the shell's
 * webView.goBack()); anything else consumes it.
 */
export type BackHandler = (source: 'back' | 'escape') => boolean | void;

export interface BackHandlerOptions {
  /**
   * Also receive the Escape key. Escape walks the stack from the top but only
   * visits Escape-enabled entries (others are transparent to it), so stacked
   * overlays close one at a time. Default false.
   */
  escape?: boolean;
}

interface BackEntry {
  handler: BackHandler;
  escape: boolean;
}

const backStack: BackEntry[] = [];

/**
 * Push a back handler on the stack (most recent wins). Returns the unregister
 * function. Prefer the `useNativeBack()` hook in components.
 */
export function registerBackHandler(handler: BackHandler, options?: BackHandlerOptions): () => void {
  const entry: BackEntry = { handler, escape: !!options?.escape };
  backStack.push(entry);
  return () => {
    const i = backStack.indexOf(entry);
    if (i >= 0) backStack.splice(i, 1);
  };
}

function runStack(source: 'back' | 'escape'): boolean {
  // Snapshot: a handler may unregister itself (closing a modal) while we iterate.
  const entries = backStack.slice().reverse();
  for (const entry of entries) {
    if (source === 'escape' && !entry.escape) continue;
    let result: boolean | void;
    try {
      result = entry.handler(source);
    } catch (err) {
      console.error(`[obli-native] ${source} handler failed`, err);
      result = true;
    }
    if (result !== false) return true;
  }
  return false;
}

/**
 * Run the back stack from the most recent handler down. Returns true when one
 * consumed the press. This is what `window.__obliHandleBack` calls.
 */
export function handleNativeBack(): boolean {
  return runStack('back');
}

/** Number of registered back handlers (0 = the shell will navigate back / exit). */
export function backStackDepth(): number {
  return backStack.length;
}

function onEscapeKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return;
  if (runStack('escape')) e.preventDefault();
}

let backInstalled = false;

/**
 * Install `window.__obliHandleBack` (called by the Android shell on the system
 * back button) and the global Escape dispatcher for Escape-enabled entries.
 * Idempotent; call once at boot (main.tsx).
 */
export function installBackHandler(): void {
  if (typeof window === 'undefined' || backInstalled) return;
  backInstalled = true;
  window.__obliHandleBack = handleNativeBack;
  // Bubble phase on window: React handlers (and inputs/comboboxes that call
  // preventDefault on Escape) run first.
  window.addEventListener('keydown', onEscapeKey);
}

// ── Lifecycle events (docs §3: obli:resume / obli:pause) ─────────────────────

/** Subscribe to the shell's `obli:resume` / `obli:pause` events. Returns the unsubscribe fn. */
export function onNativeLifecycle(event: 'resume' | 'pause', cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const name = `obli:${event}`;
  const listener = () => cb();
  window.addEventListener(name, listener);
  return () => window.removeEventListener(name, listener);
}

// ── System bars / theme-color follow the app theme ───────────────────────────

function rgbTripletToHex(triplet: string): string | null {
  const parts = triplet.trim().split(/[\s,/]+/).slice(0, 3).map((p) => parseInt(p, 10));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  return '#' + parts.map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0')).join('');
}

function isLightHex(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  // Relative luminance (sRGB approximation) — > 0.5 means a light surface.
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.5;
}

let lastBarsColor = '';

function applySystemBars(): void {
  const triplet = getComputedStyle(document.documentElement).getPropertyValue('--c-bg-secondary');
  const hex = rgbTripletToHex(triplet);
  if (!hex || hex === lastBarsColor) return;
  lastBarsColor = hex;
  // Browser address bar / PWA tint follows the header colour of the theme
  // (index.html ships a static dark default for the first paint).
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  const light = isLightHex(hex);
  if (meta) meta.content = hex;
  if (canUseNative('setSystemBars')) {
    // Second argument follows the docs example ('#0f1220', false): true only on
    // a light surface (Android "light status bar" = dark icons).
    native.setSystemBars(hex, light).catch(() => { /* shell too old — ignore */ });
  }
}

let barsInstalled = false;

/**
 * Keep the Android system bars (and `<meta name="theme-color">`) in sync with
 * the header colour of the current theme. Watches `data-theme` on <html>.
 * Idempotent; call once at boot after initTheme().
 */
export function syncSystemBarsWithTheme(): void {
  if (typeof document === 'undefined' || barsInstalled) return;
  barsInstalled = true;
  applySystemBars();
  const mo = new MutationObserver(() => applySystemBars());
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
}

/**
 * Boot-time wiring (main.tsx): back handler, system bars, and a
 * `data-native="android"` attribute on <html> for CSS hooks.
 */
export function initNativeBridge(): void {
  installBackHandler();
  if (isAndroidApp()) {
    document.documentElement.dataset.native = 'android';
  }
  syncSystemBarsWithTheme();
}
