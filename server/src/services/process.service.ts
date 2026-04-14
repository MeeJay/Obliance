import { agentHub, type HubCommand } from './agentHub.service';
import { getIO } from '../socket';
import { SocketEvents } from '@obliance/shared';
import { privacyGateService } from './privacyGate.service';
import { logger } from '../utils/logger';
import { randomUUID } from 'crypto';

/**
 * Manages process-list subscriptions.
 *
 * When the first browser subscribes to a device's process list, the service
 * starts a polling interval that sends `list_processes` commands to the agent
 * every 5 seconds.  When the last subscriber leaves, the interval is stopped.
 *
 * Process data is never stored in the DB — it is ephemeral and only relayed
 * via socket events.
 */

interface DeviceSub {
  /** Set of socket IDs currently watching */
  viewers: Set<string>;
  /** Interval handle for periodic polling */
  interval: ReturnType<typeof setInterval> | null;
  /** Tenant ID for broadcasting */
  tenantId: number;
  /** User IDs of current viewers — used to look up privacy unlock tokens. */
  viewerUserIds: Set<number>;
}

class ProcessService {
  private subs = new Map<number, DeviceSub>();

  subscribe(deviceId: number, tenantId: number, socketId: string, userId?: number): void {
    let sub = this.subs.get(deviceId);
    if (!sub) {
      sub = { viewers: new Set(), interval: null, tenantId, viewerUserIds: new Set() };
      this.subs.set(deviceId, sub);
    }
    sub.viewers.add(socketId);
    if (userId) sub.viewerUserIds.add(userId);

    // Start polling if this is the first viewer
    if (sub.viewers.size === 1 && !sub.interval) {
      this._poll(deviceId); // immediate first poll
      sub.interval = setInterval(() => this._poll(deviceId), 5_000);
      logger.debug({ deviceId }, 'process: started polling');
    }
  }

  unsubscribe(deviceId: number, socketId: string): void {
    const sub = this.subs.get(deviceId);
    if (!sub) return;
    sub.viewers.delete(socketId);
    if (sub.viewers.size === 0) {
      this._stopPolling(deviceId, sub);
    }
  }

  /** Remove a socket from ALL device subscriptions (called on disconnect). */
  removeSocket(socketId: string): void {
    for (const [deviceId, sub] of this.subs) {
      if (sub.viewers.has(socketId)) {
        sub.viewers.delete(socketId);
        if (sub.viewers.size === 0) {
          this._stopPolling(deviceId, sub);
        }
      }
    }
  }

  /** Called by agentHub when a `list_processes` ACK arrives. */
  broadcast(deviceId: number, tenantId: number, processes: any[]): void {
    getIO().to(`tenant:${tenantId}`).emit(SocketEvents.DEVICE_PROCESSES_UPDATED, {
      deviceId,
      processes,
    });
  }

  private _poll(deviceId: number): void {
    // If any subscriber has a privacy unlock token for 'processes' on this
    // device, attach it. First found wins — all subscribers share the stream.
    let unlockToken: string | null = null;
    const sub = this.subs.get(deviceId);
    if (sub) {
      for (const uid of sub.viewerUserIds) {
        const t = privacyGateService.get(uid, deviceId, 'processes');
        if (t) { unlockToken = t; break; }
      }
    }

    const cmd: HubCommand = {
      type: 'command',
      id: randomUUID(),
      commandType: 'list_processes',
      payload: unlockToken ? { unlockToken } : {},
    };
    // Direct push — no DB queue, no command_queue row (ephemeral).
    const pushed = agentHub.push(deviceId, cmd);
    if (!pushed) {
      logger.debug({ deviceId }, 'process: agent not connected, skipping poll');
    }
  }

  private _stopPolling(deviceId: number, sub: DeviceSub): void {
    if (sub.interval) {
      clearInterval(sub.interval);
      sub.interval = null;
    }
    this.subs.delete(deviceId);
    logger.debug({ deviceId }, 'process: stopped polling');
  }
}

export const processService = new ProcessService();
