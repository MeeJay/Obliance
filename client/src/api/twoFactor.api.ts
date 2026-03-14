import apiClient from './client';


interface ApiResponse<T = unknown> { data?: T; error?: string; }

export interface TwoFactorStatus {
  totpEnabled: boolean;
  emailOtpEnabled: boolean;
  email: string | null;
}

export interface TotpSetupData {
  secret: string;
  qrDataUrl: string;
}

export const twoFactorApi = {
  async getStatus(): Promise<TwoFactorStatus> {
    const res = await apiClient.get<ApiResponse<TwoFactorStatus>>('/profile/2fa/status');
    return res.data.data!;
  },

  async totpSetup(): Promise<TotpSetupData> {
    const res = await apiClient.post<ApiResponse<TotpSetupData>>('/profile/2fa/totp/setup');
    return res.data.data!;
  },

  async totpEnable(code: string): Promise<void> {
    await apiClient.post('/profile/2fa/totp/enable', { code });
  },

  async totpDisable(): Promise<void> {
    await apiClient.delete('/profile/2fa/totp');
  },

  async emailSetup(email: string): Promise<void> {
    await apiClient.post('/profile/2fa/email/setup', { email });
  },

  async emailEnable(code: string): Promise<void> {
    await apiClient.post('/profile/2fa/email/enable', { code });
  },

  async emailDisable(): Promise<void> {
    await apiClient.delete('/profile/2fa/email');
  },

  async verify(code: string, method: 'totp' | 'email'): Promise<{ user: unknown }> {
    const res = await apiClient.post<ApiResponse<{ user: unknown }>>('/profile/2fa/verify', { code, method });
    return res.data.data!;
  },

  async resendEmail(): Promise<void> {
    await apiClient.post('/profile/2fa/resend-email');
  },
};
