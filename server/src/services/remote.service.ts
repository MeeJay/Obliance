import crypto from 'crypto';
import { db } from '../db';
import { commandService } from './command.service';
import { agentHub } from './agentHub.service';
import { oblireachHub } from './oblireachHub.service';
import type { OrCommand } from './oblireachHub.service';
import { getIO } from '../socket';
import { SocketEvents } from '@obliance/shared';
import type { RemoteSession, RemoteProtocol } from '@obliance/shared';
import { logger } from '../utils/logger';

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

  async createSession(
    deviceId: number,
    tenantId: number,
    userId: number,
    protocol: RemoteProtocol = 'oblireach',
    /** WTS session ID to capture (Windows only). Omit to capture the console session. */
    wtsSessionId?: number,
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
        const delivered = oblireachHub.push(device.uuid, orCmd);
        if (!delivered) {
          // Agent offline — queue in DB; drained immediately on next WS connect.
          await db('oblireach_devices')
            .where({ device_uuid: device.uuid, tenant_id: tenantId })
            .update({ pending_command: JSON.stringify(orCmd) });
        }
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

    // Notify UI
    try {
      getIO().to(`tenant:${tenantId}`).emit(SocketEvents.REMOTE_SESSION_UPDATED, session);
    } catch {}

    logger.info({ sessionId: session.id, deviceId, protocol }, 'Remote session created');
    return session;
  }

  async endSession(sessionId: string, tenantId: number, reason: string = 'user_disconnect') {
    const session = await db('remote_sessions').where({ id: sessionId, tenant_id: tenantId }).first();
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
        });
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
          deviceId: session.device_id, tenantId,
          type: 'close_remote_tunnel',
          payload: closePayload,
          priority: 'urgent',
        });
      }
    }

    // Clean up in-memory tunnel
    this.tunnels.delete(session.session_token);

    // Notify UI
    try {
      const updated = await db('remote_sessions').where({ id: sessionId }).first();
      getIO().to(`tenant:${tenantId}`).emit(SocketEvents.REMOTE_SESSION_UPDATED, this.rowToSession(updated));
    } catch {}
  }

  async getSessions(tenantId: number, filters?: { deviceId?: number; status?: string }) {
    let q = db('remote_sessions as rs')
      .leftJoin('users as u', 'u.id', 'rs.started_by')
      .where({ 'rs.tenant_id': tenantId });
    if (filters?.deviceId) q = q.where({ 'rs.device_id': filters.deviceId });
    if (filters?.status) q = q.where({ 'rs.status': filters.status });
    const rows = await q
      .select('rs.*', 'u.username as started_by_username', 'u.display_name as started_by_display_name')
      .orderBy('rs.started_at', 'desc').limit(100);
    return rows.map((row: any) => {
      const session = this.rowToSession(row);
      if (row.started_by_username || row.started_by_display_name) {
        session.startedByUser = {
          id: row.started_by,
          username: row.started_by_username,
          displayName: row.started_by_display_name,
        };
      }
      return session;
    });
  }

  // Called when agent WebSocket connects for a session.
  // Agent data may arrive before the browser has connected, so we buffer it
  // until registerBrowserTunnel() flushes the buffer and sets up full relay.
  registerAgentTunnel(sessionToken: string, agentWs: any) {
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

    // Update session status
    db('remote_sessions').where({ session_token: sessionToken }).update({
      status: 'active', connected_at: new Date(),
    }).then(() => {
      db('remote_sessions').where({ session_token: sessionToken }).first().then((row: any) => {
        if (row) {
          try { getIO().to(`tenant:${row.tenant_id}`).emit(SocketEvents.REMOTE_TUNNEL_READY, this.rowToSession(row)); } catch {}
        }
      });
    });
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
      try {
        getIO().to(`tenant:${row.tenant_id}`).emit(SocketEvents.REMOTE_SESSION_UPDATED, this.rowToSession(row));
      } catch {}
    }
  }
}

export const remoteService = new RemoteService();
