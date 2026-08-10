import { db } from '../db';
import { isMasterTenant } from '@obliance/shared';

/**
 * Read side of the Rewind time-machine. Serves:
 *   - range:    the scrubber bounds + where detailed snapshots exist
 *   - series:   CPU/RAM/Disk timeseries for a window (5-min or hourly buckets)
 *   - snapshot: the running processes + services nearest a chosen instant
 *
 * All queries are tenant-scoped (master tenant sees any device — god view).
 */

const DAY = 24 * 60 * 60 * 1000;

function scope(table: string, deviceId: number, tenantId: number) {
  const q = db(table).where({ device_id: deviceId });
  if (!isMasterTenant(tenantId)) q.where({ tenant_id: tenantId });
  return q;
}

function toArr(v: unknown): any[] {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; } }
  return [];
}

export const rewindService = {
  /** Scrubber bounds. Metric range = graph extent; process/service range = where detail exists. */
  async getRange(deviceId: number, tenantId: number) {
    const [metric5] = await scope('device_metric_5min', deviceId, tenantId).min({ min: 'bucket' }).max({ max: 'bucket' });
    const [metricH] = await scope('device_metric_hourly', deviceId, tenantId).min({ min: 'bucket' }).max({ max: 'bucket' });
    const [proc] = await scope('device_process_history', deviceId, tenantId).min({ min: 'captured_at' }).max({ max: 'captured_at' });
    const [svc] = await scope('device_service_history', deviceId, tenantId).min({ min: 'captured_at' }).max({ max: 'captured_at' });

    // Compare by epoch, not by Date.toString() (which sorts weekday-first and is
    // chronologically arbitrary). metricFrom = earliest across hourly(30d)+5min(7d).
    const toMs = (d: unknown) => new Date(d as any).getTime();
    const mins = [metricH?.min, metric5?.min].filter(Boolean) as unknown[];
    const maxs = [metricH?.max, metric5?.max].filter(Boolean) as unknown[];
    const metricFrom = mins.length ? new Date(Math.min(...mins.map(toMs))).toISOString() : null;
    const metricTo = maxs.length ? new Date(Math.max(...maxs.map(toMs))).toISOString() : null;
    return {
      metricFrom, metricTo,
      processFrom: proc?.min ?? null, processTo: proc?.max ?? null,
      serviceFrom: svc?.min ?? null, serviceTo: svc?.max ?? null,
      now: new Date().toISOString(),
    };
  },

  /** CPU/RAM/Disk timeseries for [from,to]. Resolution = 5-min only for a short
   *  window that is ALSO newer than the 5-min retention horizon (else those rows
   *  are pruned); otherwise hourly. Falls back to hourly if the 5-min query is
   *  empty (e.g. right at the prune boundary). */
  async getSeries(deviceId: number, tenantId: number, from: Date, to: Date) {
    const query = async (resolution: '5min' | 'hourly') => {
      const metricTable = resolution === '5min' ? 'device_metric_5min' : 'device_metric_hourly';
      const diskTable = resolution === '5min' ? 'device_disk_5min' : 'device_disk_hourly';

      const mRows = await scope(metricTable, deviceId, tenantId)
        .where('bucket', '>=', from).where('bucket', '<=', to)
        .orderBy('bucket', 'asc')
        .select('bucket', 'cpu_sum', 'ram_sum', 'samples', 'cpu_max', 'ram_max');

      const points = mRows.map((r: any) => {
        const s = r.samples > 0 ? r.samples : 1;
        return {
          t: r.bucket,
          cpu: Math.round((r.cpu_sum / s) * 10) / 10,
          cpuMax: Math.round(r.cpu_max * 10) / 10,
          ram: Math.round((r.ram_sum / s) * 10) / 10,
          ramMax: Math.round(r.ram_max * 10) / 10,
        };
      });

      const dRows = await scope(diskTable, deviceId, tenantId)
        .where('bucket', '>=', from).where('bucket', '<=', to)
        .orderBy(['mount', 'bucket'])
        .select('mount', 'bucket', 'pct_sum', 'samples', 'pct_max', 'used_gb_last', 'total_gb_last');

      const byMount = new Map<string, any[]>();
      for (const r of dRows as any[]) {
        const s = r.samples > 0 ? r.samples : 1;
        if (!byMount.has(r.mount)) byMount.set(r.mount, []);
        byMount.get(r.mount)!.push({
          t: r.bucket,
          pct: Math.round((r.pct_sum / s) * 10) / 10,
          pctMax: Math.round(r.pct_max * 10) / 10,
          usedGb: Math.round(r.used_gb_last * 10) / 10,
          totalGb: Math.round(r.total_gb_last * 10) / 10,
        });
      }
      const disks = [...byMount.entries()].map(([mount, pts]) => ({ mount, points: pts }));
      return { resolution, points, disks };
    };

    const retentionMs = Math.max(1, parseInt(process.env.REWIND_RETENTION_DAYS || '7', 10)) * DAY;
    const fine = (to.getTime() - from.getTime()) <= 2 * DAY && from.getTime() >= Date.now() - retentionMs;

    let res = await query(fine ? '5min' : 'hourly');
    if (fine && !res.points.length && !res.disks.length) {
      res = await query('hourly'); // 5-min pruned at the boundary — hourly still has 30d
    }
    return res;
  },

  /** Processes + services nearest an instant (closest snapshot in either direction). */
  async getSnapshotAt(deviceId: number, tenantId: number, at: Date) {
    const nearest = async (table: string, tsCol: string) => {
      const before = await scope(table, deviceId, tenantId).where(tsCol, '<=', at).orderBy(tsCol, 'desc').first();
      const after = await scope(table, deviceId, tenantId).where(tsCol, '>', at).orderBy(tsCol, 'asc').first();
      if (!before) return after ?? null;
      if (!after) return before;
      const db1 = Math.abs(new Date(before[tsCol]).getTime() - at.getTime());
      const da = Math.abs(new Date(after[tsCol]).getTime() - at.getTime());
      return da < db1 ? after : before;
    };

    const p = await nearest('device_process_history', 'captured_at');
    const s = await nearest('device_service_history', 'captured_at');

    return {
      process: p ? {
        capturedAt: p.captured_at,
        processCount: p.process_count,
        cpuTotal: p.cpu_total,
        memUsedMb: p.mem_used_mb,
        procs: toArr(p.procs),
      } : null,
      service: s ? {
        capturedAt: s.captured_at,
        serviceCount: s.service_count,
        runningCount: s.running_count,
        services: toArr(s.services),
      } : null,
    };
  },
};
