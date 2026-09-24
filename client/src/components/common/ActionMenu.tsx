import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal } from 'lucide-react';
import { cn } from '@/utils/cn';
import { useLayoutMode } from '@/hooks/useMediaQuery';
import { useClickOutside } from '@/hooks/useClickOutside';
import { useNativeBack } from '@/hooks/useNativeBack';
import { useAnchoredPosition } from '@/native/overlay';
import { Drawer } from './Drawer';
import { IconButton, type IconButtonSize, type IconButtonVariant } from './IconButton';

export interface ActionMenuItem {
  /** React key (defaults to the label). */
  key?: string;
  icon?: ReactNode;
  label: string;
  /** Secondary line under the label. */
  description?: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Filtered out (permission / state-gated actions). */
  hidden?: boolean;
  /** Draw a separator above this item. */
  separator?: boolean;
}

export interface ActionMenuTriggerProps {
  ref: Ref<HTMLButtonElement>;
  onClick: () => void;
  'aria-haspopup': 'menu';
  'aria-expanded': boolean;
}

export interface ActionMenuProps {
  items: ReadonlyArray<ActionMenuItem>;
  /** Accessible name of the default "⋯" trigger AND title of the phone sheet. Default t('ui.moreActions'). */
  label?: string;
  /** Optional heading in the phone bottom sheet (defaults to nothing; `label` is used for aria only). */
  sheetTitle?: ReactNode;
  /**
   * Custom trigger. Spread the props on your own button:
   *   trigger={(p) => <button {...p} className="…">Actions</button>}
   */
  trigger?: (props: ActionMenuTriggerProps) => ReactNode;
  /** Size / variant of the default "⋯" IconButton. */
  triggerSize?: IconButtonSize;
  triggerVariant?: IconButtonVariant;
  /** Extra classes for the default trigger. */
  triggerClassName?: string;
  /** Desktop popover alignment with the trigger. Default 'end'. */
  align?: 'start' | 'end';
  /** Desktop popover preferred side. Default 'bottom'. */
  placement?: 'top' | 'bottom';
  /** Classes for the desktop popover (default w-56). */
  menuClassName?: string;
  disabled?: boolean;
  /** Force a presentation (default: bottom sheet on phone < 768px, popover otherwise). */
  mode?: 'auto' | 'popover' | 'sheet';
}

/**
 * "⋯" overflow menu — docs/obli-mobile.md §5 / §8. A viewport-clamped popover
 * on tablet / desktop, a bottom sheet with 48px rows on phone. Closes on item
 * click, outside tap, Escape and Android back.
 *
 *   <ActionMenu items={[
 *     { icon: <Pencil className="w-4 h-4" />, label: t('common.edit'), onClick: edit },
 *     { icon: <Trash2 className="w-4 h-4" />, label: t('common.delete'), onClick: remove, danger: true, separator: true },
 *   ]} />
 */
export function ActionMenu({
  items,
  label,
  sheetTitle,
  trigger,
  triggerSize = 'md',
  triggerVariant = 'ghost',
  triggerClassName,
  align = 'end',
  placement = 'bottom',
  menuClassName,
  disabled = false,
  mode = 'auto',
}: ActionMenuProps) {
  const { t } = useTranslation();
  const layout = useLayoutMode();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const visible = items.filter((i) => !i.hidden);
  const asSheet = mode === 'sheet' || (mode === 'auto' && layout === 'phone');
  const popoverOpen = open && !asSheet;
  const menuLabel = label ?? t('ui.moreActions', 'More actions');

  const pos = useAnchoredPosition(triggerRef, menuRef, popoverOpen, { placement, align });
  useClickOutside([triggerRef, menuRef], () => setOpen(false), popoverOpen);
  // The sheet (Drawer) registers its own back / Escape handling.
  useNativeBack(() => {
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  }, popoverOpen, { escape: true });

  // Move focus into the popover once it is positioned so arrow keys work.
  const positioned = pos !== null;
  useEffect(() => {
    if (popoverOpen && positioned) menuRef.current?.focus({ preventScroll: true });
  }, [popoverOpen, positioned]);

  const close = () => setOpen(false);
  const toggle = () => {
    if (!disabled && visible.length > 0) setOpen((o) => !o);
  };
  const run = (item: ActionMenuItem) => {
    if (item.disabled) return;
    close();
    // Synchronous on purpose: keeps the user activation for actions that
    // need it (window.open, clipboard, file pickers).
    item.onClick();
  };

  const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const buttons = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? [],
    );
    if (buttons.length === 0) return;
    const idx = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next = -1;
    if (e.key === 'ArrowDown') next = (idx + 1) % buttons.length;
    else if (e.key === 'ArrowUp') next = idx <= 0 ? buttons.length - 1 : idx - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = buttons.length - 1;
    else if (e.key === 'Tab') { close(); return; }
    if (next >= 0) {
      e.preventDefault();
      buttons[next].focus();
    }
  };

  const triggerProps: ActionMenuTriggerProps = {
    ref: triggerRef,
    onClick: toggle,
    'aria-haspopup': 'menu',
    'aria-expanded': open,
  };

  const renderItems = (sheet: boolean) =>
    visible.map((item, i) => (
      <div key={item.key ?? item.label}>
        {item.separator && i > 0 && <div className={cn('my-1 h-px bg-border', sheet && 'mx-2')} role="separator" />}
        <button
          type="button"
          role="menuitem"
          disabled={item.disabled}
          onClick={() => run(item)}
          className={cn(
            'flex w-full items-center gap-3 text-left transition-colors',
            'focus-visible:outline-none focus-visible:bg-bg-hover',
            'disabled:cursor-not-allowed disabled:opacity-40',
            sheet ? 'min-h-12 rounded-lg px-3 py-2 text-sm' : 'px-3 py-2 text-sm coarse:min-h-11',
            item.danger
              ? 'text-red-400 hover:bg-red-400/10'
              : 'text-text-primary hover:bg-bg-hover',
          )}
        >
          {item.icon && (
            <span className={cn('flex shrink-0 items-center', !item.danger && 'text-text-muted')}>{item.icon}</span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate">{item.label}</span>
            {item.description && (
              <span className="block truncate text-xs text-text-muted">{item.description}</span>
            )}
          </span>
        </button>
      </div>
    ));

  return (
    <>
      {trigger ? (
        trigger(triggerProps)
      ) : (
        <IconButton
          ref={triggerRef}
          label={menuLabel}
          icon={<MoreHorizontal className="h-4 w-4" />}
          size={triggerSize}
          variant={triggerVariant}
          active={open}
          disabled={disabled || visible.length === 0}
          onClick={toggle}
          aria-haspopup="menu"
          aria-expanded={open}
          className={triggerClassName}
        />
      )}

      {popoverOpen &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={menuLabel}
            tabIndex={-1}
            onKeyDown={onMenuKeyDown}
            style={{
              position: 'fixed',
              top: pos?.top ?? 0,
              left: pos?.left ?? 0,
              maxHeight: pos?.maxHeight,
              visibility: pos ? 'visible' : 'hidden',
            }}
            className={cn(
              'z-[260] w-56 max-w-[calc(100vw-1rem)] overflow-y-auto overscroll-contain rounded-lg',
              'border border-border bg-bg-secondary py-1 shadow-xl outline-none',
              menuClassName,
            )}
          >
            {renderItems(false)}
          </div>,
          document.body,
        )}

      <Drawer
        open={open && asSheet}
        onClose={close}
        side="bottom"
        size="lg"
        title={sheetTitle}
        ariaLabel={menuLabel}
        showCloseButton={false}
        overlayClassName="z-[260]"
        bodyClassName="px-2 pb-3 pt-1"
      >
        <div role="menu" aria-label={menuLabel}>
          {renderItems(true)}
        </div>
      </Drawer>
    </>
  );
}
