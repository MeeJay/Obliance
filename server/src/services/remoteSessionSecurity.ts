import { ServerResponse, STATUS_CODES } from 'http';
import type { IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import type { RemoteSession } from '@obliance/shared';

/**
 * Remote-session security helpers — pure (no DB, no socket singleton) so they
 * can be exercised in isolation. remote.service.ts wires them to the real
 * socket.io server and database.
 *
 * Background: the 64-hex `sessionToken` of a remote session is the key of the
 * relay (/api/remote/tunnel/<token> for the browser end,
 * /api/remote/agent-tunnel/<token> for the agent end). It used to be
 * broadcast to the whole tenant room, and both ends accepted anyone holding
 * it (plus, for the agent end, ANY agent API key), so a tenant member could
 * attach to another user's root shell / RDP / ObliReach stream from either
 * side. Now:
 *   - over socket.io the token only reaches the user who started the session
 *     (emitRemoteSessionEvent); GET /api/remote/sessions strips it from rows
 *     the caller did not start; command payloads shown to users are redacted
 *     (redactCommandPayload). The agent still receives it in its own command
 *     frames (command channel / command_queue poll), which is required.
 *   - the browser upgrade is authenticated with the express-session cookie
 *     and restricted to that same user (evaluateBrowserTunnelAccess),
 *   - the agent upgrade must present the API key the session's device is
 *     bound to, and only one agent may attach (evaluateAgentTunnelAccess),
 *   - refused upgrades are answered with a plain HTTP error BEFORE the
 *     WebSocket handshake (rejectUpgrade), so clients never see a successful
 *     `open` for a tunnel they may not use.
 */

/** Fields that carry the tunnel secret, or a URL that embeds it. */
const SECRET_KEYS = new Set(['sessionToken', 'session_token', 'serverWsUrl', 'viewerToken', 'unlockToken']);

/**
 * Command-payload fields that are credentials meant for the AGENT only: the
 * relay key (and the URL that embeds it), the privacy-gate unlock token, and
 * the API key carried by `reconfigure_agent`. They stay in command_queue (the
 * agent reads the raw row) but are stripped from every user-facing view.
 */
const COMMAND_SECRET_KEYS = new Set(['sessionToken', 'serverWsUrl', 'unlockToken', 'apiKey', 'viewerToken']);

/** Copy of a command payload with agent-only secrets removed (never mutates). */
export function redactCommandPayload(payload: unknown): Record<string, unknown> {
  if (typeof payload === 'string') {
    // jsonb comes back parsed from pg; a legacy text value may not.
    try {
      const parsed = JSON.parse(payload);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return redactCommandPayload(parsed);
    } catch { /* not JSON — cannot carry a keyed secret */ }
    return payload as unknown as Record<string, unknown>;
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return (payload ?? {}) as Record<string, unknown>;
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (COMMAND_SECRET_KEYS.has(key)) continue;
    out[key] = value;
  }
  return out;
}

export type PublicRemoteSession = Omit<RemoteSession, 'sessionToken'>;

/**
 * Copy of a session safe to show to users other than its starter: the token
 * is removed, together with any top-level string field that embeds it
 * (e.g. a `serverWsUrl` of the form /api/remote/tunnel/<token>).
 */
export function toPublicRemoteSession<T extends { sessionToken?: string | null }>(session: T): Omit<T, 'sessionToken'> {
  const token = session.sessionToken;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(session)) {
    if (SECRET_KEYS.has(key)) continue;
    if (token && typeof value === 'string' && value.includes(token)) continue;
    out[key] = value;
  }
  return out as Omit<T, 'sessionToken'>;
}

export type RemoteSessionEvent = 'REMOTE_SESSION_UPDATED' | 'REMOTE_TUNNEL_READY';

/** The subset of the socket.io Server API used here (a fake is enough in tests). */
interface Emitter { emit(event: string, ...args: any[]): unknown }
interface RoomTarget extends Emitter { except(room: string | string[]): Emitter }
export interface RoomEmitter { to(room: string | string[]): RoomTarget }

/**
 * Emit a remote-session event without leaking the tunnel token:
 *   - full payload (with sessionToken) → room `user:<startedBy>` only,
 *   - token-free copy → the tenant room, minus the starter's sockets (so the
 *     starter does not receive the event twice).
 * Event name and every other field are unchanged, so tenant-wide listeners
 * (session lists matching by id) keep working.
 */
export function emitRemoteSessionEvent(io: RoomEmitter, event: RemoteSessionEvent, session: RemoteSession): void {
  const tenantRoom = session.tenantId != null ? `tenant:${session.tenantId}` : null;
  const publicCopy = toPublicRemoteSession(session);
  if (session.startedBy != null) {
    const starterRoom = `user:${session.startedBy}`;
    io.to(starterRoom).emit(event, session);
    if (tenantRoom) io.to(tenantRoom).except(starterRoom).emit(event, publicCopy);
  } else if (tenantRoom) {
    io.to(tenantRoom).emit(event, publicCopy);
  }
}

/** Statuses in which a browser may still attach to the relay. */
export const OPEN_REMOTE_SESSION_STATUSES: ReadonlySet<string> = new Set(['waiting', 'connecting', 'active']);

export type TunnelAccessVerdict =
  | { ok: true; sessionId: string; userId: number }
  | { ok: false; code: 4000 | 4003 | 4004; reason: string; sessionId?: string; userId?: number };

/**
 * Decide whether the authenticated caller may attach the browser end of a
 * relay. Order matters: nothing about the token is revealed to a caller
 * without a valid session cookie.
 */
export function evaluateBrowserTunnelAccess(input: {
  userId: number | null | undefined;
  userActive: boolean;
  row: { id: string; started_by: number | null; status: string } | null | undefined;
}): TunnelAccessVerdict {
  const { userId, userActive, row } = input;
  if (!userId) return { ok: false, code: 4003, reason: 'Authentication required' };
  if (!row) return { ok: false, code: 4004, reason: 'Session not found', userId };
  if (row.started_by == null || Number(row.started_by) !== Number(userId)) {
    return { ok: false, code: 4003, reason: 'Not the session owner', sessionId: row.id, userId };
  }
  if (!userActive) return { ok: false, code: 4003, reason: 'User inactive', sessionId: row.id, userId };
  if (!OPEN_REMOTE_SESSION_STATUSES.has(row.status)) {
    return { ok: false, code: 4004, reason: 'Session already closed', sessionId: row.id, userId };
  }
  return { ok: true, sessionId: row.id, userId: Number(userId) };
}

/** HTTP status used to refuse a browser upgrade before the handshake. */
export function browserVerdictHttpStatus(verdict: Extract<TunnelAccessVerdict, { ok: false }>): number {
  if (verdict.code === 4003) return verdict.reason === 'Authentication required' ? 401 : 403;
  if (verdict.code === 4004) return 404;
  return 500;
}

/**
 * May the agent authenticated by `key` act for `device`? Same rule as the
 * /api/agent/ws command-channel mismatch check: the key must belong to the
 * device's tenant, and when the device is bound to a key (devices.api_key_id,
 * set at enrollment, NULLed if that key is deleted) it must be that key.
 * The ObliReach agent is installed by the Obliance agent with its own key
 * (install_oblireach.go), so both agents of a device pass.
 */
export function agentKeyMayActForDevice(
  key: { id: number; tenant_id: number },
  device: { tenant_id: number; api_key_id: number | null | undefined },
): boolean {
  if (Number(key.tenant_id) !== Number(device.tenant_id)) return false;
  if (device.api_key_id != null && Number(device.api_key_id) !== Number(key.id)) return false;
  return true;
}

/** Statuses in which the AGENT end may still attach (it attaches exactly once). */
export const AGENT_ATTACHABLE_STATUSES: ReadonlySet<string> = new Set(['waiting', 'connecting']);

export type AgentTunnelVerdict =
  | { ok: true; sessionId: string; deviceId: number }
  | { ok: false; status: 401 | 403 | 404 | 409 | 500; reason: string; sessionId?: string; deviceId?: number };

/**
 * Decide whether an agent may attach the agent end of a relay:
 *   - a valid, active API key,
 *   - a session whose device is bound to that key (agentKeyMayActForDevice) —
 *     a key of another device's tenant or another key cannot claim the
 *     session even with the token,
 *   - a session still waiting for its agent (a closed session is never
 *     re-activated),
 *   - no agent already attached (a second "agent" would otherwise receive
 *     every keystroke the user types and could inject output).
 */
export function evaluateAgentTunnelAccess(input: {
  key: { id: number; tenant_id: number; is_active?: boolean | null } | null | undefined;
  row: { id: string; status: string; device_id: number; device_tenant_id: number | null; device_api_key_id: number | null } | null | undefined;
  hasLiveAgent: boolean;
}): AgentTunnelVerdict {
  const { key, row, hasLiveAgent } = input;
  if (!key || key.is_active === false) return { ok: false, status: 401, reason: 'Invalid API key' };
  if (!row || row.device_tenant_id == null) return { ok: false, status: 404, reason: 'Session not found' };
  if (!agentKeyMayActForDevice(key, { tenant_id: row.device_tenant_id, api_key_id: row.device_api_key_id })) {
    return { ok: false, status: 403, reason: 'Device/API-key mismatch', sessionId: row.id, deviceId: row.device_id };
  }
  if (!AGENT_ATTACHABLE_STATUSES.has(row.status)) {
    return { ok: false, status: 404, reason: 'Session not open', sessionId: row.id, deviceId: row.device_id };
  }
  if (hasLiveAgent) {
    return { ok: false, status: 409, reason: 'Agent already attached', sessionId: row.id, deviceId: row.device_id };
  }
  return { ok: true, sessionId: row.id, deviceId: row.device_id };
}

/**
 * Refuse a WebSocket upgrade with a plain HTTP response, before any
 * handshake (same as ws's own abortHandshake). The client never gets `open`,
 * only an error/close with code 1006 — so a viewer's reconnect counter is not
 * reset by a tunnel it may not use, and a refused agent sees a dial failure.
 */
export function rejectUpgrade(socket: Duplex, status: number, reason: string): void {
  if (socket.destroyed) return;
  const body = reason || STATUS_CODES[status] || 'Error';
  // Keep a listener: a peer reset while we write must not crash the process.
  socket.on('error', () => socket.destroy());
  socket.once('finish', () => socket.destroy());
  try {
    socket.end(
      `HTTP/1.1 ${status} ${STATUS_CODES[status] ?? 'Error'}\r\n`
      + 'Connection: close\r\n'
      + 'Content-Type: text/plain; charset=utf-8\r\n'
      + `Content-Length: ${Buffer.byteLength(body)}\r\n`
      + '\r\n'
      + body,
    );
  } catch {
    socket.destroy();
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** True for a canonical UUID string (safe to compare against a pg `uuid` column). */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

type ConnectStyleMiddleware = (req: any, res: any, next: (err?: unknown) => void) => void;

/**
 * Run the express-session middleware on a raw upgrade request (no Express
 * app, no real response) and return the resulting session — the same trick
 * engine.io uses for the socket.io handshake. express-session only reads
 * req.headers.cookie / req.url and hooks res.writeHead/res.end to persist
 * changes; the detached ServerResponse is never written, so nothing is sent
 * on the upgrade socket and nothing is saved.
 * Resolves undefined when there is no middleware or no session; rejects on a
 * store error or timeout.
 */
export function loadUpgradeSession(
  sessionMw: ConnectStyleMiddleware | null | undefined,
  request: IncomingMessage,
  timeoutMs = 10_000,
): Promise<{ userId?: number } | undefined> {
  if (!sessionMw) return Promise.resolve(undefined);
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => settle(() => reject(new Error('Session lookup timed out'))), timeoutMs);
    const res = new ServerResponse(request);
    try {
      sessionMw(request, res, (err?: unknown) => settle(() => {
        if (err) reject(err);
        else resolve((request as any).session as { userId?: number } | undefined);
      }));
    } catch (err) {
      settle(() => reject(err));
    }
  });
}
