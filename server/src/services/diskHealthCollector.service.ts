import { db } from '../db';
import { config } from '../config';
import { logger } from '../utils/logger';
import { commandService } from './command.service';
import { getDiskProbe, type ProbeContext } from './diskHealthProbes';
import { smartctlAsset } from './smartctlAsset.service';

/**
 * Native, server-driven disk-health (SMART) collection.
 *
 * Periodically ships an embedded probe (diskHealthProbes.ts) to the stalest
 * eligible devices via the standard `run_script` command. The result flows back
 * through command.service.ts (source_type='disk_health_probe') into
 * diskHealthService.saveFromScript. ZERO agent change, ZERO admin action —
 * delivered in the server image.
 *
 * Work is spread across ticks (a small BATCH per TICK) so a 2000+ device fleet
 * is probed gradually over INTERVAL_HOURS instead of in one fan-out storm —
 * deliberately gentle given the metrics-push load the server already carries.
 */

const ENABLED = process.env.DISK_HEALTH_PROBE_ENABLED !== 'false';
const INTERVAL_HOURS = Math.max(1, parseInt(process.env.DISK_HEALTH_PROBE_INTERVAL_HOURS || '6', 10));
const TICK_SECONDS = Math.max(30, parseInt(process.env.DISK_HEALTH_PROBE_TICK_SECONDS || '120', 10));
const BATCH = Math.max(1, parseInt(process.env.DISK_HEALTH_PROBE_BATCH || '20', 10));
const PROBE_TIMEOUT_SECONDS = 120;

const ELIGIBLE_OS = ['windows', 'linux', 'macos', 'freebsd'];

class DiskHealthCollector {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  start(): void {
    if (!ENABLED) {
      logger.info('diskHealthCollector: disabled via DISK_HEALTH_PROBE_ENABLED=false');
      return;
    }
    if (this.timer) return;
    this.timer = setInterval(() => { void this.tick(); }, TICK_SECONDS * 1000);
    logger.info(
      { intervalHours: INTERVAL_HOURS, tickSeconds: TICK_SECONDS, batch: BATCH, staticSmartctl: smartctlAsset.anyAvailable() },
      'diskHealthCollector: started',
    );
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  /** Shared download context for this tick (constant across devices except the token).
   *  Public base = APP_URL if set, else CLIENT_ORIGIN (the origin nginx serves and
   *  proxies /api through). null (no self-provisioning) when unusable or no binary. */
  private baseContext(): Omit<ProbeContext, 'toolsToken'> | null {
    const base = (config.appUrl || config.clientOrigin || '').replace(/\/+$/, '');
    if (!base || /localhost|127\.0\.0\.1/.test(base) || !smartctlAsset.anyAvailable()) return null;
    return {
      toolsUrl: `${base}/api/agent-tools/smartctl`,
      sha256Amd64: smartctlAsset.sha256('amd64') ?? undefined,
      sha256Arm64: smartctlAsset.sha256('arm64') ?? undefined,
    };
  }

  private async tick(): Promise<void> {
    if (this.running) return; // never overlap
    this.running = true;
    try {
      const staleBefore = new Date(Date.now() - INTERVAL_HOURS * 3600 * 1000);
      const devices = await db('devices')
        .select('id', 'tenant_id', 'os_type')
        .where({ status: 'online', privacy_mode_enabled: false })
        .whereIn('os_type', ELIGIBLE_OS)
        .where(function () {
          this.whereNull('last_disk_probe_at').orWhere('last_disk_probe_at', '<', staleBefore);
        })
        .orderByRaw('last_disk_probe_at ASC NULLS FIRST')
        .limit(BATCH);

      if (!devices.length) return;
      const base = this.baseContext();

      for (const d of devices) {
        try {
          const ctx: ProbeContext | undefined = base
            ? { ...base, toolsToken: smartctlAsset.signToken(d.id) }
            : undefined;
          const probe = getDiskProbe(d.os_type, ctx);
          if (!probe) continue;

          await commandService.enqueue({
            deviceId: d.id,
            tenantId: d.tenant_id,
            type: 'run_script',
            payload: {
              runtime: probe.runtime,
              content: probe.content,
              timeoutSeconds: PROBE_TIMEOUT_SECONDS,
              expectedExitCode: 0,
              runAs: 'system',
            },
            priority: 'low',
            expiresInSeconds: PROBE_TIMEOUT_SECONDS + 300,
            sourceType: 'disk_health_probe',
          });

          await db('devices').where({ id: d.id }).update({ last_disk_probe_at: new Date() });
        } catch (err) {
          logger.error(err, `diskHealthCollector: failed to enqueue probe for device ${d.id}`);
        }
      }
      logger.debug(`diskHealthCollector: dispatched ${devices.length} probe(s)`);
    } catch (err) {
      logger.error(err, 'diskHealthCollector: tick failed');
    } finally {
      this.running = false;
    }
  }
}

export const diskHealthCollector = new DiskHealthCollector();
