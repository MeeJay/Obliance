import apiClient from './client';
import type { Report, ReportOutput } from '@obliance/shared';

interface ApiResponse<T> { data?: T; error?: string; }

export const reportApi = {
  async list(): Promise<Report[]> {
    const res = await apiClient.get<ApiResponse<Report[]>>('/reports');
    return res.data.data ?? [];
  },
  async getById(id: number): Promise<Report> {
    const res = await apiClient.get<ApiResponse<Report>>(`/reports/${id}`);
    return res.data.data!;
  },
  async create(data: Omit<Report, 'id' | 'createdAt' | 'updatedAt' | 'lastGeneratedAt' | 'createdBy'>): Promise<Report> {
    const res = await apiClient.post<ApiResponse<Report>>('/reports', data);
    return res.data.data!;
  },
  async update(id: number, data: Partial<Report>): Promise<Report> {
    const res = await apiClient.patch<ApiResponse<Report>>(`/reports/${id}`, data);
    return res.data.data!;
  },
  async delete(id: number): Promise<void> {
    await apiClient.delete(`/reports/${id}`);
  },
  async generate(id: number): Promise<ReportOutput> {
    const res = await apiClient.post<ApiResponse<ReportOutput>>(`/reports/${id}/generate`);
    return res.data.data!;
  },
  async listOutputs(id: number): Promise<ReportOutput[]> {
    const res = await apiClient.get<ApiResponse<ReportOutput[]>>(`/reports/${id}/outputs`);
    return res.data.data ?? [];
  },
  getDownloadUrl(outputId: number): string {
    return `/api/reports/outputs/${outputId}/download`;
  },
};
