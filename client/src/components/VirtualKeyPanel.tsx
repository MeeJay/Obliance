import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Keyboard, ChevronDown, ChevronUp } from 'lucide-react';
import { clsx } from 'clsx';
import { useIsCoarsePointer } from '@/hooks/useMediaQuery';
import { RemoteKeyBar, KeyChip } from '@/components/remote/RemoteKeyBar';
import {
 ESSENTIAL_KEYS, NAVIGATION_KEYS, NO_MODIFIERS, hasModifier, applyTerminalModifiers, terminalSequence,
 type KeyBarKey, type ModifierKey, type Modifiers,
} from '@/components/remote/remoteKeys';

/**
 * Latched Ctrl / Alt / Shift of a terminal key bar. Owners that also want the
 * latch to apply to what the soft keyboard types pass it to the panel AND run
 * xterm's `onData` through `transformInput` (docs/obli-mobile.md §5):
 *
 *   const latch = useTerminalLatch();
 *   term.onData((d) => ws.send(enc(latchRef.current.transformInput(d))));
 *   <VirtualKeyPanel onKey={send} latch={latch} />
 */
export interface TerminalLatch {
 latched: Modifiers;
 toggle: (m: ModifierKey) => void;
 /** Returns the latched modifiers and clears them. */
 consume: () => Modifiers;
 /** Applies (and clears) a latched Ctrl / Alt to typed terminal data. */
 transformInput: (data: string) => string;
}

export function useTerminalLatch(): TerminalLatch {
 const [latched, setLatchedState] = useState<Modifiers>(NO_MODIFIERS);
 const ref = useRef<Modifiers>(NO_MODIFIERS);
 const set = useCallback((m: Modifiers) => { ref.current = m; setLatchedState(m); }, []);
 const toggle = useCallback((m: ModifierKey) => set({ ...ref.current, [m]: !ref.current[m] }), [set]);
 const consume = useCallback(() => {
 const m = ref.current;
 if (hasModifier(m)) set(NO_MODIFIERS);
 return m;
 }, [set]);
 const transformInput = useCallback((data: string) => {
 const m = ref.current;
 if (!m.ctrl && !m.alt) return data;
 // Only plain typed text: escape sequences (arrows from a hardware
 // keyboard…) and pastes are left alone.
 if (data.startsWith('\x1b') || Array.from(data).length > 1) return data;
 set(NO_MODIFIERS);
 return applyTerminalModifiers(data, m);
 }, [set]);
 return { latched, toggle, consume, transformInput };
}

interface Props {
 /** Sends raw bytes to the terminal session. Usually `(s) => ws.send(...)`. */
 onKey: (sequence: string) => void;
 className?: string;
 /**
  * 'panel' = the tabbed F-keys / Nav / Ctrl+ panel (desktop look) · 'bar' =
  * the touch key bar (40 px chips, latched modifiers) · 'auto' (default) =
  * bar on touch screens, panel otherwise.
  */
 variant?: 'auto' | 'panel' | 'bar';
 /** DECCKM state of the terminal (xterm `term.modes.applicationCursorKeysMode`); absent = historic sequences. */
 applicationCursor?: () => boolean | null;
 /** Shared latch (see useTerminalLatch); an internal one is used otherwise. */
 latch?: TerminalLatch;
 /** Bar mode: shows a keyboard button that summons the soft keyboard (e.g. `() => term.focus()`). */
 onKeyboard?: () => void;
}

// Escape sequences per xterm/vt220 convention. Same as what a real terminal
// emitter would send when the corresponding physical key is pressed.
const FUNCTION_KEYS: Array<{ label: string; seq: string }> = [
 { label: 'F1', seq: '\x1bOP' },
 { label: 'F2', seq: '\x1bOQ' },
 { label: 'F3', seq: '\x1bOR' },
 { label: 'F4', seq: '\x1bOS' },
 { label: 'F5', seq: '\x1b[15~' },
 { label: 'F6', seq: '\x1b[17~' },
 { label: 'F7', seq: '\x1b[18~' },
 { label: 'F8', seq: '\x1b[19~' },
 { label: 'F9', seq: '\x1b[20~' },
 { label: 'F10', seq: '\x1b[21~' },
 { label: 'F11', seq: '\x1b[23~' },
 { label: 'F12', seq: '\x1b[24~' },
];

// `code` lets the panel re-encode the key for the terminal's cursor mode.
const CONTROL_KEYS: Array<{ id: string; label: string; seq: string; title: string; code: string }> = [
 { id: 'esc', label: 'Esc', seq: '\x1b', title: 'Escape', code: 'Escape' },
 { id: 'tab', label: 'Tab', seq: '\t', title: 'Tab', code: 'Tab' },
 { id: 'up', label: '↑', seq: '\x1b[A', title: 'Up arrow', code: 'ArrowUp' },
 { id: 'down', label: '↓', seq: '\x1b[B', title: 'Down arrow', code: 'ArrowDown' },
 { id: 'left', label: '←', seq: '\x1b[D', title: 'Left arrow', code: 'ArrowLeft' },
 { id: 'right', label: '→', seq: '\x1b[C', title: 'Right arrow', code: 'ArrowRight' },
 { id: 'home', label: 'Home',seq: '\x1bOH', title: 'Home', code: 'Home' },
 { id: 'end', label: 'End', seq: '\x1bOF', title: 'End', code: 'End' },
 { id: 'pgup', label: 'PgUp',seq: '\x1b[5~', title: 'Page Up', code: 'PageUp' },
 { id: 'pgdn', label: 'PgDn',seq: '\x1b[6~', title: 'Page Down', code: 'PageDown' },
 { id: 'ins', label: 'Ins', seq: '\x1b[2~', title: 'Insert', code: 'Insert' },
 { id: 'del', label: 'Del', seq: '\x1b[3~', title: 'Delete', code: 'Delete' },
];

const CTRL_COMBOS: Array<{ id: string; label: string; seq: string; title: string }> = [
 { id: 'c', label: '^C', seq: '\x03', title: 'Ctrl+C — interrupt' },
 { id: 'd', label: '^D', seq: '\x04', title: 'Ctrl+D — EOF / logout' },
 { id: 'z', label: '^Z', seq: '\x1a', title: 'Ctrl+Z — suspend' },
 { id: 'l', label: '^L', seq: '\x0c', title: 'Ctrl+L — clear screen' },
 { id: 'u', label: '^U', seq: '\x15', title: 'Ctrl+U — erase line' },
 { id: 'w', label: '^W', seq: '\x17', title: 'Ctrl+W — erase word' },
 { id: 'r', label: '^R', seq: '\x12', title: 'Ctrl+R — reverse history search' },
 { id: 'a', label: '^A', seq: '\x01', title: 'Ctrl+A — start of line' },
 { id: 'e', label: '^E', seq: '\x05', title: 'Ctrl+E — end of line' },
];

// Touch bar: the keys a soft keyboard lacks, then shell symbols it buries.
const SYMBOL_KEYS: KeyBarKey[] = ['|', '~', '/', '-', '\\', '$', '*'].map((ch) => ({ id: `sym-${ch}`, label: ch, text: ch }));
const BAR_KEYS: KeyBarKey[] = [...ESSENTIAL_KEYS, ...NAVIGATION_KEYS, ...SYMBOL_KEYS];
const BAR_COMBOS = CTRL_COMBOS.filter((c) => c.id === 'c' || c.id === 'd');

/**
 * Virtual terminal keys the browser normally intercepts (F1-F12, arrows, Ctrl
 * combos). Clicking a key injects the corresponding escape sequence into the
 * active terminal session via the provided `onKey` callback.
 *
 * Desktop: the historic tabbed panel. Touch screens: one scrollable row of
 * 40 px keys with latched Ctrl / Alt / Shift (the shared RemoteKeyBar) —
 * pressing a key never steals the focus from the terminal.
 */
export function VirtualKeyPanel({ onKey, className, variant = 'auto', applicationCursor, latch: latchProp, onKeyboard }: Props) {
 const { t } = useTranslation();
 const coarse = useIsCoarsePointer();
 const ownLatch = useTerminalLatch();
 const latch = latchProp ?? ownLatch;
 const [collapsed, setCollapsed] = useState(false);
 const [section, setSection] = useState<'fn' | 'ctrl' | 'nav'>(coarse ? 'nav' : 'fn');
 const asBar = variant === 'bar' || (variant === 'auto' && coarse);

 const cursorMode = () => {
 try { return applicationCursor ? applicationCursor() : null; } catch { return null; }
 };

 const keyTitle = (id: string, fallback: string) => t(`terminalKeys.key.${id}`, fallback);

 if (asBar) {
 const onBarKey = (k: KeyBarKey) => {
 const mods = latch.consume();
 const seq = terminalSequence(k, mods, cursorMode());
 if (seq) onKey(seq);
 };
 return (
 <RemoteKeyBar
 className={className}
 ariaLabel={t('terminalKeys.title', 'Keys')}
 modifiers={['ctrl', 'alt', 'shift']}
 latched={latch.latched}
 onToggleModifier={latch.toggle}
 keys={BAR_KEYS}
 onKey={onBarKey}
 letterRow
 leading={onKeyboard ? (
 <KeyChip onClick={onKeyboard} aria-label={t('terminalKeys.showKeyboard', 'Show keyboard')}>
 <Keyboard className="w-4 h-4" />
 </KeyChip>
 ) : undefined}
 trailing={BAR_COMBOS.map((c) => (
 <KeyChip key={c.id} tone="accent" onClick={() => onKey(c.seq)} aria-label={keyTitle(`ctrl_${c.id}`, c.title)}>
 {c.label}
 </KeyChip>
 ))}
 />
 );
 }

 const seqFor = (k: { seq: string; code?: string }) => {
 // Re-encode the cursor keys for the terminal's current mode when the owner
 // tells us (vim / less switch to application mode).
 if (k.code && applicationCursor) {
 const seq = terminalSequence({ id: k.code, label: k.code, code: k.code }, latch.consume(), cursorMode());
 if (seq) return seq;
 }
 return k.seq;
 };

 const renderRow = (keys: Array<{ id?: string; label: string; seq: string; title?: string; code?: string }>) => (
 <div className="flex flex-wrap gap-1 p-2">
 {keys.map((k) => (
 <button
 key={k.label}
 type="button"
 onClick={() => onKey(seqFor(k))}
 // Touch / pen: keep the focus (and the soft keyboard) in the terminal.
 onPointerDown={(e) => { if (e.pointerType !== 'mouse') e.preventDefault(); }}
 title={k.id ? keyTitle(k.id, k.title || k.label) : (k.title || k.label)}
 className="min-w-[36px] px-2 py-1 text-[11px] font-mono font-semibold bg-bg-tertiary rounded hover:bg-accent/10 hover:border-accent/40 hover:text-accent transition-colors coarse:min-h-10"
 >
 {k.label}
 </button>
 ))}
 </div>
 );

 return (
 <div
 className={clsx(
 'bg-bg-secondary flex flex-col shrink-0',
 className,
 )}
 >
 <div className="flex items-center gap-1 px-2 py-1 /50">
 <Keyboard className="w-3.5 h-3.5 text-text-muted" />
 <span className="text-[11px] text-text-muted uppercase tracking-wider mr-2">{t('terminalKeys.title', 'Keys')}</span>
 {!collapsed && (
 <div className="flex items-center gap-1">
 {(['fn', 'nav', 'ctrl'] as const).map((s) => (
 <button
 key={s}
 onClick={() => setSection(s)}
 onPointerDown={(e) => { if (e.pointerType !== 'mouse') e.preventDefault(); }}
 className={clsx(
 'px-2 py-0.5 text-[10px] font-medium rounded transition-colors coarse:min-h-10 coarse:px-3',
 section === s ? 'bg-accent/15 text-accent' : 'text-text-muted hover:text-text-primary',
 )}
 >
 {s === 'fn' ? 'F1-F12' : s === 'nav' ? t('terminalKeys.nav', 'Nav') : 'Ctrl+'}
 </button>
 ))}
 </div>
 )}
 <button
 onClick={() => setCollapsed(!collapsed)}
 onPointerDown={(e) => { if (e.pointerType !== 'mouse') e.preventDefault(); }}
 className="ml-auto p-0.5 text-text-muted hover:text-text-primary coarse:min-h-10 coarse:min-w-10 coarse:flex coarse:items-center coarse:justify-center"
 title={collapsed ? t('terminalKeys.expand', 'Expand') : t('terminalKeys.collapse', 'Collapse')}
 aria-label={collapsed ? t('terminalKeys.expand', 'Expand') : t('terminalKeys.collapse', 'Collapse')}
 >
 {collapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
 </button>
 </div>
 {!collapsed && (
 section === 'fn' ? renderRow(FUNCTION_KEYS) :
 section === 'nav' ? renderRow(CONTROL_KEYS) :
 renderRow(CTRL_COMBOS.map((c) => ({ ...c, id: `ctrl_${c.id}` })))
 )}
 </div>
 );
}
