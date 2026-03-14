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
      bios: row.bios || {}, raw: row.raw || {},
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
    await db('device_inventory_hardware').insert({
      device_id: deviceId,
      cpu: JSON.stringify(data.cpu || {}),
      memory: JSON.stringify(data.memory || {}),
      disks: JSON.stringify(data.disks || []),
      network_interfaces: JSON.stringify(data.networkInterfaces || []),
      gpu: JSON.stringify(data.gpu || []),
      motherboard: JSON.stringify(data.motherboard || {}),
      bios: JSON.stringify(data.bios || {}),
      raw: JSON.stringify(data.raw || {}),
      scanned_at: new Date(),
    });

    // Update device summary from hardware
    await db('devices').where({ id: deviceId }).update({
      cpu_model: data.cpu?.model,
      cpu_cores: data.cpu?.cores,
      ram_total_gb: data.memory?.total ? Math.round(data.memory.total / (1024**3) * 100) / 100 : undefined,
      updated_at: new Date(),
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

export const inventoryService = new InventoryService();
