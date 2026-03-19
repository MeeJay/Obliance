import apiClient from './client';
import type { RemoteSession, RemoteProtocol } from '@obliance/shared';

interface ApiResponse<T> { data?: T; error?: string; }

export const remoteApi = {
  async listSessions(params?: { deviceId?: number; status?: string; page?: number }): Promise<{ items: RemoteSession[]; total: number }> {
    const res = await apiClient.get<ApiResponse<{ items: RemoteSession[]; total: number }>>('/remote/sessions', { params });
    return res.data.data ?? { items: [], total: 0 };
  },
  async startSession(deviceId: number, protocol: RemoteProtocol, notes?: string, sessionId?: number): Promise<RemoteSession> {
    const res = await apiClient.post<ApiResponse<RemoteSession>>('/remote/sessions', {
      deviceId, protocol, notes,
      ...(sessionId !== undefined ? { sessionId } : {}),
    });
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
  /** Return the set of device UUIDs that have the Oblireach agent installed. */
  async listObliReachDeviceUuids(): Promise<Set<string>> {
    try {
      const res = await apiClient.get<ApiResponse<{ items: Array<{ device_uuid: string }> }>>('/oblireach/devices');
      const items = res.data.data?.items ?? [];
      return new Set(items.map((d) => d.device_uuid));
    } catch {
      return new Set();
    }
  },

  /** Return the last-known WTS session list for an Oblireach device. */
  async getObliReachSessions(deviceUuid: string): Promise<ObliReachSession[]> {
    try {
      const res = await apiClient.get<ApiResponse<{ sessions: ObliReachSession[] }>>(
        `/oblireach/devices/${deviceUuid}/sessions`,
      );
      return res.data.data?.sessions ?? [];
    } catch {
      return [];
    }
  },
};

export interface ObliReachSession {
  id: number;
  username: string;
  state: string;
  stationName?: string;
  isConsole: boolean;
}
