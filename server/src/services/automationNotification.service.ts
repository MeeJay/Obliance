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

/** Resolve a channel row -> sendable config + plugin, then dispatch. */
async function dispatch(channelId: number, tenantId: number, subject: string, body: string): Promise<void> {
  const row = await db('notification_channels').where({ id: channelId, tenant_id: tenantId, is_enabled: true }).first();
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

export const automationNotificationService = {
  /**
   * Send notifications for a completed automation batch/run according to
   * the configured bindings. Callers provide the aggregate result.
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
      if (b.mode === 'on_error') {
        body = buildOnErrorMessage(result);
      } else if ((b.mode as AutomationNotificationMode) === 'summary') {
        body = buildSummaryMessage(result);
      }
      if (!body) continue;
      await dispatch(b.channelId, tenantId, subject, body);
    }
  },
};
