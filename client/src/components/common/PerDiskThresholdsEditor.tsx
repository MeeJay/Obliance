// Per-disk threshold override editor — used on the device settings
// panel when a machine has multiple disks / mount points and the
// admin wants tighter (or looser) seuils on a specific drive.
//
// The list of available mounts is read from `device.latestMetrics.disks`
// — what the agent actually reports — so the user can only override
// real disks, not type free-form mount strings that may not exist.
//
// A toggle next to each mount switches "inherit (use the global disk
// threshold)" → "override". When override is on, two number inputs
// show the warn/crit values; saving them writes into
// `thresholdsOverride.diskByMount[mount]`. Removing the toggle clears
// the override entirely.
//
// Per-mount "Alerts" switch (`diskByMount[mount].notify`): muting a mount
// silences its notifications only (status colour unchanged). It is
// independent from the warn / crit override: an entry holding only
// `notify` does not override the thresholds. When the generic Disk alerts
// switch is effectively off every mount is muted — the per-mount switches
// are then greyed (a mount cannot re-enable what the Disk switch mutes).

import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { HardDrive } from 'lucide-react';
import { clsx } from 'clsx';
import type { MetricThresholds, MetricThreshold, DeviceMetrics, ResolvedThresholds } from '@obliance/shared';
import { SYSTEM_DEFAULT_THRESHOLDS } from '@obliance/shared';
import { ToggleSwitch } from './ToggleSwitch';
import { inheritedFromLabel } from './ThresholdsEditor';

interface Props {
 /** Disks reported by the agent on this device. */
 disks: NonNullable<DeviceMetrics['disks']>;
 /** Current thresholds_override blob — we read/write `diskByMount`. */
 value: MetricThresholds;
 onChange: (next: MetricThresholds) => void;
 /** What the device inherits (cascade resolved without the device's own
 * override: group chain / tenant / global / system). Placeholders and
 * seeds use it together with the device's own generic `disk` values. */
 inherited?: ResolvedThresholds;
}

/** Keys of a mount entry that override thresholds (anything but notify). */
function hasThresholdOverride(entry: MetricThreshold | undefined): boolean {
 return !!entry && Object.keys(entry).some((k) => k !== 'notify');
}

export function PerDiskThresholdsEditor({ disks, value, onChange, inherited }: Props) {
 const { t } = useTranslation();
 // Ids linking each Alerts switch to the text explaining its state.
 const idBase = useId();
 const diskOffHintId = `${idBase}-disk-off`;
 // Skip removable / optical disks — they're already excluded from
 // alerts server-side, and showing them here would just confuse the
 // admin into setting thresholds that don't apply.
 const eligible = disks.filter((d) => !d.removable && !['iso9660', 'udf', 'cdfs'].includes((d.fstype ?? '').toLowerCase()));
 const byMount = value.diskByMount ?? {};

 // Generic disk values that apply to a mount without its own slot: the
 // device's own `disk` override first, then what the device inherits.
 const genericDisk = {
 warn: value.disk?.warn ?? inherited?.disk.warn ?? SYSTEM_DEFAULT_THRESHOLDS.disk.warn,
 crit: value.disk?.crit ?? inherited?.disk.crit ?? SYSTEM_DEFAULT_THRESHOLDS.disk.crit,
 };
 // Values currently applied to a mount when the device does not override
 // it: an inherited per-mount override (group chain), else generic disk.
 const inheritedMount = (mount: string) => {
 const im = inherited?.diskByMount?.[mount];
 return { warn: im?.warn ?? genericDisk.warn, crit: im?.crit ?? genericDisk.crit };
 };
 // Effective generic Disk alerts switch (the draft above wins).
 const diskNotify = typeof value.disk?.notify === 'boolean' ? value.disk.notify : (inherited?.disk.notify ?? true);

 const writeMount = (mount: string, mt: MetricThreshold | null) => {
 const next: MetricThresholds = { ...value, diskByMount: { ...byMount } };
 if (!mt || Object.keys(mt).length === 0) {
 delete next.diskByMount![mount];
 } else {
 next.diskByMount![mount] = mt;
 }
 if (Object.keys(next.diskByMount!).length === 0) delete next.diskByMount;
 onChange(next);
 };

 const setMountSlot = (mount: string, slot: 'warn' | 'crit', raw: string) => {
 const mt: MetricThreshold = { ...(byMount[mount] ?? {}) };
 if (raw === '') {
 delete mt[slot];
 } else {
 const n = parseInt(raw, 10);
 if (Number.isNaN(n) || n < 0 || n > 100) return;
 mt[slot] = n;
 }
 writeMount(mount, mt);
 };

 const toggleOverride = (mount: string, on: boolean) => {
 const current = byMount[mount];
 if (on) {
 // Seed with the values currently applied so the inputs are
 // pre-filled rather than empty — the admin almost always wants to
 // tweak, not start blank.
 const seed = inheritedMount(mount);
 writeMount(mount, { ...(current ?? {}), warn: current?.warn ?? seed.warn, crit: current?.crit ?? seed.crit });
 } else {
 // Drop the thresholds, keep a per-mount alerts choice if any.
 writeMount(mount, typeof current?.notify === 'boolean' ? { notify: current.notify } : null);
 }
 };

 /** Tri-state: back to "inherit" when the choice equals the inherited
 * value, explicit true / false otherwise. */
 const setMountNotify = (mount: string, next: boolean) => {
 const inheritedNotify = inherited?.diskByMount?.[mount]?.notify ?? true;
 const mt: MetricThreshold = { ...(byMount[mount] ?? {}) };
 if (next === inheritedNotify) delete mt.notify;
 else mt.notify = next;
 writeMount(mount, mt);
 };

 if (eligible.length === 0) {
 return (
 <div className="text-xs text-text-muted italic">
 {t('thresholds.perDisk.empty', 'No internal disks reported by the agent yet.')}
 </div>
 );
 }

 return (
 <div className="space-y-1.5">
 <div className="text-[11px] text-text-muted">
 {t(
 'thresholds.perDisk.helper',
 'Override the global disk threshold for a specific mount point — useful for system partitions that are full by nature, or for data drives that need tighter alerts. Removable / ISO mounts are always excluded.',
 )}
 </div>
 {!diskNotify && (
 <div id={diskOffHintId} className="text-[11px] text-amber-400/90">
 {t('thresholds.perDisk.diskAlertsOff', 'Disk alerts are off: every disk is muted. Turn the Disk alerts switch back on to choose disk by disk.')}
 </div>
 )}
 {eligible.map((d, idx) => {
 const override = byMount[d.mount];
 const isOverridden = hasThresholdOverride(override);
 const ownNotify = override?.notify;
 const inheritedMountNotify = inherited?.diskByMount?.[d.mount]?.notify;
 const mountNotify = typeof ownNotify === 'boolean' ? ownNotify : (inheritedMountNotify ?? true);
 const effectiveNotify = diskNotify && mountNotify;
 const alertsLabel = `${d.mount} — ${t('thresholds.alerts', 'Alerts')}`;
 const mutedAbove = typeof ownNotify !== 'boolean' && inheritedMountNotify === false;
 const inheritedHintId = `${idBase}-m${idx}`;
 const describedBy = [!diskNotify ? diskOffHintId : null, mutedAbove ? inheritedHintId : null].filter(Boolean).join(' ') || undefined;
 return (
 <div key={d.mount} className={clsx(
 // Phone: the two inputs wrap onto their own line so the mount
 // name keeps a readable width (desktop row unchanged).
 'p-2 rounded bg-bg-tertiary/40 flex items-center gap-2 max-sm:flex-wrap',
 isOverridden && 'border-accent/40 bg-accent/5',
 )}>
 <HardDrive className="w-3.5 h-3.5 text-text-muted shrink-0" />
 <div className="flex-1 min-w-0">
 <div className="text-xs font-mono text-text-primary truncate">{d.mount}</div>
 <div className="text-[10px] text-text-muted">
 {t('thresholds.perDisk.usage', '{{size}} GB · {{percent}}% used', { size: d.totalGb.toFixed(0), percent: d.percent.toFixed(0) })}
 {d.fstype && <> · {d.fstype}</>}
 {/* A mount muted higher up (group chain) is worth a word. */}
 {mutedAbove && (
 <> · <span id={inheritedHintId} className="italic">{inheritedFromLabel(t, inherited?.diskByMount?.[d.mount]?.origin?.notify)}</span></>
 )}
 </div>
 </div>
 <span className="inline-flex items-center gap-1.5 text-[11px] text-text-muted coarse:min-h-10 coarse:px-1 coarse:text-xs">
 {/* Visible caption; the switch carries the full name (mount + Alerts). */}
 <span aria-hidden="true" className={clsx(!diskNotify && 'opacity-50')}>{t('thresholds.alerts', 'Alerts')}</span>
 <ToggleSwitch
 size="sm"
 checked={effectiveNotify}
 disabled={!diskNotify}
 onChange={(v) => setMountNotify(d.mount, v)}
 ariaLabel={alertsLabel}
 ariaDescribedBy={describedBy}
 />
 </span>
 <label className="inline-flex items-center gap-1.5 text-[11px] text-text-muted cursor-pointer coarse:min-h-10 coarse:px-1 coarse:text-xs">
 <input type="checkbox" checked={isOverridden} onChange={(e) => toggleOverride(d.mount, e.target.checked)} className="accent-accent" />
 <span>{isOverridden ? t('thresholds.perDisk.override', 'override') : t('thresholds.perDisk.inherit', 'inherit')}</span>
 </label>
 {isOverridden && (
 <div className="flex items-center gap-1 shrink-0 max-sm:w-full max-sm:justify-end">
 {/* Touch: warn / crit are otherwise told apart only by colour
     and a hover title — show short visible labels. */}
 <span className="can-hover:hidden text-[10px] text-amber-400" aria-hidden="true">{t('thresholds.perDisk.warnShort', 'Warn')}</span>
 <input
 type="number" min={0} max={100}
 inputMode="numeric"
 value={override?.warn ?? ''}
 onChange={(e) => setMountSlot(d.mount, 'warn', e.target.value)}
 placeholder={String(genericDisk.warn)}
 className="w-14 px-1.5 py-0.5 text-xs bg-bg-primary rounded text-amber-400 text-center font-mono focus:outline-none focus:border-accent coarse:min-h-10 coarse:w-16"
 title={t('thresholds.perDisk.warnTitle', 'Warning threshold (%)')}
 aria-label={t('thresholds.perDisk.warnTitle', 'Warning threshold (%)')}
 />
 <span className="text-[10px] text-text-muted">/</span>
 <span className="can-hover:hidden text-[10px] text-red-400" aria-hidden="true">{t('thresholds.perDisk.critShort', 'Crit')}</span>
 <input
 type="number" min={0} max={100}
 inputMode="numeric"
 value={override?.crit ?? ''}
 onChange={(e) => setMountSlot(d.mount, 'crit', e.target.value)}
 placeholder={String(genericDisk.crit)}
 className="w-14 px-1.5 py-0.5 text-xs bg-bg-primary rounded text-red-400 text-center font-mono focus:outline-none focus:border-accent coarse:min-h-10 coarse:w-16"
 title={t('thresholds.perDisk.critTitle', 'Critical threshold (%)')}
 aria-label={t('thresholds.perDisk.critTitle', 'Critical threshold (%)')}
 />
 </div>
 )}
 </div>
 );
 })}
 </div>
 );
}
