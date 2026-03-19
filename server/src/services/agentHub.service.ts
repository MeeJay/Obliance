import type { WebSocket } from 'ws';
import { db } from '../db';
import { getIO } from '../socket';
import { SocketEvents } from '@obliance/shared';
import { logger } from '../utils/logger';
import { commandService } from './command.service';
import { deviceService } from './device.service';

// ── Types ─────────────────────────────────────────────────────────────────────

interface AgentConn {
  ws: WebSocket;
  deviceId: number;
  tenantId: number;
  /** API key row ID — forwarded to agentService.handlePush */
  apiKeyId: number;
  /** Hardware device UUID — forwarded to agentService.handlePush */
  deviceUuid: string;
  /** Client IP extracted at WS upgrade time */
  clientIp: string;
}

// Message sent FROM server TO agent on the command channel
export interface HubCommand {
  type: 'command';
  id: string;              // unique invocation ID (for ack correlation)
  commandType: string;
  payload: Record<string, unknown>;
}

// Ack sent FROM agent TO server
interface AgentAck {
  type: 'ack';
  id: string;
  commandType: string;
  success: boolean;
  result?: any;
  sessionToken?: string;
  error?: string;
}

// Heartbeat sent FROM agent TO server on the command channel
interface AgentHeartbeat {
  type: 'heartbeat';
  hostname?: string;
  agentVersion?: string;
  osInfo?: Record<string, unknown>;
  metrics?: Record<string, unknown>;
}

// ── Service ───────────────────────────────────────────────────────────────────

class AgentHubService {
  /** deviceId → active connection */
  private byDevice = new Map<number, AgentConn>();

  constructor() {
    // Ping all connected agents every 15 s so the WebSocket stays alive through
    // reverse proxies that close idle connections. 15 s covers proxies with
    // timeouts as low as ~20 s (e.g. cPanel/WHM Nginx custom configuration).
    setInterval(() => {
      for (const [deviceId, conn] of this.byDevice) {
        if (conn.ws.readyState === 1 /* OPEN */) {
          try { (conn.ws as any).ping(); } catch { this._unregister(deviceId, conn.ws); }
        }
      }
    }, 15_000);
  }

  /**
   * Register an agent command-channel WebSocket.
   * If a previous connection for the same device exists it is cleanly replaced.
   * Drains any pending_command stored in the DB immediately on connect.
   */
  async register(
    deviceId: number,
    tenantId: number,
    ws: WebSocket,
    apiKeyId: number,
    deviceUuid: string,
    clientIp: string,
  ): Promise<void> {
    const existing = this.byDevice.get(deviceId);
    if (existing && existing.ws.readyState === 1 /* OPEN */) {
      try { existing.ws.close(1000, 'replaced'); } catch {}
    }
    const conn: AgentConn = { ws, deviceId, tenantId, apiKeyId, deviceUuid, clientIp };
    this.byDevice.set(deviceId, conn);

    ws.on('close', () => this._unregister(deviceId, ws));
    ws.on('error', () => this._unregister(deviceId, ws));
    ws.on('message', async (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString()) as AgentHeartbeat | AgentAck;
        if (msg.type === 'heartbeat') {
          await this._handleHeartbeat(conn, msg as AgentHeartbeat);
        } else if (msg.type === 'ack') {
          await this._handleAck(conn, msg as AgentAck);
        }
      } catch { /* malformed JSON — ignore */ }
    });

    // Drain any command queued in the DB while the agent was offline.
    await this._drainPendingCommand(conn);

    logger.info({ deviceId, deviceUuid }, 'Agent command channel connected');
  }

  private _unregister(deviceId: number, ws: WebSocket): void {
    const existing = this.byDevice.get(deviceId);
    if (existing?.ws === ws) {
      this.byDevice.delete(deviceId);
      logger.info({ deviceId }, 'Agent command channel disconnected');
    }
  }

  /**
   * Deliver any command that was queued in agent_devices.pending_command
   * while the agent was offline. Clears the DB field before delivering so
   * a crash between clear and send at worst skips one command (safe).
   */
  private async _drainPendingCommand(conn: AgentConn): Promise<void> {
    try {
      // Fetch up to 5 pending commands queued while the agent was offline.
      const pending = await db('command_queue')
        .where({ device_id: conn.deviceId, status: 'pending' })
        .orderBy([{ column: 'priority', order: 'desc' }, { column: 'created_at', order: 'asc' }])
        .limit(5);

      if (!pending.length) return;

      // Mark as sent before delivering — avoids re-delivery on reconnect races.
      await db('command_queue')
        .whereIn('id', pending.map((c: any) => c.id))
        .update({ status: 'sent', sent_at: new Date(), updated_at: new Date() });

      if (conn.ws.readyState !== 1 /* OPEN */) return;

      for (const row of pending) {
        const cmd: HubCommand = {
          type: 'command',
          id: row.id,
          commandType: row.type,
          payload: row.payload || {},
        };
        try { conn.ws.send(JSON.stringify(cmd)); } catch { /* socket closed mid-drain */ }
      }
    } catch (e) {
      logger.error(e, 'agentHub: failed to drain pending commands');
    }
  }

  /**
   * Handle a heartbeat from an agent on the command channel.
   * Delegates to agentService.handlePush (same path as the old HTTP push endpoint)
   * and sends a `{ type: "config", ... }` response with the resolved interval,
   * latest version, and any one-shot command.
   */
  private async _handleHeartbeat(conn: AgentConn, msg: AgentHeartbeat): Promise<void> {
    try {
      const response = await deviceService.handlePush(
        conn.deviceId,
        conn.tenantId,
        {
          deviceUuid: conn.deviceUuid,
          agentVersion: msg.agentVersion ?? '',
          metrics: (msg.metrics ?? {}) as any,
          acks: [],
        },
      );

      // Deliver any commands returned by handlePush (it already marked them 'sent').
      if (conn.ws.readyState === 1 /* OPEN */) {
        for (const cmd of response.commands ?? []) {
          const hubCmd: HubCommand = {
            type: 'command',
            id: cmd.id,
            commandType: cmd.type as string,
            payload: cmd.payload,
          };
          try { conn.ws.send(JSON.stringify(hubCmd)); } catch { break; }
        }

        // Config reply so the agent can update its poll interval.
        const configMsg: Record<string, unknown> = { type: 'config' };
        if (response.config?.pushIntervalSeconds) {
          configMsg.checkIntervalSeconds = response.config.pushIntervalSeconds;
        }
        if (response.latestVersion) {
          configMsg.latestVersion = response.latestVersion;
        }
        conn.ws.send(JSON.stringify(configMsg));
      }
    } catch (e) {
      logger.error(e, 'agentHub: failed to handle heartbeat');
    }
  }

  /**
   * Handle an ack message received from an agent on the command channel.
   * All command types are now handled:
   *   - All acks → update command_queue row + emit COMMAND_RESULT to tenant room
   *   - open_remote_tunnel failure → additionally mark session failed
   */
  private async _handleAck(conn: AgentConn, msg: AgentAck): Promise<void> {
    if (msg.type !== 'ack') return;

    // Update command in DB and emit socket event for ALL command types
    try {
      const status = msg.success ? 'success' : 'failure';
      await commandService.processAcks(conn.deviceId, conn.tenantId, [{
        commandId: msg.id,
        status,
        result: msg.result ?? (msg.error ? { error: msg.error } : {}),
      }]);
    } catch (e) {
      logger.error(e, 'Failed to process WS command ack');
    }

    // Special handling: open_remote_tunnel failure → mark session failed
    if (msg.commandType === 'open_remote_tunnel' && !msg.success && msg.sessionToken) {
      const [updated] = await db('remote_sessions')
        .where({ session_token: msg.sessionToken })
        .whereIn('status', ['waiting', 'connecting'])
        .update({ status: 'failed', ended_at: new Date(), end_reason: 'command_failure' })
        .returning('*');

      if (updated) {
        try {
          getIO().to(`tenant:${conn.tenantId}`).emit(SocketEvents.REMOTE_SESSION_UPDATED, {
            id: updated.id, deviceId: updated.device_id, tenantId: updated.tenant_id,
            protocol: updated.protocol, status: updated.status,
            sessionToken: updated.session_token, startedBy: updated.started_by,
            startedAt: updated.started_at, connectedAt: updated.connected_at,
            endedAt: updated.ended_at, durationSeconds: updated.duration_seconds,
            endReason: updated.end_reason, createdAt: updated.created_at,
          });
        } catch {}
        logger.error(
          { sessionToken: msg.sessionToken, error: msg.error, deviceId: conn.deviceId },
          'open_remote_tunnel failed (command channel)',
        );
      }
    }
  }

  /**
   * Push a command directly to a connected agent.
   * Returns true if the message was delivered, false if the agent is not
   * currently connected on the command channel (caller should fall back to
   * the DB command queue).
   */
  push(deviceId: number, cmd: HubCommand): boolean {
    const conn = this.byDevice.get(deviceId);
    if (!conn || conn.ws.readyState !== 1 /* OPEN */) return false;
    try {
      conn.ws.send(JSON.stringify(cmd));
      return true;
    } catch {
      this._unregister(deviceId, conn.ws);
      return false;
    }
  }

  isConnected(deviceId: number): boolean {
    const conn = this.byDevice.get(deviceId);
    return !!conn && conn.ws.readyState === 1;
  }

  connectedCount(): number {
    return this.byDevice.size;
  }
}

export const agentHub = new AgentHubService();
