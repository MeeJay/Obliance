import apiClient from './client';
import type { DeviceGroup, DeviceGroupTreeNode } from '@obliance/shared';

interface ApiResponse<T> { data?: T; error?: string; }

interface CreateGroupRequest {
  name: string;
  parentId?: number | null;
  description?: string | null;
  sortOrder?: number;
}

interface UpdateGroupRequest {
  name?: string;
  parentId?: number | null;
  description?: string | null;
  sortOrder?: number;
  groupNotifications?: boolean;
  groupConfig?: DeviceGroup['groupConfig'];
}

export const groupsApi = {
  async list(): Promise<DeviceGroup[]> {
    const res = await apiClient.get<ApiResponse<DeviceGroup[]>>('/groups');
    return res.data.data!;
  },

  async tree(): Promise<DeviceGroupTreeNode[]> {
    const res = await apiClient.get<ApiResponse<DeviceGroupTreeNode[]>>('/groups/tree');
    return res.data.data!;
  },

  async getById(id: number): Promise<DeviceGroup> {
    const res = await apiClient.get<ApiResponse<DeviceGroup>>(`/groups/${id}`);
    return res.data.data!;
  },

  async create(data: CreateGroupRequest): Promise<DeviceGroup> {
    const res = await apiClient.post<ApiResponse<DeviceGroup>>('/groups', data);
    return res.data.data!;
  },

  async update(id: number, data: UpdateGroupRequest): Promise<DeviceGroup> {
    const res = await apiClient.put<ApiResponse<DeviceGroup>>(`/groups/${id}`, data);
    return res.data.data!;
  },

  async move(id: number, newParentId: number | null): Promise<DeviceGroup> {
    const res = await apiClient.post<ApiResponse<DeviceGroup>>(`/groups/${id}/move`, { newParentId });
    return res.data.data!;
  },

  async delete(id: number): Promise<void> {
    await apiClient.delete(`/groups/${id}`);
  },

  async reorder(items: { id: number; sortOrder: number }[]): Promise<void> {
    await apiClient.post('/groups/reorder', { items });
  },
};
