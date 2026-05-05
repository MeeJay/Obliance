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
  /**
   * Render mode chosen by the section. HTML-mode streams are bursty by
   * nature (a `ConvertTo-Html` script dumps the whole document at once)
   * so we skip the per-second throttle for them — otherwise the
   * trailing chunks of a >10KB document would be silently dropped.
   */
  renderMode: 'terminal' | 'html';
  createdAt: number;
  bytesLastSecond: number;
  lastRateReset: number;
  dropped: boolean;
}

// 10 KB/s was the original safety net for an htop-style live terminal —
// way too low for any HTML dashboard (a typical ConvertTo-Html document
// is 10–50 KB delivered in one or two bursts). HTML mode skips the
// throttle entirely (see handleAgentMessage). Terminal mode keeps a
// limit but bumped to 256 KB/s so a `cat` of a small log file doesn't
// silently truncate.
const THROTTLE_BYTES_PER_SEC = 256 * 1024;

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
    const renderMode = section.renderMode === 'html' ? 'html' : 'terminal';
    this.streams.set(streamId, {
      streamId,
      sectionId: params.sectionId,
      deviceId: params.deviceId,
      tenantId: params.tenantId,
      socketId: params.socketId,
      userId: params.userId,
      renderMode,
      createdAt: Date.now(),
      bytesLastSecond: 0,
      lastRateReset: Date.now(),
      dropped: false,
    });

    // HTML mode forces non-PTY: terminal control sequences mangle the
    // document, and most HTML scripts (PowerShell `ConvertTo-Html`) only
    // emit a single document in one shot — no need for line-buffered
    // PTY behaviour.
    const effectiveUsePty = renderMode === 'html' ? false : section.usePty;

    const pushed = agentHub.push(params.deviceId, {
      type: 'command',
      id: streamId,
      commandType: 'start_custom_section',
      payload: {
        streamId,
        command: section.command,
        runtime: section.runtime,
        usePty: effectiveUsePty,
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

    const data: string = payload?.data || '';

    // Throttle check (simple sliding window of 1s). Skipped for HTML
    // streams: those typically arrive as one or two big bursts that
    // exceed the 10 KB/s budget, and dropping the tail truncates the
    // document.
    if (s.renderMode !== 'html') {
      const now = Date.now();
      if (now - s.lastRateReset >= 1000) {
        s.bytesLastSecond = 0;
        s.lastRateReset = now;
        s.dropped = false;
      }
      const size = Math.ceil(data.length * 3 / 4); // base64 -> bytes
      s.bytesLastSecond += size;
      if (s.bytesLastSecond > THROTTLE_BYTES_PER_SEC) {
        if (!s.dropped) {
          logger.warn({
            streamId, sectionId: s.sectionId, bytesLastSecond: s.bytesLastSecond,
            limit: THROTTLE_BYTES_PER_SEC,
          }, 'custom section stream throttled — chunk dropped');
          s.dropped = true;
        }
        return; // drop this chunk
      }
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
