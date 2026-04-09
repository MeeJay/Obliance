import apiClient from './client';
import type { Scenario, ScenarioRun } from '@obliance/shared';

interface ApiResponse<T> { data?: T; error?: string; }

export const scenarioApi = {
  async list(params?: Record<string, string>): Promise<Scenario[]> {
    const res = await apiClient.get<ApiResponse<Scenario[]>>('/scenarios', { params });
    return res.data.data ?? [];
  },
  async getById(id: number): Promise<Scenario> {
    const res = await apiClient.get<ApiResponse<Scenario>>(`/scenarios/${id}`);
    return res.data.data!;
  },
  async create(data: any): Promise<Scenario> {
    const res = await apiClient.post<ApiResponse<Scenario>>('/scenarios', data);
    return res.data.data!;
  },
  async update(id: number, data: any): Promise<Scenario> {
    const res = await apiClient.put<ApiResponse<Scenario>>(`/scenarios/${id}`, data);
    return res.data.data!;
  },
  async delete(id: number): Promise<void> {
    await apiClient.delete(`/scenarios/${id}`);
  },
  async enable(id: number): Promise<void> {
    await apiClient.post(`/scenarios/${id}/enable`);
  },
  async disable(id: number): Promise<void> {
    await apiClient.post(`/scenarios/${id}/disable`);
  },
  async trigger(id: number, deviceIds: number[]): Promise<ScenarioRun[]> {
    const res = await apiClient.post<ApiResponse<ScenarioRun[]>>(`/scenarios/${id}/trigger`, { deviceIds });
    return res.data.data ?? [];
  },
  async listRuns(params?: Record<string, any>): Promise<ScenarioRun[]> {
    const res = await apiClient.get<ApiResponse<ScenarioRun[]>>('/scenarios/runs', { params });
    return res.data.data ?? [];
  },
  async getRun(runId: string): Promise<ScenarioRun> {
    const res = await apiClient.get<ApiResponse<ScenarioRun>>(`/scenarios/runs/${runId}`);
    return res.data.data!;
  },
  async cancelRun(runId: string): Promise<void> {
    await apiClient.post(`/scenarios/runs/${runId}/cancel`);
  },
  async listTemplates(): Promise<any[]> {
    const res = await apiClient.get<ApiResponse<any[]>>('/scenarios/templates');
    return res.data.data ?? [];
  },
  async instantiateTemplate(index: number, data: { name?: string; variables?: Record<string, string> }): Promise<Scenario> {
    const res = await apiClient.post<ApiResponse<Scenario>>(`/scenarios/templates/${index}/instantiate`, data);
    return res.data.data!;
  },
  async listForDevice(deviceId: number): Promise<Scenario[]> {
    const res = await apiClient.get<ApiResponse<Scenario[]>>(`/scenarios/for-device/${deviceId}`);
    return res.data.data ?? [];
  },
  async listRunsForDevice(deviceId: number): Promise<ScenarioRun[]> {
    const res = await apiClient.get<ApiResponse<ScenarioRun[]>>(`/scenarios/for-device/${deviceId}/runs`);
    return res.data.data ?? [];
  },
};
