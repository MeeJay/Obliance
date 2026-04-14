import { db } from '../db';
import { logger } from '../utils/logger';
import { getIO } from '../socket';
import { SocketEvents } from '@obliance/shared';
import { privacyGateService } from './privacyGate.service';
import type { Command, CommandAck, CommandType, CommandPriority } from '@obliance/shared';

// Sync-wait map used by privacy-password routes and anywhere else that
// needs to block on the agent's ack for a specific command.
const pendingWaiters = new Map<string, (payload: { status: string; result: any }) => void>();

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

    // Auto-inject privacy unlock token for privacy-gated commands if the
    // caller has an active unlock session on this device for the matching
    // feature. Applies to every command enqueued via this service (files,
    // processes, scripts, remote, etc.), not just /api/commands.
    let payload = data.payload || {};
    if (data.createdBy && privacyGateService.isBlockedByPrivacy(data.type)) {
      const feature = privacyGateService.featureForCommand(data.type);
      const token = privacyGateService.get(data.createdBy, data.deviceId, feature);
      if (token) {
        payload = { ...payload, unlockToken: token };
      }
    }

    const [row] = await db('command_queue').insert({
      device_id: data.deviceId,
      tenant_id: data.tenantId,
      type: data.type,
      payload: JSON.stringify(payload),
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

  /**
   * Wait for a specific command to be acked. Used by sync operations like
   * privacy-password verification where the caller needs the agent's result
   * immediately. Resolves on terminal ack, rejects on timeout.
   */
  waitForResult(commandId: string, timeoutMs = 10000): Promise<{ status: string; result: any }> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingWaiters.delete(commandId);
        reject(new Error('Timed out waiting for agent response'));
      }, timeoutMs);
      pendingWaiters.set(commandId, (payload) => {
        clearTimeout(timer);
        pendingWaiters.delete(commandId);
        resolve(payload);
      });
    });
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

      // Sync waiters (privacy-password routes, etc.) resolve as soon as the
      // terminal ack is received.
      if (isTerminal) {
        const waiter = pendingWaiters.get(ack.commandId);
        if (waiter) waiter({ status: ack.status, result: ack.result });
      }

      const affected = await db('command_queue')
        .where({ id: ack.commandId, device_id: deviceId })
        .update(updates);

      // If no row was updated, this is a synthetic/periodic command from the agent.
      // Insert it into command_queue so it appears in task history (only for terminal acks).
      if (affected === 0 && isTerminal && ack.commandType) {
        try {
          const now = new Date();
          await db('command_queue').insert({
            id: ack.commandId,
            device_id: deviceId,
            tenant_id: tenantId,
            type: ack.commandType,
            payload: JSON.stringify(ack.result || {}),
            status: ack.status,
            priority: 'normal',
            created_at: now,
            sent_at: now,
            acked_at: now,
            ...(isTerminal ? { finished_at: now } : {}),
            result: JSON.stringify(ack.result || {}),
          });
        } catch { /* ignore dupes or missing enum */ }
      }

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

          // ── Schedule Assert Pass: alert / recovery ──────────────────────
          try {
            const exec = await db('script_executions').where({ id: row.source_id }).first();
            if (exec?.schedule_id) {
              const schedule = await db('script_schedules').where({ id: exec.schedule_id }).first();
              if (schedule?.assert_pass) {
                const device = await db('devices').where({ id: deviceId }).first();
                if (execStatus === 'failure' || execStatus === 'timeout') {
                  // Set schedule alert on the device
                  const alertData = {
                    scheduleId: schedule.id,
                    scheduleName: schedule.name,
                    exitCode: result?.exitCode ?? -1,
                    stderr: (result?.stderr ?? result?.error ?? '').slice(0, 2000),
                    failedAt: new Date().toISOString(),
                  };
                  await db('devices').where({ id: deviceId }).update({
                    schedule_alert: JSON.stringify(alertData),
                    updated_at: new Date(),
                  });
                  // Send alert notification
                  try {
                    const { notificationService } = await import('./notification.service');
                    const deviceName = device?.display_name || device?.hostname || `Device #${deviceId}`;
                    const msg = `Schedule "${schedule.name}" failed on ${deviceName} (exit code ${alertData.exitCode})`;
                    const detail = alertData.stderr ? `\n${alertData.stderr.slice(0, 500)}` : '';
                    await notificationService.sendForAgent(deviceId, device?.tenant_id, 'warning', msg + detail);
                  } catch {}
                  // Emit socket event
                  try {
                    const { getIO } = await import('../socket');
                    const { SocketEvents } = await import('@obliance/shared');
                    getIO().to(`tenant:${device?.tenant_id}`).emit(SocketEvents.DEVICE_UPDATED, {
                      id: deviceId, scheduleAlert: alertData,
                    });
                  } catch {}
                } else if (execStatus === 'success' && device?.schedule_alert) {
                  // Check if this is the same schedule that set the alert
                  const currentAlert = typeof device.schedule_alert === 'string'
                    ? JSON.parse(device.schedule_alert)
                    : device.schedule_alert;
                  if (currentAlert?.scheduleId === schedule.id) {
                    // Clear the alert — recovery
                    await db('devices').where({ id: deviceId }).update({
                      schedule_alert: null,
                      updated_at: new Date(),
                    });
                    // Send recovery notification
                    try {
                      const { notificationService } = await import('./notification.service');
                      const deviceName = device?.display_name || device?.hostname || `Device #${deviceId}`;
                      const msg = `Schedule "${schedule.name}" recovered on ${deviceName}`;
                      await notificationService.sendForAgent(deviceId, device?.tenant_id, 'online', msg);
                    } catch {}
                    // Emit socket event
                    try {
                      const { getIO } = await import('../socket');
                      const { SocketEvents } = await import('@obliance/shared');
                      getIO().to(`tenant:${device?.tenant_id}`).emit(SocketEvents.DEVICE_UPDATED, {
                        id: deviceId, scheduleAlert: null,
                      });
                    } catch {}
                  }
                }
              }
            }
          } catch (alertErr) {
            logger.error(alertErr, 'Failed to process schedule assert_pass');
          }
        } catch (execErr) {
          logger.error(execErr, 'Failed to update script_execution from ack');
        }
      }

      // ── Scenario step orchestration ─────────────────────────────────────
      if (isTerminal && row && row.source_type?.startsWith('scenario_step_')) {
        try {
          const result = ack.result as any;
          const { scenarioService } = await import('./scenario.service');
          await scenarioService.handleScenarioCommandAck(
            row.id,
            row.source_type,
            row.source_id,
            result?.exitCode ?? (ack.status === 'success' ? 0 : -1),
            result?.stdout ?? '',
            result?.stderr ?? result?.error ?? '',
          );
        } catch (scenarioErr) {
          logger.error(scenarioErr, 'Failed to process scenario step ack');
        }
      }
    }
  }

  async getCommands(tenantId: number, filters?: { deviceId?: number; status?: string; page?: number; limit?: number }) {
    const limit = filters?.limit ?? 50;
    const page = filters?.page ?? 1;

    let baseQ = db('command_queue').where({ 'command_queue.tenant_id': tenantId });
    if (filters?.deviceId) baseQ = baseQ.where({ 'command_queue.device_id': filters.deviceId });
    if (filters?.status) baseQ = baseQ.where({ 'command_queue.status': filters.status });

    const countResult = await baseQ.clone().count('command_queue.id as count').first();
    const total = parseInt(String((countResult as any)?.count ?? 0));

    let q = baseQ
      .select('command_queue.*', db.raw("COALESCE(u.display_name, u.username, u.email) as created_by_name"))
      .leftJoin('users as u', 'command_queue.created_by', 'u.id')
      .orderBy('command_queue.created_at', 'desc');

    if (limit > 0) {
      q = q.limit(limit).offset((page - 1) * limit);
    }

    const rows = await q;
    return { items: rows.map(this.rowToCommand.bind(this)), total };
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
