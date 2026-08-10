import { randomUUID } from 'crypto';
import { db } from '../db';
import { logger } from '../utils/logger';
import { agentHub, type HubCommand } from './agentHub.service';

/**
 * Rewind (time-machine) PROCESS collector.
 *
 * Periodically snapshots the running processes of each online device so the
 * Rewind tab can show "what was running / what was eating CPU at 14:30 last
 * Tuesday". ZERO agent change: it reuses the existing `list_processes` command
 * (the same one the live process view polls), pushed over the agent WS command
 * channel; the ACK is captured in agentHub._handleAck -> onProcessAck() and
 * stored as ONE jsonb row (top-N processes) in device_process_history.
 *
 * Ephemeral, in-memory correlation (no command_queue rows): each dispatch id is
 * tracked in `pending`; only ids we dispatched get persisted, so the 5s live
 * poll (which also flows through _handleAck) is never written to history.
 *
 * Only WS-connected agents are probed — HTTP-poll / legacy agents simply get no
 * process history (they still get metric + service rewind). Deliberately gentle
 * fan-out: a small BATCH per TICK spreads the fleet over INTERVAL_MINUTES.
 */

const ENABLED = process.env.REWIND_PROC_ENABLED !== 'false';
const INTERVAL_MINUTES = Math.max(1, parseInt(process.env.REWIND_PROC_INTERVAL_MINUTES || '5', 10));
const TICK_SECONDS = Math.max(10, parseInt(process.env.REWIND_PROC_TICK_SECONDS || '20', 10));
const BATCH = Math.max(1, parseInt(process.env.REWIND_PROC_BATCH || '300', 10));
const TOP_N = Math.max(5, parseInt(process.env.REWIND_PROC_TOP_N || '40', 10));
const PENDING_TTL_MS = 90_000;

interface Pending { deviceId: number; tenantId: number; at: number; }
interface RawProc { pid?: unknown; name?: unknown; cpuPercent?: unknown; memBytes?: unknown; user?: unknown; }

function num(v: unknown): number { const n = Number(v); return Number.isFinite(n) ? n : 0; }

class RewindCollector {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private pending = new Map<string, Pending>();

  start(): void {
    if (!ENABLED) { logger.info('rewindCollector: disabled via REWIND_PROC_ENABLED=false'); return; }
    if (this.timer) return;
    this.timer = setInterval(() => { void this.tick(); }, TICK_SECONDS * 1000);
    logger.info({ intervalMinutes: INTERVAL_MINUTES, tickSeconds: TICK_SECONDS, batch: BATCH, topN: TOP_N }, 'rewindCollector: started');
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  private gcPending(): void {
    const cutoff = Date.now() - PENDING_TTL_MS;
    for (const [id, p] of this.pending) if (p.at < cutoff) this.pending.delete(id);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      this.gcPending();
      const staleBefore = new Date(Date.now() - INTERVAL_MINUTES * 60 * 1000);
      const devices = await db('devices')
        .select('id', 'tenant_id')
        .where({ status: 'online', privacy_mode_enabled: false })
        .where(function () {
          this.whereNull('last_process_snapshot_at').orWhere('last_process_snapshot_at', '<', staleBefore);
        })
        .orderByRaw('last_process_snapshot_at ASC NULLS FIRST')
        .limit(BATCH);
      if (!devices.length) return;

      const now = new Date();
      let dispatched = 0;
      for (const d of devices) {
        // Stamp regardless of connectivity so non-WS agents rotate out and don't
        // starve connected ones; they'll be retried in INTERVAL_MINUTES.
        try { await db('devices').where({ id: d.id }).update({ last_process_snapshot_at: now }); } catch { /* ignore */ }

        if (!agentHub.isConnected(d.id)) continue;
        const id = randomUUID();
        const cmd: HubCommand = { type: 'command', id, commandType: 'list_processes', payload: {} };
        if (agentHub.push(d.id, cmd)) {
          this.pending.set(id, { deviceId: d.id, tenantId: d.tenant_id, at: Date.now() });
          dispatched++;
        }
      }
      if (dispatched) logger.debug(`rewindCollector: dispatched ${dispatched} process snapshot(s)`);
    } catch (err) {
      logger.error(err, 'rewindCollector: tick failed');
    } finally {
      this.running = false;
    }
  }

  /** Called from agentHub._handleAck for every list_processes ACK. No-op unless
   *  this id was one WE dispatched (live-poll acks are ignored). Best-effort. */
  async onProcessAck(commandId: string, _deviceId: number, _tenantId: number, processes: any[]): Promise<void> {
    const p = this.pending.get(commandId);
    if (!p) return; // not a rewind capture (e.g. live viewer poll)
    this.pending.delete(commandId);
    try {
      if (!Array.isArray(processes) || !processes.length) return;

      const norm = (processes as RawProc[]).map((x) => ({
        pid: Math.trunc(num(x.pid)),
        name: String(x.name ?? '').slice(0, 128),
        cpu: Math.round(num(x.cpuPercent) * 10) / 10,
        memMb: Math.round(num(x.memBytes) / (1024 * 1024)),
        user: x.user != null ? String(x.user).slice(0, 128) : null,
      }));

      const cpuTotal = Math.round(norm.reduce((s, x) => s + x.cpu, 0) * 10) / 10;
      const memUsedMb = norm.reduce((s, x) => s + x.memMb, 0);

      // Keep top-N by CPU AND top-N by RAM (union, deduped by pid) so both CPU
      // hogs and RAM hogs survive the slice.
      const byCpu = [...norm].sort((a, b) => b.cpu - a.cpu).slice(0, TOP_N);
      const byMem = [...norm].sort((a, b) => b.memMb - a.memMb).slice(0, TOP_N);
      const seen = new Set<number>();
      const top: typeof norm = [];
      for (const x of [...byCpu, ...byMem]) {
        if (seen.has(x.pid)) continue;
        seen.add(x.pid);
        top.push(x);
        if (top.length >= TOP_N) break;
      }
      top.sort((a, b) => b.cpu - a.cpu);

      await db('device_process_history').insert({
        device_id: p.deviceId,
        tenant_id: p.tenantId,
        captured_at: new Date(),
        process_count: norm.length,
        cpu_total: cpuTotal,
        mem_used_mb: memUsedMb,
        procs: JSON.stringify(top),
      });
    } catch (err) {
      logger.error(err, 'rewindCollector: failed to store process snapshot');
    }
  }
}

export const rewindCollector = new RewindCollector();
