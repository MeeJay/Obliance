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
    // Multi-trigger: every cron-trigger node has its OWN clock
    // (next_cron_run_at + last_cron_fire_at on scenario_nodes). The
    // tick scans the per-node columns and fires each due node
    // independently — two cron triggers in the same scenario can
    // therefore have entirely different schedules.
    const nodes = await db('scenario_nodes as n')
      .join('scenarios as s', 's.id', 'n.scenario_id')
      .where({ 'n.type': 'trigger_schedule_cron', 's.status': 'active' })
      .where(function() {
        this.whereNull('n.next_cron_run_at').orWhere('n.next_cron_run_at', '<=', now);
      })
      .select(
        'n.id as node_id', 'n.config as node_config',
        'n.next_cron_run_at as next_cron_run_at',
        's.id as scenario_id', 's.tenant_id as tenant_id',
        's.target_type as target_type', 's.target_ids as target_ids',
      ) as Array<{
        node_id: number; node_config: any; next_cron_run_at: Date | null;
        scenario_id: number; tenant_id: number; target_type: string; target_ids: any;
      }>;

    for (const n of nodes) {
      try {
        await this.fireOneNode(n, now);
      } catch (err) {
        logger.error({ err, nodeId: n.node_id }, 'Scenarios v2 cron fire-one (per-node) failed');
      }
    }
  }

  private async fireOneNode(n: {
    node_id: number; node_config: any; next_cron_run_at: Date | null;
    scenario_id: number; tenant_id: number; target_type: string; target_ids: any;
  }, now: Date): Promise<void> {
    const config = typeof n.node_config === 'string' ? JSON.parse(n.node_config) : (n.node_config ?? {});
    const expression: string = config.cronExpression || '0 0 * * *';
    const timezone: string = config.timezone || 'UTC';

    const targetIds = typeof n.target_ids === 'string' ? JSON.parse(n.target_ids) : (n.target_ids ?? []);
    const deviceIds = await this.resolveTargetDevices(n.tenant_id, n.target_type, targetIds);

    // First-ever tick for this trigger node (NULL): prime the next
    // firing time without actually starting a run, so a node that
    // was created hours ago doesn't fire immediately when the
    // server learns about it.
    if (n.next_cron_run_at == null) {
      const nextRun = nextRunFromExpression(expression, timezone, now);
      await db('scenario_nodes').where({ id: n.node_id }).update({
        next_cron_run_at: nextRun,
        last_cron_fire_at: null,
      });
      return;
    }

    for (const deviceId of deviceIds) {
      try {
        await scenarioGraphService.startRun(n.scenario_id, deviceId, {
          triggerType: 'schedule_cron',
          triggerSource: `cron:${expression}`,
          triggerNodeId: n.node_id,
        });
      } catch (err) {
        logger.error({ err, nodeId: n.node_id, deviceId }, 'Scenarios v2 cron startRun failed');
      }
    }

    const nextRun = nextRunFromExpression(expression, timezone, now);
    await db('scenario_nodes').where({ id: n.node_id }).update({
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
