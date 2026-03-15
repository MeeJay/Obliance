import apiClient from './client';
import type { Command, CommandType, CommandPriority } from '@obliance/shared';

interface ApiResponse<T> { data?: T; error?: string; }

export const commandApi = {
  async list(deviceId?: number, params?: { status?: string; page?: number }): Promise<{ items: Command[]; total: number }> {
    const res = await apiClient.get<ApiResponse<{ items: Command[]; total: number }>>(`/commands`, { params: { ...(deviceId !== undefined && { deviceId }), ...params } });
    return res.data.data ?? { items: [], total: 0 };
  },
  async enqueue(deviceId: number, type: CommandType, payload?: Record<string, any>, priority?: CommandPriority): Promise<Command> {
    const res = await apiClient.post<ApiResponse<Command>>('/commands', { deviceId, type, payload: payload ?? {}, priority: priority ?? 'normal' });
    return res.data.data!;
  },
  async cancel(commandId: string): Promise<void> {
    await apiClient.delete(`/commands/${commandId}`);
  },
};
