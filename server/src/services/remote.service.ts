import crypto from 'crypto';
import type { IncomingMessage } from 'http';
import { db } from '../db';
import { commandService } from './command.service';
import { agentHub } from './agentHub.service';
import { oblireachHub } from './oblireachHub.service';
import { privacyGateService } from './privacyGate.service';
import type { OrCommand } from './oblireachHub.service';
import { getIO } from '../socket';
import { SocketEvents, isMasterTenant } from '@obliance/shared';
import type { RemoteSession, RemoteProtocol } from '@obliance/shared';
import { logger } from '../utils/logger';
import { AppError } from '../middleware/errorHandler';
import {
  emitRemoteSessionEvent,
  evaluateAgentTunnelAccess,
  evaluateBrowserTunnelAccess,
  loadUpgradeSession,
  toPublicRemoteSession,
  type AgentTunnelVerdict,
  type PublicRemoteSession,
  type RemoteSessionEvent,
  type TunnelAccessVerdict,
} from './remoteSessionSecurity';

interface TunnelEntry {
  browser?: any;
  agent?: any;
  /** Messages received from agent before browser connected — flushed on bridge. */
  agentBuffer: Array<{ data: Buffer; isBinary: boolean }>;
}

class RemoteService {
  // WebSocket relay store: sessionToken → TunnelEntry
  private tunnels = new Map<string, TunnelEntry>();

  rowToSession(row: any): RemoteSession {
    return {
      id: row.id, deviceId: row.device_id, tenantId: row.tenant_id,
      protocol: row.protocol, status: row.status,
      sessionToken: row.session_token,
      startedBy: row.started_by,
      startedAt: row.started_at, connectedAt: row.connected_at,
      endedAt: row.ended_at, durationSeconds: row.duration_seconds,
      endReason: row.end_reason, notes: row.notes, createdAt: row.created_at,
    };
  }

  /**
   * THE single way to emit REMOTE_SESSION_UPDATED / REMOTE_TUNNEL_READY.
   * The full session (with sessionToken) goes to the starter's `user:<id>`
   * room only; the rest of the tenant gets a token-free copy. Never emit
   * these events with a raw row or to a tenant room directly — the token is
   * the relay key and must not reach other users.
   * Accepts a DB row (snake_case) or an already-mapped RemoteSession.
   */
  emitSessionEvent(event: RemoteSessionEvent, rowOrSession: any) {
    if (!rowOrSession) return;
    const session: RemoteSession = 'session_token' in rowOrSession || 'tenant_id' in rowOrSession
      ? this.rowToSession(rowOrSession)
      : rowOrSession;
    try {
      emitRemoteSessionEvent(getIO(), event, session);
    } catch { /* socket.io not initialised (boot / scripts) — nothing to notify */ }
  }

  /**
   * Authorize the browser end of /api/remote/tunnel/<token>: the upgrade
   * request must carry a valid express-session cookie whose user started the
   * session, and the session must still be open. `sessionMw` is the app's
   * express-session middleware (app.getSessionMiddleware()).
   * Never throws — errors resolve to a 4000 verdict.
   */
  async authorizeBrowserTunnel(
    request: IncomingMessage,
    sessionToken: string,
    sessionMw: ((req: any, res: any, next: (err?: unknown) => void) => void) | null,
  ): Promise<TunnelAccessVerdict> {
    try {
      const sess = await loadUpgradeSession(sessionMw, request);
      const userId = sess?.userId;
      if (!userId) return evaluateBrowserTunnelAccess({ userId: null, userActive: false, row: null });
      const row = await db('remote_sessions')
        .where({ session_token: sessionToken })
        .first('id', 'started_by', 'status');
      const user = row ? await db('users').where({ id: userId }).first('is_active') : null;
      return evaluateBrowserTunnelAccess({ userId, userActive: !!user && user.is_active !== false, row });
    } catch (err) {
      logger.error(err, 'Browser remote tunnel authorization error');
      return { ok: false, code: 4000, reason: 'Internal error' };
    }
  }

  /**
   * Authorize the agent end of /api/remote/agent-tunnel/<token>: the
   * X-Api-Key must be the key the session's DEVICE is bound to (same rule as
   * the /api/agent/ws channel), the session must still be waiting for its
   * agent, and no agent may already be attached. The caller must register
   * the tunnel in the same tick as a positive verdict (no await in between)
   * so the "no live agent" check cannot race.
   * Never throws — errors resolve to a 500 verdict.
   */
  async authorizeAgentTunnel(apiKey: string | undefined, sessionToken: string): Promise<AgentTunnelVerdict> {
    try {
      if (!apiKey) return { ok: false, status: 401, reason: 'Missing X-Api-Key header' };
      const key = await db('agent_api_keys').where({ key: apiKey }).first('id', 'tenant_id', 'is_active');
      if (!key || key.is_active === false) return evaluateAgentTunnelAccess({ key: null, row: null, hasLiveAgent: false });
      const row = await db('remote_sessions as rs')
        .leftJoin('devices as d', 'd.id', 'rs.device_id')
        .where('rs.session_token', sessionToken)
        .first(
          'rs.id', 'rs.status', 'rs.device_id',
          'd.tenant_id as device_tenant_id', 'd.api_key_id as device_api_key_id',
        );
      return evaluateAgentTunnelAccess({ key, row, hasLiveAgent: this.hasLiveAgent(sessionToken) });
    } catch (err) {
      logger.error(err, 'Agent remote tunnel authorization error');
      return { ok: false, status: 500, reason: 'Internal error' };
    }
  }

  /** True while an agent WebSocket is attached (and not closed) for this token. */
  hasLiveAgent(sessionToken: string): boolean {
    const agent = this.tunnels.get(sessionToken)?.agent;
    // ws readyState: 0 CONNECTING, 1 OPEN, 2 CLOSING, 3 CLOSED
    return !!agent && (agent.readyState === 0 || agent.readyState === 1);
  }

  async createSession(
    deviceId: number,
    tenantId: number,
    userId: number,
    protocol: RemoteProtocol = 'oblireach',
    /** WTS session ID to capture (Windows only). Omit to capture the console session. */
    wtsSessionId?: number,
    /** Hyper-V VM GUID — required when protocol === 'vmconsole'. */
    vmId?: string,
  ): Promise<RemoteSession> {
    const sessionToken = crypto.randomBytes(32).toString('hex');

    const [row] = await db('remote_sessions').insert({
      device_id: deviceId, tenant_id: tenantId,
      protocol, status: 'waiting',
      session_token: sessionToken,
      started_by: userId,
    }).returning('*');

    const session = this.rowToSession(row);

    // Look up the connecting user's display name for agent-side notifications.
    let username = 'Unknown';
    try {
      const user = await db('users').where({ id: userId }).first();
      if (user) username = user.display_name || user.username || user.email || 'Unknown';
    } catch {}

    // Deliver the open_remote_tunnel command to the appropriate agent.
    const commandPayload: Record<string, unknown> = {
      sessionToken, protocol, serverWsUrl: `/api/remote/tunnel/${sessionToken}`,
      username,
    };
    if (wtsSessionId !== undefined) {
      commandPayload.sessionId = wtsSessionId;
    }
    // Attach privacy unlock token if the user has an active unlock for 'remote'.
    const remoteToken = privacyGateService.get(userId, deviceId, 'remote');
    if (remoteToken) {
      commandPayload.unlockToken = remoteToken;
    }

    if (protocol === 'oblireach') {
      // Oblireach: try instant WS delivery first; fall back to DB queue so the
      // command is picked up the moment the agent reconnects (even if offline now).
      const device = await db('devices').where({ id: deviceId }).first();
      if (device?.uuid) {
        const orCmd: OrCommand = {
          type: 'open_remote_tunnel',
          id: `or_${sessionToken.slice(0, 8)}`,
          payload: commandPayload,
        };
        // Only to a channel registered with this device's key (the command
        // carries the relay token) — see oblireachHub.push.
        const delivered = oblireachHub.push(device.uuid, orCmd, {
          tenantId: device.tenant_id, apiKeyId: device.api_key_id ?? null,
        });
        if (!delivered) {
          // Agent offline — queue in DB; drained immediately on next WS connect.
          // oblireach_devices rows are keyed by the AGENT's tenant, i.e. the
          // device's (the session tenant is the master's for a god-view start).
          await db('oblireach_devices')
            .where({ device_uuid: device.uuid, tenant_id: device.tenant_id })
            .update({ pending_command: JSON.stringify(orCmd) });
        }
      }
    } else if (protocol === 'vmconsole') {
      // Hyper-V VM interactive console: the Obliance agent spawns the bundled
      // FreeRDP helper which streams the VM console as H.264 into the same relay.
      // Live-only — there is no DB-queue fallback (an interactive stream needs
      // the agent online right now); if undelivered the session simply times out.
      const vmPayload: Record<string, unknown> = { ...commandPayload, vmId };
      const delivered = agentHub.push(deviceId, {
        type: 'command',
        id: `vmc_${sessionToken.slice(0, 8)}`,
        commandType: 'open_vm_console',
        payload: vmPayload,
      });
      if (!delivered) {
        const [failed] = await db('remote_sessions').where({ id: row.id })
          .update({ status: 'failed', ended_at: new Date(), end_reason: 'agent_offline' })
          .returning('*');
        this.emitSessionEvent(SocketEvents.REMOTE_SESSION_UPDATED, failed ?? row);
        logger.warn({ deviceId, sessionId: row.id }, 'vm console: agent offline, session failed');
        // Do NOT hand back a session that is already dead: the viewer would
        // open a tunnel that is refused and, on its reconnect path, create
        // another dead session in a loop. A 409 stops the caller instead.
        throw new AppError(409, 'The host agent is not connected — the VM console needs a live agent connection.');
      }
    } else {
      // RDP / SSH / Shell: prefer instant command channel, fall back to DB queue.
      const delivered = agentHub.push(deviceId, {
        type: 'command',
        id: `remote_${sessionToken.slice(0, 8)}`,
        commandType: 'open_remote_tunnel',
        payload: commandPayload,
      });
      if (!delivered) {
        await commandService.enqueue({
          deviceId, tenantId, type: 'open_remote_tunnel',
          payload: commandPayload,
          priority: 'urgent',
          expiresInSeconds: 300,
          createdBy: userId,
        });
      }
    }

    // Notify UI (token only to the starter — see emitSessionEvent)
    this.emitSessionEvent(SocketEvents.REMOTE_SESSION_UPDATED, session);

    logger.info({ sessionId: session.id, deviceId, protocol }, 'Remote session created');
    return session;
  }

  async endSession(sessionId: string, tenantId: number, reason: string = 'user_disconnect') {
    // Master tenant gets god-view (can close any tenant's session);
    // child tenants stay scoped.
    const isMaster = isMasterTenant(tenantId);
    const q = db('remote_sessions').where({ id: sessionId });
    if (!isMaster) q.where({ tenant_id: tenantId });
    const session = await q.first();
    if (!session) return;

    const duration = session.connected_at
      ? Math.floor((Date.now() - new Date(session.connected_at).getTime()) / 1000)
      : 0;
    // Sessions that never connected (waiting/connecting) are marked 'expired', not 'closed'
    const finalStatus = session.connected_at ? 'closed' : 'expired';
    await db('remote_sessions').where({ id: sessionId }).update({
      status: finalStatus, ended_at: new Date(),
      duration_seconds: duration, end_reason: reason,
    });

    // Tell agent to close tunnel — include username for agent-side notification.
    let closingUsername = 'Unknown';
    try {
      const user = await db('users').where({ id: session.started_by }).first();
      if (user) closingUsername = user.display_name || user.username || user.email || 'Unknown';
    } catch {}
    const closePayload = { sessionToken: session.session_token, username: closingUsername };
    if (session.protocol === 'oblireach') {
      // Deliver close via WS if connected; no DB fallback needed (close is best-effort —
      // the session is ending regardless, and the agent will detect the tunnel close).
      const device = await db('devices').where({ id: session.device_id }).first();
      if (device?.uuid) {
        oblireachHub.push(device.uuid, {
          type: 'close_remote_tunnel',
          id: `close_${session.session_token.slice(0, 8)}`,
          payload: closePayload,
        }, { tenantId: device.tenant_id, apiKeyId: device.api_key_id ?? null });
      }
    } else {
      const closePushed = agentHub.push(session.device_id, {
        type: 'command',
        id: `close_${session.session_token.slice(0, 8)}`,
        commandType: 'close_remote_tunnel',
        payload: closePayload,
      });
      if (!closePushed) {
        await commandService.enqueue({
          deviceId: session.device_id, tenantId: session.tenant_id,
          type: 'close_remote_tunnel',
          payload: closePayload,
          priority: 'urgent',
        });
      }
    }

    // Clean up in-memory tunnel
    this.tunnels.delete(session.session_token);

    // Notify UI (token only to the starter — see emitSessionEvent)
    try {
      const updated = await db('remote_sessions').where({ id: sessionId }).first();
      this.emitSessionEvent(SocketEvents.REMOTE_SESSION_UPDATED, updated);
    } catch {}
  }

  async getSessions(tenantId: number, filters?: {
    deviceId?: number; status?: string;
    callerUserId?: number; callerIsAdmin?: boolean;
  }) {
    // Visibility cascade — strictest wins:
    //   - Master tenant (id=1) god view: every session install-wide.
    //   - Otherwise tenant-scoped.
    //   - Plain user (callerIsAdmin=false): further restricted to
    //     sessions THEY started (started_by = callerUserId). Without
    //     this, a non-admin with the `remote` capability would see
    //     other users' sessions on shared devices, which the user
    //     explicitly asked to prevent.
    const isMaster = isMasterTenant(tenantId);
    let q = db('remote_sessions as rs')
      .leftJoin('users as u', 'u.id', 'rs.started_by');
    if (!isMaster) q = q.where({ 'rs.tenant_id': tenantId });
    if (filters?.deviceId) q = q.where({ 'rs.device_id': filters.deviceId });
    if (filters?.status) q = q.where({ 'rs.status': filters.status });
    if (filters?.callerIsAdmin === false && filters.callerUserId != null) {
      q = q.where({ 'rs.started_by': filters.callerUserId });
    }
    const rows = await q
      .select('rs.*', 'u.username as started_by_username', 'u.display_name as started_by_display_name')
      .orderBy('rs.started_at', 'desc').limit(100);
    return rows.map((row: any): RemoteSession | PublicRemoteSession => {
      const session = this.rowToSession(row);
      if (row.started_by_username || row.started_by_display_name) {
        session.startedByUser = {
          id: row.started_by,
          username: row.started_by_username,
          displayName: row.started_by_display_name,
        };
      }
      // The relay token only goes to the user who started the session (the
      // tunnel refuses anyone else anyway). Admins still see every session,
      // without the token — same shape as the socket.io tenant copy.
      const isOwn = filters?.callerUserId != null && Number(row.started_by) === Number(filters.callerUserId);
      return isOwn ? session : toPublicRemoteSession(session);
    });
  }

  // Called when agent WebSocket connects for a session (after
  // authorizeAgentTunnel). Agent data may arrive before the browser has
  // connected, so we buffer it until registerBrowserTunnel() flushes the
  // buffer and sets up full relay.
  // Returns false — and registers nothing — when an agent is already
  // attached: a second agent is never swapped in or bridged to the browser
  // (it would receive everything the user types).
  registerAgentTunnel(sessionToken: string, agentWs: any): boolean {
    if (this.hasLiveAgent(sessionToken)) return false;
    if (!this.tunnels.has(sessionToken)) this.tunnels.set(sessionToken, { agentBuffer: [] });
    const tunnel = this.tunnels.get(sessionToken)!;
    tunnel.agent = agentWs;

    // Buffer agent→browser frames until browser is ready.
    // The second parameter `isBinary` is provided by the `ws` library (v8+):
    // text frames arrive as isBinary=false, binary frames as isBinary=true.
    // We MUST forward the same frame type so the browser (xterm) interprets
    // binary frames as raw terminal bytes and not UTF-8 text.
    agentWs.on('message', (data: Buffer, isBinary: boolean) => {
      if (tunnel.browser) {
        try { tunnel.browser.send(data, { binary: isBinary }); } catch {}
      } else {
        tunnel.agentBuffer.push({ data: Buffer.isBuffer(data) ? data : Buffer.from(data), isBinary });
      }
    });

    // Keepalive ping every 15 s — prevents intermediate proxies (Nginx/NPM)
    // from dropping idle tunnel WS connections. 15 s covers proxies with
    // timeouts as low as ~20 s and ensures the first ping fires well before
    // a typical 40–60 s idle cutoff.
    const agentKeepAlive = setInterval(() => {
      try { (agentWs as any).ping(); } catch { clearInterval(agentKeepAlive); }
    }, 15_000);
    agentWs.on('close', () => {
      clearInterval(agentKeepAlive);
      this.handleTunnelClose(sessionToken, 'agent_disconnect');
    });

    // If browser arrived first (unusual but possible), flush immediately
    if (tunnel.browser) {
      this._flushAndBridgeBrowser(sessionToken, tunnel.browser, agentWs);
    }

    // Update session status — only a session still waiting for its agent
    // becomes 'active'. If it was ended/expired meanwhile, drop the tunnel
    // and hang up on the agent instead of resurrecting the session.
    db('remote_sessions')
      .where({ session_token: sessionToken })
      .whereIn('status', ['waiting', 'connecting'])
      .update({ status: 'active', connected_at: new Date() })
      .returning('*')
      .then((rows: any[]) => {
        const row = rows?.[0];
        if (row) {
          this.emitSessionEvent(SocketEvents.REMOTE_TUNNEL_READY, row);
          return;
        }
        const current = this.tunnels.get(sessionToken);
        if (current && current.agent === agentWs) {
          this.tunnels.delete(sessionToken); // handleTunnelClose then no-ops
          try { current.browser?.close(); } catch {}
        }
        try { agentWs.close(4004, 'Session not open'); } catch {}
      })
      .catch((err: unknown) => logger.error(err, 'Remote tunnel: failed to mark session active'));
    return true;
  }

  // Called when browser WebSocket connects for a session.
  registerBrowserTunnel(sessionToken: string, browserWs: any) {
    if (!this.tunnels.has(sessionToken)) this.tunnels.set(sessionToken, { agentBuffer: [] });
    const tunnel = this.tunnels.get(sessionToken)!;
    tunnel.browser = browserWs;

    if (tunnel.agent) {
      this._flushAndBridgeBrowser(sessionToken, browserWs, tunnel.agent);
    }
    // If agent hasn't connected yet, browser→agent relay will be set up
    // in registerAgentTunnel when the agent eventually arrives.
  }

  /** Drop a tunnel entry whose browser side gave up BEFORE the agent paired
   *  (e.g. the in-process SSH bastion hit its connect timeout). Without this
   *  the entry would linger in memory until an agent that never comes. */
  dropTunnel(sessionToken: string) {
    this.tunnels.delete(sessionToken);
  }

  /** Flush buffered agent frames to the browser, then wire up browser→agent relay. */
  private _flushAndBridgeBrowser(sessionToken: string, browserWs: any, agentWs: any) {
    const tunnel = this.tunnels.get(sessionToken);
    if (!tunnel) return;

    // Signal the browser that the agent is paired and streaming is starting.
    // This triggers the viewer transition from 'waiting' → 'streaming' even
    // if the agent's init frame was already buffered (and would be lost as
    // binary when text/binary metadata is not preserved in the buffer).
    try { browserWs.send(JSON.stringify({ type: 'paired' })); } catch {}

    // Drain buffer: send accumulated agent frames to browser, preserving frame type
    for (const { data, isBinary } of tunnel.agentBuffer) {
      try { browserWs.send(data, { binary: isBinary }); } catch {}
    }
    tunnel.agentBuffer = [];

    // Keepalive ping every 25 s on the browser WS — same reason as agent side.
    const browserKeepAlive = setInterval(() => {
      try { (browserWs as any).ping(); } catch { clearInterval(browserKeepAlive); }
    }, 15_000);

    // Browser → agent relay (agent→browser is already wired in registerAgentTunnel).
    // Preserve the WS frame type (text vs binary) so the agent can distinguish
    // JSON control messages (text, e.g. resize) from raw shell stdin (binary).
    browserWs.on('message', (data: Buffer, isBinary: boolean) => {
      try { agentWs.send(data, { binary: isBinary }); } catch {}
    });
    browserWs.on('close', () => {
      clearInterval(browserKeepAlive);
      this.handleTunnelClose(sessionToken, 'browser_disconnect');
    });
  }

  private async handleTunnelClose(sessionToken: string, reason: string) {
    const tunnel = this.tunnels.get(sessionToken);
    if (!tunnel) return;
    this.tunnels.delete(sessionToken);

    // Propagate close to the other side so neither end hangs as an orphan.
    // The guard above ensures this is called only once per tunnel.
    try { tunnel.browser?.close(); } catch {}
    try { tunnel.agent?.close(); } catch {}

    const session = await db('remote_sessions').where({ session_token: sessionToken }).first();
    if (session && session.tenant_id) {
      this.endSession(session.id, session.tenant_id, reason);
    }
  }

  // Expire stale sessions and notify the UI
  async cleanupStaleSessions() {
    const timeout = await db('app_config').where({ key: 'remote_session_timeout_minutes' }).first();
    const minutes = parseInt(timeout?.value || '60');
    const now = new Date();

    // "waiting" sessions: short fuse (6 min) — the open_remote_tunnel command expires
    // in 5 min, so after 6 min a waiting session is definitively stuck.
    const timedOutWaiting = await db('remote_sessions')
      .where({ status: 'waiting' })
      .where('started_at', '<', new Date(Date.now() - 6 * 60 * 1000))
      .update({ status: 'timeout', ended_at: now, end_reason: 'timeout' })
      .returning('*');

    // "connecting" sessions: use the admin-configured timeout
    const timedOutConnecting = await db('remote_sessions')
      .where({ status: 'connecting' })
      .where('started_at', '<', new Date(Date.now() - minutes * 60 * 1000))
      .update({ status: 'timeout', ended_at: now, end_reason: 'timeout' })
      .returning('*');

    // Notify UI for each session that was timed out
    const allTimedOut = [...(timedOutWaiting || []), ...(timedOutConnecting || [])];
    for (const row of allTimedOut) {
      this.emitSessionEvent(SocketEvents.REMOTE_SESSION_UPDATED, row);
    }
  }
}

export const remoteService = new RemoteService();
