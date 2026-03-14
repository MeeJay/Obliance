import apiClient from './client';
import type { SmtpServer } from '@obliance/shared';

interface ApiResponse<T = unknown> { data?: T; error?: string; }

export interface CreateSmtpServerRequest {
  name: string;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  fromAddress: string;
}

export interface UpdateSmtpServerRequest {
  name?: string;
  host?: string;
  port?: number;
  secure?: boolean;
  username?: string;
  password?: string;
  fromAddress?: string;
}

export const smtpServerApi = {
  async list(): Promise<SmtpServer[]> {
    const res = await apiClient.get<ApiResponse<SmtpServer[]>>('/admin/smtp-servers');
    return res.data.data!;
  },

  async create(data: CreateSmtpServerRequest): Promise<SmtpServer> {
    const res = await apiClient.post<ApiResponse<SmtpServer>>('/admin/smtp-servers', data);
    return res.data.data!;
  },

  async update(id: number, data: UpdateSmtpServerRequest): Promise<SmtpServer> {
    const res = await apiClient.put<ApiResponse<SmtpServer>>(`/admin/smtp-servers/${id}`, data);
    return res.data.data!;
  },

  async delete(id: number): Promise<void> {
    await apiClient.delete(`/admin/smtp-servers/${id}`);
  },

  async test(id: number): Promise<void> {
    await apiClient.post(`/admin/smtp-servers/${id}/test`);
  },
};
