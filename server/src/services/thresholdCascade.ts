import type {
  MetricThresholds,
  MetricThreshold,
  GenericMetricKind,
  ResolvedThresholds,
  ResolvedMetricThreshold,
  ThresholdOrigin,
} from '@obliance/shared';
import { SYSTEM_DEFAULT_THRESHOLDS, isMountNotified } from '@obliance/shared';

// Pure part of the metric-threshold cascade (no DB access) so it can be
// verified in isolation. `threshold.service.ts` loads the layers and calls
// in here; `device.service.ts` and the alert re-baseline use the
// evaluation helpers.
//
// Cascade, outermost → innermost (the innermost layer that sets a value
// wins, slot by slot):
//   system → global → tenant → [group ancestors, root → parent] → group → device
//
// Group ancestors contribute ONLY the per-metric `notify` alerts switch.
// warn / crit keep their historical flat inheritance (the device's direct
// group only) so existing sub-group thresholds are not reinterpreted.
//
// `diskByMount` (per-mount overrides):
//   - warn / crit: the innermost value layer that lists the mount wins as a
//     WHOLE object (historical behaviour), missing slots fall back to the
//     resolved generic `disk` value. An entry that only carries `notify`
//     does not take part in this merge, so muting a mount never changes
//     its thresholds.
//   - notify: merged per mount across every layer (ancestors included),
//     innermost boolean wins. Effective alerts of a mount are
//     `disk.notify && mount.notify` (see `isMountNotified`): the generic
//     disk switch mutes every disk; a single mount can also be muted on its
//     own, but `notify: true` on a mount cannot re-enable it while the
//     generic disk switch is off.
//
// IMPORTANT — `notify` never changes the evaluation itself:
// `computeMetricStatus` returns every breach exactly as before (device
// status, colours, scenario metric_* triggers). Only the notification
// paths filter the breaches through `filterNotifiedBreaches`.

export interface CascadeLayer {
  origin: ThresholdOrigin;
  thresholds: MetricThresholds | null | undefined;
  /** false = only `notify` flags are read from this layer (group ancestors). */
  values: boolean;
}

export type MetricLevel = 'ok' | 'warning' | 'critical';
export type MetricBreach = { metric: 'cpu' | 'ram' | 'disk'; percent: number; level: 'warning' | 'critical'; mount?: string };

export const METRIC_KINDS: GenericMetricKind[] = ['disk', 'cpu', 'ram'];
export const METRIC_SEVERITY: Record<MetricLevel, number> = { ok: 0, warning: 1, critical: 2 };

const SYSTEM_ORIGIN: ThresholdOrigin = { layer: 'system', id: null, name: null };

function resolveSlot(metric: GenericMetricKind, layers: CascadeLayer[]): ResolvedMetricThreshold {
  const sys = SYSTEM_DEFAULT_THRESHOLDS[metric];
  let warn: number = sys.warn;
  let crit: number = sys.crit;
  let notify = true;
  let oWarn = SYSTEM_ORIGIN;
  let oCrit = SYSTEM_ORIGIN;
  let oNotify = SYSTEM_ORIGIN;
  for (const l of layers) {
    const t = l.thresholds?.[metric] as MetricThreshold | null | undefined;
    if (!t || typeof t !== 'object') continue;
    if (l.values) {
      // `!= null` (not typeof number) mirrors the historical `??` chain.
      if (t.warn != null) { warn = t.warn; oWarn = l.origin; }
      if (t.crit != null) { crit = t.crit; oCrit = l.origin; }
    }
    if (typeof t.notify === 'boolean') { notify = t.notify; oNotify = l.origin; }
  }
  return { warn, crit, notify, origin: { warn: oWarn, crit: oCrit, notify: oNotify } };
}

/** Resolve the cascade. `layers` are ordered outermost → innermost; the
 *  system default is implicit. */
export function resolveCascade(layers: CascadeLayer[]): ResolvedThresholds {
  const disk = resolveSlot('disk', layers);
  const cpu = resolveSlot('cpu', layers);
  const ram = resolveSlot('ram', layers);

  type MountAcc = {
    values: MetricThreshold | null;
    valuesOrigin: ThresholdOrigin | null;
    notify: boolean;
    notifyOrigin: ThresholdOrigin;
  };
  const newAcc = (): MountAcc => ({ values: null, valuesOrigin: null, notify: true, notifyOrigin: SYSTEM_ORIGIN });
  const mounts = new Map<string, MountAcc>();
  for (const l of layers) {
    const byMount = l.thresholds?.diskByMount;
    if (!byMount || typeof byMount !== 'object') continue;
    for (const [mount, entry] of Object.entries(byMount)) {
      if (!entry || typeof entry !== 'object') continue;
      const keys = Object.keys(entry);
      const onlyNotify = keys.length > 0 && keys.every((k) => k === 'notify');
      let acc = mounts.get(mount);
      if (l.values && !onlyNotify) {
        acc = acc ?? newAcc();
        acc.values = entry;
        acc.valuesOrigin = l.origin;
      }
      if (typeof entry.notify === 'boolean') {
        acc = acc ?? newAcc();
        acc.notify = entry.notify;
        acc.notifyOrigin = l.origin;
      }
      if (acc) mounts.set(mount, acc);
    }
  }

  const diskByMount: Record<string, ResolvedMetricThreshold> = {};
  for (const [mount, acc] of mounts) {
    const v = acc.values;
    const ownWarn = v?.warn != null;
    const ownCrit = v?.crit != null;
    diskByMount[mount] = {
      warn: ownWarn ? v!.warn! : disk.warn,
      crit: ownCrit ? v!.crit! : disk.crit,
      notify: acc.notify,
      origin: {
        warn: ownWarn ? acc.valuesOrigin! : disk.origin!.warn,
        crit: ownCrit ? acc.valuesOrigin! : disk.origin!.crit,
        notify: acc.notifyOrigin,
      },
    };
  }

  return { disk, cpu, ram, diskByMount };
}

/**
 * Decide whether a disk should be skipped by every threshold pipeline
 * (notifications, status flip, dashboard saturated card, scenario
 * triggers). Three signals:
 *
 *   1. Agent-reported `removable` flag (Windows GetDriveType, Linux
 *      /sys/block/*\/removable, macOS DiskArbitration). Most reliable
 *      when present.
 *   2. Filesystem type — iso9660 / udf / cdfs are optical media, full
 *      by nature.
 *   3. Mount-path heuristic — covers older agents that don't yet
 *      populate `removable`/`fstype`. Conservative: only matches paths
 *      that are unambiguously external (`/media/<user>/`, `/mnt/`,
 *      `/run/media/`, macOS `/Volumes/*` except boot, Windows mounts
 *      without a stable letter aren't filterable here — they need
 *      the agent flag).
 */
export function isExcludedDisk(d: { mount?: string; fstype?: string; removable?: boolean }): boolean {
  if (d.removable === true) return true;
  const fs = (d.fstype ?? '').toLowerCase();
  if (fs === 'iso9660' || fs === 'udf' || fs === 'cdfs') return true;
  const mount = d.mount ?? '';
  // Linux convention — mount points under /media or /mnt are usually
  // user-mounted external drives. We exclude /run/media/ for the same
  // reason (systemd's auto-mount path).
  if (/^\/(media|mnt|run\/media)(\/|$)/.test(mount)) return true;
  // macOS mounts every external volume under /Volumes; the boot disk
  // is the special "Macintosh HD" or the user-renamed equivalent
  // attached at /. We can't tell from path alone whether a /Volumes/*
  // entry is the boot volume or a USB key, so we exclude all of them
  // for safety. The boot disk itself shows up at `/`.
  if (/^\/Volumes\//.test(mount)) return true;
  return false;
}

type PushMetrics = {
  cpu?: { percent?: number | null } | null;
  memory?: { percent?: number | null } | null;
  disks?: Array<{ mount?: string; percent?: number | null; fstype?: string; removable?: boolean } | null> | null;
};

/** Worst level of a breach list. */
export function worstLevel(breaches: ReadonlyArray<Pick<MetricBreach, 'level'>>): MetricLevel {
  let status: MetricLevel = 'ok';
  for (const b of breaches) {
    if (b.level === 'critical') return 'critical';
    if (b.level === 'warning') status = 'warning';
  }
  return status;
}

/**
 * Worst metric severity for a single push, plus the breach details (which
 * metric, at what %, which level) for the notification body and the
 * metric_warning / metric_critical trigger filter.
 *
 * The alerts switch (`notify`) is deliberately NOT applied here: a muted
 * metric still degrades the device status and still fires the scenario
 * triggers. Notification paths call `filterNotifiedBreaches` on top.
 */
export function computeMetricStatus(
  metrics: PushMetrics | null | undefined,
  thresholds: ResolvedThresholds,
): { status: MetricLevel; breaches: MetricBreach[] } {
  const breaches: MetricBreach[] = [];
  if (!metrics) return { status: 'ok', breaches };

  const evalAgainst = (metric: 'cpu' | 'ram' | 'disk', pct: number | null | undefined, t: { warn: number; crit: number }, mount?: string) => {
    if (pct == null || !Number.isFinite(pct)) return;
    if (pct >= t.crit)      breaches.push({ metric, percent: pct, level: 'critical', mount });
    else if (pct >= t.warn) breaches.push({ metric, percent: pct, level: 'warning', mount });
  };
  evalAgainst('cpu', metrics.cpu?.percent ?? null, thresholds.cpu);
  evalAgainst('ram', metrics.memory?.percent ?? null, thresholds.ram);
  if (Array.isArray(metrics.disks) && metrics.disks.length > 0) {
    // Per-mount: every disk is evaluated against its specific override
    // (or the default disk threshold when no override is set). Each
    // saturated mount produces its own breach so the notification body
    // and the trigger filter both know which drive crossed. Removable /
    // optical disks are skipped — a 100% full ISO is normal, and a USB
    // key shouldn't trigger fleet-wide alerts the way a system disk does.
    for (const d of metrics.disks) {
      if (!d || isExcludedDisk(d)) continue;
      const mount = d.mount;
      const pct = typeof d.percent === 'number' ? d.percent : null;
      const t = (mount && thresholds.diskByMount[mount]) ? thresholds.diskByMount[mount] : thresholds.disk;
      evalAgainst('disk', pct, t, mount);
    }
  }

  return { status: worstLevel(breaches), breaches };
}

/** Breaches whose metric has alerts ON (the ones allowed to notify). cpu /
 *  ram follow their own switch; a disk breach follows `isMountNotified`
 *  (generic disk switch AND the mount's own switch). */
export function filterNotifiedBreaches<B extends Pick<MetricBreach, 'metric' | 'mount'>>(
  breaches: ReadonlyArray<B>,
  thresholds: ResolvedThresholds,
): B[] {
  return breaches.filter((b) => {
    if (b.metric === 'cpu') return thresholds.cpu.notify !== false;
    if (b.metric === 'ram') return thresholds.ram.notify !== false;
    return isMountNotified(thresholds, b.mount);
  });
}

/**
 * Transition rules shared by the notification level and the trigger level
 * (unchanged from the historical handlePush logic):
 *   - becameBad: ok (or unknown) → warning/critical, or warning → critical
 *   - recovered: warning/critical → ok
 *   - critical → warning: neither (nothing is sent)
 */
export function levelTransition(prev: MetricLevel | null, next: MetricLevel): { becameBad: boolean; recovered: boolean } {
  const becameBad = next !== 'ok' && (prev == null || prev === 'ok' || (prev === 'warning' && next === 'critical'));
  const recovered = next === 'ok' && prev !== 'ok' && prev != null;
  return { becameBad, recovered };
}

/**
 * What one push does with the two metric levels (pure, used by
 * handlePush):
 *   - `levelUpdate`: columns to write (`last_metric_status` = level of every
 *     breach, `last_metric_alert_status` = level of the breaches whose
 *     alerts are on; a NULL alert column is read as the full level);
 *   - `notify`: 'alert' / 'recovery' on a transition of the ALERTABLE level
 *     (notification channels + live alert), null otherwise;
 *   - `trigger`: true on a transition INTO warning/critical of the FULL
 *     level (scenario metric_warning / metric_critical — unchanged).
 * `evaluated` = thresholds were resolved for this push (false when the
 * all-metrics switch is off or the push has no metrics: both levels then
 * reset to ok silently, as before).
 */
export function planMetricTransitions(input: {
  prevMetric: MetricLevel | null;
  rawPrevAlert: MetricLevel | null;
  metric: MetricLevel;
  alert: MetricLevel;
  evaluated: boolean;
}): {
  levelUpdate: { last_metric_status?: MetricLevel; last_metric_alert_status?: MetricLevel };
  prevAlert: MetricLevel | null;
  notify: 'alert' | 'recovery' | null;
  trigger: boolean;
} {
  const { prevMetric, rawPrevAlert, metric, alert, evaluated } = input;
  const prevAlert = rawPrevAlert ?? prevMetric;
  const levelUpdate: { last_metric_status?: MetricLevel; last_metric_alert_status?: MetricLevel } = {};
  if (prevMetric !== metric) levelUpdate.last_metric_status = metric;
  if (rawPrevAlert !== alert) levelUpdate.last_metric_alert_status = alert;

  let notify: 'alert' | 'recovery' | null = null;
  if (evaluated && prevAlert !== alert) {
    const t = levelTransition(prevAlert, alert);
    notify = t.becameBad ? 'alert' : (t.recovered ? 'recovery' : null);
  }
  const trigger = evaluated && prevMetric !== metric && levelTransition(prevMetric, metric).becameBad;
  return { levelUpdate, prevAlert, notify, trigger };
}

/**
 * Silent re-baseline of the stored ALERTABLE level after an alerts switch
 * changed (see metricAlertRebaseline.service). Returns the level to store,
 * or null to leave the stored value alone.
 *
 *   - Only ever LOWERS the stored level. Raising is left to the next push,
 *     so un-muting a breaching metric alerts normally on that push.
 *   - Lowers only when the drop is caused by muting: if the device is also
 *     back to normal on the FULL evaluation (`fullLevel === 'ok'`) the
 *     drop is a genuine recovery and the next push sends the usual
 *     "back to normal" message.
 *   - A critical → warning drop is lowered too (the push rules would send
 *     nothing for it anyway), so a later real warning → critical alerts.
 */
export function rebaselineAlertLevel(prevAlert: MetricLevel, alertLevel: MetricLevel, fullLevel: MetricLevel): MetricLevel | null {
  if (METRIC_SEVERITY[alertLevel] >= METRIC_SEVERITY[prevAlert]) return null;
  if (fullLevel === 'ok') return null;
  return alertLevel;
}

/**
 * Inline twin of the background re-baseline, run by handlePush on every
 * push whose ALERTABLE level drops. Right after an alerts switch is turned
 * off, the threshold cache already mutes the metric while the background
 * job (metricAlertRebaseline.service) may not have reached this device
 * yet: re-evaluate the PREVIOUS metrics with the CURRENT switches and
 * apply the same silent rule, so the push cannot send a false "back to
 * normal". When nothing was muted since the previous push, the previous
 * metrics give the stored level back and this returns null (no-op).
 * Returns the level to use as the previous alertable level, or null.
 */
export function inlineRebaselinePrevAlert(input: {
  storedPrevAlert: MetricLevel | null;
  alert: MetricLevel;
  prevMetrics: PushMetrics | null | undefined;
  thresholds: ResolvedThresholds;
}): MetricLevel | null {
  const { storedPrevAlert, alert, prevMetrics, thresholds } = input;
  if (!storedPrevAlert || !prevMetrics) return null;
  if (METRIC_SEVERITY[alert] >= METRIC_SEVERITY[storedPrevAlert]) return null;
  const prevFull = computeMetricStatus(prevMetrics, thresholds);
  const prevAlertable = worstLevel(filterNotifiedBreaches(prevFull.breaches, thresholds));
  return rebaselineAlertLevel(storedPrevAlert, prevAlertable, prevFull.status);
}

/** Stable fingerprint of the `notify` flags a layer sets — the silent
 *  re-baseline only runs when a save actually changed a switch. */
export function notifySignature(t: MetricThresholds | null | undefined): string {
  const parts: string[] = [];
  for (const m of METRIC_KINDS) {
    const n = (t?.[m] as MetricThreshold | undefined)?.notify;
    if (typeof n === 'boolean') parts.push(`${m}=${n}`);
  }
  const byMount = (t?.diskByMount ?? {}) as Record<string, MetricThreshold | undefined>;
  for (const k of Object.keys(byMount).sort()) {
    const n = byMount[k]?.notify;
    if (typeof n === 'boolean') parts.push(`mount:${k}=${n}`);
  }
  return parts.join('|');
}
