import apiClient from './client';
import type { Command } from '@obliance/shared';

interface ApiResponse<T> { data?: T; error?: string; }

export const fileApi = {
  async listDirectory(deviceId: number, path: string): Promise<Command> {
    const res = await apiClient.post<ApiResponse<Command>>(`/files/${deviceId}/files/list`, { path });
    return res.data.data!;
  },
  async createDirectory(deviceId: number, path: string): Promise<Command> {
    const res = await apiClient.post<ApiResponse<Command>>(`/files/${deviceId}/files/create-directory`, { path });
    return res.data.data!;
  },
  async renameFile(deviceId: number, oldPath: string, newPath: string): Promise<Command> {
    const res = await apiClient.post<ApiResponse<Command>>(`/files/${deviceId}/files/rename`, { oldPath, newPath });
    return res.data.data!;
  },
  async deleteFile(deviceId: number, path: string, recursive: boolean): Promise<Command> {
    const res = await apiClient.post<ApiResponse<Command>>(`/files/${deviceId}/files/delete`, { path, recursive });
    return res.data.data!;
  },
  async downloadFile(deviceId: number, path: string): Promise<Command> {
    const res = await apiClient.post<ApiResponse<Command>>(`/files/${deviceId}/files/download`, { path });
    return res.data.data!;
  },
  async uploadFile(deviceId: number, path: string, data: string, overwrite = false): Promise<Command> {
    const res = await apiClient.post<ApiResponse<Command>>(`/files/${deviceId}/files/upload`, { path, data, overwrite });
    return res.data.data!;
  },
  async logOpen(deviceId: number): Promise<void> {
    await apiClient.post(`/files/${deviceId}/files/open-explorer`);
  },
  async getAuditLog(deviceId: number): Promise<any[]> {
    const res = await apiClient.get<ApiResponse<any[]>>(`/files/${deviceId}/files/audit-log`);
    return res.data.data ?? [];
  },
};
