import apiClient from './client';
import type { User, UserPermissions, LoginRequest } from '@obliance/shared';

interface ApiResponse<T = unknown> { data?: T; error?: string; }

export type LoginResult =
  | { user: User; requires2fa?: never }
  | { requires2fa: true; methods: { totp: boolean; email: boolean }; user?: never };

export const authApi = {
  async login(data: LoginRequest): Promise<LoginResult> {
    const res = await apiClient.post<ApiResponse<LoginResult>>('/auth/login', data);
    return res.data.data!;
  },

  async logout(): Promise<void> {
    await apiClient.post('/auth/logout');
  },

  async me(): Promise<{ user: User; permissions: UserPermissions; requires2faSetup: boolean; currentTenantId?: number }> {
    const res = await apiClient.get<ApiResponse<{ user: User; permissions: UserPermissions; requires2faSetup: boolean; currentTenantId?: number }>>('/auth/me');
    return res.data.data!;
  },

  async getPermissions(): Promise<UserPermissions> {
    const res = await apiClient.get<ApiResponse<UserPermissions>>('/auth/permissions');
    return res.data.data!;
  },
};
