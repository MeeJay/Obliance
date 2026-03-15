import { db } from '../db';
import { logger } from '../utils/logger';
import { getIO } from '../socket';
import { SocketEvents } from '@obliance/shared';
import type { Command, CommandAck, CommandType, CommandPriority } from '@obliance/shared';

class CommandService {
  rowToCommand(row: any): Command {
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
      createdAt: row.created_at,
      updatedAt: row.updated_at,
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

    for (const ack of acks) {
      const updates: any = {
        status: ack.status,
        acked_at: new Date(),
        updated_at: new Date(),
        result: JSON.stringify(ack.result || {}),
      };

      const isTerminal = ['success', 'failure', 'timeout'].includes(ack.status);
      if (isTerminal) updates.finished_at = new Date();

      await db('command_queue')
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
            await db('remote_sessions')
              .where({ session_token: payload.sessionToken, status: 'waiting' })
              .update({ status: 'failed', ended_at: new Date(), end_reason: 'command_failure' });
          }
        } catch {}
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
    let q = db('command_queue').where({ tenant_id: tenantId });
    if (filters?.deviceId) q = q.where({ device_id: filters.deviceId });
    if (filters?.status) q = q.where({ status: filters.status });
    const rows = await q.orderBy('created_at', 'desc').limit(100);
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
