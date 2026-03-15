import apiClient from './client';
import type { RemoteSession, RemoteProtocol } from '@obliance/shared';

interface ApiResponse<T> { data?: T; error?: string; }

export const remoteApi = {
  async listSessions(params?: { deviceId?: number; status?: string; page?: number }): Promise<{ items: RemoteSession[]; total: number }> {
    const res = await apiClient.get<ApiResponse<{ items: RemoteSession[]; total: number }>>('/remote/sessions', { params });
    return res.data.data ?? { items: [], total: 0 };
  },
  async startSession(deviceId: number, protocol: RemoteProtocol, notes?: string): Promise<RemoteSession> {
    const res = await apiClient.post<ApiResponse<RemoteSession>>('/remote/sessions', { deviceId, protocol, notes });
    return res.data.data!;
  },
  async endSession(sessionId: string): Promise<void> {
    await apiClient.post(`/remote/sessions/${sessionId}/end`);
  },
  /** Build the browser-side WebSocket URL for a VNC tunnel session. */
  getTunnelWsUrl(sessionToken: string): string {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/api/remote/tunnel/${sessionToken}`;
  },
};
