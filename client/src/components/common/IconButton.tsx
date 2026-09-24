import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/utils/cn';
import { useCanHover } from '@/hooks/useMediaQuery';

export type IconButtonSize = 'xs' | 'sm' | 'md' | 'lg';
export type IconButtonVariant = 'ghost' | 'plain' | 'danger' | 'accent' | 'primary' | 'solid';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'> {
  /** Required accessible name: aria-label always, native tooltip (title) only on hover-capable devices. */
  label: string;
  /** The icon (size it yourself, e.g. <X className="w-4 h-4" />). `children` works too. */
  icon?: ReactNode;
  children?: ReactNode;
  /**
   * Padding preset matching the existing hand-rolled buttons:
   * xs = p-0.5 · sm = p-1 · md = p-1.5 (default) · lg = p-2.
   */
  size?: IconButtonSize;
  /**
   * ghost (default) = muted → primary text + hover bg · plain = muted → primary, no bg ·
   * danger = muted → red + red tint · accent = muted → accent + accent tint ·
   * primary = accent text + accent tint · solid = tertiary bg.
   */
  variant?: IconButtonVariant;
  /** Pressed / selected look (e.g. a toggled toolbar button). Also sets aria-pressed. */
  active?: boolean;
  /**
   * Touch target on coarse pointers (desktop size never changes):
   * 'grow' (default) = the button itself becomes ≥ 40×40 on touch;
   * 'overlay' = keeps its visual size, an invisible 40×40 hit area is added
   * (dense rows where the layout must not move); 'none' = unchanged.
   */
  touchTarget?: 'grow' | 'overlay' | 'none';
  /** Set false to never emit the title tooltip (e.g. when a visible label sits next to it). */
  showTooltip?: boolean;
}

const sizes: Record<IconButtonSize, string> = {
  xs: 'p-0.5',
  sm: 'p-1',
  md: 'p-1.5',
  lg: 'p-2',
};

const variants: Record<IconButtonVariant, string> = {
  ghost: 'text-text-muted hover:text-text-primary hover:bg-bg-hover',
  plain: 'text-text-muted hover:text-text-primary',
  danger: 'text-text-muted hover:text-red-400 hover:bg-red-400/10',
  accent: 'text-text-muted hover:text-accent hover:bg-accent/10',
  primary: 'text-accent hover:bg-accent/10',
  solid: 'bg-bg-tertiary text-text-secondary hover:bg-bg-hover hover:text-text-primary',
};

const activeCls: Record<IconButtonVariant, string> = {
  ghost: 'bg-bg-active text-text-primary',
  plain: 'text-text-primary',
  danger: 'bg-red-400/10 text-red-400',
  accent: 'bg-accent/10 text-accent',
  primary: 'bg-accent/15 text-accent',
  solid: 'bg-bg-active text-text-primary',
};

const touchCls = {
  grow: 'coarse:min-h-10 coarse:min-w-10',
  // Invisible centred 40×40 hit area; only exists on coarse pointers.
  overlay:
    "relative coarse:after:absolute coarse:after:left-1/2 coarse:after:top-1/2 coarse:after:h-10 coarse:after:w-10 coarse:after:-translate-x-1/2 coarse:after:-translate-y-1/2 coarse:after:content-['']",
  none: '',
} as const;

/**
 * Icon-only button — docs/obli-mobile.md §5.4 / §8.
 *
 *   <IconButton label={t('common.delete')} icon={<Trash2 className="w-4 h-4" />} variant="danger" onClick={remove} />
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    label,
    icon,
    children,
    size = 'md',
    variant = 'ghost',
    active = false,
    touchTarget = 'grow',
    showTooltip = true,
    className,
    type = 'button',
    title,
    ...rest
  },
  ref,
) {
  const canHover = useCanHover();
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      aria-pressed={active ? true : undefined}
      title={title ?? (showTooltip && canHover ? label : undefined)}
      className={cn(
        'inline-flex items-center justify-center rounded transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
        'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent',
        sizes[size],
        variants[variant],
        active && activeCls[variant],
        touchCls[touchTarget],
        className,
      )}
      {...rest}
    >
      {icon ?? children}
    </button>
  );
});
