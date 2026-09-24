import { useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { cn } from '@/utils/cn';
import { useNativeBack } from '@/hooks/useNativeBack';
import { useBodyScrollLock, useFocusTrap } from '@/native/overlay';
import { IconButton } from './IconButton';

export type DrawerSide = 'left' | 'right' | 'bottom';
export type DrawerSize = 'sm' | 'md' | 'lg' | 'full';

export interface DrawerProps {
  open: boolean;
  /** Called by the close button, Escape, Android back and (if enabled) a backdrop tap. */
  onClose: () => void;
  /** Edge the sheet slides from (default 'right'). */
  side?: DrawerSide;
  /**
   * left/right width: sm = min(85vw, 320px) (default — phone sidebar) ·
   * md = min(90vw, 420px) · lg = min(95vw, 560px) · full = 100vw.
   * bottom height cap: sm = 50dvh · md = 70dvh · lg = 85dvh (default) · full = 100dvh.
   */
  size?: DrawerSize;
  /** Header title. The header renders when title / headerExtra is set or the close button is shown. */
  title?: ReactNode;
  icon?: ReactNode;
  headerExtra?: ReactNode;
  children?: ReactNode;
  /** Sticky footer (actions). */
  footer?: ReactNode;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
  /** false = cannot be closed by the user (Escape / back / backdrop swallowed). Default true. */
  dismissible?: boolean;
  /** Default: shown when there is a title and the drawer is dismissible. */
  showCloseButton?: boolean;
  /** Bottom sheets: show the small grab bar at the top (default true for side="bottom"). */
  showHandle?: boolean;
  /** Classes for the sliding panel. */
  className?: string;
  /** Classes for the scrolling body (default padding px-4 py-3; pass 'p-0' for full-bleed content like the sidebar). */
  bodyClassName?: string;
  footerClassName?: string;
  /** Classes for the backdrop layer (e.g. a different z-index). */
  overlayClassName?: string;
  ariaLabel?: string;
}

const widths: Record<DrawerSize, string> = {
  sm: 'w-[min(85vw,320px)]',
  md: 'w-[min(90vw,420px)]',
  lg: 'w-[min(95vw,560px)]',
  full: 'w-screen',
};

// Each dvh class has a `supports-[not(height:100dvh)]:` vh twin for WebView
// < 108 (a plain 'max-h-[50vh] max-h-[50dvh]' pair would not work: Tailwind
// emits same-property utilities alphabetically, so vh would always win).
const heights: Record<DrawerSize, string> = {
  sm: 'max-h-[50dvh] supports-[not(height:100dvh)]:max-h-[50vh]',
  md: 'max-h-[70dvh] supports-[not(height:100dvh)]:max-h-[70vh]',
  lg: 'max-h-[85dvh] supports-[not(height:100dvh)]:max-h-[85vh]',
  full: 'h-dvh max-h-dvh supports-[not(height:100dvh)]:h-screen supports-[not(height:100dvh)]:max-h-screen',
};

/**
 * Side / bottom sheet — docs/obli-mobile.md §8. Same behaviours as Modal
 * (portal, z-[200], Escape, Android back, scroll lock, focus trap). Used by
 * the phone sidebar, ActionMenu's phone sheet and MasterDetail's drawer mode.
 */
export function Drawer(props: DrawerProps) {
  if (!props.open) return null;
  return <DrawerImpl {...props} />;
}

function DrawerImpl({
  onClose,
  side = 'right',
  size,
  title,
  icon,
  headerExtra,
  children,
  footer,
  closeOnBackdrop = true,
  closeOnEscape = true,
  dismissible = true,
  showCloseButton,
  showHandle,
  className,
  bodyClassName,
  footerClassName,
  overlayClassName,
  ariaLabel,
}: DrawerProps) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const downOnBackdrop = useRef(false);
  const titleId = useId();

  useNativeBack((source) => {
    if (!dismissible) return true;
    if (source === 'escape' && !closeOnEscape) return true;
    onClose();
    return true;
  }, true, { escape: true });
  useBodyScrollLock(true);
  useFocusTrap(panelRef, true);

  const isBottom = side === 'bottom';
  const effSize: DrawerSize = size ?? (isBottom ? 'lg' : 'sm');
  const withClose = showCloseButton ?? (title != null && dismissible);
  const hasHeader = title != null || icon != null || headerExtra != null || withClose;
  const withHandle = showHandle ?? isBottom;

  return createPortal(
    <div
      className={cn(
        'fixed inset-0 z-[200] flex bg-black/60 backdrop-blur-sm',
        side === 'left' && 'justify-start',
        side === 'right' && 'justify-end',
        isBottom && 'items-end justify-center',
        overlayClassName,
      )}
      onPointerDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        if (e.target !== e.currentTarget || !downOnBackdrop.current) return;
        downOnBackdrop.current = false;
        if (closeOnBackdrop && dismissible) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title != null ? titleId : undefined}
        aria-label={title == null ? ariaLabel : undefined}
        tabIndex={-1}
        className={cn(
          'relative flex flex-col overflow-hidden bg-bg-secondary shadow-2xl outline-none',
          side === 'left' && 'h-dvh supports-[not(height:100dvh)]:h-screen max-w-full pt-safe pb-safe pl-safe motion-safe:animate-obli-slide-in-left',
          side === 'right' && 'h-dvh supports-[not(height:100dvh)]:h-screen max-w-full pt-safe pb-safe pr-safe motion-safe:animate-obli-slide-in-right',
          !isBottom && widths[effSize],
          isBottom && 'w-full rounded-t-xl pb-safe px-safe motion-safe:animate-obli-slide-in-up sm:max-w-lg',
          isBottom && heights[effSize],
          className,
        )}
      >
        {withHandle && (
          <div className="flex shrink-0 justify-center pt-2" aria-hidden="true">
            <div className="h-1 w-10 rounded-full bg-border-light" />
          </div>
        )}
        {hasHeader && (
          <div className="flex shrink-0 items-center gap-2 px-4 py-3">
            {icon}
            {title != null ? (
              <h2 id={titleId} className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary">
                {title}
              </h2>
            ) : (
              <div className="flex-1" />
            )}
            {headerExtra}
            {withClose && (
              <IconButton
                label={t('common.close', 'Close')}
                icon={<X className="h-4 w-4" />}
                size="sm"
                variant="plain"
                onClick={onClose}
                className="-mr-1"
              />
            )}
          </div>
        )}
        <div className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3', bodyClassName)}>
          {children}
        </div>
        {footer != null && (
          <div className={cn('flex shrink-0 flex-wrap items-center justify-end gap-2 px-4 py-3', footerClassName)}>
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
