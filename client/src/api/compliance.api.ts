import apiClient from './client';
import type { CompliancePolicy, CompliancePreset, ComplianceResult } from '@obliance/shared';

interface ApiResponse<T> { data?: T; error?: string; }

export const complianceApi = {
  async listPolicies(): Promise<CompliancePolicy[]> {
    const res = await apiClient.get<ApiResponse<CompliancePolicy[]>>('/compliance/policies');
    return res.data.data ?? [];
  },
  async createPolicy(data: Omit<CompliancePolicy, 'id' | 'uuid' | 'createdAt' | 'updatedAt' | 'createdBy'>): Promise<CompliancePolicy> {
    const res = await apiClient.post<ApiResponse<CompliancePolicy>>('/compliance/policies', data);
    return res.data.data!;
  },
  async updatePolicy(id: number, data: Partial<CompliancePolicy>): Promise<CompliancePolicy> {
    const res = await apiClient.put<ApiResponse<CompliancePolicy>>(`/compliance/policies/${id}`, data);
    return res.data.data!;
  },
  async deletePolicy(id: number): Promise<void> {
    await apiClient.delete(`/compliance/policies/${id}`);
  },
  async listResults(params?: { deviceId?: number; policyId?: number; page?: number }): Promise<{ items: ComplianceResult[]; total: number }> {
    const res = await apiClient.get<ApiResponse<{ items: ComplianceResult[]; total: number }>>('/compliance/results', { params });
    return res.data.data ?? { items: [], total: 0 };
  },
  async triggerCheck(deviceId: number, policyId?: number): Promise<void> {
    await apiClient.post('/compliance/check', { deviceId, policyId });
  },
  async listPresets(): Promise<CompliancePreset[]> {
    const res = await apiClient.get<ApiResponse<CompliancePreset[]>>('/compliance/presets');
    return res.data.data ?? [];
  },
};
