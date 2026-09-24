import { forwardRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/utils/cn';
import {
  FUNCTION_KEYS,
  LETTER_KEYS,
  type KeyBarKey,
  type ModifierKey,
  type Modifiers,
} from './remoteKeys';

/**
 * Touch key bar shared by the remote tools — docs/obli-mobile.md §5.
 *
 * One horizontally scrollable row of 40 px chips: latched modifiers
 * (Ctrl / Alt / Shift / Win, applied to the next key, character or tap),
 * the keys a soft keyboard lacks (Esc, Tab, arrows, Home/End…), F1–F12 on
 * demand, plus `leading` / `trailing` slots for tool buttons (keyboard
 * summon, Ctrl+Alt+Del, clipboard…). While Ctrl or Alt is latched an a–z
 * row appears (`letterRow`), the reliable way to send Ctrl+<letter> when
 * the soft keyboard composes words.
 *
 * Every chip keeps the focus where it is (pointerdown / mousedown are
 * prevented) so a soft keyboard or the terminal's hidden textarea is not
 * blurred by a key press.
 */

const MOD_LABEL: Record<ModifierKey, string> = { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: 'Win' };

export interface KeyChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  /** Accent / danger tint for tool chips. */
  tone?: 'default' | 'accent' | 'danger';
}

/** A key-bar button that never steals focus. */
export const KeyChip = forwardRef<HTMLButtonElement, KeyChipProps>(function KeyChip(
  { active = false, tone = 'default', className, children, type = 'button', onPointerDown, onMouseDown, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      tabIndex={-1}
      aria-pressed={active || undefined}
      onPointerDown={(e) => { e.preventDefault(); onPointerDown?.(e); }}
      onMouseDown={(e) => { e.preventDefault(); onMouseDown?.(e); }}
      className={cn(
        'inline-flex h-10 min-w-10 shrink-0 select-none items-center justify-center gap-1.5 rounded-md px-2.5',
        'text-xs font-mono font-semibold transition-colors disabled:opacity-40',
        active
          ? 'bg-accent text-white'
          : tone === 'danger'
            ? 'bg-red-500/10 text-red-400 active:bg-red-500/20'
            : tone === 'accent'
              ? 'bg-accent/10 text-accent active:bg-accent/20'
              : 'bg-bg-tertiary text-text-primary active:bg-accent/15',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

export interface RemoteKeyBarProps {
  /** Latch buttons to show (in this order). */
  modifiers?: ModifierKey[];
  latched: Modifiers;
  onToggleModifier: (m: ModifierKey) => void;
  /** Main row keys. */
  keys: KeyBarKey[];
  /** Offer F1–F12 behind an "Fn" toggle (default true). */
  functionKeys?: boolean;
  /** Called for every key / letter chip; the owner applies (and clears) the latched modifiers. */
  onKey: (key: KeyBarKey) => void;
  /** Show the a–z row while Ctrl or Alt is latched. */
  letterRow?: boolean;
  /** Buttons before the modifiers (e.g. keyboard summon). */
  leading?: ReactNode;
  /** Buttons after the keys (e.g. Ctrl+Alt+Del, clipboard, zoom). */
  trailing?: ReactNode;
  className?: string;
  ariaLabel?: string;
}

export function RemoteKeyBar({
  modifiers = [],
  latched,
  onToggleModifier,
  keys,
  functionKeys = true,
  onKey,
  letterRow = false,
  leading,
  trailing,
  className,
  ariaLabel,
}: RemoteKeyBarProps) {
  const { t } = useTranslation();
  const [fnOpen, setFnOpen] = useState(false);
  const showLetters = letterRow && (latched.ctrl || latched.alt);

  const renderKey = (k: KeyBarKey) => (
    <KeyChip key={k.id} onClick={() => onKey(k)} title={k.title} aria-label={k.title ?? k.label}>
      {k.label}
    </KeyChip>
  );

  return (
    <div
      role="toolbar"
      aria-label={ariaLabel ?? t('remoteKeys.bar', 'Keys')}
      className={cn('shrink-0 bg-bg-secondary pb-safe px-safe', className)}
    >
      {showLetters && (
        <div className="flex items-center gap-1 overflow-x-auto overscroll-x-contain scrollbar-none px-2 pt-1.5">
          {LETTER_KEYS.map(renderKey)}
        </div>
      )}
      <div className="flex items-center gap-1 overflow-x-auto overscroll-x-contain scrollbar-none px-2 py-1.5">
        {leading}
        {modifiers.map((m) => (
          <KeyChip
            key={m}
            active={latched[m]}
            onClick={() => onToggleModifier(m)}
            aria-label={t(`remoteKeys.mod.${m}`, `${MOD_LABEL[m]} (applies to the next key)`)}
          >
            {MOD_LABEL[m]}
          </KeyChip>
        ))}
        {modifiers.length > 0 && <span className="mx-0.5 h-6 w-px shrink-0 bg-border" aria-hidden="true" />}
        {keys.map(renderKey)}
        {functionKeys && (
          <>
            <KeyChip
              active={fnOpen}
              onClick={() => setFnOpen((v) => !v)}
              aria-expanded={fnOpen}
              aria-label={t('remoteKeys.functionKeys', 'Function keys F1–F12')}
            >
              Fn
            </KeyChip>
            {fnOpen && FUNCTION_KEYS.map(renderKey)}
          </>
        )}
        {trailing && <span className="mx-0.5 h-6 w-px shrink-0 bg-border" aria-hidden="true" />}
        {trailing}
      </div>
    </div>
  );
}
