import apiClient from './client';
import type { VirtualMachine, VmAction } from '@obliance/shared';

interface ApiResponse<T> { data?: T; error?: string }

export const hypervApi = {
  /** VMs hosted on a single device. */
  async listForDevice(deviceId: number): Promise<VirtualMachine[]> {
    const res = await apiClient.get<ApiResponse<VirtualMachine[]>>(`/hyperv/devices/${deviceId}/vms`);
    return res.data.data ?? [];
  },

  /** Tenant-wide VM grid (Dashboard tab). */
  async listForTenant(): Promise<VirtualMachine[]> {
    const res = await apiClient.get<ApiResponse<VirtualMachine[]>>('/hyperv/vms');
    return res.data.data ?? [];
  },

  /** Ask the host agent to re-enumerate its VMs (durable, shows in history). */
  async refresh(deviceId: number): Promise<void> {
    await apiClient.post(`/hyperv/devices/${deviceId}/refresh`);
  },

  /** Pre-download the interactive VM-console helper onto the host (~130 MB). */
  async installConsole(deviceId: number): Promise<{ delivered: boolean }> {
    const res = await apiClient.post<{ data?: { delivered: boolean } }>(`/hyperv/devices/${deviceId}/install-console`);
    return res.data.data ?? { delivered: false };
  },

  /** Live heartbeat — ephemeral WS enumerate, no task-history row. Called on
   *  a short interval while a Hyper-V view is open. */
  async live(deviceId: number): Promise<void> {
    await apiClient.post(`/hyperv/devices/${deviceId}/live`);
  },

  /** Request a fresh console thumbnail (read-only preview, layer A). The
   *  frame arrives via the HYPERV_THUMBNAIL socket event; a cached frame (if
   *  any) is returned synchronously for an immediate first paint. */
  async requestThumbnail(deviceId: number, vmId: string, width = 640, height = 480): Promise<{ delivered: boolean; cached: { pngBase64: string; width: number; height: number } | null }> {
    const res = await apiClient.post<{ data?: { delivered: boolean; cached: any } }>(
      `/hyperv/devices/${deviceId}/vms/${encodeURIComponent(vmId)}/thumbnail`,
      { width, height },
    );
    return res.data.data ?? { delivered: false, cached: null };
  },

  /** Run an action on a VM. Returns the response data — when the action is
   *  gated by the restriction matrix the server replies 202 with
   *  { status: 'pending_approval' } (axios treats it as success), and the
   *  2FA interceptor handles the 401 twoFactorRequired case transparently. */
  async action(deviceId: number, vmId: string, action: VmAction, params?: Record<string, unknown>): Promise<any> {
    const res = await apiClient.post<ApiResponse<any>>(
      `/hyperv/devices/${deviceId}/vms/${encodeURIComponent(vmId)}/action`,
      { action, params },
    );
    return res.data.data ?? res.data;
  },
};
