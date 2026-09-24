import { useEffect, type ReactNode, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/utils/cn';
import { MEDIA, matchesMedia } from '@/hooks/useMediaQuery';

/**
 * Scrolls `ref` to the top of its scroll container whenever `trigger`
 * changes to a non-null value — used by the inline create / edit forms of
 * the automation pages, which open at the top of a long list (tapping Edit
 * on the 10th row otherwise looks like a no-op on a phone).
 *
 * `when`:
 *   - 'not-desktop' (default): below `lg` or on a coarse pointer — a
 *     desktop with a mouse keeps its historic behaviour (no scroll).
 *   - 'narrow': below `lg` only (master/detail swaps).
 */
export function useRevealOnOpen(
 ref: RefObject<HTMLElement | null>,
 trigger: string | number | null | undefined | false,
 opts: { when?: 'not-desktop' | 'narrow'; behavior?: ScrollBehavior } = {},
): void {
 const { when = 'not-desktop', behavior = 'smooth' } = opts;
 useEffect(() => {
 if (trigger === null || trigger === undefined || trigger === false) return;
 const narrow = !matchesMedia(MEDIA.lg);
 const should = when === 'narrow' ? narrow : narrow || matchesMedia(MEDIA.coarse);
 if (!should) return;
 const id = requestAnimationFrame(() => {
 ref.current?.scrollIntoView({ block: 'start', behavior });
 });
 return () => cancelAnimationFrame(id);
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [trigger]);
}

interface StickyFormActionsProps {
 onCancel: () => void;
 onSave: () => void;
 saving?: boolean;
 /** Default t('common.save'). */
 saveLabel?: ReactNode;
 /** Default t('common.cancel'). */
 cancelLabel?: ReactNode;
 /**
 * Extra classes — typically negative margins matching the card padding so
 * the bar sits flush with the card edges, and the card background.
 */
 className?: string;
}

/**
 * Save / Cancel bar that sticks to the bottom of the scroll area below `md`
 * (docs/obli-mobile.md §5) so a long inline form can be saved without
 * scrolling back to its header. Renders nothing from `md` up — the form
 * header keeps its own buttons there (desktop unchanged).
 */
export function StickyFormActions({ onCancel, onSave, saving = false, saveLabel, cancelLabel, className }: StickyFormActionsProps) {
 const { t } = useTranslation();
 return (
 <div
 className={cn(
 'md:hidden sticky bottom-0 z-10 flex gap-2 border-t border-border px-3 pt-3',
 'pb-[max(0.75rem,var(--safe-bottom))] rounded-b-xl bg-bg-secondary',
 className,
 )}
 >
 <button
 type="button"
 onClick={onCancel}
 className="flex-1 min-h-11 px-4 text-sm text-text-muted hover:text-text-primary bg-bg-tertiary rounded-lg transition-colors"
 >
 {cancelLabel ?? t('common.cancel', 'Cancel')}
 </button>
 <button
 type="button"
 onClick={onSave}
 disabled={saving}
 className="flex-1 min-h-11 px-4 text-sm bg-accent text-white rounded-lg hover:bg-accent/80 disabled:opacity-50 transition-colors"
 >
 {saving ? t('common.saving', 'Saving…') : (saveLabel ?? t('common.save', 'Save'))}
 </button>
 </div>
 );
}
