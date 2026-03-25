import { db } from '../db';
import { logger } from '../utils/logger';
import { getIO } from '../socket';
import { SocketEvents } from '@obliance/shared';
import type { Command, CommandAck, CommandType, CommandPriority } from '@obliance/shared';

class CommandService {
  rowToCommand(row: any): Command {
    // Compute duration from timestamps if not in result
    let durationMs: number | null = null;
    if (row.result?.duration != null) {
      durationMs = row.result.duration;
    } else if (row.sent_at && row.finished_at) {
      durationMs = new Date(row.finished_at).getTime() - new Date(row.sent_at).getTime();
    }
    return {
      id: row.id,
      deviceId: row.device_id,
      tenantId: row.tenant_id,
      type: row.type,
      payload: row.payload || {},
      status: row.status,
      priority: row.priority,
      sentAt: row.sent_at,
      ackedAt: row.acked_at,
      finishedAt: row.finished_at,
      expiresAt: row.expires_at,
      result: row.result || {},
      retryCount: row.retry_count,
      maxRetries: row.max_retries,
      sourceType: row.source_type,
      sourceId: row.source_id,
      createdBy: row.created_by,
      createdByName: row.created_by_name ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      durationMs,
    };
  }

  async enqueue(data: {
    deviceId: number;
    tenantId: number;
    type: CommandType;
    payload?: Record<string, any>;
    priority?: CommandPriority;
    maxRetries?: number;
    expiresInSeconds?: number;
    sourceType?: string;
    sourceId?: string;
    createdBy?: number;
  }): Promise<Command> {
    const expiresAt = data.expiresInSeconds
      ? new Date(Date.now() + data.expiresInSeconds * 1000)
      : null;

    const [row] = await db('command_queue').insert({
      device_id: data.deviceId,
      tenant_id: data.tenantId,
      type: data.type,
      payload: JSON.stringify(data.payload || {}),
      status: 'pending',
      priority: data.priority || 'normal',
      max_retries: data.maxRetries || 0,
      expires_at: expiresAt,
      source_type: data.sourceType,
      source_id: data.sourceId,
      created_by: data.createdBy,
    }).returning('*');

    const cmd = this.rowToCommand(row);

    // Notify via socket that there's a new pending command
    try {
      const io = getIO();
      io.to(`tenant:${data.tenantId}:admin`).emit(SocketEvents.COMMAND_UPDATED, cmd);
    } catch {}

    return cmd;
  }

  async processAcks(deviceId: number, tenantId: number, acks: CommandAck[]) {
    if (!acks?.length) return;

    // UUID v4 pattern — synthetic agent IDs (e.g. periodic scan commands) may
    // not be valid UUIDs and would cause a PostgreSQL "invalid input syntax for
    // type uuid" error.  Skip non-UUID IDs gracefully; they won't match any
    // command_queue row anyway.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    for (const ack of acks) {
      if (!UUID_RE.test(ack.commandId)) continue;

      const updates: any = {
        status: ack.status,
        acked_at: new Date(),
        updated_at: new Date(),
        result: JSON.stringify(ack.result || {}),
      };

      const isTerminal = ['success', 'failure', 'timeout'].includes(ack.status);
      if (isTerminal) updates.finished_at = new Date();

      const affected = await db('command_queue')
        .where({ id: ack.commandId, device_id: deviceId })
        .update(updates);

      // Emit update and keep row for script_execution linkage below
      let row: any;
      try {
        row = await db('command_queue').where({ id: ack.commandId }).first();
        if (row) {
          const io = getIO();
          const cmd = this.rowToCommand(row);
          io.to(`tenant:${tenantId}`).emit(SocketEvents.COMMAND_UPDATED, cmd);
          if (isTerminal) {
            io.to(`tenant:${tenantId}`).emit(SocketEvents.COMMAND_RESULT, cmd);
          }
        }
      } catch {}

      // If a remote tunnel command failed, mark the session as failed so the UI stops waiting
      if (isTerminal && ack.status === 'failure' && row && row.type === 'open_remote_tunnel') {
        try {
          const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : (row.payload || {});
          if (payload.sessionToken) {
            const [updatedSession] = await db('remote_sessions')
              .where({ session_token: payload.sessionToken })
              .whereIn('status', ['waiting', 'connecting'])
              .update({ status: 'failed', ended_at: new Date(), end_reason: 'command_failure' })
              .returning('*');
            if (updatedSession) {
              try {
                const io = getIO();
                io.to(`tenant:${updatedSession.tenant_id}`).emit(SocketEvents.REMOTE_SESSION_UPDATED, {
                  id: updatedSession.id, deviceId: updatedSession.device_id,
                  tenantId: updatedSession.tenant_id, protocol: updatedSession.protocol,
                  status: updatedSession.status, sessionToken: updatedSession.session_token,
                  startedBy: updatedSession.started_by, startedAt: updatedSession.started_at,
                  connectedAt: updatedSession.connected_at, endedAt: updatedSession.ended_at,
                  durationSeconds: updatedSession.duration_seconds,
                  endReason: updatedSession.end_reason, createdAt: updatedSession.created_at,
                });
              } catch {}
            }
          }
        } catch {}
      }

      // When install_update(s) starts running, mark the update(s) as "installing"
      if (!isTerminal && ack.status === 'ack_running' && row && (row.type === 'install_update' || row.type === 'install_updates')) {
        try {
          const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : (row.payload || {});
          const uids: string[] = row.type === 'install_updates'
            ? (payload.updateUids ?? [])
            : (payload.updateUid ? [payload.updateUid] : []);
          if (uids.length) {
            await db('device_updates')
              .whereIn('update_uid', uids)
              .where({ device_id: deviceId })
              .update({ status: 'installing', updated_at: new Date() });
          }
        } catch (updateErr) {
          logger.error(updateErr, 'Failed to update device_updates status to installing from ack_running');
        }
      }

      // When install_update(s) finishes, reflect the outcome in device_updates
      if (isTerminal && row && (row.type === 'install_update' || row.type === 'install_updates')) {
        try {
          const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : (row.payload || {});
          const uids: string[] = row.type === 'install_updates'
            ? (payload.updateUids ?? [])
            : (payload.updateUid ? [payload.updateUid] : []);
          if (uids.length) {
            await db('device_updates')
              .whereIn('update_uid', uids)
              .where({ device_id: deviceId })
              .update({
                status: ack.status === 'success' ? 'installed' : 'failed',
                installed_at: ack.status === 'success' ? new Date() : null,
                install_error: ack.status !== 'success'
                  ? ((ack.result as any)?.error ?? 'Installation failed')
                  : null,
                updated_at: new Date(),
              });
          }
        } catch (updateErr) {
          logger.error(updateErr, 'Failed to update device_updates status from install_update(s) ack');
        }
      }

      // Update linked script execution when the command is terminal
      if (isTerminal && row && row.source_type === 'script_execution' && row.source_id) {
        try {
          const result = ack.result as any;
          const execStatus =
            ack.status === 'success' ? 'success' :
            ack.status === 'timeout' ? 'timeout' : 'failure';

          await db('script_executions').where({ id: row.source_id }).update({
            status: execStatus,
            exit_code: result?.exitCode ?? null,
            stdout: result?.stdout ?? null,
            stderr: result?.stderr ?? null,
            started_at: result?.duration != null
              ? new Date(Date.now() - (result.duration as number))
              : new Date(),
            finished_at: new Date(),
          });
        } catch (execErr) {
          logger.error(execErr, 'Failed to update script_execution from ack');
        }
      }
    }
  }

  async getCommands(tenantId: number, filters?: { deviceId?: number; status?: string }) {
    let q = db('command_queue')
      .select('command_queue.*', db.raw("COALESCE(u.display_name, u.username, u.email) as created_by_name"))
      .leftJoin('users as u', 'command_queue.created_by', 'u.id')
      .where({ 'command_queue.tenant_id': tenantId });
    if (filters?.deviceId) q = q.where({ 'command_queue.device_id': filters.deviceId });
    if (filters?.status) q = q.where({ 'command_queue.status': filters.status });
    const rows = await q.orderBy('command_queue.created_at', 'desc').limit(100);
    return rows.map(this.rowToCommand.bind(this));
  }

  async cancelCommand(id: string, tenantId: number) {
    await db('command_queue')
      .where({ id, tenant_id: tenantId, status: 'pending' })
      .update({ status: 'cancelled', updated_at: new Date() });
  }

  // Expire timed-out commands
  async startCleanupJob() {
    setInterval(async () => {
      try {
        const expired = await db('command_queue')
          .where('expires_at', '<', new Date())
          .whereIn('status', ['pending', 'sent'])
          .update({ status: 'timeout', finished_at: new Date(), updated_at: new Date() })
          .returning('*');

        if (expired.length > 0) {
          logger.info({ count: expired.length }, 'Commands expired');
        }
      } catch (err) {
        logger.error(err, 'Error in command cleanup job');
      }
    }, 60_000); // every minute
  }
}

export const commandService = new CommandService();
