import apiClient from './client';
import type { SshPublicKey } from '@obliance/shared';

// ─── SSH bastion (ObliJump) ──────────────────────────────────────────────────
// User side (/profile/*): own keys, SSH-button IP authorization, connection info.
// Admin side (/ssh-bastion/*): platform-wide status, enforce, allow-list, bans.

export interface SshHostKeyInfo {
  type: string;
  fingerprint: string;
}

export interface SshBastionInfo {
  enabled: boolean;
  running: boolean;
  port: number;
  enforce: boolean;
  hostKey: SshHostKeyInfo | null;
  currentIp: string | null;
  ipAuthorizedUntil: string | null;
  /** Rule under which the bastion would admit this IP right now (null = refused). */
  gateVia: 'allowlist' | 'ssh_button' | null;
  /** The server only sees a relay address for this client: it can never be authorized. */
  ipRelayed: boolean;
  has2fa: boolean;
}

export interface SshBastionStatus {
  enabled: boolean;
  running: boolean;
  port: number;
  enforce: boolean;
  hostKey: SshHostKeyInfo | null;
}

export interface SshAllowEntry {
  id: number;
  cidr: string;
  label: string | null;
  createdBy: number | null;
  createdByName?: string | null;
  createdAt: string;
}

export interface SshBan {
  ip: string;
  reason: string | null;
  expiresAt: string | null;
  createdAt: string;
  obliguardPushedAt: string | null;
  obliguardError: string | null;
}

export const sshBastionApi = {
  // ── User ──
  async info(): Promise<SshBastionInfo> {
    const res = await apiClient.get('/profile/ssh-bastion');
    return res.data.data;
  },

  async listKeys(): Promise<SshPublicKey[]> {
    const res = await apiClient.get('/profile/ssh-keys');
    return res.data.data ?? [];
  },

  // Requires a fresh 2FA code — the api client interceptor prompts and replays.
  async addKey(name: string, publicKey: string): Promise<SshPublicKey> {
    const res = await apiClient.post('/profile/ssh-keys', { name, publicKey });
    return res.data.data;
  },

  async deleteKey(id: number): Promise<void> {
    await apiClient.delete(`/profile/ssh-keys/${id}`);
  },

  // Requires a fresh 2FA code — the api client interceptor prompts and replays.
  async authorizeIp(): Promise<{ ip: string; expiresAt: string }> {
    const res = await apiClient.post('/profile/ssh-authorize-ip', {});
    return res.data.data;
  },

  async revokeIp(): Promise<void> {
    await apiClient.delete('/profile/ssh-authorize-ip');
  },

  // ── Admin ──
  async status(): Promise<SshBastionStatus> {
    const res = await apiClient.get('/ssh-bastion/status');
    return res.data.data;
  },

  async setEnforce(enforce: boolean): Promise<void> {
    await apiClient.put('/ssh-bastion/enforce', { enforce });
  },

  async listAllowlist(): Promise<SshAllowEntry[]> {
    const res = await apiClient.get('/ssh-bastion/allowlist');
    return res.data.data ?? [];
  },

  async addAllowlist(cidr: string, label: string | null): Promise<SshAllowEntry> {
    const res = await apiClient.post('/ssh-bastion/allowlist', { cidr, label });
    return res.data.data;
  },

  async deleteAllowlist(id: number): Promise<void> {
    await apiClient.delete(`/ssh-bastion/allowlist/${id}`);
  },

  async listBans(): Promise<SshBan[]> {
    const res = await apiClient.get('/ssh-bastion/bans');
    return res.data.data ?? [];
  },

  async unban(ip: string): Promise<void> {
    await apiClient.delete(`/ssh-bastion/bans/${encodeURIComponent(ip)}`);
  },
};

/**
 * Message to toast for a failed call, or null when nothing should be shown:
 * a cancelled 2FA prompt (not an HTTP error), or a 401/403/423 carrying an
 * `error` string, which the api client interceptor already toasts.
 */
export function apiErrorMessage(err: unknown, fallback: string): string | null {
  const e = err as any;
  if (!e?.response) return e?.isAxiosError ? fallback : null;
  const msg = e.response.data?.error;
  if ([401, 403, 423].includes(e.response.status) && typeof msg === 'string') return null;
  return typeof msg === 'string' && msg ? msg : fallback;
}
