import { db } from '../db';
import { logger } from '../utils/logger';
import { getPlugin } from '../notifications/registry';
import { config as appConfig } from '../config';
import type { AutomationNotificationBinding, AutomationNotificationMode } from '@obliance/shared';
import type { NotificationPayload } from '../notifications/types';

/**
 * automationNotification.service — central dispatcher for schedule &
 * scenario notifications. Used by command.service (when a schedule batch
 * finishes) and scenario.service (when a run reaches a terminal state).
 *
 * Two modes per channel binding:
 *
 *   - 'on_error'  : message sent ONLY if at least one device failed. Lists
 *                   failing device names, truncated with "..." to fit 160
 *                   chars (SMS friendly).
 *
 *   - 'summary'   : always sent. Short recap "OK: N / Failed: M", no names.
 */

const SMS_MAX = 160;

interface AggregateResult {
  automationType: 'schedule' | 'scenario';
  automationName: string;
  successCount: number;
  failureCount: number;
  totalCount: number;
  failedDeviceNames: string[];
}

/** Resolve a channel row -> sendable config + plugin, then dispatch.
 *  Visibility rule mirrors `notificationService.getAllChannels(tenantId)`:
 *  a channel is dispatchable from this tenant if it is owned by the tenant
 *  OR shared into it via `notification_channel_tenants` (master-tenant
 *  channel sharing). Without this, scenarios/schedules on a child tenant
 *  that bind a master-owned channel would silently no-op at send time. */
async function dispatch(channelId: number, tenantId: number, subject: string, body: string): Promise<void> {
  const row = await db('notification_channels')
    .where({ id: channelId, is_enabled: true })
    .andWhere(function () {
      this.where('tenant_id', tenantId).orWhereIn(
        'id',
        db('notification_channel_tenants').select('channel_id').where({ tenant_id: tenantId }),
      );
    })
    .first();
  if (!row) return;
  const plugin = getPlugin(row.type);
  if (!plugin) {
    logger.warn({ channelId, type: row.type }, 'automation notification: no plugin for channel type');
    return;
  }
  const payload: NotificationPayload = {
    monitorName: subject,
    oldStatus: 'running',
    newStatus: 'completed',
    message: body,
    timestamp: new Date().toISOString(),
    appName: appConfig.appName,
  };
  try {
    // The plugin handles its own config parsing (secrets resolved from rowsConfig).
    const cfg = typeof row.config === 'string' ? JSON.parse(row.config) : (row.config || {});
    await plugin.send(cfg, payload);
    logger.info({ channelId, subject }, 'automation notification sent');
  } catch (err) {
    logger.error({ err, channelId }, 'automation notification failed');
  }
}

function buildOnErrorMessage(r: AggregateResult): string | null {
  if (r.failureCount === 0) return null;
  const prefix = `[Obliance] "${r.automationName}" failed on ${r.failureCount}/${r.totalCount}`;
  // Try to include device names, truncated to fit SMS_MAX total.
  if (r.failedDeviceNames.length === 0) return prefix;
  const budget = SMS_MAX - prefix.length - 2; // ": " separator
  if (budget <= 10) return prefix;
  let listed = '';
  const ellipsis = '...';
  for (const name of r.failedDeviceNames) {
    const candidate = listed ? `${listed}, ${name}` : name;
    if (candidate.length + ellipsis.length <= budget) {
      listed = candidate;
    } else {
      listed = listed ? `${listed}${ellipsis}` : `${name.slice(0, Math.max(0, budget - ellipsis.length))}${ellipsis}`;
      break;
    }
  }
  return `${prefix}: ${listed}`;
}

function buildSummaryMessage(r: AggregateResult): string {
  return `[Obliance] "${r.automationName}" — OK: ${r.successCount} / Failed: ${r.failureCount}`;
}

/** Per-device message — fires for EVERY device that traversed the node,
 *  regardless of success/failure. Used by `mode: 'per_device'`. */
function buildPerDeviceMessage(r: AggregateResult, deviceName: string, success: boolean): string {
  const verb = success ? 'completed on' : 'failed on';
  return `[Obliance] "${r.automationName}" ${verb} ${deviceName}`;
}

export const automationNotificationService = {
  /**
   * Aggregate dispatch — used by `mode: 'summary'` and legacy
   * `mode: 'on_error'` (failure-only). For per-device dispatch the
   * caller should use `notifyPerDevice` from inside the node executor
   * loop instead.
   */
  async notify(
    tenantId: number,
    bindings: AutomationNotificationBinding[],
    result: AggregateResult,
  ): Promise<void> {
    if (!bindings || bindings.length === 0) return;
    for (const b of bindings) {
      const subject = `${result.automationType === 'schedule' ? 'Schedule' : 'Scenario'}: ${result.automationName}`;
      let body: string | null = null;
      if (b.mode === 'summary') {
        body = buildSummaryMessage(result);
      } else if (b.mode === 'on_error') {
        // Legacy alias kept so old bindings still work; only fires when
        // at least one device failed.
        body = buildOnErrorMessage(result);
      }
      // `per_device` is intentionally a no-op here — it's dispatched
      // per-device from the executor, not from the aggregate hook.
      if (!body) continue;
      await dispatch(b.channelId, tenantId, subject, body);
    }
  },

  /** Per-device hook — call once per (device, completion) for bindings
   *  in `per_device` mode. Skips any binding that isn't per_device. */
  async notifyPerDevice(
    tenantId: number,
    bindings: AutomationNotificationBinding[],
    args: { automationType: 'schedule' | 'scenario'; automationName: string; deviceName: string; success: boolean },
  ): Promise<void> {
    if (!bindings || bindings.length === 0) return;
    for (const b of bindings) {
      if (b.mode !== 'per_device') continue;
      const subject = `${args.automationType === 'schedule' ? 'Schedule' : 'Scenario'}: ${args.automationName}`;
      const body = buildPerDeviceMessage({
        automationType: args.automationType,
        automationName: args.automationName,
        successCount: args.success ? 1 : 0,
        failureCount: args.success ? 0 : 1,
        totalCount: 1,
        failedDeviceNames: args.success ? [] : [args.deviceName],
      }, args.deviceName, args.success);
      await dispatch(b.channelId, tenantId, subject, body);
    }
  },
};
