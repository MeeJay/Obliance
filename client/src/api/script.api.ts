import apiClient from './client';
import type { Script, ScriptCategory, ScriptSchedule, ScriptExecution, ExecutionBatch } from '@obliance/shared';

interface ApiResponse<T> { data?: T; error?: string; }

type NewScheduleInput = Omit<ScriptSchedule, 'id' | 'uuid' | 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy' | 'lastRunAt' | 'nextRunAt' | 'script'>;

/** Returned by POST /schedules when the privacy-mode bypass awaits approval. */
export interface ScheduleBypassApproval {
  approvalId: number | string | null;
  status: 'pending_approval';
}

async function postSchedule(data: NewScheduleInput): Promise<{ schedule: ScriptSchedule; bypassPrivacyApproval?: ScheduleBypassApproval }> {
  const res = await apiClient.post<ApiResponse<ScriptSchedule> & { bypassPrivacyApproval?: ScheduleBypassApproval }>('/schedules', data);
  return { schedule: res.data.data!, bypassPrivacyApproval: res.data.bypassPrivacyApproval };
}

export const scriptApi = {
  // Categories
  async listCategories(): Promise<ScriptCategory[]> {
    const res = await apiClient.get<ApiResponse<ScriptCategory[]>>('/scripts/categories');
    return res.data.data ?? [];
  },
  async createCategory(name: string): Promise<ScriptCategory> {
    const res = await apiClient.post<ApiResponse<ScriptCategory>>('/scripts/categories', { name });
    return res.data.data!;
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
  async clone(id: number): Promise<Script> {
    const res = await apiClient.post<ApiResponse<Script>>(`/scripts/${id}/clone`);
    return res.data.data!;
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
  async createSchedule(data: NewScheduleInput): Promise<ScriptSchedule> {
    return (await postSchedule(data)).schedule;
  },
  /**
   * Same as createSchedule, plus the server's `bypassPrivacyApproval` when a
   * requested privacy-mode bypass was held for admin approval (restricted
   * tenant): the schedule is then created WITHOUT the bypass.
   */
  async createScheduleWithApproval(data: NewScheduleInput): Promise<{ schedule: ScriptSchedule; bypassPrivacyApproval?: ScheduleBypassApproval }> {
    return postSchedule(data);
  },
  async updateSchedule(id: number, data: Partial<ScriptSchedule>): Promise<ScriptSchedule> {
    const res = await apiClient.patch<ApiResponse<ScriptSchedule>>(`/schedules/${id}`, data);
    return res.data.data!;
  },
  async getScheduleHistory(id: number, limit = 10): Promise<Array<{
    batchId: string;
    triggeredAt: string;
    triggeredBy: string | null;
    total: number;
    ok: number;
    fail: number;
    pending: number;
    items: Array<{
      id: string;
      status: string;
      exitCode: number | null;
      stdout: string | null;
      stderr: string | null;
      triggeredAt: string;
      startedAt: string | null;
      finishedAt: string | null;
      deviceId: number;
      deviceName: string;
      deviceOsType: string | null;
    }>;
  }>> {
    const res = await apiClient.get<ApiResponse<any[]>>(`/schedules/${id}/history`, { params: { limit } });
    return res.data.data ?? [];
  },
  async deleteSchedule(id: number): Promise<void> {
    await apiClient.delete(`/schedules/${id}`);
  },
  async listSchedulesForDevice(deviceId: number): Promise<ScriptSchedule[]> {
    const res = await apiClient.get<ApiResponse<ScriptSchedule[]>>(`/schedules/for-device/${deviceId}`);
    return res.data.data ?? [];
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
  async stopExecution(id: string): Promise<void> {
    await apiClient.post(`/executions/${id}/stop`);
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
