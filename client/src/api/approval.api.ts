import { apiClient } from './client';
import type { ApiResponse } from './client';

export interface PendingApproval {
  id: number;
  tenantId: number;
  requestedBy: number;
  requestedByName: string | null;
  requestType: 'batch_command' | 'device_uninstall';
  description: string;
  payload: Record<string, any>;
  status: 'pending' | 'approved' | 'denied' | 'executed' | 'expired' | 'cancelled';
  reviewedBy: number | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviewReason: string | null;
  createdAt: string;
  expiresAt: string;
  executedAt: string | null;
}

export const approvalApi = {
  async list(includeResolved = false): Promise<PendingApproval[]> {
    const res = await apiClient.get<ApiResponse<PendingApproval[]>>('/approvals', {
      params: { includeResolved },
    });
    return res.data.data ?? [];
  },
  async approve(id: number, reason?: string): Promise<PendingApproval> {
    const res = await apiClient.post<ApiResponse<PendingApproval>>(`/approvals/${id}/approve`, { reason });
    return res.data.data!;
  },
  async deny(id: number, reason?: string): Promise<PendingApproval> {
    const res = await apiClient.post<ApiResponse<PendingApproval>>(`/approvals/${id}/deny`, { reason });
    return res.data.data!;
  },
  async cancel(id: number): Promise<PendingApproval> {
    const res = await apiClient.post<ApiResponse<PendingApproval>>(`/approvals/${id}/cancel`);
    return res.data.data!;
  },
};
