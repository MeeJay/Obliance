import { db } from '../db';
import { isMasterTenant } from '@obliance/shared';
import type { VirtualMachine, VmState, VirtualizationHostType, VmCheckpoint } from '@obliance/shared';

// Virtualization (Hyper-V) service. Stores the VM inventory reported by host
// agents and reads it back for the device-detail tab + tenant-wide grid.
//
// The agent posts the FULL VM list for a host on each refresh; we reconcile
// with delete-missing + upsert so VMs removed on the host disappear here too.

const VALID_STATES: VmState[] = ['running', 'off', 'saved', 'paused', 'transitioning', 'unknown'];

interface IncomingVM {
  vmId: string;
  name: string;
  state?: string;
  rawState?: string | null;
  cpuCount?: number | null;
  memoryBytes?: number | null;
  uptimeSeconds?: number | null;
  checkpointCount?: number | null;
  checkpoints?: unknown;
  ipAddresses?: unknown;
  generation?: number | null;
  notes?: string | null;
  cpuUsagePercent?: number | null;
  memoryDemandBytes?: number | null;
  dynamicMemory?: boolean;
  heartbeat?: string | null;
  integrationSvcVer?: string | null;
  version?: string | null;
  statusText?: string | null;
  guestOs?: string | null;
  automaticStart?: string | null;
  automaticStop?: string | null;
}

function rowToVM(row: any): VirtualMachine {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    hostDeviceId: row.host_device_id,
    hostType: row.host_type,
    vmId: row.vm_id,
    name: row.name,
    state: row.state,
    rawState: row.raw_state ?? null,
    cpuCount: row.cpu_count ?? null,
    memoryBytes: row.memory_bytes != null ? Number(row.memory_bytes) : null,
    uptimeSeconds: row.uptime_seconds != null ? Number(row.uptime_seconds) : null,
    checkpointCount: row.checkpoint_count ?? null,
    checkpoints: typeof row.checkpoints === 'string' ? JSON.parse(row.checkpoints) : (row.checkpoints ?? []),
    ipAddresses: typeof row.ip_addresses === 'string' ? JSON.parse(row.ip_addresses) : (row.ip_addresses ?? []),
    generation: row.generation ?? null,
    notes: row.notes ?? null,
    ...(() => {
      const m = typeof row.metrics === 'string' ? safeJson(row.metrics) : (row.metrics ?? {});
      return {
        cpuUsagePercent: m.cpuUsagePercent ?? null,
        memoryDemandBytes: m.memoryDemandBytes != null ? Number(m.memoryDemandBytes) : null,
        dynamicMemory: !!m.dynamicMemory,
        heartbeat: m.heartbeat ?? null,
        integrationServicesVersion: m.integrationSvcVer ?? null,
        configVersion: m.version ?? null,
        statusText: m.statusText ?? null,
        guestOs: m.guestOs ?? null,
        automaticStart: m.automaticStart ?? null,
        automaticStop: m.automaticStop ?? null,
      };
    })(),
    updatedAt: row.updated_at,
    hostName: row.host_name ?? undefined,
    hostTags: row.host_tags != null
      ? (typeof row.host_tags === 'string' ? safeJson(row.host_tags) : row.host_tags)
      : undefined,
  };
}

function safeJson(s: string): any { try { return JSON.parse(s); } catch { return {}; } }

export const hyperVService = {
  /** Replace the VM set for a host with the agent's freshly-reported list. */
  async ingestVMs(hostDeviceId: number, tenantId: number, hostType: VirtualizationHostType, vms: IncomingVM[]): Promise<void> {
    const keepIds = vms.map((v) => v.vmId).filter(Boolean);
    await db.transaction(async (trx) => {
      // Drop VMs that no longer exist on the host.
      const del = trx('device_virtual_machines').where({ host_device_id: hostDeviceId });
      if (keepIds.length > 0) del.whereNotIn('vm_id', keepIds);
      await del.delete();

      for (const v of vms) {
        if (!v.vmId || !v.name) continue;
        const state: VmState = VALID_STATES.includes(v.state as VmState) ? (v.state as VmState) : 'unknown';
        const ips = Array.isArray(v.ipAddresses)
          ? (v.ipAddresses as unknown[]).filter((x): x is string => typeof x === 'string')
          : [];
        const checkpoints: VmCheckpoint[] = Array.isArray(v.checkpoints)
          ? (v.checkpoints as any[]).map((c) => ({
              name: String(c?.name ?? ''),
              createdAt: c?.createdAt ? String(c.createdAt) : null,
              parentName: c?.parentName ? String(c.parentName) : null,
            })).filter((c) => c.name)
          : [];
        const payload = {
          tenant_id: tenantId,
          host_device_id: hostDeviceId,
          host_type: hostType,
          vm_id: v.vmId,
          name: v.name,
          state,
          raw_state: v.rawState ?? null,
          cpu_count: v.cpuCount ?? null,
          memory_bytes: v.memoryBytes ?? null,
          uptime_seconds: v.uptimeSeconds ?? null,
          checkpoint_count: v.checkpointCount ?? null,
          checkpoints: JSON.stringify(checkpoints),
          metrics: JSON.stringify({
            cpuUsagePercent: v.cpuUsagePercent ?? null,
            memoryDemandBytes: v.memoryDemandBytes ?? null,
            dynamicMemory: !!v.dynamicMemory,
            heartbeat: v.heartbeat ?? null,
            integrationSvcVer: v.integrationSvcVer ?? null,
            version: v.version ?? null,
            statusText: v.statusText ?? null,
            guestOs: v.guestOs ?? null,
            automaticStart: v.automaticStart ?? null,
            automaticStop: v.automaticStop ?? null,
          }),
          ip_addresses: JSON.stringify(ips),
          generation: v.generation ?? null,
          notes: v.notes ?? null,
          updated_at: new Date(),
        };
        await trx('device_virtual_machines')
          .insert(payload)
          .onConflict(['host_device_id', 'vm_id'])
          .merge();
      }
    });

    // Push the fresh list to any open Hyper-V views (device-detail tab +
    // dashboard tenant grid) so they update live without polling.
    try {
      const { getIO } = await import('../socket');
      const vmsOut = await this.listForDevice(hostDeviceId);
      getIO().to(`tenant:${tenantId}`).emit('HYPERV_VMS_UPDATED', { hostDeviceId, tenantId, vms: vmsOut });
    } catch { /* socket not ready — clients fall back to polling */ }
  },

  /** VMs hosted on a single device. */
  async listForDevice(hostDeviceId: number): Promise<VirtualMachine[]> {
    const rows = await db('device_virtual_machines')
      .where({ host_device_id: hostDeviceId })
      .orderBy('name', 'asc');
    return rows.map(rowToVM);
  },

  /** Every VM in the tenant (master sees all), joined with the host name for
   *  the Dashboard grid. */
  async listForTenant(tenantId: number, hostDeviceIds?: number[]): Promise<VirtualMachine[]> {
    const isMaster = isMasterTenant(tenantId);
    const q = db('device_virtual_machines as vm')
      .leftJoin('devices as d', 'd.id', 'vm.host_device_id')
      .select('vm.*', db.raw('COALESCE(d.display_name, d.hostname) as host_name'), db.raw('d.tags as host_tags'))
      .orderBy('host_name', 'asc')
      .orderBy('vm.name', 'asc');
    if (!isMaster) q.where('vm.tenant_id', tenantId);
    // Non-admin callers pass the device-id allowlist they can see.
    if (hostDeviceIds) {
      if (hostDeviceIds.length === 0) return [];
      q.whereIn('vm.host_device_id', hostDeviceIds);
    }
    const rows = await q;
    return rows.map(rowToVM);
  },

  /** Single VM lookup scoped to a host + tenant (ownership check). */
  async getVM(hostDeviceId: number, vmId: string, tenantId: number): Promise<VirtualMachine | null> {
    const isMaster = isMasterTenant(tenantId);
    const q = db('device_virtual_machines').where({ host_device_id: hostDeviceId, vm_id: vmId });
    if (!isMaster) q.where({ tenant_id: tenantId });
    const row = await q.first();
    return row ? rowToVM(row) : null;
  },
};
