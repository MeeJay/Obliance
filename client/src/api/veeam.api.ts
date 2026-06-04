import apiClient from './client';
import type { BackupJob, BackupJobAction } from '@obliance/shared';

interface ApiResponse<T> { data?: T; error?: string }

export const veeamApi = {
  /** Backup jobs hosted on a single device (VBR host). */
  async listForDevice(deviceId: number): Promise<BackupJob[]> {
    const res = await apiClient.get<ApiResponse<BackupJob[]>>(`/veeam/devices/${deviceId}/jobs`);
    return res.data.data ?? [];
  },

  /** Tenant-wide job grid (Dashboard tab). */
  async listForTenant(): Promise<BackupJob[]> {
    const res = await apiClient.get<ApiResponse<BackupJob[]>>('/veeam/jobs');
    return res.data.data ?? [];
  },

  /** Ask the host agent to re-enumerate its jobs (durable, shows in history). */
  async refresh(deviceId: number): Promise<void> {
    await apiClient.post(`/veeam/devices/${deviceId}/refresh`);
  },

  /** Live heartbeat — ephemeral WS enumerate, no task-history row. Called on
   *  a short interval while a Backups view is open. */
  async live(deviceId: number): Promise<void> {
    await apiClient.post(`/veeam/devices/${deviceId}/live`);
  },

  /** Run an action on a job. Returns the response data — when the action is
   *  gated by the restriction matrix the server replies 202 with
   *  { status: 'pending_approval' } (axios treats it as success), and the
   *  2FA interceptor handles the 401 twoFactorRequired case transparently. */
  async action(deviceId: number, jobId: string, action: BackupJobAction): Promise<any> {
    const res = await apiClient.post<ApiResponse<any>>(
      `/veeam/devices/${deviceId}/jobs/${encodeURIComponent(jobId)}/action`,
      { action },
    );
    return res.data.data ?? res.data;
  },
};
