/**
 * Privacy Gate — in-memory unlock session store.
 *
 * When a user enters the device's privacy password to unlock a feature
 * temporarily (without disabling privacy mode), the agent returns a random
 * unlock token. We keep that token in memory here, scoped to
 * (userId, deviceId, feature), with a sliding TTL.
 *
 * Subsequent privileged commands from the same user check this store, and
 * if a valid session exists, the token is attached to the command payload
 * so the agent lets it through.
 *
 * Not persisted: lost at server restart by design. Short-lived.
 */

const UNLOCK_TTL_MS = 15 * 60 * 1000;      // sliding window
const UNLOCK_MAX_MS = 2 * 60 * 60 * 1000;  // absolute max

interface UnlockSession {
  token: string;
  feature: string;
  createdAt: number;
  lastUsed: number;
}

const store = new Map<string, UnlockSession>();

function key(userId: number, deviceId: number, feature: string): string {
  return `${userId}:${deviceId}:${feature}`;
}

export const privacyGateService = {
  put(userId: number, deviceId: number, feature: string, token: string): void {
    const now = Date.now();
    store.set(key(userId, deviceId, feature), {
      token,
      feature,
      createdAt: now,
      lastUsed: now,
    });
  },

  /** Returns the active token for this (user, device, feature) if any, and refreshes its sliding expiry. */
  get(userId: number, deviceId: number, feature: string): string | null {
    const k = key(userId, deviceId, feature);
    const s = store.get(k);
    if (!s) return null;
    const now = Date.now();
    if (now - s.createdAt > UNLOCK_MAX_MS || now - s.lastUsed > UNLOCK_TTL_MS) {
      store.delete(k);
      return null;
    }
    s.lastUsed = now;
    return s.token;
  },

  /** Returns info for all active unlocks held by a user on a device (for UI). */
  list(userId: number, deviceId: number): Array<{ feature: string; expiresAt: number }> {
    const out: Array<{ feature: string; expiresAt: number }> = [];
    const now = Date.now();
    for (const [k, s] of store) {
      if (!k.startsWith(`${userId}:${deviceId}:`)) continue;
      if (now - s.createdAt > UNLOCK_MAX_MS || now - s.lastUsed > UNLOCK_TTL_MS) {
        store.delete(k);
        continue;
      }
      const expiresAt = Math.min(
        s.createdAt + UNLOCK_MAX_MS,
        s.lastUsed + UNLOCK_TTL_MS,
      );
      out.push({ feature: s.feature, expiresAt });
    }
    return out;
  },

  clearForDevice(deviceId: number): void {
    for (const k of store.keys()) {
      if (k.split(':')[1] === String(deviceId)) store.delete(k);
    }
  },

  /** Map a command type to its privacy-feature name. Must match the agent. */
  featureForCommand(type: string): string {
    switch (type) {
      case 'run_script':
        return 'scripts';
      case 'open_remote_tunnel':
        return 'remote';
      case 'list_wts_sessions':
      case 'list_processes':
      case 'kill_process':
        return 'processes';
      case 'list_directory':
      case 'create_directory':
      case 'rename_file':
      case 'delete_file':
      case 'download_file':
      case 'upload_file':
        return 'files';
    }
    return '';
  },

  isBlockedByPrivacy(type: string): boolean {
    return this.featureForCommand(type) !== '';
  },
};
