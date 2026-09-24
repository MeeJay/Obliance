import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/utils/cn';
import { MEDIA, useMediaQuery } from '@/hooks/useMediaQuery';
import { useNativeBack } from '@/hooks/useNativeBack';
import { Drawer } from './Drawer';
import { IconButton } from './IconButton';

export interface MasterDetailProps {
  /** The list pane. */
  master: ReactNode;
  /** The detail pane (null / undefined = nothing selected). */
  detail?: ReactNode;
  /** Override "something is selected" (default: detail != null). */
  hasDetail?: boolean;
  /** Clear the selection — called by the back button and by Android back (narrow screens only). */
  onBack: () => void;
  /** Title shown next to the back button on narrow screens (e.g. the selected item's name). */
  detailTitle?: ReactNode;
  /** Label of the back button. Default t('common.back'). */
  backLabel?: string;
  /** Wide screens, nothing selected: placeholder in the detail pane (e.g. "Select a script"). */
  emptyDetail?: ReactNode;
  /**
   * Narrow screens (< lg): 'stack' (default) = one pane at a time, list →
   * detail with a back bar; 'drawer' = list stays, detail opens in a right Drawer.
   */
  narrowMode?: 'stack' | 'drawer';
  /** Root classes (default: flex gap-4 at lg). */
  className?: string;
  /** Master pane classes. Default 'lg:w-72 lg:shrink-0' (the current w-72 lists). */
  masterClassName?: string;
  /** Detail pane classes. */
  detailClassName?: string;
}

/**
 * List / detail layout — docs/obli-mobile.md §5.8 / §8. Side by side from
 * `lg` (1024px); below, a single pane (or a drawer for the detail). Both panes
 * stay mounted in 'stack' mode (CSS-hidden), so the list keeps its scroll
 * position and state when coming back.
 *
 *   <MasterDetail
 *     master={<ScriptList onSelect={setSelectedId} />}
 *     detail={selected ? <ScriptEditor script={selected} /> : null}
 *     detailTitle={selected?.name}
 *     onBack={() => setSelectedId(null)}
 *     emptyDetail={<Empty text={t('scripts.selectOne')} />}
 *   />
 */
export function MasterDetail({
  master,
  detail,
  hasDetail,
  onBack,
  detailTitle,
  backLabel,
  emptyDetail,
  narrowMode = 'stack',
  className,
  masterClassName = 'lg:w-72 lg:shrink-0',
  detailClassName,
}: MasterDetailProps) {
  const { t } = useTranslation();
  const wide = useMediaQuery(MEDIA.lg);
  const selected = hasDetail ?? detail != null;
  const back = backLabel ?? t('common.back', 'Back');

  // Stack mode: Android back returns to the list (the Drawer handles its own).
  useNativeBack(() => onBack(), !wide && selected && narrowMode === 'stack');

  if (!wide && narrowMode === 'drawer') {
    return (
      <div className={cn('min-w-0', className)}>
        <div className={cn('min-w-0', masterClassName)}>{master}</div>
        <Drawer open={selected} onClose={onBack} side="right" size="lg" title={detailTitle ?? back} bodyClassName={detailClassName}>
          {detail}
        </Drawer>
      </div>
    );
  }

  return (
    <div className={cn('min-w-0 lg:flex lg:items-start lg:gap-4', className)}>
      <div className={cn('min-w-0', selected && 'hidden lg:block', masterClassName)}>{master}</div>
      <div className={cn('min-w-0 lg:flex-1', !selected && 'hidden lg:block', detailClassName)}>
        {selected && !wide && (
          <div className="mb-3 flex items-center gap-2">
            <IconButton
              label={back}
              icon={<ArrowLeft className="h-4 w-4" />}
              size="md"
              variant="ghost"
              onClick={onBack}
            />
            {detailTitle != null && (
              <div className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary">{detailTitle}</div>
            )}
          </div>
        )}
        {selected ? detail : emptyDetail}
      </div>
    </div>
  );
}
