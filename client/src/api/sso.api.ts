import apiClient from './client';
import type { User, ApiResponse } from '@obliance/shared';

export const ssoApi = {
  async generateSwitchToken(): Promise<string> {
    const res = await apiClient.post<ApiResponse<{ token: string }>>('/sso/generate-token');
    return res.data.data!.token;
  },

  async exchange(
    token: string,
    from: string,
  ): Promise<
    | { user: User; isFirstLogin: boolean }
    | { needsLinking: true; linkToken: string; conflictingUsername: string }
  > {
    const res = await apiClient.post<ApiResponse<
      | { user: User; isFirstLogin: boolean }
      | { needsLinking: true; linkToken: string; conflictingUsername: string }
    >>('/sso/exchange', { token, from });
    return res.data.data!;
  },

  async completeLink(
    linkToken: string,
    password: string,
  ): Promise<
    | { user: User; isFirstLogin: boolean }
    | { requires2fa: true; methods: { totp: boolean; email: boolean } }
  > {
    const res = await apiClient.post<ApiResponse<
      | { user: User; isFirstLogin: boolean }
      | { requires2fa: true; methods: { totp: boolean; email: boolean } }
    >>('/sso/complete-link', { linkToken, password });
    return res.data.data!;
  },

  async verifyLink2fa(
    code: string,
    method: 'totp' | 'email',
  ): Promise<{ user: User; isFirstLogin: boolean }> {
    const res = await apiClient.post<ApiResponse<{ user: User; isFirstLogin: boolean }>>(
      '/sso/verify-link-2fa',
      { code, method },
    );
    return res.data.data!;
  },

  async resendLink2faEmail(): Promise<void> {
    await apiClient.post('/sso/verify-link-2fa', { resend: true });
  },

  async setLocalPassword(password: string): Promise<void> {
    await apiClient.post('/sso/set-password', { password });
  },
};
