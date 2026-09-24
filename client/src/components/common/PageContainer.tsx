import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/utils/cn';

export interface PageContainerProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
  /**
   * Drop the padding (a page rendered `embedded` inside another page's
   * PageContainer, e.g. the tabs of PoliciesPage). Default false.
   */
  embedded?: boolean;
}

/**
 * Standard page padding — docs/obli-mobile.md §8: p-3 (phone) · sm:p-4 ·
 * lg:p-6 (= the current desktop `p-6`). Replaces the hard-coded `p-6` on page
 * roots; combine with spacing utilities as before:
 *
 *   <PageContainer className="space-y-6">…</PageContainer>
 *   <PageContainer embedded={embedded} className="space-y-4">…</PageContainer>
 */
export const PageContainer = forwardRef<HTMLDivElement, PageContainerProps>(function PageContainer(
  { children, className, embedded = false, ...rest },
  ref,
) {
  return (
    <div ref={ref} className={cn('min-w-0', !embedded && 'p-3 sm:p-4 lg:p-6', className)} {...rest}>
      {children}
    </div>
  );
});
