import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Info } from 'lucide-react';
import { cn } from '@/utils/cn';
import { useCanHover } from '@/hooks/useMediaQuery';
import { useClickOutside } from '@/hooks/useClickOutside';
import { useNativeBack } from '@/hooks/useNativeBack';
import { useAnchoredPosition } from '@/native/overlay';

export interface TipProps {
  /** Tooltip content (text or rich nodes). Nothing renders when null/empty. */
  content: ReactNode;
  /**
   * The trigger. Omit it to get a small (i) info button (= <InfoTip>).
   * Wrap NON-interactive content (text, icon, badge) or a DISABLED control
   * (to explain why it is disabled): on touch, a tap on the wrapper toggles
   * the tip, so an enabled button inside would also fire its own action.
   */
  children?: ReactNode;
  /** Preferred side (flips if there is no room). Default 'top'. */
  placement?: 'top' | 'bottom';
  /** Default 'center'. */
  align?: 'start' | 'center' | 'end';
  /** aria-label of the default (i) trigger. Default t('ui.moreInfo'). */
  label?: string;
  /** Classes for the trigger wrapper (inline-flex span). */
  className?: string;
  /** Classes for the bubble (default max-w-xs). */
  contentClassName?: string;
  /** Hover open delay in ms (mouse only). Default 150. */
  delay?: number;
  disabled?: boolean;
}

/**
 * Tooltip that also works on touch — docs/obli-mobile.md §5.2 / §8.
 * Mouse: hover / keyboard focus shows it. Touch: tap toggles a small popover,
 * tap elsewhere / Android back / Escape closes it.
 *
 *   <Tip content={t('devices.privacyHint')}><Shield className="w-3.5 h-3.5" /></Tip>
 *   <Tip content={reason}><span><button disabled>…</button></span></Tip>
 *   <InfoTip content={t('schedules.bypassPrivacyHelp')} />
 */
export function Tip({
  content,
  children,
  placement = 'top',
  align = 'center',
  label,
  className,
  contentClassName,
  delay = 150,
  disabled = false,
}: TipProps) {
  const { t } = useTranslation();
  const canHover = useCanHover();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const id = useId();
  const empty = content == null || content === '' || content === false;
  const active = open && !disabled && !empty;

  const pos = useAnchoredPosition(wrapRef, popRef, active, { placement, align, offset: 6 });

  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useClickOutside([wrapRef, popRef], () => setOpen(false), active && !canHover);
  useNativeBack(() => setOpen(false), active, { escape: true });

  const show = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(true), delay);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    setOpen(false);
  };

  const trigger = children ?? (
    <button
      type="button"
      aria-label={label ?? t('ui.moreInfo', 'More information')}
      className={cn(
        'inline-flex items-center justify-center rounded-full text-text-muted hover:text-text-primary',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
        // Invisible 40×40 hit area on touch without moving the layout.
        "relative coarse:after:absolute coarse:after:left-1/2 coarse:after:top-1/2 coarse:after:h-10 coarse:after:w-10 coarse:after:-translate-x-1/2 coarse:after:-translate-y-1/2 coarse:after:content-['']",
      )}
    >
      <Info className="h-3.5 w-3.5" />
    </button>
  );

  return (
    <>
      <span
        ref={wrapRef}
        className={cn(
          'inline-flex items-center',
          // Let taps / hovers on a disabled control reach the wrapper.
          '[&>*:disabled]:pointer-events-none',
          className,
        )}
        aria-describedby={active ? id : undefined}
        onMouseEnter={canHover ? show : undefined}
        onMouseLeave={canHover ? hide : undefined}
        onFocus={canHover ? show : undefined}
        onBlur={canHover ? hide : undefined}
        onClick={
          canHover
            ? undefined
            : () => {
                if (!disabled && !empty) setOpen((o) => !o);
              }
        }
      >
        {trigger}
      </span>
      {active &&
        createPortal(
          <div
            ref={popRef}
            id={id}
            role="tooltip"
            style={{
              position: 'fixed',
              top: pos?.top ?? 0,
              left: pos?.left ?? 0,
              maxHeight: pos?.maxHeight,
              visibility: pos ? 'visible' : 'hidden',
            }}
            className={cn(
              'z-[450] max-w-xs overflow-y-auto whitespace-pre-line break-words rounded-lg border border-border',
              'bg-bg-tertiary px-2.5 py-1.5 text-xs text-text-primary shadow-lg',
              canHover && 'pointer-events-none',
              contentClassName,
            )}
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}

/** <Tip> with the default (i) trigger. */
export function InfoTip(props: Omit<TipProps, 'children'>) {
  return <Tip {...props} />;
}
