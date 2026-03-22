import apiClient from './client';
import type { QuickReplyTemplate } from '@obliance/shared';

export const quickReplyTemplatesApi = {
  list: async (): Promise<QuickReplyTemplate[]> => {
    const { data } = await apiClient.get('/quick-reply-templates');
    return data.data;
  },
  create: async (translations: Record<string, string>): Promise<QuickReplyTemplate> => {
    const { data } = await apiClient.post('/quick-reply-templates', { translations });
    return data.data;
  },
  update: async (id: number, body: { translations?: Record<string, string>; sortOrder?: number }): Promise<QuickReplyTemplate> => {
    const { data } = await apiClient.put(`/quick-reply-templates/${id}`, body);
    return data.data;
  },
  remove: async (id: number): Promise<void> => {
    await apiClient.delete(`/quick-reply-templates/${id}`);
  },
  reorder: async (ids: number[]): Promise<void> => {
    await apiClient.put('/quick-reply-templates/reorder', { ids });
  },
};
