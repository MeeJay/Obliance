import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { HardDrive, Cpu, MemoryStick, RotateCcw, Pencil, type LucideIcon } from 'lucide-react';
import { clsx } from 'clsx';
import type { MetricThresholds, MetricThreshold, GenericMetricKind, ResolvedThresholds, ThresholdOrigin } from '@obliance/shared';
import { SYSTEM_DEFAULT_THRESHOLDS } from '@obliance/shared';
import { ToggleSwitch } from './ToggleSwitch';

// Lot D.2 — Threshold editor reused on every layer of the cascade: global
// settings, tenant thresholds tab, group edit page, device settings. A
// blank input means "inherit from the parent layer" (placeholder = the
// inherited value).
//
// Per-metric "Alerts" switch (`notify`, tri-state per layer):
//   - inherited (key absent): the switch shows the inherited value greyed,
//     with its origin ("Inherited from group X") and an explicit
//     "Override" action;
//   - overridden (true / false): the switch is live, "Reset to inherited"
//     removes the key.
// Muting a metric only silences its notifications (web, channels, mobile
// app): the warn / crit values stay editable because they still drive the
// status colour.

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
 /** What this layer inherits (server cascade resolved WITHOUT this layer,
 * with the origin of each value). Placeholders show its warn / crit and
 * the greyed Alerts switch its notify. Omitted = system defaults (global
 * layer). */
 inheritedFrom?: ResolvedThresholds;
 /** Adapts the helper text under the title to the layer being edited. */
 layer?: 'global' | 'tenant' | 'group' | 'device';
}

const SYSTEM_ORIGIN: ThresholdOrigin = { layer: 'system', id: null, name: null };

/** "Inherited from …" sentence for an origin (one key per layer so each
 * locale can use its own grammar). Exported for the per-disk editor. */
export function inheritedFromLabel(t: TFunction, origin: ThresholdOrigin | undefined): string {
 const o = origin ?? SYSTEM_ORIGIN;
 const name = o.name ?? (o.id != null ? `#${o.id}` : '');
 switch (o.layer) {
 case 'global': return t('thresholds.inherited.global', 'Inherited from the global settings');
 case 'tenant': return t('thresholds.inherited.tenant', 'Inherited from tenant {{name}}', { name });
 case 'group': return t('thresholds.inherited.group', 'Inherited from group {{name}}', { name });
 case 'device': return t('thresholds.inheritedFrom', 'Inherited from {{name}}', { name });
 default: return t('thresholds.inherited.system', 'Inherited from the system default');
 }
}

/** Small text action (override / reset). On touch the button itself is
 * ≥ 40 px tall IN the layout flow (no invisible ::after area): an area
 * that grows upwards would sit over the inputs of the row above and
 * steal their taps. */
export function InlineAction({ onClick, icon: Icon, children, ariaLabel }: { onClick: () => void; icon: LucideIcon; children: React.ReactNode; ariaLabel?: string }) {
 return (
 <button
 type="button"
 onClick={onClick}
 aria-label={ariaLabel}
 className={clsx(
 'inline-flex items-center gap-1 rounded text-accent hover:underline',
 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
 'coarse:min-h-10 coarse:px-1',
 )}
 >
 <Icon className="w-3 h-3 shrink-0" />
 {children}
 </button>
 );
}

export function ThresholdsEditor({ value, onChange, inheritedFrom, layer = 'group' }: Props) {
 const { t } = useTranslation();

 const writeMetric = (metric: GenericMetricKind, m: MetricThreshold) => {
 const next: MetricThresholds = { ...value };
 if (Object.keys(m).length === 0) {
 delete next[metric];
 } else {
 next[metric] = m;
 }
 onChange(next);
 };

 const setSlot = (metric: GenericMetricKind, slot: 'warn' | 'crit', raw: string) => {
 const m: MetricThreshold = { ...(value[metric] ?? {}) };
 if (raw === '') {
 delete m[slot];
 } else {
 const n = parseInt(raw, 10);
 if (Number.isNaN(n) || n < 0 || n > 100) return;
 m[slot] = n;
 }
 writeMetric(metric, m);
 };

 /** `undefined` = back to inherit (key removed). */
 const setNotify = (metric: GenericMetricKind, notify: boolean | undefined) => {
 const m: MetricThreshold = { ...(value[metric] ?? {}) };
 if (notify === undefined) delete m.notify;
 else m.notify = notify;
 writeMetric(metric, m);
 };

 const placeholder = (metric: GenericMetricKind, slot: 'warn' | 'crit'): string => {
 const inherited = inheritedFrom?.[metric]?.[slot];
 if (inherited != null) return String(inherited);
 return String(SYSTEM_DEFAULT_THRESHOLDS[metric][slot]);
 };

 const helper = layer === 'device'
 ? t('thresholds.helpDevice', 'Leave empty to inherit from the group (then the system default).')
 : t('thresholds.helpGroup', 'Leave empty to inherit the system default.');

 const alertsLabel = t('thresholds.alerts', 'Alerts');
 const mutedHint = t('thresholds.alertsOffHint', "Off: the status colour is still shown, but no notification (web, channels, mobile app) is sent for this metric.");

 return (
 <div className="space-y-3">
 <div>
 <div className="text-sm font-semibold text-text-primary">
 {t('thresholds.title', 'Metric thresholds')}
 </div>
 <div className="text-xs text-text-muted">{helper}</div>
 </div>
 {/* Phone: the fixed 120 px label column shrinks so both inputs keep a
     usable width (desktop grid unchanged). The last column holds the
     per-metric Alerts switch; each metric gets a full-width line below
     for the inheritance state and the muted hint. */}
 <div className="grid grid-cols-[120px_1fr_1fr_auto] gap-x-2 gap-y-1 items-center text-xs max-sm:grid-cols-[minmax(0,5.5rem)_1fr_1fr_auto]">
 <div />
 <div className="text-text-muted text-center">{t('thresholds.warnPct', 'Warn (%)')}</div>
 <div className="text-text-muted text-center">{t('thresholds.critPct', 'Critical (%)')}</div>
 <div className="text-text-muted text-center">{alertsLabel}</div>
 {METRICS.map(({ key, labelKey, label, icon: Icon }) => {
 const own = value[key]?.notify;
 const overridden = typeof own === 'boolean';
 const inheritedNotify = inheritedFrom?.[key]?.notify ?? true;
 const effective = overridden ? own : inheritedNotify;
 const metricLabel = t(labelKey, label);
 return (
 <MetricRow
 key={key}
 label={metricLabel}
 warnLabel={`${metricLabel} — ${t('thresholds.warnPct', 'Warn (%)')}`}
 critLabel={`${metricLabel} — ${t('thresholds.critPct', 'Critical (%)')}`}
 alertsAria={`${metricLabel} — ${alertsLabel}`}
 Icon={Icon}
 warn={value[key]?.warn ?? ''}
 crit={value[key]?.crit ?? ''}
 warnPlaceholder={placeholder(key, 'warn')}
 critPlaceholder={placeholder(key, 'crit')}
 onWarnChange={(v) => setSlot(key, 'warn', v)}
 onCritChange={(v) => setSlot(key, 'crit', v)}
 notify={effective}
 overridden={overridden}
 onNotifyChange={(v) => setNotify(key, v)}
 inheritedText={inheritedFromLabel(t, inheritedFrom?.[key]?.origin?.notify)}
 overrideText={t('thresholds.override', 'Override')}
 resetText={t('thresholds.resetInherit', 'Reset to inherited')}
 mutedHint={effective ? null : mutedHint}
 />
 );
 })}
 </div>
 </div>
 );
}

/** ≥ 40 px inputs on touch (the font is already 16 px on touch phones). */
const INPUT_CLS = 'min-w-0 px-2 py-1 rounded bg-bg-primary text-text-primary focus:outline-none focus:border-accent/50 text-center coarse:min-h-10';

function MetricRow({
 label, warnLabel, critLabel, alertsAria, Icon, warn, crit, warnPlaceholder, critPlaceholder, onWarnChange, onCritChange,
 notify, overridden, onNotifyChange, inheritedText, overrideText, resetText, mutedHint,
}: {
 label: string;
 warnLabel: string;
 critLabel: string;
 alertsAria: string;
 Icon: LucideIcon;
 warn: number | '';
 crit: number | '';
 warnPlaceholder: string;
 critPlaceholder: string;
 onWarnChange: (v: string) => void;
 onCritChange: (v: string) => void;
 notify: boolean;
 overridden: boolean;
 onNotifyChange: (v: boolean | undefined) => void;
 inheritedText: string;
 overrideText: string;
 resetText: string;
 mutedHint: string | null;
}) {
 // The switch is described by the inheritance sentence (why it is greyed)
 // and by the muted hint, both rendered on the line below it.
 const inheritedId = useId();
 const mutedId = useId();
 const describedBy = [!overridden ? inheritedId : null, mutedHint ? mutedId : null].filter(Boolean).join(' ') || undefined;
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
 <div className="flex justify-center px-1">
 {/* Inherited: greyed, read-only — "Override" makes it editable. */}
 <ToggleSwitch
 size="sm"
 checked={notify}
 disabled={!overridden}
 onChange={(v) => onNotifyChange(v)}
 ariaLabel={alertsAria}
 ariaDescribedBy={describedBy}
 />
 </div>
 {/* Full-width line: inheritance state + action, muted hint. On touch
     the actions are 40 px tall in the flow, so no negative top margin. */}
 <div className="col-span-4 -mt-0.5 mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-text-muted coarse:mt-0">
 {overridden ? (
 <InlineAction icon={RotateCcw} onClick={() => onNotifyChange(undefined)} ariaLabel={`${alertsAria} — ${resetText}`}>{resetText}</InlineAction>
 ) : (
 <>
 <span id={inheritedId} className="italic">{inheritedText}</span>
 <span aria-hidden="true">·</span>
 {/* Pin the inherited value on this layer, then it can be toggled. */}
 <InlineAction icon={Pencil} onClick={() => onNotifyChange(notify)} ariaLabel={`${alertsAria} — ${overrideText}`}>{overrideText}</InlineAction>
 </>
 )}
 {mutedHint && <span id={mutedId} className="basis-full text-amber-400/90">{mutedHint}</span>}
 </div>
 </>
 );
}
