import apiClient from './client';
import type { CustomSection } from '@obliance/shared';

interface ApiResponse<T> { data?: T; error?: string; }

export const customSectionApi = {
  async list(): Promise<CustomSection[]> {
    const res = await apiClient.get<ApiResponse<CustomSection[]>>('/custom-sections');
    return res.data.data ?? [];
  },
  async create(data: Partial<CustomSection>): Promise<CustomSection> {
    const res = await apiClient.post<ApiResponse<CustomSection>>('/custom-sections', data);
    return res.data.data!;
  },
  async update(id: number, data: Partial<CustomSection>): Promise<CustomSection> {
    const res = await apiClient.patch<ApiResponse<CustomSection>>(`/custom-sections/${id}`, data);
    return res.data.data!;
  },
  async delete(id: number): Promise<void> {
    await apiClient.delete(`/custom-sections/${id}`);
  },
};
