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
 label: string;
 icon: LucideIcon;
}> = [
 { key: 'disk', label: 'Disque', icon: HardDrive },
 { key: 'cpu', label: 'CPU', icon: Cpu },
 { key: 'ram', label: 'RAM', icon: MemoryStick },
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
 ? t('thresholds.helpDevice', 'Laisser vide pour hériter du groupe (puis du défaut système).')
 : t('thresholds.helpGroup', 'Laisser vide pour hériter du défaut système.');

 return (
 <div className="space-y-3">
 <div>
 <div className="text-sm font-semibold text-text-primary">
 {t('thresholds.title', 'Seuils métriques')}
 </div>
 <div className="text-xs text-text-muted">{helper}</div>
 </div>
 <div className="grid grid-cols-[120px_1fr_1fr] gap-2 items-center text-xs">
 <div />
 <div className="text-text-muted text-center">Warn (%)</div>
 <div className="text-text-muted text-center">Critical (%)</div>
 {METRICS.map(({ key, label, icon: Icon }) => (
 <FragmentRow
 key={key}
 label={label}
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

function FragmentRow({
 label, Icon, warn, crit, warnPlaceholder, critPlaceholder, onWarnChange, onCritChange,
}: {
 label: string;
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
 <div className="flex items-center gap-2 text-text-secondary">
 <Icon className="w-4 h-4" />
 <span>{label}</span>
 </div>
 <input
 type="number" min={0} max={100}
 value={warn === '' ? '' : warn}
 placeholder={warnPlaceholder}
 onChange={(e) => onWarnChange(e.target.value)}
 className="px-2 py-1 rounded bg-bg-primary text-text-primary focus:outline-none focus:border-accent/50 text-center"
 />
 <input
 type="number" min={0} max={100}
 value={crit === '' ? '' : crit}
 placeholder={critPlaceholder}
 onChange={(e) => onCritChange(e.target.value)}
 className="px-2 py-1 rounded bg-bg-primary text-text-primary focus:outline-none focus:border-accent/50 text-center"
 />
 </>
 );
}
