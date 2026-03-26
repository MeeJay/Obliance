import { db } from '../db';
import type { DeviceLicense } from '@obliance/shared';

function rowToLicense(row: any): DeviceLicense {
  return {
    id: row.id,
    deviceId: row.device_id,
    tenantId: row.tenant_id,
    softwareName: row.software_name,
    licenseKey: row.license_key,
    licenseType: row.license_type,
    seats: row.seats,
    expiryDate: row.expiry_date,
    vendor: row.vendor,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const licenseService = {
  async listForDevice(deviceId: number, tenantId: number): Promise<DeviceLicense[]> {
    const rows = await db('device_licenses')
      .where({ device_id: deviceId, tenant_id: tenantId })
      .orderBy('software_name');
    return rows.map(rowToLicense);
  },

  async listAll(tenantId: number): Promise<(DeviceLicense & { deviceName: string | null })[]> {
    const rows = await db('device_licenses as dl')
      .join('devices as d', 'd.id', 'dl.device_id')
      .where({ 'dl.tenant_id': tenantId })
      .select(
        'dl.*',
        db.raw(`COALESCE(NULLIF(d.display_name, ''), d.hostname) AS device_name`),
      )
      .orderBy('dl.software_name');
    return rows.map((r: any) => ({
      ...rowToLicense(r),
      deviceName: r.device_name ?? null,
    }));
  },

  async create(deviceId: number, tenantId: number, data: Partial<DeviceLicense>): Promise<DeviceLicense> {
    const [row] = await db('device_licenses').insert({
      device_id: deviceId,
      tenant_id: tenantId,
      software_name: data.softwareName,
      license_key: data.licenseKey || null,
      license_type: data.licenseType || null,
      seats: data.seats ?? null,
      expiry_date: data.expiryDate || null,
      vendor: data.vendor || null,
      notes: data.notes || null,
    }).returning('*');
    return rowToLicense(row);
  },

  async update(id: number, tenantId: number, data: Partial<DeviceLicense>): Promise<DeviceLicense | null> {
    const updates: Record<string, any> = { updated_at: new Date() };
    if (data.softwareName !== undefined) updates.software_name = data.softwareName;
    if (data.licenseKey !== undefined) updates.license_key = data.licenseKey;
    if (data.licenseType !== undefined) updates.license_type = data.licenseType;
    if (data.seats !== undefined) updates.seats = data.seats;
    if (data.expiryDate !== undefined) updates.expiry_date = data.expiryDate;
    if (data.vendor !== undefined) updates.vendor = data.vendor;
    if (data.notes !== undefined) updates.notes = data.notes;

    const [row] = await db('device_licenses')
      .where({ id, tenant_id: tenantId })
      .update(updates)
      .returning('*');
    return row ? rowToLicense(row) : null;
  },

  async delete(id: number, tenantId: number): Promise<boolean> {
    const count = await db('device_licenses')
      .where({ id, tenant_id: tenantId })
      .delete();
    return count > 0;
  },
};
