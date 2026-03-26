import fs from 'fs';
import path from 'path';
import type { WebSocket } from 'ws';
import { db } from '../db';
import { logger } from '../utils/logger';
import { getIO } from '../socket';

// ── Version helpers ────────────────────────────────────────────────────────────
// (Mirrored from oblireach-agent.routes.ts — kept in sync manually)

let _cachedVersion: string | null = null;
let _cachedVersionAt = 0;
const VERSION_TTL_MS = 60_000;

function getLatestVersion(): string | null {
  const now = Date.now();
  if (now - _cachedVersionAt < VERSION_TTL_MS) return _cachedVersion;
  try {
    const fp = path.resolve(__dirname, '../../../../agent/dist/oblireach-version.txt');
    _cachedVersion = fs.readFileSync(fp, 'utf-8').trim() || null;
  } catch {
    _cachedVersion = null;
  }
  _cachedVersionAt = now;
  return _cachedVersion;
}

function isOlderVersion(current: string, latest: string): boolean {
  const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number);
  const [cm, cmi, cp] = parse(current);
  const [lm, lmi, lp] = parse(latest);
  if (cm !== lm) return cm < lm;
  if (cmi !== lmi) return cmi < lmi;
  return cp < lp;
}

function downloadName(agentOS?: string, agentArch?: string): string {
  if (agentOS === 'windows') return 'oblireach-agent.msi';
  if (agentOS === 'darwin') return agentArch === 'arm64'
    ? 'oblireach-agent-darwin-arm64'
    : 'oblireach-agent-darwin-amd64';
  return 'oblireach-agent-linux-amd64';
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface ObliReachConn {
  ws: WebSocket;
  deviceUuid: string;
  tenantId: number;
}

/** A command delivered from server → Oblireach agent over the WS channel. */
export interface OrCommand {
  /** 'open_remote_tunnel' | 'close_remote_tunnel' | 'update' */
  type: string;
  id: string;
  payload: Record<string, unknown>;
}

// ── Service ───────────────────────────────────────────────────────────────────

class ObliReachHubService {
  /** deviceUuid → active WS connection */
  private byDevice = new Map<string, ObliReachConn>();

  constructor() {
    // Server-side keepalive: ping every 15 s so idle connections survive
    // reverse-proxy idle timeouts (Nginx default 60 s, NPM ~20 s).
    setInterval(() => {
      for (const [uuid, conn] of this.byDevice) {
        if (conn.ws.readyState === 1 /* OPEN */) {
          try { (conn.ws as any).ping(); } catch { this._unregister(uuid, conn.ws); }
        } else {
          this._unregister(uuid, conn.ws);
        }
      }
    }, 15_000);
  }

  /**
   * Register a new persistent WS connection for a Oblireach agent.
   * Replaces any previous connection for the same deviceUuid.
   * Drains any pending offline-queued command immediately.
   */
  async register(deviceUuid: string, tenantId: number, ws: WebSocket): Promise<void> {
    // Replace stale connection if present
    const existing = this.byDevice.get(deviceUuid);
    if (existing?.ws.readyState === 1 /* OPEN */) {
      try { existing.ws.close(1000, 'replaced'); } catch {}
    }

    const conn: ObliReachConn = { ws, deviceUuid, tenantId };
    this.byDevice.set(deviceUuid, conn);

    ws.on('close', () => this._unregister(deviceUuid, ws));
    ws.on('error', () => this._unregister(deviceUuid, ws));
    ws.on('message', async (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'heartbeat') {
          await this._handleHeartbeat(conn, msg);
        } else if (msg.type === 'chat_message' && msg.chatId) {
          const chatSender = msg.payload?.from || 'User';
          const chatText = msg.payload?.text || '';
          try {
            getIO().to(`chat:${msg.chatId}`).emit('chat:message', {
              chatId: msg.chatId,
              sender: chatSender,
              message: chatText,
              timestamp: msg.payload?.timestamp || Date.now(),
            });
          } catch {}
          // Persist to DB
          try {
            await db('chat_messages').insert({
              chat_id: msg.chatId,
              tenant_id: conn.tenantId,
              sender: chatSender,
              message: chatText,
              is_operator: false,
            });
          } catch {}
        } else if (msg.type === 'chat_event' && msg.chatId) {
          // User event (closed, allow_remote, deny_remote)
          const action = msg.payload?.action;
          if (action === 'user_closed') {
            try { getIO().to(`chat:${msg.chatId}`).emit('chat:closed', { chatId: msg.chatId }); } catch {}
          } else if (action === 'typing') {
            try { getIO().to(`chat:${msg.chatId}`).emit('chat:typing', { chatId: msg.chatId }); } catch {}
          } else if (action === 'allow_remote' || action === 'deny_remote') {
            try {
              getIO().to(`chat:${msg.chatId}`).emit('chat:remote_response', {
                chatId: msg.chatId,
                allowed: !!msg.payload?.allowed,
              });
            } catch {}
          }
        }
      } catch { /* malformed JSON — discard */ }
    });

    // Drain any command that was queued while the agent was offline.
    // This ensures urgent commands (e.g. open_remote_tunnel) are delivered
    // the instant the agent reconnects rather than waiting for the next push.
    try {
      await this._drainPendingCommand(conn);
    } catch (err) {
      logger.error(err, 'oblireachHub: drain pending command failed');
    }

    logger.info({ deviceUuid }, 'ObliReach agent command channel connected');
  }

  private _unregister(deviceUuid: string, ws: WebSocket): void {
    const existing = this.byDevice.get(deviceUuid);
    if (existing?.ws === ws) {
      this.byDevice.delete(deviceUuid);
      logger.info({ deviceUuid }, 'ObliReach agent command channel disconnected');
    }
  }

  /**
   * If a command was queued in `pending_command` while the agent was offline,
   * deliver it immediately over WS and clear the DB field.
   */
  private async _drainPendingCommand(conn: ObliReachConn): Promise<void> {
    const row = await db('oblireach_devices')
      .where({ device_uuid: conn.deviceUuid, tenant_id: conn.tenantId })
      .first();

    if (!row?.pending_command) return;

    const cmd = JSON.parse(row.pending_command) as OrCommand;

    // Clear first — avoid double-delivery if WS send throws
    await db('oblireach_devices')
      .where({ device_uuid: conn.deviceUuid, tenant_id: conn.tenantId })
      .update({ pending_command: null });

    try {
      conn.ws.send(JSON.stringify(cmd));
      logger.info(
        { deviceUuid: conn.deviceUuid, cmdType: cmd.type },
        'ObliReach: pending command delivered on reconnect',
      );
    } catch (err) {
      logger.error(err, 'ObliReach: failed to deliver drained command');
    }
  }

  /**
   * Handle a heartbeat message from the agent.
   * Updates the DB record (hostname, version, sessions, last_seen_at).
   * Also injects an auto-update command if the agent is outdated.
   */
  private async _handleHeartbeat(conn: ObliReachConn, msg: any): Promise<void> {
    const { deviceUuid, hostname, os, arch, version, sessions } = msg;
    if (!deviceUuid) return;

    // Feature flag check
    const flag = await db('app_config')
      .where({ key: 'integrated_oblireach_enabled' }).first();
    if (flag?.value === 'false') return;

    const sessionsJson = sessions ? JSON.stringify(sessions) : null;

    const existing = await db('oblireach_devices')
      .where({ device_uuid: deviceUuid, tenant_id: conn.tenantId })
      .first();

    if (existing) {
      await db('oblireach_devices')
        .where({ id: existing.id })
        .update({ hostname, os, arch, version, sessions: sessionsJson, last_seen_at: new Date() });
    } else {
      await db('oblireach_devices').insert({
        tenant_id: conn.tenantId, device_uuid: deviceUuid,
        hostname, os, arch, version, sessions: sessionsJson, last_seen_at: new Date(),
      });
    }

    // Auto-update: push update command if agent is outdated.
    // Only fires once per heartbeat cycle that detects a version mismatch.
    if (version) {
      const latest = getLatestVersion();
      if (latest && isOlderVersion(version, latest)) {
        const filename = downloadName(os, arch);
        const updateCmd: OrCommand = {
          type: 'update',
          id: `auto_update_ws_${Date.now()}`,
          payload: { version: latest, url: `/api/agent/download/${filename}` },
        };
        try {
          conn.ws.send(JSON.stringify(updateCmd));
          logger.info({ deviceUuid, version, latest }, 'ObliReach: auto-update pushed via WS');
        } catch { /* ws closed between heartbeat receipt and send — ignore */ }
      }
    }
  }

  /**
   * Push a command directly to a connected agent.
   *
   * Returns `true` if the message was delivered, `false` if the agent is
   * offline — caller should fall back to DB `pending_command` so the command
   * is delivered when the agent next connects.
   */
  push(deviceUuid: string, cmd: OrCommand): boolean {
    const conn = this.byDevice.get(deviceUuid);
    if (!conn || conn.ws.readyState !== 1 /* OPEN */) return false;
    try {
      conn.ws.send(JSON.stringify(cmd));
      return true;
    } catch {
      this._unregister(deviceUuid, conn.ws);
      return false;
    }
  }

  /**
   * Returns true when the agent currently has an open WS command channel.
   * More accurate than the `last_seen_at` heuristic for real-time status.
   */
  isConnected(deviceUuid: string): boolean {
    const conn = this.byDevice.get(deviceUuid);
    return !!conn && conn.ws.readyState === 1;
  }

  connectedCount(): number {
    return this.byDevice.size;
  }

  /**
   * Broadcast a command to ALL connected agents.
   * Used for chat messages where we don't track device→chatId mapping server-side.
   * The agent ignores commands for chatIDs it doesn't own.
   */
  broadcastCommand(cmd: OrCommand): void {
    const json = JSON.stringify(cmd);
    for (const [, conn] of this.byDevice) {
      if (conn.ws.readyState === 1) {
        try { conn.ws.send(json); } catch {}
      }
    }
  }

  /** Broadcast a command only to agents belonging to the specified tenant. */
  broadcastCommandToTenant(tenantId: number, cmd: OrCommand): void {
    const json = JSON.stringify(cmd);
    for (const [, conn] of this.byDevice) {
      if (conn.tenantId === tenantId && conn.ws.readyState === 1) {
        try { conn.ws.send(json); } catch {}
      }
    }
  }
}

export const oblireachHub = new ObliReachHubService();
