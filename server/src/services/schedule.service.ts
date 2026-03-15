import * as cron from 'node-cron';
import { db } from '../db';
import { logger } from '../utils/logger';
import { commandService } from './command.service';

class ScheduleService {
  private task: cron.ScheduledTask | null = null;

  start() {
    // Check every minute for due schedules
    this.task = cron.schedule('* * * * *', () => this.tick());
    logger.info('Schedule service started');
  }

  stop() {
    this.task?.stop();
  }

  private async tick() {
    try {
      const now = new Date();
      const schedules = await db('script_schedules')
        .where({ enabled: true })
        .where(function() {
          this.where('next_run_at', '<=', now)
              .orWhere('fire_once_at', '<=', now);
        });

      for (const schedule of schedules) {
        await this.runSchedule(schedule, now);
      }
    } catch (err) {
      logger.error(err, 'Schedule tick error');
    }
  }

  private async runSchedule(schedule: any, now: Date) {
    try {
      // Get target devices
      const devices = await this.resolveTargetDevices(schedule);

      for (const device of devices) {
        // Check run conditions
        if (!await this.checkConditions(schedule.run_conditions || [], device)) continue;

            // Create execution record + command
        await this.dispatchExecution(schedule, device, now, false);
      }

      // Handle catch-up: find missed executions
      if (schedule.catchup_enabled && schedule.last_run_at) {
        await this.processCatchup(schedule, now, devices);
      }

      // Update last/next run
      const nextRun = this.computeNextRun(schedule, now);
      await db('script_schedules').where({ id: schedule.id }).update({
        last_run_at: now,
        next_run_at: nextRun,
        updated_at: now,
      });

      // If fire_once, disable after running
      if (schedule.fire_once_at) {
        await db('script_schedules').where({ id: schedule.id }).update({ enabled: false });
      }
    } catch (err) {
      logger.error({ scheduleId: schedule.id, err }, 'Schedule run error');
    }
  }

  private async processCatchup(schedule: any, now: Date, devices: any[]) {
    if (!schedule.cron_expression || !schedule.last_run_at) return;

    // Find missed execution times between last_run_at and now
    const missed = this.getMissedExecutionTimes(
      schedule.cron_expression,
      new Date(schedule.last_run_at),
      now,
      schedule.catchup_max || 3
    );

    for (const missedTime of missed) {
      for (const device of devices) {
        await this.dispatchExecution(schedule, device, now, true, missedTime);
      }
    }
  }

  private getMissedExecutionTimes(cronExpr: string, from: Date, to: Date, max: number): Date[] {
    // Simple implementation: compute missed times using node-cron
    const times: Date[] = [];
    let cursor = new Date(from.getTime() + 60_000); // start 1 min after last run

    while (cursor < to && times.length < max) {
      const task = cron.schedule(cronExpr, () => {});
      // This is a simplified approach - in production use a proper cron parser
      // For now, just return empty (catch-up requires cron-parser library)
      task.stop();
      break;
    }

    return times;
  }

  private computeNextRun(schedule: any, from: Date): Date | null {
    if (schedule.fire_once_at) return null;
    if (!schedule.cron_expression) return null;

    // Simple: add the approximate interval
    // In production, use node-cron or cron-parser to compute next
    return new Date(from.getTime() + 60_000);
  }

  private async resolveTargetDevices(schedule: any) {
    const tenantId = schedule.tenant_id;
    let q = db('devices').where({ tenant_id: tenantId, approval_status: 'approved', status: 'online' });

    if (schedule.target_type === 'device' && schedule.target_id) {
      q = q.where({ id: schedule.target_id });
    } else if (schedule.target_type === 'group' && schedule.target_id) {
      // Get all devices in group and descendants
      const descendants = await db('device_group_closure')
        .where({ ancestor_id: schedule.target_id })
        .pluck('descendant_id');
      q = q.whereIn('group_id', descendants);
    }

    return q;
  }

  private async checkConditions(conditions: any[], device: any): Promise<boolean> {
    if (!conditions?.length) return true;
    for (const cond of conditions) {
      const value = device[cond.field];
      if (cond.operator === 'eq' && value !== cond.value) return false;
      if (cond.operator === 'neq' && value === cond.value) return false;
      if (cond.operator === 'in' && !cond.value.includes(value)) return false;
    }
    return true;
  }

  private async dispatchExecution(
    schedule: any, device: any, now: Date, isCatchup: boolean, catchupForAt?: Date
  ) {
    const script = await db('scripts').where({ id: schedule.script_id }).first();
    if (!script) return;

    // Create script_execution record
    const [exec] = await db('script_executions').insert({
      tenant_id: schedule.tenant_id,
      script_id: schedule.script_id,
      device_id: device.id,
      schedule_id: schedule.id,
      script_snapshot: JSON.stringify({
        id: script.id, name: script.name, platform: script.platform,
        runtime: script.runtime, content: script.content,
        timeoutSeconds: script.timeout_seconds, runAs: script.run_as,
      }),
      parameter_values: JSON.stringify(schedule.parameter_values || {}),
      status: 'pending',
      triggered_by: isCatchup ? 'catchup' : 'schedule',
      triggered_at: now,
      is_catchup: isCatchup,
      catchup_for_at: catchupForAt || null,
    }).returning('*');

    // Enqueue command
    const cmd = await commandService.enqueue({
      deviceId: device.id,
      tenantId: schedule.tenant_id,
      type: 'run_script',
      payload: {
        executionId: exec.id,
        runtime: script.runtime,
        content: script.content,
        parameters: schedule.parameter_values || {},
        timeoutSeconds: script.timeout_seconds,
        expectedExitCode: script.expected_exit_code ?? 0,
        runAs: script.run_as,
      },
      priority: 'normal',
      expiresInSeconds: script.timeout_seconds + 300,
      sourceType: 'script_execution',
      sourceId: exec.id,
    });

    // Link command to execution
    await db('script_executions').where({ id: exec.id }).update({ command_queue_id: cmd.id });
  }

  // Manual execution (from UI)
  async executeNow(scriptId: number, deviceIds: number[], tenantId: number, parameterValues: Record<string, any>, userId: number) {
    const script = await db('scripts').where({ id: scriptId }).first();
    if (!script) throw new Error('Script not found');

    const executions = [];
    for (const deviceId of deviceIds) {
      const device = await db('devices').where({ id: deviceId, tenant_id: tenantId }).first();
      if (!device) continue;

      const [exec] = await db('script_executions').insert({
        tenant_id: tenantId,
        script_id: scriptId,
        device_id: deviceId,
        script_snapshot: JSON.stringify({
          id: script.id, name: script.name, platform: script.platform,
          runtime: script.runtime, content: script.content,
          timeoutSeconds: script.timeout_seconds, runAs: script.run_as,
        }),
        parameter_values: JSON.stringify(parameterValues || {}),
        status: 'pending',
        triggered_by: 'manual',
        triggered_by_user_id: userId,
        triggered_at: new Date(),
        is_catchup: false,
      }).returning('*');

      const cmd = await commandService.enqueue({
        deviceId, tenantId, type: 'run_script',
        payload: {
          executionId: exec.id, runtime: script.runtime, content: script.content,
          parameters: parameterValues, timeoutSeconds: script.timeout_seconds,
          expectedExitCode: script.expected_exit_code ?? 0, runAs: script.run_as,
        },
        priority: 'high', expiresInSeconds: script.timeout_seconds + 300,
        sourceType: 'script_execution', sourceId: exec.id, createdBy: userId,
      });

      await db('script_executions').where({ id: exec.id }).update({ command_queue_id: cmd.id });
      executions.push(exec);
    }
    return executions;
  }
}

export const scheduleService = new ScheduleService();
