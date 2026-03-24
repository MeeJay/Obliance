import apiClient from './client';
import type { Script, ScriptCategory, ScriptSchedule, ScriptExecution, ExecutionBatch } from '@obliance/shared';

interface ApiResponse<T> { data?: T; error?: string; }

export const scriptApi = {
  // Categories
  async listCategories(): Promise<ScriptCategory[]> {
    const res = await apiClient.get<ApiResponse<ScriptCategory[]>>('/scripts/categories');
    return res.data.data ?? [];
  },

  // Scripts
  async list(params?: { categoryId?: number; platform?: string; search?: string }): Promise<Script[]> {
    const res = await apiClient.get<ApiResponse<Script[]>>('/scripts', { params });
    return res.data.data ?? [];
  },
  async getById(id: number): Promise<Script> {
    const res = await apiClient.get<ApiResponse<Script>>(`/scripts/${id}`);
    return res.data.data!;
  },
  async create(data: Omit<Script, 'id' | 'uuid' | 'createdAt' | 'updatedAt' | 'isBuiltin' | 'createdBy' | 'updatedBy' | 'parameters' | 'category'> & { parameters?: Omit<import('@obliance/shared').ScriptParameter, 'id' | 'scriptId'>[] }): Promise<Script> {
    const res = await apiClient.post<ApiResponse<Script>>('/scripts', data);
    return res.data.data!;
  },
  async update(id: number, data: Partial<Script & { parameters?: any[] }>): Promise<Script> {
    const res = await apiClient.patch<ApiResponse<Script>>(`/scripts/${id}`, data);
    return res.data.data!;
  },
  async delete(id: number): Promise<void> {
    await apiClient.delete(`/scripts/${id}`);
  },
  async executeNow(scriptId: number, opts: { deviceIds?: number[]; targetType?: string; targetIds?: number[]; parameterValues?: Record<string, any> }): Promise<ScriptExecution[]> {
    const res = await apiClient.post<ApiResponse<ScriptExecution[]>>(`/scripts/${scriptId}/execute`, opts);
    return res.data.data ?? [];
  },

  // Schedules
  async listSchedules(params?: { scriptId?: number; enabled?: boolean }): Promise<ScriptSchedule[]> {
    const res = await apiClient.get<ApiResponse<ScriptSchedule[]>>('/schedules', { params });
    return res.data.data ?? [];
  },
  async getSchedule(id: number): Promise<ScriptSchedule> {
    const res = await apiClient.get<ApiResponse<ScriptSchedule>>(`/schedules/${id}`);
    return res.data.data!;
  },
  async createSchedule(data: Omit<ScriptSchedule, 'id' | 'uuid' | 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy' | 'lastRunAt' | 'nextRunAt' | 'script'>): Promise<ScriptSchedule> {
    const res = await apiClient.post<ApiResponse<ScriptSchedule>>('/schedules', data);
    return res.data.data!;
  },
  async updateSchedule(id: number, data: Partial<ScriptSchedule>): Promise<ScriptSchedule> {
    const res = await apiClient.patch<ApiResponse<ScriptSchedule>>(`/schedules/${id}`, data);
    return res.data.data!;
  },
  async deleteSchedule(id: number): Promise<void> {
    await apiClient.delete(`/schedules/${id}`);
  },

  // Executions
  async listExecutions(params?: { deviceId?: number; scriptId?: number; scheduleId?: number; status?: string; page?: number; pageSize?: number }): Promise<{ items: ScriptExecution[]; total: number }> {
    const res = await apiClient.get<ApiResponse<{ items: ScriptExecution[]; total: number }>>('/executions', { params });
    return res.data.data ?? { items: [], total: 0 };
  },
  async getExecution(id: string): Promise<ScriptExecution> {
    const res = await apiClient.get<ApiResponse<ScriptExecution>>(`/executions/${id}`);
    return res.data.data!;
  },

  // Batches (History tab)
  async listBatches(params?: { page?: number; pageSize?: number }): Promise<{ items: ExecutionBatch[]; total: number }> {
    const res = await apiClient.get<ApiResponse<{ items: ExecutionBatch[]; total: number }>>('/executions/batches', { params });
    return res.data.data ?? { items: [], total: 0 };
  },
  async getBatchDetail(batchId: string): Promise<Array<{ id: string; deviceId: number; hostname: string; osType: string; status: string; exitCode: number | null; stdout: string | null; stderr: string | null; triggeredAt: string; startedAt: string | null; finishedAt: string | null }>> {
    const res = await apiClient.get<ApiResponse<any[]>>(`/executions/batches/${batchId}`);
    return res.data.data ?? [];
  },
};
