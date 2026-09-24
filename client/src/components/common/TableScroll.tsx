import { forwardRef, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/utils/cn';

export interface TableScrollProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  /**
   * Classes for the OUTER (rounded, clipping) container — put the card look
   * here, e.g. "bg-bg-secondary rounded-xl". Default: rounded-xl.
   */
  className?: string;
  /** Classes for the inner horizontal scroller. */
  innerClassName?: string;
  /** Keep the first cell of every row visible while scrolling horizontally. */
  stickyFirstCol?: boolean;
  /**
   * Background of the sticky first column (any CSS colour). Default: the card
   * colour rgb(var(--c-bg-secondary)). Needed when the card is not bg-secondary.
   */
  stickyBg?: string;
}

/**
 * Horizontal-scroll wrapper for data tables — docs/obli-mobile.md §5.7 / §8.
 * Replace `<div className="bg-bg-secondary rounded-xl overflow-hidden"><table …>`
 * with `<TableScroll className="bg-bg-secondary rounded-xl"><table …>`: same
 * look, but columns that do not fit scroll (with overscroll containment)
 * instead of being clipped.
 */
export const TableScroll = forwardRef<HTMLDivElement, TableScrollProps>(function TableScroll(
  { children, className, innerClassName, stickyFirstCol = false, stickyBg, style, ...rest },
  ref,
) {
  const innerStyle: CSSProperties | undefined = stickyBg
    ? ({ ['--table-sticky-bg' as string]: stickyBg } as CSSProperties)
    : undefined;
  return (
    <div ref={ref} className={cn('min-w-0 overflow-hidden rounded-xl', className)} style={style} {...rest}>
      <div
        className={cn(
          'overflow-x-auto overscroll-x-contain',
          stickyFirstCol && 'table-sticky-first',
          innerClassName,
        )}
        style={innerStyle}
      >
        {children}
      </div>
    </div>
  );
});
