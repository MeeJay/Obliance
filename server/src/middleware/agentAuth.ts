import { Request, Response, NextFunction } from 'express';
import { db } from '../db';
import { AppError } from './errorHandler';

declare global {
  namespace Express {
    interface Request {
      agentApiKeyId?: number;
      agentTenantId?: number;
    }
  }
}

// ── Hot-path caching ─────────────────────────────────────────────────────────
// agentAuth runs on EVERY agent request — push (~200/s at 2000 devices), command
// poll, inventory, etc. The stock version did one SELECT + one UPDATE per call,
// both on the agent_api_keys table, and the UPDATE hammered the SAME row for a
// whole fleet sharing one key (~400 writes/s of MVCC churn on a tiny table).
//
// 1. Key lookup is cached in-memory for 60s. A revoked key therefore keeps
//    working for at most 60s — the same staleness window as the threshold
//    cache; admins revoking a key should not expect sub-minute cutoff.
// 2. last_used_at is throttled to at most one write per key per minute — the
//    column is a coarse "when did we last hear from this key" indicator, not an
//    audit log, so per-request precision is worthless.

interface CachedKey { id: number; tenantId: number; isActive: boolean; at: number }
const KEY_TTL_MS = 60_000;
const LAST_USED_THROTTLE_MS = 60_000;
const keyCache = new Map<string, CachedKey>();
const lastUsedWrittenAt = new Map<number, number>();

/** Drop a key from the cache immediately (call on revoke/rotate for instant cutoff). */
export function invalidateAgentKeyCache(apiKey?: string): void {
  if (apiKey) keyCache.delete(apiKey);
  else keyCache.clear();
}

export async function agentAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const apiKey = req.headers['x-api-key'] as string;
    if (!apiKey) throw new AppError(401, 'Missing API key');

    const now = Date.now();
    let cached = keyCache.get(apiKey);
    if (!cached || now - cached.at >= KEY_TTL_MS) {
      const keyRow = await db('agent_api_keys').where({ key: apiKey }).first();
      if (!keyRow) throw new AppError(401, 'Invalid API key');
      cached = { id: keyRow.id, tenantId: keyRow.tenant_id, isActive: keyRow.is_active !== false, at: now };
      keyCache.set(apiKey, cached);
    }
    // Revocation flag (migration 089) — admin disabled the key. We treat
    // `is_active=false` as "key doesn't exist" to avoid leaking the existence
    // of valid-but-revoked keys to scanners.
    if (!cached.isActive) throw new AppError(401, 'Invalid API key');

    req.agentApiKeyId = cached.id;
    req.agentTenantId = cached.tenantId;

    // Throttled last_used_at (fire and forget, ≤ 1 write/min per key).
    const lastWrite = lastUsedWrittenAt.get(cached.id) ?? 0;
    if (now - lastWrite >= LAST_USED_THROTTLE_MS) {
      lastUsedWrittenAt.set(cached.id, now);
      db('agent_api_keys')
        .where({ id: cached.id })
        .update({ last_used_at: new Date() })
        .catch(() => {});
    }

    next();
  } catch (err) {
    next(err);
  }
}
