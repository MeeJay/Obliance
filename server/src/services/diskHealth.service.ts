import { db } from '../db';
import { logger } from '../utils/logger';
import { getIO } from '../socket';
import { SocketEvents, isMasterTenant } from '@obliance/shared';
import type { SmartDisk, DiskHealthStatus } from '@obliance/shared';

/**
 * Disk health (SMART). Fed out-of-band by a scheduled metric script whose JSON
 * output carries a `disks` array (see command.service.ts) — NEVER by the 10s
 * metrics push. Stores one row per physical disk, computes an overall status,
 * and fires the same notification/live-alert path as the metric thresholds on
 * a state transition (dedup via devices.last_disk_health_status).
 */

const ORDER: Record<DiskHealthStatus, number> = { unknown: 0, good: 0, caution: 1, bad: 2 };

interface IncomingDisk {
  serial?: unknown; model?: unknown; type?: unknown; status?: unknown;
  tempC?: unknown; healthPct?: unknown; wearPct?: unknown; powerOnHours?: unknown;
  reallocatedSectors?: unknown; pendingSectors?: unknown;
  [k: string]: unknown;
}

function normStatus(s: unknown): DiskHealthStatus {
  return s === 'good' || s === 'caution' || s === 'bad' ? s : 'unknown';
}
function numOrNull(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}
function str(v: unknown, max: number): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

function rowToDisk(r: any): SmartDisk {
  return {
    id: r.id,
    deviceId: r.device_id,
    serial: r.serial,
    model: r.model ?? null,
    diskType: r.disk_type ?? null,
    status: normStatus(r.status),
    temperatureC: r.temperature_c ?? null,
    healthPercent: r.health_percent ?? null,
    wearPercent: r.wear_percent ?? null,
    powerOnHours: r.power_on_hours != null ? Number(r.power_on_hours) : null,
    reallocatedSectors: r.reallocated_sectors != null ? Number(r.reallocated_sectors) : null,
    pendingSectors: r.pending_sectors != null ? Number(r.pending_sectors) : null,
    updatedAt: r.updated_at,
  };
}

export const diskHealthService = {
  async listForDevice(deviceId: number, tenantId: number): Promise<SmartDisk[]> {
    const isMaster = isMasterTenant(tenantId);
    const q = db('device_smart_disks').where({ device_id: deviceId });
    if (!isMaster) q.where({ tenant_id: tenantId });
    const rows = await q.orderBy('serial', 'asc');
    return rows.map(rowToDisk);
  },

  /** Replace the device's SMART snapshot from a metric-script `disks` payload,
   *  then alert on a health-state transition. Best-effort — never throws into
   *  the caller (a script-result handler). */
  async saveFromScript(deviceId: number, tenantId: number, disks: IncomingDisk[]): Promise<void> {
    try {
      if (!Array.isArray(disks)) return;
      // Normalise + de-dup by serial (unique device_id+serial); keep the worst
      // status if the same serial appears twice. Disks with no readable serial
      // (RAID / USB-bridged / some NVMe controllers) get a synthesized stable
      // key (model + index) so multiple serial-less disks don't collapse onto a
      // single '' key and violate the unique constraint.
      const bySerial = new Map<string, any>();
      let idx = 0;
      for (const d of disks) {
        idx++;
        if (!d || typeof d !== 'object') continue;
        const realSerial = str(d.serial, 200);
        const serial = realSerial ?? `${str(d.model, 160) ?? 'disk'}#${idx}`;
        const status = normStatus(d.status);
        const row = {
          device_id: deviceId, tenant_id: tenantId, serial,
          model: str(d.model, 300),
          disk_type: str(d.type, 20),
          status,
          temperature_c: numOrNull(d.tempC),
          health_percent: numOrNull(d.healthPct),
          wear_percent: numOrNull(d.wearPct),
          power_on_hours: numOrNull(d.powerOnHours),
          reallocated_sectors: numOrNull(d.reallocatedSectors),
          pending_sectors: numOrNull(d.pendingSectors),
          raw: JSON.stringify(d),
          updated_at: new Date(),
        };
        const prev = bySerial.get(serial);
        if (!prev || ORDER[status] > ORDER[prev.status as DiskHealthStatus]) bySerial.set(serial, row);
      }
      const rows = [...bySerial.values()];
      if (rows.length === 0) return;

      await db.transaction(async (trx) => {
        await trx('device_smart_disks').where({ device_id: deviceId }).delete();
        await trx('device_smart_disks').insert(rows);
      });

      let worst: DiskHealthStatus = 'good';
      for (const r of rows) if (ORDER[r.status as DiskHealthStatus] > ORDER[worst]) worst = r.status;

      await this._evaluateTransition(deviceId, tenantId, worst, rows);

      try {
        getIO().to(`tenant:${tenantId}`).emit(SocketEvents.DISK_HEALTH_UPDATED, { deviceId, status: worst });
      } catch { /* io not ready */ }
    } catch (err) {
      logger.error(err, 'diskHealth.saveFromScript failed');
    }
  },

  async _evaluateTransition(deviceId: number, tenantId: number, worst: DiskHealthStatus, rows: any[]): Promise<void> {
    const dev = await db('devices').where({ id: deviceId })
      .select('hostname', 'display_name', 'last_disk_health_status').first() as
      { hostname: string; display_name: string | null; last_disk_health_status: string | null } | undefined;
    if (!dev) return;

    const prev = (dev.last_disk_health_status ?? null) as DiskHealthStatus | null;
    if (prev === worst) return; // no transition
    await db('devices').where({ id: deviceId }).update({ last_disk_health_status: worst });

    const becameBad = (worst === 'caution' || worst === 'bad')
      && (prev == null || prev === 'good' || prev === 'unknown' || (prev === 'caution' && worst === 'bad'));
    const recovered = worst === 'good' && prev != null && prev !== 'good' && prev !== 'unknown';
    if (!becameBad && !recovered) return;

    const dispName = dev.display_name || dev.hostname || `#${deviceId}`;
    const bad = rows.filter((r) => r.status === 'caution' || r.status === 'bad');
    const violations = bad.map((r) => {
      const parts: string[] = [];
      if (r.temperature_c != null) parts.push(`${r.temperature_c}°C`);
      if (r.health_percent != null) parts.push(`santé ${r.health_percent}%`);
      if (r.reallocated_sectors) parts.push(`${r.reallocated_sectors} secteurs réalloués`);
      const label = r.model || r.serial || 'disque';
      return `${label}${parts.length ? ' — ' + parts.join(', ') : ''}`;
    });

    try {
      const { notificationService } = await import('./notification.service');
      await notificationService.sendForAgent(
        deviceId, dispName,
        recovered ? 'up' : 'alert',
        prev ?? 'good',
        violations,
        recovered ? 'up' : 'alert',
      );
    } catch (err) { logger.error(err, 'disk-health notification failed'); }

    try {
      const { liveAlertService } = await import('./liveAlert.service');
      if (recovered) {
        await liveAlertService.add(tenantId, {
          severity: 'info',
          title: `${dispName}: santé disque revenue à la normale`,
          message: 'Tous les disques sont repassés à un état sain.',
          navigateTo: `/devices/${deviceId}`,
          stableKey: null,
        });
      } else {
        await liveAlertService.add(tenantId, {
          severity: worst === 'bad' ? 'critical' : 'warning',
          title: `${dispName}: santé disque ${worst === 'bad' ? 'critique' : 'à surveiller'}`,
          message: violations.length ? violations.join(' · ') : 'Un disque a franchi un seuil SMART.',
          navigateTo: `/devices/${deviceId}`,
          stableKey: `device:${deviceId}:diskhealth:${worst}`,
        });
      }
    } catch (err) { logger.error(err, 'disk-health live-alert failed'); }
  },
};
