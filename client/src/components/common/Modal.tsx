import { useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { cn } from '@/utils/cn';
import { useNativeBack } from '@/hooks/useNativeBack';
import { useBodyScrollLock, useFocusTrap } from '@/native/overlay';
import { IconButton } from './IconButton';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full';

export interface ModalProps {
  open: boolean;
  /** Called by the close button, Escape, Android back and (if enabled) a backdrop tap. */
  onClose: () => void;
  /** Header title. The header (with the close button) renders when `title` or `icon` is set, or when dismissible. */
  title?: ReactNode;
  /** Optional icon left of the title (e.g. <Cpu className="w-4 h-4 text-accent" />). */
  icon?: ReactNode;
  /** Extra header content right of the title (before the close button). */
  headerExtra?: ReactNode;
  /** Max width from `sm` up: sm=28rem · md=32rem (default) · lg=42rem · xl=48rem · 2xl=56rem · full=viewport. */
  size?: ModalSize;
  children?: ReactNode;
  /** Sticky action bar under the scrolling body (buttons are right-aligned; on phone they wrap). */
  footer?: ReactNode;
  /** Tap on the dimmed backdrop closes (default true). */
  closeOnBackdrop?: boolean;
  /** Escape closes (default true). Set false when the body owns Escape (terminal, editor). */
  closeOnEscape?: boolean;
  /**
   * false = blocking modal (e.g. operation in progress): no close button, and
   * Escape / Android back / backdrop do nothing (back is still swallowed so
   * the page underneath does not navigate). Default true.
   */
  dismissible?: boolean;
  /** Show the × button (default = dismissible). */
  showCloseButton?: boolean;
  /**
   * Layout below the `sm` breakpoint: 'fullscreen' (default — full-screen
   * sheet), 'sheet' (bottom sheet, auto height), 'center' (compact centred card).
   */
  phoneLayout?: 'fullscreen' | 'sheet' | 'center';
  /** Classes for the dialog panel. */
  className?: string;
  /** Classes for the scrolling body (default padding px-4 py-3). */
  bodyClassName?: string;
  /** Classes for the footer bar. */
  footerClassName?: string;
  /** Classes for the backdrop / positioning layer (e.g. a different z-index). */
  overlayClassName?: string;
  /** aria-label when there is no visible title. */
  ariaLabel?: string;
  /** Extra attributes for testing / styling hooks. */
  'data-testid'?: string;
}

const maxWidths: Record<ModalSize, string> = {
  sm: 'sm:max-w-md',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-2xl',
  xl: 'sm:max-w-3xl',
  '2xl': 'sm:max-w-4xl',
  full: 'sm:max-w-[calc(100vw-2rem)] sm:h-[calc(100dvh-2rem)] sm:supports-[not(height:100dvh)]:h-[calc(100vh-2rem)]',
};

/**
 * Shared dialog — docs/obli-mobile.md §5.5 / §8.
 * Portal to <body>, z-[200]. Full-screen sheet below `sm`, centred card from
 * `sm` up (max-h = 100dvh − 2rem, scrolling body, sticky footer). Escape,
 * Android back, body scroll lock and focus trap are built in.
 */
export function Modal(props: ModalProps) {
  if (!props.open) return null;
  return <ModalImpl {...props} />;
}

function ModalImpl({
  onClose,
  title,
  icon,
  headerExtra,
  size = 'md',
  children,
  footer,
  closeOnBackdrop = true,
  closeOnEscape = true,
  dismissible = true,
  showCloseButton,
  phoneLayout = 'fullscreen',
  className,
  bodyClassName,
  footerClassName,
  overlayClassName,
  ariaLabel,
  'data-testid': testId,
}: ModalProps) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const downOnBackdrop = useRef(false);
  const titleId = useId();

  // Android back + Escape (top-most overlay only). A non-dismissible modal
  // still swallows both so nothing underneath reacts; with
  // closeOnEscape={false} Escape is swallowed too (the body owns it).
  useNativeBack((source) => {
    if (!dismissible) return true;
    if (source === 'escape' && !closeOnEscape) return true;
    onClose();
    return true;
  }, true, { escape: true });

  useBodyScrollLock(true);
  useFocusTrap(panelRef, true);

  const withClose = showCloseButton ?? dismissible;
  const hasHeader = title != null || icon != null || headerExtra != null || withClose;

  // dvh fallback: WebView < 108 drops every dvh declaration, so each dvh
  // class has a `supports-[not(height:100dvh)]:` vh twin. (A plain
  // 'h-screen h-dvh' pair does NOT work: Tailwind emits same-property
  // utilities alphabetically, so the vh rule would always win.)
  const phonePanel = {
    fullscreen: 'h-dvh max-h-dvh supports-[not(height:100dvh)]:h-screen supports-[not(height:100dvh)]:max-h-screen w-full rounded-none pt-safe pb-safe px-safe',
    sheet: 'w-full max-h-[calc(100dvh-var(--safe-top)-1rem)] supports-[not(height:100dvh)]:max-h-[calc(100vh-var(--safe-top)-1rem)] rounded-t-xl rounded-b-none pb-safe px-safe',
    center: 'w-full max-h-[calc(100dvh-2rem)] supports-[not(height:100dvh)]:max-h-[calc(100vh-2rem)] rounded-xl',
  }[phoneLayout];

  const phoneOverlay = {
    fullscreen: 'items-stretch',
    sheet: 'items-end',
    center: 'items-center p-4',
  }[phoneLayout];

  return createPortal(
    <div
      className={cn(
        'fixed inset-0 z-[200] flex justify-center bg-black/60 backdrop-blur-sm',
        phoneOverlay,
        'sm:items-center sm:p-4',
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
        data-testid={testId}
        className={cn(
          'relative flex flex-col overflow-hidden bg-bg-secondary shadow-2xl outline-none',
          phonePanel,
          phoneLayout === 'sheet' && 'motion-safe:animate-obli-slide-in-up sm:animate-none',
          // sm and up: centred card
          'sm:h-auto sm:w-full sm:max-h-[calc(100dvh-2rem)] sm:supports-[not(height:100dvh)]:max-h-[calc(100vh-2rem)] sm:rounded-xl sm:p-0',
          maxWidths[size],
          className,
        )}
      >
        {hasHeader && (
          <div className="flex shrink-0 items-center gap-2 px-4 py-3">
            {icon}
            {title != null && (
              <h2 id={titleId} className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary">
                {title}
              </h2>
            )}
            {title == null && <div className="flex-1" />}
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
        <div
          className={cn(
            'min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3',
            !hasHeader && 'pt-4',
            bodyClassName,
          )}
        >
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
