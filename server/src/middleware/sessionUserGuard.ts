import type { Request, Response, NextFunction } from 'express';
import { performance } from 'node:perf_hooks';
import { db } from '../db';

// P6 (docs/mobile/device-bound-2fa.md §6.0) — the session's user is re-read.
//
// killSessionsForUser (services/userSessions.service.ts) deletes the session
// rows of a disabled / deleted / demoted user, but a request of that user
// already in flight loaded its session BEFORE the delete; when it ends,
// express-session saves it again (connect-pg-simple `set` is an upsert) and
// the row is back with `userId` and `role` intact. Deleting rows is therefore
// not enough on its own.
//
// Mounted in app.ts after the session middleware, before every router: for a
// signed-in session, the user's `is_active` and `role` are read (cached a few
// seconds, dropped by killSessionsForUser):
//   - missing or inactive user → the session is regenerated (old row deleted,
//     the request continues anonymous: requireAuth answers 401);
//   - role changed → session.role follows the database (a demoted admin loses
//     the admin bypasses on the next request, whatever resurrected the row).

const TTL_MS = 5_000;
const MAX_ENTRIES = 10_000;

type UserState = { active: boolean; role: string } | null;
const cache = new Map<number, { at: number; state: UserState }>();

/** Drops the cached state of a user (called by killSessionsForUser). */
export function forgetSessionUser(userId: number): void {
  cache.delete(userId);
}

async function stateOf(userId: number): Promise<UserState> {
  const now = performance.now();
  const hit = cache.get(userId);
  if (hit && now - hit.at < TTL_MS) return hit.state;
  const row = await db('users').where({ id: userId }).first('is_active', 'role') as { is_active: boolean; role: string } | undefined;
  const state: UserState = row ? { active: row.is_active !== false, role: String(row.role) } : null;
  if (cache.size >= MAX_ENTRIES) cache.clear();
  cache.set(userId, { at: now, state });
  return state;
}

export async function sessionUserGuard(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const userId = Number(req.session?.userId);
  if (!Number.isInteger(userId) || userId <= 0) { next(); return; }
  try {
    const state = await stateOf(userId);
    if (!state || !state.active) {
      await new Promise<void>((resolve) => req.session.regenerate(() => resolve()));
      next();
      return;
    }
    if (req.session.role !== state.role) req.session.role = state.role;
    next();
  } catch (err) {
    next(err);
  }
}
