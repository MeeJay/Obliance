import { useTranslation } from 'react-i18next';
import { HardDrive, Cpu, MemoryStick, type LucideIcon } from 'lucide-react';
import type { MetricThresholds, GenericMetricKind } from '@obliance/shared';
import { SYSTEM_DEFAULT_THRESHOLDS } from '@obliance/shared';

// Lot D.2 — Threshold editor reused on the GroupEditPage and the
// DeviceDetailPage. A blank input means "inherit from the parent layer"
// (group inherits the system default; device inherits its group, which
// itself inherits the system default).

const METRICS: Array<{
 key: GenericMetricKind;
 /** i18n key + English fallback (CPU / RAM are the same in every locale). */
 labelKey: string;
 label: string;
 icon: LucideIcon;
}> = [
 { key: 'disk', labelKey: 'thresholds.disk', label: 'Disk', icon: HardDrive },
 { key: 'cpu', labelKey: 'thresholds.cpu', label: 'CPU', icon: Cpu },
 { key: 'ram', labelKey: 'thresholds.ram', label: 'RAM', icon: MemoryStick },
];

interface Props {
 value: MetricThresholds;
 onChange: (next: MetricThresholds) => void;
 /** Optional fallback values shown as input placeholders so the user
 * knows which threshold will apply if they leave a slot empty. For a
 * group editor this is the system default; for a device override it
 * would be the group's resolved threshold. */
 inheritedFrom?: MetricThresholds;
 /** Adapts the helper text under the title to the layer being edited. */
 layer?: 'group' | 'device';
}

export function ThresholdsEditor({ value, onChange, inheritedFrom, layer = 'group' }: Props) {
 const { t } = useTranslation();

 const setSlot = (metric: GenericMetricKind, slot: 'warn' | 'crit', raw: string) => {
 const next: MetricThresholds = { ...value };
 const m = { ...(next[metric] ?? {}) };
 if (raw === '') {
 delete m[slot];
 } else {
 const n = parseInt(raw, 10);
 if (Number.isNaN(n) || n < 0 || n > 100) return;
 m[slot] = n;
 }
 if (Object.keys(m).length === 0) {
 delete next[metric];
 } else {
 next[metric] = m;
 }
 onChange(next);
 };

 const placeholder = (metric: GenericMetricKind, slot: 'warn' | 'crit'): string => {
 const inherited = inheritedFrom?.[metric]?.[slot];
 if (inherited != null) return String(inherited);
 return String(SYSTEM_DEFAULT_THRESHOLDS[metric][slot]);
 };

 const helper = layer === 'device'
 ? t('thresholds.helpDevice', 'Leave empty to inherit from the group (then the system default).')
 : t('thresholds.helpGroup', 'Leave empty to inherit the system default.');

 return (
 <div className="space-y-3">
 <div>
 <div className="text-sm font-semibold text-text-primary">
 {t('thresholds.title', 'Metric thresholds')}
 </div>
 <div className="text-xs text-text-muted">{helper}</div>
 </div>
 {/* Phone: the fixed 120 px label column shrinks so both inputs keep a
     usable width (desktop grid unchanged). */}
 <div className="grid grid-cols-[120px_1fr_1fr] gap-2 items-center text-xs max-sm:grid-cols-[minmax(0,5.5rem)_1fr_1fr]">
 <div />
 <div className="text-text-muted text-center">{t('thresholds.warnPct', 'Warn (%)')}</div>
 <div className="text-text-muted text-center">{t('thresholds.critPct', 'Critical (%)')}</div>
 {METRICS.map(({ key, labelKey, label, icon: Icon }) => (
 <FragmentRow
 key={key}
 label={t(labelKey, label)}
 warnLabel={`${t(labelKey, label)} — ${t('thresholds.warnPct', 'Warn (%)')}`}
 critLabel={`${t(labelKey, label)} — ${t('thresholds.critPct', 'Critical (%)')}`}
 Icon={Icon}
 warn={value[key]?.warn ?? ''}
 crit={value[key]?.crit ?? ''}
 warnPlaceholder={placeholder(key, 'warn')}
 critPlaceholder={placeholder(key, 'crit')}
 onWarnChange={(v) => setSlot(key, 'warn', v)}
 onCritChange={(v) => setSlot(key, 'crit', v)}
 />
 ))}
 </div>
 </div>
 );
}

/** ≥ 40 px inputs on touch (the font is already 16 px on touch phones). */
const INPUT_CLS = 'min-w-0 px-2 py-1 rounded bg-bg-primary text-text-primary focus:outline-none focus:border-accent/50 text-center coarse:min-h-10';

function FragmentRow({
 label, warnLabel, critLabel, Icon, warn, crit, warnPlaceholder, critPlaceholder, onWarnChange, onCritChange,
}: {
 label: string;
 warnLabel: string;
 critLabel: string;
 Icon: LucideIcon;
 warn: number | '';
 crit: number | '';
 warnPlaceholder: string;
 critPlaceholder: string;
 onWarnChange: (v: string) => void;
 onCritChange: (v: string) => void;
}) {
 return (
 <>
 <div className="flex min-w-0 items-center gap-2 text-text-secondary">
 <Icon className="w-4 h-4 shrink-0" />
 <span className="truncate">{label}</span>
 </div>
 <input
 type="number" min={0} max={100}
 inputMode="numeric"
 aria-label={warnLabel}
 value={warn === '' ? '' : warn}
 placeholder={warnPlaceholder}
 onChange={(e) => onWarnChange(e.target.value)}
 className={INPUT_CLS}
 />
 <input
 type="number" min={0} max={100}
 inputMode="numeric"
 aria-label={critLabel}
 value={crit === '' ? '' : crit}
 placeholder={critPlaceholder}
 onChange={(e) => onCritChange(e.target.value)}
 className={INPUT_CLS}
 />
 </>
 );
}
