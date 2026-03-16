import type { WebSocket } from 'ws';
import { db } from '../db';
import { getIO } from '../socket';
import { SocketEvents } from '@obliance/shared';
import { logger } from '../utils/logger';
import { commandService } from './command.service';

// ── Types ─────────────────────────────────────────────────────────────────────

interface AgentConn {
  ws: WebSocket;
  deviceId: number;
  tenantId: number;
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

// ── Service ───────────────────────────────────────────────────────────────────

class AgentHubService {
  /** deviceId → active connection */
  private byDevice = new Map<number, AgentConn>();

  /**
   * Register an agent command-channel WebSocket.
   * If a previous connection for the same device exists it is cleanly replaced.
   */
  register(deviceId: number, tenantId: number, ws: WebSocket): void {
    const existing = this.byDevice.get(deviceId);
    if (existing && existing.ws.readyState === 1 /* OPEN */) {
      try { existing.ws.close(1000, 'replaced'); } catch {}
    }
    const conn: AgentConn = { ws, deviceId, tenantId };
    this.byDevice.set(deviceId, conn);

    ws.on('close', () => this._unregister(deviceId, ws));
    ws.on('error', () => this._unregister(deviceId, ws));
    ws.on('message', async (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString()) as AgentAck;
        await this._handleAck(conn, msg);
      } catch { /* malformed JSON — ignore */ }
    });

    logger.info({ deviceId }, 'Agent command channel connected');
  }

  private _unregister(deviceId: number, ws: WebSocket): void {
    const existing = this.byDevice.get(deviceId);
    if (existing?.ws === ws) {
      this.byDevice.delete(deviceId);
      logger.info({ deviceId }, 'Agent command channel disconnected');
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
