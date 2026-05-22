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

  /** Ask the host agent to re-enumerate its VMs. */
  async refresh(deviceId: number): Promise<void> {
    await apiClient.post(`/hyperv/devices/${deviceId}/refresh`);
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
