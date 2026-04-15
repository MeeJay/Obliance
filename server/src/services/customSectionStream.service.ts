import { agentHub } from './agentHub.service';
import { getIO } from '../socket';
import { customSectionService } from './customSection.service';
import { logger } from '../utils/logger';
import { randomUUID } from 'crypto';

/**
 * Custom Section Stream — ephemeral live-output relay between a browser
 * socket and an agent-side process. Two separate viewers on the same
 * (section, device) pair get their OWN streamId (and their own process on
 * the agent), per the user's requirement of isolated sessions.
 *
 * Protocol (server → agent, via agentHub command channel):
 *   start_custom_section { streamId, command, runtime, usePty, cols, rows }
 *   stop_custom_section  { streamId }
 *   resize_custom_section { streamId, cols, rows }
 *
 * Protocol (agent → server, unsolicited ack-like message):
 *   { type: 'custom_section_output', streamId, data }    -- base64 chunk
 *   { type: 'custom_section_closed', streamId, code? }   -- process ended
 *
 * Server → browser (socket.io to the originating socket):
 *   'CUSTOM_SECTION_OUTPUT' { streamId, data }
 *   'CUSTOM_SECTION_CLOSED' { streamId, code? }
 *
 * Throttling: ~10 KB/s per stream, enforced server-side. If the agent
 * bursts more than that, older chunks are dropped (tail wins).
 */

interface ActiveStream {
  streamId: string;
  sectionId: number;
  deviceId: number;
  tenantId: number;
  socketId: string;
  userId: number;
  createdAt: number;
  bytesLastSecond: number;
  lastRateReset: number;
  dropped: boolean;
}

const THROTTLE_BYTES_PER_SEC = 10 * 1024;

class CustomSectionStreamService {
  private streams = new Map<string, ActiveStream>();

  async open(params: {
    deviceId: number;
    sectionId: number;
    tenantId: number;
    socketId: string;
    userId: number;
    cols: number;
    rows: number;
  }): Promise<{ streamId: string } | { error: string }> {
    const section = await customSectionService.getById(params.sectionId, params.tenantId);
    if (!section) return { error: 'Section not found' };

    const streamId = randomUUID();
    this.streams.set(streamId, {
      streamId,
      sectionId: params.sectionId,
      deviceId: params.deviceId,
      tenantId: params.tenantId,
      socketId: params.socketId,
      userId: params.userId,
      createdAt: Date.now(),
      bytesLastSecond: 0,
      lastRateReset: Date.now(),
      dropped: false,
    });

    const pushed = agentHub.push(params.deviceId, {
      type: 'command',
      id: streamId,
      commandType: 'start_custom_section',
      payload: {
        streamId,
        command: section.command,
        runtime: section.runtime,
        usePty: section.usePty,
        cols: params.cols,
        rows: params.rows,
      },
    });
    if (!pushed) {
      this.streams.delete(streamId);
      return { error: 'Agent is not connected' };
    }
    return { streamId };
  }

  close(streamId: string): void {
    const s = this.streams.get(streamId);
    if (!s) return;
    this.streams.delete(streamId);
    agentHub.push(s.deviceId, {
      type: 'command',
      id: randomUUID(),
      commandType: 'stop_custom_section',
      payload: { streamId },
    });
  }

  resize(streamId: string, cols: number, rows: number): void {
    const s = this.streams.get(streamId);
    if (!s) return;
    agentHub.push(s.deviceId, {
      type: 'command',
      id: randomUUID(),
      commandType: 'resize_custom_section',
      payload: { streamId, cols, rows },
    });
  }

  /** Called by agentHub when the agent emits a stream message. */
  handleAgentMessage(deviceId: number, type: 'custom_section_output' | 'custom_section_closed', streamId: string, payload: any): void {
    const s = this.streams.get(streamId);
    if (!s || s.deviceId !== deviceId) return;

    if (type === 'custom_section_closed') {
      this.streams.delete(streamId);
      try {
        getIO().to(s.socketId).emit('CUSTOM_SECTION_CLOSED', { streamId, code: payload?.code });
      } catch {}
      return;
    }

    // Throttle check (simple sliding window of 1s)
    const now = Date.now();
    if (now - s.lastRateReset >= 1000) {
      s.bytesLastSecond = 0;
      s.lastRateReset = now;
      s.dropped = false;
    }
    const data: string = payload?.data || '';
    const size = Math.ceil(data.length * 3 / 4); // base64 -> bytes
    s.bytesLastSecond += size;
    if (s.bytesLastSecond > THROTTLE_BYTES_PER_SEC) {
      if (!s.dropped) {
        logger.debug({ streamId }, 'custom section stream throttled');
        s.dropped = true;
      }
      return; // drop this chunk
    }

    try {
      getIO().to(s.socketId).emit('CUSTOM_SECTION_OUTPUT', { streamId, data });
    } catch {}
  }

  /** Cleanup all streams for a socket that's disconnecting. */
  removeSocket(socketId: string): void {
    for (const [id, s] of this.streams) {
      if (s.socketId === socketId) {
        this.streams.delete(id);
        agentHub.push(s.deviceId, {
          type: 'command',
          id: randomUUID(),
          commandType: 'stop_custom_section',
          payload: { streamId: id },
        });
      }
    }
  }
}

export const customSectionStreamService = new CustomSectionStreamService();
