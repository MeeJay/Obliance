/**
 * Shared key vocabulary of the on-screen key bars (ObliReach viewer and the
 * terminal panels) — docs/obli-mobile.md §5 (touch rules).
 *
 * A key is described by its DOM `KeyboardEvent.code` (physical position, the
 * ObliReach agent maps it with codeToVK) and/or a `text` to type. Adapters
 * turn a key + the latched modifiers into what the remote end understands:
 *   - ObliReach: JSON key down/up messages (see ObliReachViewer).
 *   - Terminals: xterm/VT escape sequences (terminalSequence below).
 */

export type ModifierKey = 'ctrl' | 'alt' | 'shift' | 'meta';
export type Modifiers = Record<ModifierKey, boolean>;

export const NO_MODIFIERS: Modifiers = { ctrl: false, alt: false, shift: false, meta: false };

export const MODIFIER_ORDER: ModifierKey[] = ['ctrl', 'alt', 'shift', 'meta'];

/** Physical key code pressed for each latched modifier. */
export const MODIFIER_CODES: Record<ModifierKey, string> = {
  ctrl: 'ControlLeft',
  alt: 'AltLeft',
  shift: 'ShiftLeft',
  meta: 'MetaLeft',
};

export function hasModifier(m: Modifiers): boolean {
  return m.ctrl || m.alt || m.shift || m.meta;
}

export function activeModifiers(m: Modifiers): ModifierKey[] {
  return MODIFIER_ORDER.filter((k) => m[k]);
}

export interface KeyBarKey {
  /** Stable id (also the React key). */
  id: string;
  /** Visible chip text (key names are technical, not translated). */
  label: string;
  /** Tooltip / accessible description. */
  title?: string;
  /** DOM KeyboardEvent.code (physical key). */
  code?: string;
  /** Text typed by the key (terminal symbols, letters of the modifier row). */
  text?: string;
}

/** Esc / Tab / arrows — the keys a soft keyboard does not have. */
export const ESSENTIAL_KEYS: KeyBarKey[] = [
  { id: 'esc', label: 'Esc', code: 'Escape' },
  { id: 'tab', label: 'Tab', code: 'Tab' },
  { id: 'up', label: '↑', code: 'ArrowUp' },
  { id: 'down', label: '↓', code: 'ArrowDown' },
  { id: 'left', label: '←', code: 'ArrowLeft' },
  { id: 'right', label: '→', code: 'ArrowRight' },
];

export const NAVIGATION_KEYS: KeyBarKey[] = [
  { id: 'home', label: 'Home', code: 'Home' },
  { id: 'end', label: 'End', code: 'End' },
  { id: 'pgup', label: 'PgUp', code: 'PageUp' },
  { id: 'pgdn', label: 'PgDn', code: 'PageDown' },
  { id: 'ins', label: 'Ins', code: 'Insert' },
  { id: 'del', label: 'Del', code: 'Delete' },
];

export const FUNCTION_KEYS: KeyBarKey[] = Array.from({ length: 12 }, (_, i) => ({
  id: `f${i + 1}`,
  label: `F${i + 1}`,
  code: `F${i + 1}`,
}));

/** a–z row shown while Ctrl / Alt is latched (the reliable path for Ctrl+letter on touch). */
export const LETTER_KEYS: KeyBarKey[] = 'abcdefghijklmnopqrstuvwxyz'.split('').map((ch) => ({
  id: `letter-${ch}`,
  label: ch.toUpperCase(),
  text: ch,
  code: `Key${ch.toUpperCase()}`,
}));

/**
 * `key` → `code` for key events that arrive without a physical code (Android
 * soft keyboards send code === '' for Enter / Backspace…). The ObliReach agent
 * resolves named keys through the code only.
 */
export const KEY_TO_CODE: Record<string, string> = {
  Backspace: 'Backspace',
  Enter: 'Enter',
  Tab: 'Tab',
  Escape: 'Escape',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'ArrowUp',
  ArrowDown: 'ArrowDown',
  ArrowLeft: 'ArrowLeft',
  ArrowRight: 'ArrowRight',
  ' ': 'Space',
  F1: 'F1', F2: 'F2', F3: 'F3', F4: 'F4', F5: 'F5', F6: 'F6',
  F7: 'F7', F8: 'F8', F9: 'F9', F10: 'F10', F11: 'F11', F12: 'F12',
};

/** Physical code of a letter / digit / space (US positions), null for anything else. */
export function codeForChar(ch: string): string | null {
  if (/^[a-z]$/i.test(ch)) return `Key${ch.toUpperCase()}`;
  if (/^[0-9]$/.test(ch)) return `Digit${ch}`;
  if (ch === ' ') return 'Space';
  return null;
}

// ── Terminal adapter ─────────────────────────────────────────────────────────

/** Ctrl+<char> as the terminal byte (null when the char has no control form). */
export function ctrlChar(ch: string): string | null {
  if (/^[a-z]$/i.test(ch)) return String.fromCharCode(ch.toUpperCase().charCodeAt(0) & 0x1f);
  switch (ch) {
    case '@': case ' ': case '2': return '\x00';
    case '[': case '3': return '\x1b';
    case '\\': case '4': return '\x1c';
    case ']': case '5': return '\x1d';
    case '^': case '6': return '\x1e';
    case '_': case '-': case '7': return '\x1f';
    case '?': case '8': return '\x7f';
    default: return null;
  }
}

/** Apply latched Ctrl / Alt to typed text (only the first character is modified). */
export function applyTerminalModifiers(text: string, mods: Modifiers): string {
  if (!text) return text;
  const [first, ...rest] = Array.from(text);
  let out = first;
  if (mods.ctrl) out = ctrlChar(first) ?? first;
  if (mods.alt) out = '\x1b' + out;
  return out + rest.join('');
}

const CSI_FINAL: Record<string, string> = {
  ArrowUp: 'A', ArrowDown: 'B', ArrowRight: 'C', ArrowLeft: 'D', Home: 'H', End: 'F',
};
const SS3_FKEYS: Record<string, string> = { F1: 'P', F2: 'Q', F3: 'R', F4: 'S' };
const TILDE_KEYS: Record<string, number> = {
  Insert: 2, Delete: 3, PageUp: 5, PageDown: 6,
  F5: 15, F6: 17, F7: 18, F8: 19, F9: 20, F10: 21, F11: 23, F12: 24,
};

/**
 * xterm escape sequence of a key with modifiers (xterm "modifyCursorKeys"
 * encoding: 1 + shift + 2·alt + 4·ctrl). `applicationCursor` = DECCKM
 * (vim, less… switch the arrows to SS3); null = unknown, which keeps the
 * historic panel behaviour (CSI arrows, SS3 Home/End).
 */
export function terminalSequence(key: KeyBarKey, mods: Modifiers, applicationCursor: boolean | null): string {
  if (key.text !== undefined) return applyTerminalModifiers(key.text, mods);
  const code = key.code ?? '';
  const m = 1 + (mods.shift ? 1 : 0) + (mods.alt ? 2 : 0) + (mods.ctrl ? 4 : 0);

  if (code === 'Escape') return mods.alt ? '\x1b\x1b' : '\x1b';
  if (code === 'Tab') return mods.shift ? '\x1b[Z' : mods.alt ? '\x1b\t' : '\t';
  if (code === 'Enter') return mods.alt ? '\x1b\r' : '\r';
  if (code === 'Backspace') return mods.ctrl ? '\x08' : mods.alt ? '\x1b\x7f' : '\x7f';

  const final = CSI_FINAL[code];
  if (final) {
    if (m > 1) return `\x1b[1;${m}${final}`;
    const isArrow = code.startsWith('Arrow');
    if (isArrow) return applicationCursor ? `\x1bO${final}` : `\x1b[${final}`;
    // Home / End: SS3 in application mode or when the mode is unknown (historic panel), CSI otherwise.
    return applicationCursor === false ? `\x1b[${final}` : `\x1bO${final}`;
  }
  const ss3 = SS3_FKEYS[code];
  if (ss3) return m > 1 ? `\x1b[1;${m}${ss3}` : `\x1bO${ss3}`;
  const n = TILDE_KEYS[code];
  if (n !== undefined) return m > 1 ? `\x1b[${n};${m}~` : `\x1b[${n}~`;
  return '';
}
