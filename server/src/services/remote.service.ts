import crypto from 'crypto';
import { db } from '../db';
import { commandService } from './command.service';
import { getIO } from '../socket';
import { SocketEvents } from '@obliance/shared';
import type { RemoteSession, RemoteProtocol } from '@obliance/shared';
import { logger } from '../utils/logger';

class RemoteService {
  // WebSocket relay store: sessionToken → { browserSocket, agentSocket }
  private tunnels = new Map<string, { browser?: any; agent?: any }>();

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

  async createSession(deviceId: number, tenantId: number, userId: number, protocol: RemoteProtocol = 'vnc'): Promise<RemoteSession> {
    const sessionToken = crypto.randomBytes(32).toString('hex');

    const [row] = await db('remote_sessions').insert({
      device_id: deviceId, tenant_id: tenantId,
      protocol, status: 'waiting',
      session_token: sessionToken,
      started_by: userId,
    }).returning('*');

    const session = this.rowToSession(row);

    // Send command to agent to open tunnel (agent will pick it up on next push)
    await commandService.enqueue({
      deviceId, tenantId, type: 'open_remote_tunnel',
      payload: { sessionToken, protocol, serverWsUrl: `/api/remote/tunnel/${sessionToken}` },
      priority: 'urgent',
      expiresInSeconds: 300, // 5 minutes to connect
      createdBy: userId,
    });

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

    await db('remote_sessions').where({ id: sessionId }).update({
      status: 'closed', ended_at: new Date(),
      duration_seconds: duration, end_reason: reason,
    });

    // Tell agent to close tunnel
    await commandService.enqueue({
      deviceId: session.device_id, tenantId,
      type: 'close_remote_tunnel',
      payload: { sessionToken: session.session_token },
      priority: 'urgent',
    });

    // Clean up in-memory tunnel
    this.tunnels.delete(session.session_token);

    // Notify UI
    try {
      const updated = await db('remote_sessions').where({ id: sessionId }).first();
      getIO().to(`tenant:${tenantId}`).emit(SocketEvents.REMOTE_SESSION_UPDATED, this.rowToSession(updated));
    } catch {}
  }

  async getSessions(tenantId: number, filters?: { deviceId?: number; status?: string }) {
    let q = db('remote_sessions').where({ tenant_id: tenantId });
    if (filters?.deviceId) q = q.where({ device_id: filters.deviceId });
    if (filters?.status) q = q.where({ status: filters.status });
    const rows = await q.orderBy('started_at', 'desc').limit(100);
    return rows.map(this.rowToSession.bind(this));
  }

  // Called when agent WebSocket connects for a session
  registerAgentTunnel(sessionToken: string, agentWs: any) {
    if (!this.tunnels.has(sessionToken)) this.tunnels.set(sessionToken, {});
    const tunnel = this.tunnels.get(sessionToken)!;
    tunnel.agent = agentWs;

    // If browser is already waiting, bridge them
    if (tunnel.browser) this.bridge(sessionToken, tunnel.browser, agentWs);

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

  // Called when browser WebSocket connects for a session
  registerBrowserTunnel(sessionToken: string, browserWs: any) {
    if (!this.tunnels.has(sessionToken)) this.tunnels.set(sessionToken, {});
    const tunnel = this.tunnels.get(sessionToken)!;
    tunnel.browser = browserWs;

    if (tunnel.agent) this.bridge(sessionToken, browserWs, tunnel.agent);
  }

  private bridge(sessionToken: string, ws1: any, ws2: any) {
    // Bidirectional relay
    ws1.on('message', (data: any) => { try { ws2.send(data); } catch {} });
    ws2.on('message', (data: any) => { try { ws1.send(data); } catch {} });
    ws1.on('close', () => { this.handleTunnelClose(sessionToken, 'browser_disconnect'); });
    ws2.on('close', () => { this.handleTunnelClose(sessionToken, 'agent_disconnect'); });
  }

  private async handleTunnelClose(sessionToken: string, reason: string) {
    const tunnel = this.tunnels.get(sessionToken);
    if (!tunnel) return;
    this.tunnels.delete(sessionToken);

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
