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

import { useTranslation } from 'react-i18next';
import { HardDrive } from 'lucide-react';
import { clsx } from 'clsx';
import type { MetricThresholds, MetricThreshold, DeviceMetrics } from '@obliance/shared';

interface Props {
 /** Disks reported by the agent on this device. */
 disks: NonNullable<DeviceMetrics['disks']>;
 /** Current thresholds_override blob — we read/write `diskByMount`. */
 value: MetricThresholds;
 onChange: (next: MetricThresholds) => void;
 /** Default disk threshold inherited from group/system. Shown as
 * placeholder so the user knows what they're overriding against. */
 inheritedDisk?: Required<MetricThreshold>;
}

export function PerDiskThresholdsEditor({ disks, value, onChange, inheritedDisk }: Props) {
 const { t } = useTranslation();
 // Skip removable / optical disks — they're already excluded from
 // alerts server-side, and showing them here would just confuse the
 // admin into setting thresholds that don't apply.
 const eligible = disks.filter((d) => !d.removable && !['iso9660', 'udf', 'cdfs'].includes((d.fstype ?? '').toLowerCase()));
 const byMount = value.diskByMount ?? {};

 const setMountSlot = (mount: string, slot: 'warn' | 'crit', raw: string) => {
 const next: MetricThresholds = { ...value, diskByMount: { ...byMount } };
 const mt: MetricThreshold = { ...(next.diskByMount![mount] ?? {}) };
 if (raw === '') {
 delete mt[slot];
 } else {
 const n = parseInt(raw, 10);
 if (Number.isNaN(n) || n < 0 || n > 100) return;
 mt[slot] = n;
 }
 if (Object.keys(mt).length === 0) {
 delete next.diskByMount![mount];
 } else {
 next.diskByMount![mount] = mt;
 }
 if (Object.keys(next.diskByMount!).length === 0) delete next.diskByMount;
 onChange(next);
 };

 const toggleOverride = (mount: string, on: boolean) => {
 const next: MetricThresholds = { ...value, diskByMount: { ...byMount } };
 if (on) {
 // Seed with the inherited values so the inputs are pre-filled
 // rather than empty — the admin almost always wants to tweak,
 // not start blank.
 next.diskByMount![mount] = next.diskByMount![mount] ?? {
 warn: inheritedDisk?.warn,
 crit: inheritedDisk?.crit,
 };
 } else {
 delete next.diskByMount![mount];
 }
 if (Object.keys(next.diskByMount!).length === 0) delete next.diskByMount;
 onChange(next);
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
 {eligible.map((d) => {
 const override = byMount[d.mount];
 const isOverridden = !!override;
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
 </div>
 </div>
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
 placeholder={String(inheritedDisk?.warn ?? '')}
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
 placeholder={String(inheritedDisk?.crit ?? '')}
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
