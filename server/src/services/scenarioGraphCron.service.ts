import cronParser from 'cron-parser';
import { db } from '../db';
import { logger } from '../utils/logger';
import { scenarioGraphService } from './scenarioGraph.service';
import { permissionService } from './permission.service';

// Phase 1B — cron-tick that fires v2 scenarios with a `trigger_schedule_cron`
// trigger node at the right time. Mirrors the script_schedules tick
// pattern: every minute we read scenarios whose `next_cron_run_at` is due,
// fire startRun for each target device, recompute the next firing time.
// Stateless across restarts — `next_cron_run_at` is a DB column so a
// reboot mid-tick simply skips one cycle, never double-fires.

const TICK_INTERVAL_MS = 60 * 1000;

class ScenarioGraphCron {
  private timer: ReturnType<typeof setInterval> | null = null;

  start(): void {
    if (this.timer) return;
    // First pass on boot — schedules created while the server was down
    // get a chance to catch up. Then steady-state ticks every 60s.
    this.tick().catch((err) => logger.error(err, 'Scenarios v2 cron initial tick failed'));
    this.timer = setInterval(() => {
      this.tick().catch((err) => logger.error(err, 'Scenarios v2 cron tick failed'));
    }, TICK_INTERVAL_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    const now = new Date();
    // Find every active scenario with a cron trigger that is either due
    // or has never been scheduled yet (next_cron_run_at IS NULL — first
    // tick after creation primes the column).
    const scenarios = await db('scenarios')
      .where({ trigger_type: 'schedule_cron', status: 'active' })
      .where(function() {
        this.whereNull('next_cron_run_at').orWhere('next_cron_run_at', '<=', now);
      })
      .select('id', 'tenant_id', 'next_cron_run_at', 'target_type', 'target_ids') as Array<{
        id: number; tenant_id: number; next_cron_run_at: Date | null;
        target_type: string; target_ids: any;
      }>;

    for (const s of scenarios) {
      try {
        await this.fireOne(s, now);
      } catch (err) {
        logger.error({ err, scenarioId: s.id }, 'Scenarios v2 cron fire-one failed');
      }
    }
  }

  private async fireOne(s: { id: number; tenant_id: number; next_cron_run_at: Date | null; target_type: string; target_ids: any }, now: Date): Promise<void> {
    // Read the trigger node's config to extract the cron expression. The
    // config lives on the node so admins edit it from the React Flow
    // editor (Phase 1C) rather than from the legacy scenario form.
    const triggerNode = await db('scenario_nodes')
      .where({ scenario_id: s.id, type: 'trigger_schedule_cron' })
      .first() as { config: any } | undefined;
    if (!triggerNode) {
      // No cron trigger node yet (probably a freshly migrated scenario
      // whose UI hasn't set the expression). Park the schedule by
      // setting next_cron_run_at far in the future so we don't busy-loop.
      await db('scenarios').where({ id: s.id }).update({
        next_cron_run_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
      return;
    }
    const config = typeof triggerNode.config === 'string' ? JSON.parse(triggerNode.config) : (triggerNode.config ?? {});
    const expression: string = config.cronExpression || '0 0 * * *';
    const timezone: string = config.timezone || 'UTC';

    // Resolve target devices via the same selector v1 uses, so a scenario
    // with target_type='group' fires on every approved device under that
    // group's closure, etc.
    const targetIds = typeof s.target_ids === 'string' ? JSON.parse(s.target_ids) : (s.target_ids ?? []);
    const deviceIds = await this.resolveTargetDevices(s.tenant_id, s.target_type, targetIds);

    // First-ever tick for this scenario (column was NULL): prime
    // next_cron_run_at, do NOT fire — the cron tick semantics is
    // "fire AT or AFTER the scheduled instant", and an instant in the
    // past at boot shouldn't trigger surprise runs on every device.
    if (s.next_cron_run_at == null) {
      const nextRun = nextRunFromExpression(expression, timezone, now);
      await db('scenarios').where({ id: s.id }).update({
        next_cron_run_at: nextRun,
        last_cron_fire_at: null,
      });
      return;
    }

    // Fire on every target device.
    for (const deviceId of deviceIds) {
      try {
        await scenarioGraphService.startRun(s.id, deviceId, {
          triggerType: 'schedule_cron',
          triggerSource: `cron:${expression}`,
        });
      } catch (err) {
        logger.error({ err, scenarioId: s.id, deviceId }, 'Scenarios v2 cron startRun failed');
      }
    }

    // Recompute next firing time from "now" (not from the previous
    // scheduled instant) so a cron job that ran 5 minutes late doesn't
    // immediately re-fire to "catch up".
    const nextRun = nextRunFromExpression(expression, timezone, now);
    await db('scenarios').where({ id: s.id }).update({
      next_cron_run_at: nextRun,
      last_cron_fire_at: now,
    });
  }

  private async resolveTargetDevices(tenantId: number, targetType: string, targetIds: number[]): Promise<number[]> {
    // 'all' → every approved device in the tenant
    if (targetType === 'all') {
      const rows = await db('devices')
        .where({ tenant_id: tenantId, approval_status: 'approved' })
        .whereNot({ status: 'pending_uninstall' })
        .select('id') as Array<{ id: number }>;
      return rows.map((r) => r.id);
    }
    if (targetType === 'device') {
      return targetIds;
    }
    if (targetType === 'group') {
      // Include descendants via the closure table — same semantics as v1.
      const desc = await db('device_group_closure')
        .whereIn('ancestor_id', targetIds)
        .select('descendant_id') as Array<{ descendant_id: number }>;
      const groupIds = [...new Set([...targetIds, ...desc.map((d) => d.descendant_id)])];
      const rows = await db('devices')
        .where({ tenant_id: tenantId, approval_status: 'approved' })
        .whereIn('group_id', groupIds)
        .whereNot({ status: 'pending_uninstall' })
        .select('id') as Array<{ id: number }>;
      return rows.map((r) => r.id);
    }
    // 'self' is meaningful only for event triggers — never cron.
    return [];
  }
}

function nextRunFromExpression(expression: string, timezone: string, after: Date): Date {
  try {
    const it = cronParser.parseExpression(expression, { tz: timezone, currentDate: after });
    return it.next().toDate();
  } catch (err) {
    logger.warn({ err, expression, timezone }, 'Scenarios v2 cron — invalid expression, parking 24h');
    return new Date(after.getTime() + 24 * 60 * 60 * 1000);
  }
}

// Reference the unused permissionService import to keep TS happy if a
// future iteration wants to filter targets by user-visible devices.
void permissionService;

export const scenarioGraphCron = new ScenarioGraphCron();
