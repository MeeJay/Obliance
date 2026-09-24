import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';

/**
 * Hidden text field that summons the soft keyboard for a remote screen and
 * turns what the user types into text + Backspace / Enter presses —
 * docs/obli-mobile.md §5.
 *
 * Android keyboards (Gboard, Samsung…) do not send usable key events: they
 * fire keydown with key 'Unidentified' / keyCode 229 and edit the field
 * through composition. So, like noVNC's mobile keyboard, the field holds a
 * sentinel string and every `input` event is diffed against the previous
 * value: removed characters become Backspace presses, added ones are typed.
 * This works during composition too (autocorrect replacing a word = a few
 * Backspaces + the new word). The value is only reset outside composition.
 *
 * Hardware keys that DO carry a real key code bubble to the viewer's own
 * keydown handler (which prevents their default, so they never reach the
 * field): nothing is sent twice.
 */

export interface SoftKeyboardHandle {
  /** Focus the field (opens the soft keyboard; must run inside a user gesture). */
  focus: () => void;
  blur: () => void;
  isFocused: () => boolean;
}

export interface SoftKeyboardInputProps {
  /** Typed characters (never contains '\n'). */
  onText: (text: string) => void;
  /** Backspace / Enter produced by the keyboard. */
  onKey: (code: 'Backspace' | 'Enter') => void;
  onFocusChange?: (focused: boolean) => void;
  /** Accessible name of the field. */
  label: string;
}

const SENTINEL = '_'.repeat(64);
const MAX_DRIFT = 256;

export const SoftKeyboardInput = forwardRef<SoftKeyboardHandle, SoftKeyboardInputProps>(function SoftKeyboardInput(
  { onText, onKey, onFocusChange, label },
  ref,
) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const lastRef = useRef(SENTINEL);
  const composingRef = useRef(false);

  const reset = useCallback(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.value = SENTINEL;
    lastRef.current = SENTINEL;
    try { ta.setSelectionRange(SENTINEL.length, SENTINEL.length); } catch { /* not focused */ }
  }, []);

  useImperativeHandle(ref, () => ({
    focus: () => {
      const ta = taRef.current;
      if (!ta) return;
      reset();
      ta.focus({ preventScroll: true });
      try { ta.setSelectionRange(SENTINEL.length, SENTINEL.length); } catch { /* ignore */ }
    },
    blur: () => taRef.current?.blur(),
    isFocused: () => typeof document !== 'undefined' && document.activeElement === taRef.current,
  }), [reset]);

  const flush = useCallback(() => {
    const ta = taRef.current;
    if (!ta) return;
    const next = ta.value;
    const prev = lastRef.current;
    let i = 0;
    while (i < prev.length && i < next.length && prev[i] === next[i]) i++;
    const removed = prev.length - i;
    const added = next.slice(i);
    for (let n = 0; n < removed; n++) onKey('Backspace');
    if (added) {
      // Split on line breaks: each one is an Enter press.
      const parts = added.split(/\r\n|\r|\n/);
      parts.forEach((part, idx) => {
        if (part) onText(part);
        if (idx < parts.length - 1) onKey('Enter');
      });
    }
    lastRef.current = next;
    if (!composingRef.current) {
      const drift = Math.abs(next.length - SENTINEL.length);
      if (drift > MAX_DRIFT || next.length < SENTINEL.length / 2 || /[\r\n]/.test(next)) reset();
    }
  }, [onKey, onText, reset]);

  return (
    <textarea
      ref={taRef}
      aria-label={label}
      defaultValue={SENTINEL}
      autoCapitalize="off"
      autoCorrect="off"
      autoComplete="off"
      spellCheck={false}
      inputMode="text"
      enterKeyHint="enter"
      rows={1}
      // Invisible but focusable; 16px so iOS does not zoom; at the bottom-left
      // corner so the browser never scrolls to reveal it.
      className="keep-font-size pointer-events-none absolute bottom-0 left-0 h-px w-px resize-none overflow-hidden border-0 bg-transparent p-0 text-transparent caret-transparent opacity-0 outline-none"
      style={{ fontSize: 16 }}
      onInput={flush}
      onCompositionStart={() => { composingRef.current = true; }}
      onCompositionEnd={() => { composingRef.current = false; flush(); }}
      onSelect={(e) => {
        // Keep the caret at the end: the diff assumes appends / backspaces.
        const ta = e.currentTarget;
        if (!composingRef.current && ta.selectionStart !== ta.value.length) {
          try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch { /* ignore */ }
        }
      }}
      onFocus={() => { reset(); onFocusChange?.(true); }}
      onBlur={() => onFocusChange?.(false)}
    />
  );
});
