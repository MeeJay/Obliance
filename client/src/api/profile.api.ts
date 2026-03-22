import apiClient from './client';
import type { User, UserPreferences } from '@obliance/shared';

export const profileApi = {
  async get(): Promise<User> {
    const res = await apiClient.get('/profile');
    return res.data.data;
  },

  async update(data: { displayName?: string | null; email?: string | null; preferredLanguage?: string; preferences?: UserPreferences | null }): Promise<User> {
    const res = await apiClient.put('/profile', data);
    return res.data.data;
  },

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await apiClient.put('/profile/password', { currentPassword, newPassword });
  },

  async uploadAvatar(avatar: string): Promise<string> {
    const res = await apiClient.put('/profile/avatar', { avatar });
    return res.data.avatar;
  },

  async deleteAvatar(): Promise<void> {
    await apiClient.delete('/profile/avatar');
  },
};
