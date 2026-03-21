import { agentHub, type HubCommand } from './agentHub.service';
import { getIO } from '../socket';
import { auditService } from './audit.service';
import { logger } from '../utils/logger';
import { randomUUID } from 'crypto';

/**
 * File Explorer service — WebSocket-based, no command_queue.
 *
 * Browsing operations (list_directory, download_file) are ephemeral:
 * pushed via agentHub, results relayed to the requesting socket only.
 *
 * Dangerous operations (create_directory, rename_file, delete_file, upload_file)
 * are also pushed via agentHub but additionally logged in audit_logs.
 */

interface PendingRequest {
  socketId: string;
  tenantId: number;
  requestId: string; // client-side ID for matching
}

class FileExplorerService {
  /** Maps agent cmdId → pending request info */
  private pending = new Map<string, PendingRequest>();

  async send(
    deviceId: number,
    tenantId: number,
    socketId: string,
    commandType: string,
    payload: Record<string, any>,
    audit?: { userId?: number; action: string; resourceType?: string; resourcePath?: string; details?: Record<string, unknown>; ipAddress?: string },
    requestId?: string,
  ): Promise<void> {
    const clientId = requestId || randomUUID();
    const cmdId = randomUUID();

    const cmd: HubCommand = {
      type: 'command',
      id: cmdId,
      commandType,
      payload,
    };

    const pushed = agentHub.push(deviceId, cmd);
    if (!pushed) {
      const io = getIO();
      io.to(socketId).emit('FILE_EXPLORER_RESULT', {
        id: clientId,
        commandType,
        status: 'failure',
        result: { error: 'Agent is not connected' },
      });
      return;
    }

    this.pending.set(cmdId, { socketId, tenantId, requestId: clientId });

    if (audit) {
      await auditService.log({
        tenantId,
        userId: audit.userId,
        deviceId,
        action: audit.action,
        resourceType: audit.resourceType,
        resourcePath: audit.resourcePath,
        details: audit.details,
        ipAddress: audit.ipAddress,
      }).catch(err => logger.error(err, 'fileExplorer: audit log failed'));
    }
  }

  /** Called by agentHub when a command ACK arrives. */
  handleResult(cmdId: string, status: string, result: any, commandType?: string): void {
    const req = this.pending.get(cmdId);
    if (!req) return;
    this.pending.delete(cmdId);

    try {
      const io = getIO();
      io.to(req.socketId).emit('FILE_EXPLORER_RESULT', {
        id: req.requestId, // Use client-side ID so browser can match
        commandType,
        status,
        result,
      });
    } catch (err) {
      logger.error(err, 'fileExplorer: failed to relay result to browser');
    }
  }

  removeSocket(socketId: string): void {
    for (const [id, req] of this.pending) {
      if (req.socketId === socketId) {
        this.pending.delete(id);
      }
    }
  }
}

export const fileExplorerService = new FileExplorerService();
