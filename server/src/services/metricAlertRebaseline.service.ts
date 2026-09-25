import { db } from '../db';
import { logger } from '../utils/logger';
import type { MetricThresholds } from '@obliance/shared';
import {
  computeMetricStatus,
  filterNotifiedBreaches,
  worstLevel,
  rebaselineAlertLevel,
  notifySignature,
  type MetricLevel,
} from './thresholdCascade';

// Silent re-baseline of the ALERTABLE metric level
// (`devices.last_metric_alert_status`) after a per-metric alerts switch
// (`notify`) changed at some layer of the threshold cascade.
//
// Without it, muting a metric that is currently breaching would make the
// next push see "alertable level bad → ok" and send a "back to normal"
// notification + bell alert caused only by the mute. The re-baseline
// re-evaluates each affected device's `latest_metrics` under the NEW
// cascade and lowers the stored alertable level when the drop comes from
// the mute (rules in `rebaselineAlertLevel`):
//   - no notification, no scenario trigger, `devices.status` untouched,
//     `last_metric_status` (trigger memory) untouched;
//   - never raises the level: un-muting a breaching metric alerts on the
//     next push, as a new breach;
//   - when the alertable level drops to ok, the device's unread metric live
//     alerts (stable_key device:{id}:metric:*) are marked read so they leave
//     the web bell and the mobile "À traiter" inbox.
//
// Runs asynchronously after the save response, one job at a time (a
// promise chain), in chunks. Only devices whose stored alertable level is
// warning / critical can be lowered, so the candidate query filters on it
// and a global change touches only the currently alerting devices.

const CHUNK = 500;

export type RebaselineScope =
  | { kind: 'all' }
  | { kind: 'tenant'; tenantId: number }
  | { kind: 'groupSubtree'; groupId: number }
  | { kind: 'devices'; deviceIds: number[] };

let queue: Promise<void> = Promise.resolve();

function parseMetrics(value: unknown): Record<string, unknown> | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    try { return JSON.parse(value) as Record<string, unknown>; } catch { return null; }
  }
  return typeof value === 'object' ? value as Record<string, unknown> : null;
}

function asLevel(v: unknown): MetricLevel | null {
  return v === 'ok' || v === 'warning' || v === 'critical' ? v : null;
}

async function candidateIds(scope: RebaselineScope): Promise<number[]> {
  const q = db('devices')
    .whereNotNull('latest_metrics')
    .whereRaw(`COALESCE(last_metric_alert_status, last_metric_status) IN ('warning', 'critical')`)
    .select('id');
  if (scope.kind === 'tenant') q.where({ tenant_id: scope.tenantId });
  else if (scope.kind === 'groupSubtree') {
    q.whereIn('group_id', db('device_group_closure').where({ ancestor_id: scope.groupId }).select('descendant_id'));
  } else if (scope.kind === 'devices') {
    // Explicit list (group delete, transfer, scenario move…): query it in
    // chunks so a large list never hits the bind-parameter limit.
    const ids = [...new Set(scope.deviceIds)];
    const out: number[] = [];
    for (let i = 0; i < ids.length; i += CHUNK) {
      const rows = await q.clone().whereIn('id', ids.slice(i, i + CHUNK)) as Array<{ id: number }>;
      for (const r of rows) out.push(r.id);
    }
    return out;
  }
  const rows = await q as Array<{ id: number }>;
  return rows.map((r) => r.id);
}

async function processChunk(ids: number[]): Promise<{ lowered: number; markedRead: number }> {
  const { thresholdService } = await import('./threshold.service');
  const rows = await db('devices as d')
    .leftJoin('device_groups as g', 'g.id', 'd.group_id')
    .whereIn('d.id', ids)
    .select(
      'd.id', 'd.tenant_id', 'd.latest_metrics', 'd.last_metric_status', 'd.last_metric_alert_status',
      'd.metric_alerts_enabled', 'g.metric_alerts_enabled as group_metric_alerts_enabled',
    ) as Array<{
      id: number; tenant_id: number; latest_metrics: unknown;
      last_metric_status: string | null; last_metric_alert_status: string | null;
      metric_alerts_enabled: boolean | null; group_metric_alerts_enabled: boolean | null;
    }>;
  const thresholdMap = await thresholdService.resolveMany(ids);
  const toMarkRead: number[] = [];
  let lowered = 0;

  for (const r of rows) {
    // Legacy all-metrics switch off: handlePush already resets both levels
    // to ok silently on the next push — nothing to do here.
    const alertsEnabled = typeof r.metric_alerts_enabled === 'boolean'
      ? r.metric_alerts_enabled
      : (typeof r.group_metric_alerts_enabled === 'boolean' ? r.group_metric_alerts_enabled : true);
    if (!alertsEnabled) continue;
    const thresholds = thresholdMap.get(r.id);
    const metrics = parseMetrics(r.latest_metrics);
    const prev = asLevel(r.last_metric_alert_status) ?? asLevel(r.last_metric_status);
    if (!thresholds || !metrics || !prev) continue;

    const full = computeMetricStatus(metrics as Parameters<typeof computeMetricStatus>[0], thresholds);
    const alertLevel = worstLevel(filterNotifiedBreaches(full.breaches, thresholds));
    const next = rebaselineAlertLevel(prev, alertLevel, full.status);
    if (next == null) continue;

    // Conditional write: a push that landed meanwhile already stored a
    // fresher level — keep it.
    const updated = await db('devices')
      .where({ id: r.id })
      .whereRaw('COALESCE(last_metric_alert_status, last_metric_status) = ?', [prev])
      .update({ last_metric_alert_status: next });
    if (!updated) continue;
    lowered++;
    if (next === 'ok') toMarkRead.push(r.id);
  }

  let markedRead = 0;
  if (toMarkRead.length > 0) {
    // Not tenant-scoped on purpose: a device transferred to another tenant
    // left its metric alerts in the source tenant's inbox.
    const { liveAlertService } = await import('./liveAlert.service');
    markedRead = (await liveAlertService.markDeviceMetricAlertsRead(toMarkRead)).length;
  }
  return { lowered, markedRead };
}

async function run(scope: RebaselineScope, reason: string): Promise<void> {
  const ids = await candidateIds(scope);
  if (ids.length === 0) return;
  let lowered = 0;
  let markedRead = 0;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const res = await processChunk(ids.slice(i, i + CHUNK));
    lowered += res.lowered;
    markedRead += res.markedRead;
  }
  if (lowered > 0) {
    logger.info({ scope: scope.kind, reason, candidates: ids.length, lowered, markedRead }, 'metric alert level re-baselined');
  }
}

export const metricAlertRebaseline = {
  /**
   * Queue a silent re-baseline (fire-and-forget; errors are logged). The
   * caller must have invalidated the threshold caches of the layer it just
   * saved (global / tenant / group) before calling this.
   */
  schedule(scope: RebaselineScope, reason: string): void {
    queue = queue
      // Let the save handler answer first.
      .then(() => new Promise<void>((resolve) => setImmediate(resolve)))
      .then(() => run(scope, reason))
      .catch((err) => {
        logger.error({ err, scope: scope.kind, reason }, 'metric alert re-baseline failed');
      });
  },

  /** True when the two layer values set different `notify` switches. */
  notifyChanged(before: MetricThresholds | null | undefined, after: MetricThresholds | null | undefined): boolean {
    return notifySignature(before) !== notifySignature(after);
  },

  /** Await the queued jobs (verification scripts / tests). */
  async drain(): Promise<void> {
    await queue;
  },
};
