import { db } from '../db';
import { isMasterTenant } from '@obliance/shared';
import type { BackupJob, BackupJobState, BackupJobResult, BackupHostType } from '@obliance/shared';

// Veeam Backup & Replication service. Stores the job inventory reported by VBR
// host agents and reads it back for the device-detail Backups tab + the
// tenant-wide dashboard grid.
//
// The agent posts the FULL job list for a host on each refresh; we reconcile
// with delete-missing + upsert so jobs removed on the host disappear here too.

const VALID_STATES: BackupJobState[] = ['running', 'idle', 'transitioning', 'disabled', 'unknown'];
const VALID_RESULTS: BackupJobResult[] = ['success', 'warning', 'failed', 'none'];

interface IncomingJob {
  jobId: string;
  name: string;
  jobType?: string | null;
  state?: string;
  rawState?: string | null;
  lastResult?: string;
  scheduleEnabled?: boolean;
  lastRunStart?: string | null;
  lastRunEnd?: string | null;
  nextRun?: string | null;
  progressPercent?: number | null;
  processedBytes?: number | null;
  transferredBytes?: number | null;
  durationSeconds?: number | null;
  repository?: string | null;
  description?: string | null;
}

function parseDate(v: unknown): Date | null {
  if (!v || typeof v !== 'string') return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function rowToJob(row: any): BackupJob {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    hostDeviceId: row.host_device_id,
    hostType: row.host_type,
    jobId: row.job_id,
    name: row.name,
    jobType: row.job_type ?? null,
    state: row.state,
    rawState: row.raw_state ?? null,
    lastResult: row.last_result,
    scheduleEnabled: !!row.schedule_enabled,
    lastRunStart: row.last_run_start ? new Date(row.last_run_start).toISOString() : null,
    lastRunEnd: row.last_run_end ? new Date(row.last_run_end).toISOString() : null,
    nextRun: row.next_run ? new Date(row.next_run).toISOString() : null,
    progressPercent: row.progress_percent ?? null,
    processedBytes: row.processed_bytes != null ? Number(row.processed_bytes) : null,
    transferredBytes: row.transferred_bytes != null ? Number(row.transferred_bytes) : null,
    durationSeconds: row.duration_seconds != null ? Number(row.duration_seconds) : null,
    repository: row.repository ?? null,
    description: row.description ?? null,
    updatedAt: row.updated_at,
    hostName: row.host_name ?? undefined,
    hostTags: row.host_tags != null
      ? (typeof row.host_tags === 'string' ? safeJsonArr(row.host_tags) : row.host_tags)
      : undefined,
  };
}

function safeJsonArr(s: string): string[] { try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; } }

export const veeamService = {
  /** Replace the job set for a host with the agent's freshly-reported list. */
  async ingestJobs(hostDeviceId: number, tenantId: number, hostType: BackupHostType, jobs: IncomingJob[]): Promise<void> {
    const keepIds = jobs.map((j) => j.jobId).filter(Boolean);
    await db.transaction(async (trx) => {
      // Drop jobs that no longer exist on the host.
      const del = trx('device_backup_jobs').where({ host_device_id: hostDeviceId });
      if (keepIds.length > 0) del.whereNotIn('job_id', keepIds);
      await del.delete();

      for (const j of jobs) {
        if (!j.jobId || !j.name) continue;
        const state: BackupJobState = VALID_STATES.includes(j.state as BackupJobState) ? (j.state as BackupJobState) : 'unknown';
        const lastResult: BackupJobResult = VALID_RESULTS.includes(j.lastResult as BackupJobResult) ? (j.lastResult as BackupJobResult) : 'none';
        const payload = {
          tenant_id: tenantId,
          host_device_id: hostDeviceId,
          host_type: hostType,
          job_id: j.jobId,
          name: j.name,
          job_type: j.jobType ?? null,
          state,
          raw_state: j.rawState ?? null,
          last_result: lastResult,
          schedule_enabled: j.scheduleEnabled ?? true,
          last_run_start: parseDate(j.lastRunStart),
          last_run_end: parseDate(j.lastRunEnd),
          next_run: parseDate(j.nextRun),
          progress_percent: j.progressPercent ?? null,
          processed_bytes: j.processedBytes ?? null,
          transferred_bytes: j.transferredBytes ?? null,
          duration_seconds: j.durationSeconds ?? null,
          repository: j.repository ?? null,
          description: j.description ?? null,
          updated_at: new Date(),
        };
        await trx('device_backup_jobs')
          .insert(payload)
          .onConflict(['host_device_id', 'job_id'])
          .merge();
      }
    });

    // Push the fresh list to any open Backups views (device-detail tab +
    // dashboard tenant grid) so they update live without polling.
    try {
      const { getIO } = await import('../socket');
      const jobsOut = await this.listForDevice(hostDeviceId);
      getIO().to(`tenant:${tenantId}`).emit('VEEAM_JOBS_UPDATED', { hostDeviceId, tenantId, jobs: jobsOut });
    } catch { /* socket not ready — clients fall back to polling */ }
  },

  /** Jobs hosted on a single device. */
  async listForDevice(hostDeviceId: number): Promise<BackupJob[]> {
    const rows = await db('device_backup_jobs')
      .where({ host_device_id: hostDeviceId })
      .orderBy('name', 'asc');
    return rows.map(rowToJob);
  },

  /** Every job in the tenant (master sees all), joined with the host name for
   *  the Dashboard grid. */
  async listForTenant(tenantId: number, hostDeviceIds?: number[]): Promise<BackupJob[]> {
    const isMaster = isMasterTenant(tenantId);
    const q = db('device_backup_jobs as bj')
      .leftJoin('devices as d', 'd.id', 'bj.host_device_id')
      .select('bj.*', db.raw('COALESCE(d.display_name, d.hostname) as host_name'), db.raw('d.tags as host_tags'))
      .orderBy('host_name', 'asc')
      .orderBy('bj.name', 'asc');
    if (!isMaster) q.where('bj.tenant_id', tenantId);
    // Non-admin callers pass the device-id allowlist they can see.
    if (hostDeviceIds) {
      if (hostDeviceIds.length === 0) return [];
      q.whereIn('bj.host_device_id', hostDeviceIds);
    }
    const rows = await q;
    return rows.map(rowToJob);
  },

  /** Single job lookup scoped to a host + tenant (ownership check). */
  async getJob(hostDeviceId: number, jobId: string, tenantId: number): Promise<BackupJob | null> {
    const isMaster = isMasterTenant(tenantId);
    const q = db('device_backup_jobs').where({ host_device_id: hostDeviceId, job_id: jobId });
    if (!isMaster) q.where({ tenant_id: tenantId });
    const row = await q.first();
    return row ? rowToJob(row) : null;
  },
};
