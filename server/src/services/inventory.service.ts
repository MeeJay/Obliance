import { db } from '../db';
import { commandService } from './command.service';
import type { HardwareInventory, SoftwareEntry } from '@obliance/shared';

class InventoryService {
  async getHardware(deviceId: number): Promise<HardwareInventory | null> {
    const row = await db('device_inventory_hardware')
      .where({ device_id: deviceId })
      .orderBy('scanned_at', 'desc')
      .first();
    if (!row) return null;
    return {
      id: row.id, deviceId: row.device_id,
      cpu: row.cpu || {}, memory: row.memory || {},
      disks: row.disks || [], networkInterfaces: row.network_interfaces || [],
      gpu: row.gpu || [], motherboard: row.motherboard || {},
      bios: row.bios || {}, bitlocker: row.bitlocker || [],
      raw: row.raw || {},
      scannedAt: row.scanned_at,
    };
  }

  async getSoftware(deviceId: number, search?: string): Promise<SoftwareEntry[]> {
    let q = db('device_inventory_software')
      .where({ device_id: deviceId })
      .orderBy('scanned_at', 'desc');

    if (search) q = q.whereILike('name', `%${search}%`);

    const rows = await q;
    return rows.map((r: any) => ({
      id: r.id, deviceId: r.device_id, name: r.name, version: r.version,
      publisher: r.publisher, installDate: r.install_date,
      installLocation: r.install_location, source: r.source,
      packageId: r.package_id, scannedAt: r.scanned_at,
    }));
  }

  async saveHardware(deviceId: number, data: any) {
    // Normalise Go agent field names → HardwareInventory shared-type shape.
    // Go sends: cpu.speedMhz, memory.totalMb, memory.slots[].sizeMb / .slot / .speedMhz,
    //           disks[].sizeBytes, gpu[].model / .driverVersion / .vram (string "128 MB"),
    //           networkInterfaces[].macAddress — the shared types expect different names.

    const cpu = {
      model:   data.cpu?.model   ?? '',
      cores:   data.cpu?.cores   ?? 0,
      threads: data.cpu?.threads ?? 0,
      // Go sends MHz; shared type expects GHz (1 decimal)
      speed:   data.cpu?.speedMhz ? Math.round(data.cpu.speedMhz / 100) / 10 : (data.cpu?.speed ?? 0),
    };

    const totalBytes = data.memory?.totalMb
      ? data.memory.totalMb * 1024 * 1024
      : (data.memory?.total ?? 0);

    const memory = {
      total: totalBytes,
      slots: ((data.memory?.slots ?? []) as any[]).map((s: any) => ({
        bank:  s.slot  ?? s.bank  ?? '',
        size:  s.sizeMb ? s.sizeMb * 1024 * 1024 : (s.size ?? 0), // MB → bytes
        type:  s.type  ?? '',
        speed: s.speedMhz ?? s.speed ?? 0,
      })),
    };

    const disks = ((data.disks ?? []) as any[]).map((d: any) => ({
      device: d.model ?? '',
      model:  d.model ?? null,
      type:   (d.type ?? 'unknown').toLowerCase() === 'unknown' ? 'unknown' : (d.type ?? 'unknown'),
      size:   d.sizeBytes ?? d.size ?? 0, // Go sends sizeBytes (bytes already)
      mounts: [],                           // Go doesn't report mount points
    }));

    const networkInterfaces = ((data.networkInterfaces ?? []) as any[]).map((n: any) => ({
      name:      n.name       ?? '',
      mac:       n.macAddress ?? n.mac ?? '',
      type:      n.type       ?? '',
      speed:     n.speed      ?? null,
      addresses: n.addresses  ?? [],
    }));

    const gpu = ((data.gpu ?? []) as any[]).map((g: any) => ({
      name:   g.model  ?? g.name  ?? '',
      vram:   parseVramToBytes(g.vram ?? g.VRAM ?? ''),
      driver: g.driverVersion ?? g.driver ?? null,
    }));

    const motherboard = {
      manufacturer: data.motherboard?.manufacturer ?? null,
      model:        data.motherboard?.product ?? data.motherboard?.model ?? null,
      version:      data.motherboard?.version ?? null,
    };

    const bios = {
      vendor:  data.bios?.vendor  ?? null,
      version: data.bios?.version ?? null,
      date:    data.bios?.date    ?? null,
    };

    await db('device_inventory_hardware').insert({
      device_id:          deviceId,
      cpu:                JSON.stringify(cpu),
      memory:             JSON.stringify(memory),
      disks:              JSON.stringify(disks),
      network_interfaces: JSON.stringify(networkInterfaces),
      gpu:                JSON.stringify(gpu),
      motherboard:        JSON.stringify(motherboard),
      bios:               JSON.stringify(bios),
      bitlocker:          JSON.stringify(data.bitlocker ?? []),
      raw:                JSON.stringify(data.raw ?? {}),
      scanned_at:         new Date(),
    });

    // Update device summary
    await db('devices').where({ id: deviceId }).update({
      cpu_model:    cpu.model  || undefined,
      cpu_cores:    cpu.cores  || undefined,
      ram_total_gb: totalBytes ? Math.round(totalBytes / (1024 ** 3) * 100) / 100 : undefined,
      updated_at:   new Date(),
    });
  }

  async saveSoftware(deviceId: number, software: Array<{
    name: string; version?: string; publisher?: string;
    installDate?: string; installLocation?: string;
    source?: string; packageId?: string;
  }>) {
    const now = new Date();
    const rows = software.map(s => ({
      device_id: deviceId, name: s.name, version: s.version,
      publisher: s.publisher, install_date: s.installDate,
      install_location: s.installLocation, source: s.source,
      package_id: s.packageId, scanned_at: now,
    }));

    // Replace all software for this device (full scan replaces previous)
    await db.transaction(async (trx) => {
      await trx('device_inventory_software').where({ device_id: deviceId }).delete();
      if (rows.length > 0) await trx('device_inventory_software').insert(rows);
    });
  }

  async triggerScan(deviceId: number, tenantId: number, createdBy: number) {
    return commandService.enqueue({
      deviceId, tenantId, type: 'scan_inventory',
      payload: {}, priority: 'normal',
      expiresInSeconds: 600, createdBy,
    });
  }

  // Called by agent push when inventory payload is included
  async handleInventoryPayload(deviceId: number, payload: { hardware?: any; software?: any[] }) {
    if (payload.hardware) await this.saveHardware(deviceId, payload.hardware);
    if (payload.software) await this.saveSoftware(deviceId, payload.software);
  }
}

/** Parse a VRAM string like "128 MB" or "8 GB" to bytes. */
function parseVramToBytes(s: string | number | undefined): number {
  if (typeof s === 'number') return s;
  if (!s) return 0;
  const m = String(s).match(/^(\d+(?:\.\d+)?)\s*(GB|MB|KB)?$/i);
  if (!m) return 0;
  const v = parseFloat(m[1]);
  switch ((m[2] ?? '').toUpperCase()) {
    case 'GB': return Math.round(v * 1024 * 1024 * 1024);
    case 'MB': return Math.round(v * 1024 * 1024);
    case 'KB': return Math.round(v * 1024);
    default:   return Math.round(v);
  }
}

export const inventoryService = new InventoryService();
