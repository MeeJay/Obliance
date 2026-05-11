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
  /** Build the browser-side WebSocket URL for a remote tunnel session. */
  getTunnelWsUrl(sessionToken: string): string {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/api/remote/tunnel/${sessionToken}`;
  },
  /** Return the set of device UUIDs where the Oblireach agent is currently online. */
  async listObliReachDeviceUuids(): Promise<Set<string>> {
    try {
      const res = await apiClient.get<ApiResponse<{ items: Array<{ device_uuid: string; is_online: boolean }> }>>('/oblireach/devices');
      const items = res.data.data?.items ?? [];
      // Only count devices that have pushed recently (is_online = true).
      return new Set(items.filter((d) => d.is_online).map((d) => d.device_uuid));
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

  /** Return the device record for a specific Oblireach device (includes version, os, arch). */
  async getObliReachDevice(deviceUuid: string): Promise<ObliReachDevice | null> {
    try {
      const res = await apiClient.get<ApiResponse<{ device: ObliReachDevice }>>(
        `/oblireach/devices/${deviceUuid}`,
      );
      return res.data.data?.device ?? null;
    } catch {
      return null;
    }
  },

  /** Return the latest available Oblireach agent version from the server build artefact. */
  async getObliReachLatestVersion(): Promise<string | null> {
    try {
      const res = await apiClient.get<ApiResponse<{ version: string | null }>>(
        '/oblireach/devices/latest-version',
      );
      return res.data.data?.version ?? null;
    } catch {
      return null;
    }
  },

  /** Queue an update command for a specific Oblireach device. */
  async queueObliReachUpdate(deviceUuid: string): Promise<void> {
    await apiClient.post(`/oblireach/devices/${deviceUuid}/command`, { type: 'update' });
  },
};

export interface ObliReachSession {
  id: number;
  username: string;
  state: string;
  stationName?: string;
  isConsole: boolean;
}

export interface ObliReachDevice {
  id: number;
  device_uuid: string;
  hostname: string;
  os: string;
  arch: string;
  version?: string;
  is_online: boolean;
  last_seen_at?: string;
  sessions: ObliReachSession[];
}
