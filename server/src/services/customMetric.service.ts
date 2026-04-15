import { db } from '../db';
import { logger } from '../utils/logger';
import { getIO } from '../socket';
import type { DeviceCustomMetric } from '@obliance/shared';

/**
 * Custom metrics — per-device key/value pairs produced by scripts whose
 * `purpose` is 'metric'. A schedule running such a script on one or more
 * devices keeps one row per (device, schedule). The latest value replaces
 * the previous one on each execution.
 */

interface ParsedMetric {
  value: string;
  unit: string | null;
  name?: string;
  status?: 'ok' | 'warning' | 'critical' | 'error';
}

/**
 * Parse a script stdout string into a custom metric value. Supports:
 *   - JSON: {"value": 42, "unit": "%", "label": "queue", "status": "ok"}
 *   - Plain: "42"  "42.5"  "1.04M"  "1.04M it/s"  "42 %"  "128 MB"
 *
 * Only the last non-empty line is considered for plain inputs — this lets
 * scripts echo progress info and end with the final value.
 */
export function parseMetricStdout(stdout: string | null | undefined): ParsedMetric | null {
  if (!stdout) return null;
  const trimmed = stdout.trim();
  if (!trimmed) return null;

  // Try JSON first.
  if (trimmed.startsWith('{')) {
    try {
      const obj = JSON.parse(trimmed);
      if (obj && (obj.value !== undefined || obj.v !== undefined)) {
        const value = String(obj.value ?? obj.v);
        const unit = obj.unit ?? obj.u ?? null;
        const name = obj.label ?? obj.name ?? undefined;
        const status = obj.status && ['ok', 'warning', 'critical', 'error'].includes(obj.status) ? obj.status : undefined;
        return { value, unit, name, status };
      }
    } catch {
      // Fall through to plain parsing.
    }
  }

  // Plain: take the last non-empty line.
  const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return null;
  const last = lines[lines.length - 1];

  // Match: optional +/-, digits with optional decimal, optional SI prefix
  // (K, M, G, T) and optional unit following a space.
  //   1.04M it/s  →  value="1.04M"  unit="it/s"
  //   42 %        →  value="42"     unit="%"
  //   500K        →  value="500K"   unit=null
  //   3.14        →  value="3.14"   unit=null
  const m = last.match(/^([+-]?\d+(?:[.,]\d+)?(?:[KMGTPEkmgtpe])?)\s*(.*)$/);
  if (!m) {
    // Not numeric — just store the whole last line as the value.
    return { value: last, unit: null };
  }
  const value = m[1].replace(',', '.');
  const unit = m[2].trim() || null;
  return { value, unit };
}

export const customMetricService = {
  async upsert(params: {
    deviceId: number;
    scheduleId: number;
    tenantId: number;
    scheduleName: string;
    parsed: ParsedMetric;
  }): Promise<void> {
    const { deviceId, scheduleId, tenantId, scheduleName, parsed } = params;
    const name = parsed.name || scheduleName;
    const status = parsed.status ?? 'ok';
    try {
      await db('device_custom_metrics')
        .insert({
          device_id: deviceId,
          schedule_id: scheduleId,
          tenant_id: tenantId,
          name,
          value: parsed.value,
          unit: parsed.unit,
          status,
          updated_at: new Date(),
        })
        .onConflict(['device_id', 'schedule_id'])
        .merge({
          name,
          value: parsed.value,
          unit: parsed.unit,
          status,
          updated_at: new Date(),
        });

      // Broadcast so the device detail page refreshes the metric card live.
      try {
        getIO().to(`tenant:${tenantId}`).emit('CUSTOM_METRIC_UPDATED', {
          deviceId, scheduleId, name, value: parsed.value, unit: parsed.unit, status,
        });
      } catch {}
    } catch (err) {
      logger.error(err, 'customMetric: failed to upsert');
    }
  },

  /**
   * Mark a metric as failed (status='error') without overwriting the last
   * known value. Keeps the history visible while making the failure obvious.
   */
  async markError(params: {
    deviceId: number;
    scheduleId: number;
    tenantId: number;
    scheduleName: string;
  }): Promise<void> {
    const { deviceId, scheduleId, tenantId, scheduleName } = params;
    try {
      const existing = await db('device_custom_metrics')
        .where({ device_id: deviceId, schedule_id: scheduleId })
        .first();
      if (existing) {
        await db('device_custom_metrics')
          .where({ id: existing.id })
          .update({ status: 'error', updated_at: new Date() });
      } else {
        // First run and it failed — create an empty placeholder.
        await db('device_custom_metrics').insert({
          device_id: deviceId,
          schedule_id: scheduleId,
          tenant_id: tenantId,
          name: scheduleName,
          value: '—',
          unit: null,
          status: 'error',
          updated_at: new Date(),
        });
      }
      try {
        getIO().to(`tenant:${tenantId}`).emit('CUSTOM_METRIC_UPDATED', {
          deviceId, scheduleId, status: 'error',
        });
      } catch {}
    } catch (err) {
      logger.error(err, 'customMetric: failed to mark error');
    }
  },

  async listForDevice(deviceId: number, tenantId: number): Promise<DeviceCustomMetric[]> {
    const rows = await db('device_custom_metrics')
      .where({ device_id: deviceId, tenant_id: tenantId })
      .orderBy('name', 'asc');
    return rows.map((r: any) => ({
      id: r.id,
      deviceId: r.device_id,
      scheduleId: r.schedule_id,
      tenantId: r.tenant_id,
      name: r.name,
      value: r.value,
      unit: r.unit,
      status: r.status,
      updatedAt: r.updated_at,
    }));
  },
};
