import apiClient from './client';
import type {
  User,
  UserTeam,
  UserTenantAssignment,
  ApiResponse,
  CreateUserRequest,
  UpdateUserRequest,
} from '@obliance/shared';

/** 202 answer of a write gated at the 'restricted' level: the request waits
 *  for a second administrator (tenant.manage_users). */
export interface PendingApproval { approvalId: number; status: 'pending_approval' }

export function isPendingApproval(x: unknown): x is PendingApproval {
  return !!x && typeof x === 'object' && (x as { status?: unknown }).status === 'pending_approval';
}

function pendingOf(res: { status: number; data?: { data?: unknown } }): PendingApproval | null {
  return res.status === 202 && isPendingApproval(res.data?.data) ? res.data!.data as PendingApproval : null;
}

export const usersApi = {
  async list(): Promise<User[]> {
    const res = await apiClient.get<ApiResponse<User[]>>('/users');
    return res.data.data!;
  },

  async getById(id: number): Promise<User> {
    const res = await apiClient.get<ApiResponse<User>>(`/users/${id}`);
    return res.data.data!;
  },

  /** A PendingApproval when the creation waits for a second administrator. */
  async create(data: CreateUserRequest): Promise<User | PendingApproval> {
    const res = await apiClient.post<ApiResponse<User>>('/users', data);
    return pendingOf(res) ?? res.data.data!;
  },

  /** A PendingApproval when the change waits for a second administrator. */
  async update(id: number, data: UpdateUserRequest): Promise<User | PendingApproval> {
    const res = await apiClient.put<ApiResponse<User>>(`/users/${id}`, data);
    return pendingOf(res) ?? res.data.data!;
  },

  async changePassword(id: number, password: string): Promise<PendingApproval | null> {
    const res = await apiClient.put(`/users/${id}/password`, { password });
    return pendingOf(res);
  },

  async delete(id: number): Promise<PendingApproval | null> {
    const res = await apiClient.delete(`/users/${id}`);
    return pendingOf(res);
  },

  async getTeams(id: number): Promise<UserTeam[]> {
    const res = await apiClient.get<ApiResponse<UserTeam[]>>(`/users/${id}/teams`);
    return res.data.data!;
  },

  async getTenants(id: number): Promise<UserTenantAssignment[]> {
    const res = await apiClient.get<ApiResponse<UserTenantAssignment[]>>(`/users/${id}/tenants`);
    return res.data.data!;
  },

  /** role: 'admin' or a permission set slug ('user' by default). */
  async setTenants(
    id: number,
    assignments: { tenantId: number; role: string }[],
  ): Promise<PendingApproval | null> {
    const res = await apiClient.put(`/users/${id}/tenants`, { assignments });
    return pendingOf(res);
  },

  async resetMfa(id: number): Promise<PendingApproval | null> {
    const res = await apiClient.delete(`/users/${id}/2fa`);
    return pendingOf(res);
  },
};
