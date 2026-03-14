import { db } from '../db';
import type { NotificationChannel, NotificationChannelType, NotificationBinding, DeviceNotificationTypes, OverrideMode } from '@obliance/shared';

import type { NotificationPayload } from '../notifications/types';
import { getPlugin } from '../notifications/registry';
import { smtpServerService } from './smtpServer.service';
import { config } from '../config';
import { logger } from '../utils/logger';

const DEFAULT_NOTIFICATION_TYPES = { online: true, offline: true, warning: true, critical: true, update: false };
interface ChannelRow {
  id: number;
  name: string;
  type: string;
  config: Record<string, unknown>;
  is_enabled: boolean;
  created_by: number | null;
  tenant_id: number;
  created_at: Date;
  updated_at: Date;
}

interface BindingRow {
  id: number;
  tenant_id: number;
  channel_id: number;
  scope: string;
  scope_id: number | null;
  override_mode: string;
}

function rowToChannel(row: ChannelRow, currentTenantId?: number): NotificationChannel {
  const ch: NotificationChannel = {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    type: row.type as NotificationChannelType,
    config: typeof row.config === 'string' ? JSON.parse(row.config) : row.config,
    uuid: (row as any).uuid ?? '',
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
  return ch;
}

function rowToBinding(row: BindingRow): NotificationBinding {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    channelId: row.channel_id,
    scope: row.scope as NotificationBinding['scope'],
    scopeId: row.scope_id,
    overrideMode: row.override_mode as OverrideMode,
  };
}

export const notificationService = {
  // ── Channel CRUD ──

  async getAllChannels(tenantId: number): Promise<NotificationChannel[]> {
    // Own channels + channels shared to this tenant via the junction table
    const rows = await db<ChannelRow>('notification_channels')
      .where(function () {
        this.where('notification_channels.tenant_id', tenantId)
          .orWhereIn(
            'notification_channels.id',
            db('notification_channel_tenants').select('channel_id').where({ tenant_id: tenantId }),
          );
      })
      .orderBy('name');
    return rows.map((row) => rowToChannel(row, tenantId));
  },

  async getChannelById(id: number): Promise<NotificationChannel | null> {
    const row = await db<ChannelRow>('notification_channels').where({ id }).first();
    return row ? rowToChannel(row) : null;
  },

  async createChannel(data: {
    name: string;
    type: string;
    config: Record<string, unknown>;
    isEnabled?: boolean;
    createdBy?: number;
  }, tenantId: number): Promise<NotificationChannel> {
    const plugin = getPlugin(data.type);
    if (!plugin) throw new Error(`Unknown notification type: ${data.type}`);

    const [row] = await db<ChannelRow>('notification_channels')
      .insert({
        name: data.name,
        type: data.type,
        config: JSON.stringify(data.config) as unknown as Record<string, unknown>,
        is_enabled: data.isEnabled ?? true,
        created_by: data.createdBy ?? null,
        tenant_id: tenantId,
      })
      .returning('*');

    return rowToChannel(row);
  },

  async updateChannel(id: number, data: {
    name?: string;
    config?: Record<string, unknown>;
    isEnabled?: boolean;
  }): Promise<NotificationChannel | null> {
    const updateData: Record<string, unknown> = { updated_at: new Date() };
    if (data.name !== undefined) updateData.name = data.name;
    if (data.config !== undefined) updateData.config = JSON.stringify(data.config);
    if (data.isEnabled !== undefined) updateData.is_enabled = data.isEnabled;

    const [row] = await db<ChannelRow>('notification_channels')
      .where({ id })
      .update(updateData)
      .returning('*');
    return row ? rowToChannel(row) : null;
  },

  async deleteChannel(id: number): Promise<boolean> {
    const count = await db('notification_channels').where({ id }).del();
    return count > 0;
  },

  // ── Cross-tenant channel sharing ──

  /** Returns the list of tenant IDs the channel is shared to (not including its own tenant). */
  async getChannelTenants(channelId: number): Promise<number[]> {
    const rows = await db('notification_channel_tenants')
      .where({ channel_id: channelId })
      .select('tenant_id');
    return rows.map((r: { tenant_id: number }) => r.tenant_id);
  },

  /** Replaces the sharing list for a channel (full replace — not additive). */
  async setChannelTenants(channelId: number, tenantIds: number[]): Promise<void> {
    await db.transaction(async (trx) => {
      await trx('notification_channel_tenants').where({ channel_id: channelId }).del();
      if (tenantIds.length > 0) {
        await trx('notification_channel_tenants').insert(
          tenantIds.map((tenant_id) => ({ channel_id: channelId, tenant_id })),
        );
      }
    });
  },

  /**
   * Resolve the effective config for a channel.
   * For smtp channels using smtpServerId, fetches the SMTP server and injects its credentials.
   * For all other channels, returns config as-is (backward-compat).
   */
  async resolveChannelConfig(channel: NotificationChannel): Promise<Record<string, unknown>> {
    if (channel.type === 'smtp' && channel.config.smtpServerId) {
      const server = await smtpServerService.getTransportConfig(Number(channel.config.smtpServerId));
      if (!server) throw new Error(`SMTP server #${channel.config.smtpServerId} not found`);
      return {
        host: server.host,
        port: server.port,
        secure: server.secure,
        username: server.username,
        password: server.password,
        from: channel.config.fromOverride || server.fromAddress,
        to: channel.config.to,
      };
    }
    return channel.config;
  },

  async testChannel(id: number): Promise<void> {
    const channel = await this.getChannelById(id);
    if (!channel) throw new Error('Channel not found');

    const plugin = getPlugin(channel.type);
    if (!plugin) throw new Error(`No plugin for type: ${channel.type}`);

    const resolvedConfig = await this.resolveChannelConfig(channel);
    await plugin.sendTest(resolvedConfig);
  },

  // ── Bindings ──

  async getBindings(scope: string, scopeId: number | null): Promise<NotificationBinding[]> {
    const rows = await db<BindingRow>('notification_bindings')
      .where({ scope, scope_id: scopeId });
    return rows.map(rowToBinding);
  },

  async addBinding(channelId: number, scope: string, scopeId: number | null, overrideMode: OverrideMode = 'merge'): Promise<NotificationBinding> {
    const [row] = await db<BindingRow>('notification_bindings')
      .insert({
        channel_id: channelId,
        scope,
        scope_id: scopeId,
        override_mode: overrideMode,
      })
      .onConflict(['channel_id', 'scope', 'scope_id'])
      .merge({ override_mode: overrideMode })
      .returning('*');
    return rowToBinding(row);
  },

  async removeBinding(channelId: number, scope: string, scopeId: number | null): Promise<boolean> {
    const count = await db('notification_bindings')
      .where({ channel_id: channelId, scope, scope_id: scopeId })
      .del();
    return count > 0;
  },

  // ── Resolution (merge/replace/exclude inheritance) ──

  /**
   * Apply a set of bindings to the current channel set.
   * 1. If any binding has 'replace' mode → clear the set first
   * 2. Add all 'merge' (and 'replace') bindings to the set
   * 3. Remove all 'exclude' bindings from the set
   */
  _applyBindings(channelIds: Set<number>, bindings: NotificationBinding[]): Set<number> {
    if (bindings.length === 0) return channelIds;

    const hasReplace = bindings.some((b) => b.overrideMode === 'replace');
    if (hasReplace) {
      channelIds = new Set();
    }

    // Add merge/replace bindings
    for (const b of bindings) {
      if (b.overrideMode !== 'exclude') {
        channelIds.add(b.channelId);
      }
    }

    // Remove exclude bindings
    for (const b of bindings) {
      if (b.overrideMode === 'exclude') {
        channelIds.delete(b.channelId);
      }
    }

    return channelIds;
  },

  /**
   * Resolve which channels should fire for a given monitor.
   * Chain: Global → Group ancestors (root→leaf) → Monitor
   * 'merge' = add to parent channels, 'replace' = discard parent channels at that level,
   * 'exclude' = remove a specific channel from the inherited set.
   */
  async resolveChannelsForMonitor(monitorId: number, groupId: number | null): Promise<number[]> {
    let channelIds: Set<number> = new Set();

    // 1. Global bindings
    const globalBindings = await this.getBindings('global', null);
    channelIds = this._applyBindings(channelIds, globalBindings);

    // 2. Group chain (root → leaf)
    if (groupId !== null) {
      const ancestorRows = await db('device_group_closure')
        .where('descendant_id', groupId)
        .orderBy('depth', 'desc')
        .select('ancestor_id');

      for (const row of ancestorRows) {
        const groupBindings = await this.getBindings('group', row.ancestor_id);
        channelIds = this._applyBindings(channelIds, groupBindings);
      }
    }

    // 3. Monitor bindings
    const monitorBindings = await this.getBindings('monitor', monitorId);
    channelIds = this._applyBindings(channelIds, monitorBindings);

    return Array.from(channelIds);
  },

  /**
   * Resolve bindings for a scope WITH source info (for the UI).
   * Shows which channels are active and where they come from.
   * Also tracks excluded channels so the UI can show "Unbind" state.
   */
  async resolveBindingsWithSources(
    scope: 'group' | 'monitor' | 'device',
    scopeId: number,
    groupId?: number | null,
  ): Promise<{
    channelId: number;
    channelName: string;
    channelType: string;
    source: 'global' | 'group' | 'monitor' | 'device';
    sourceId: number | null;
    sourceName: string;
    isDirect: boolean;
    isExcluded: boolean;
  }[]> {
    interface SourceInfo {
      channelId: number;
      source: 'global' | 'group' | 'monitor' | 'device';
      sourceId: number | null;
      sourceName: string;
      isDirect: boolean;
      isExcluded: boolean;
    }

    // Build the inheritance chain
    const result: Map<number, SourceInfo> = new Map();
    // Track excluded channel IDs separately for the final output
    const excludedSet: Set<number> = new Set();

    const applyBindingsWithSources = (
      bindings: NotificationBinding[],
      source: SourceInfo['source'],
      sourceId: number | null,
      sourceName: string,
      isDirect: boolean,
    ) => {
      if (bindings.length === 0) return;

      const hasReplace = bindings.some((b) => b.overrideMode === 'replace');
      if (hasReplace) {
        result.clear();
        excludedSet.clear();
      }

      // Add merge/replace bindings
      for (const b of bindings) {
        if (b.overrideMode !== 'exclude') {
          result.set(b.channelId, {
            channelId: b.channelId,
            source,
            sourceId,
            sourceName,
            isDirect,
            isExcluded: false,
          });
          excludedSet.delete(b.channelId);
        }
      }

      // Process excludes
      for (const b of bindings) {
        if (b.overrideMode === 'exclude') {
          // Keep the entry in result (for UI to show it) but mark as excluded
          const existing = result.get(b.channelId);
          if (existing) {
            existing.isExcluded = true;
          }
          excludedSet.add(b.channelId);
        }
      }
    };

    // 1. Global bindings
    const globalBindings = await this.getBindings('global', null);
    applyBindingsWithSources(globalBindings, 'global', null, 'Global', false);

    // 2. Group chain (for monitor/device scope: walk group ancestors; for group scope: walk parent ancestors)
    const effectiveGroupId = (scope === 'monitor' || scope === 'device') ? groupId : null;

    // For group scope, walk the parent chain (ancestors of this group)
    if (scope === 'group') {
      const ancestorRows = await db('device_group_closure')
        .where('descendant_id', scopeId)
        .where('depth', '>', 0) // exclude self
        .orderBy('depth', 'desc')
        .select('ancestor_id');

      for (const row of ancestorRows) {
        const groupBindings = await this.getBindings('group', row.ancestor_id);
        const groupRow = await db('device_groups').where({ id: row.ancestor_id }).first('name');
        applyBindingsWithSources(
          groupBindings,
          'group',
          row.ancestor_id,
          groupRow?.name || `Group #${row.ancestor_id}`,
          false,
        );
      }
    }

    // For monitor/device scope, walk all group ancestors (including the direct group)
    if ((scope === 'monitor' || scope === 'device') && effectiveGroupId !== null && effectiveGroupId !== undefined) {
      const ancestorRows = await db('device_group_closure')
        .where('descendant_id', effectiveGroupId)
        .orderBy('depth', 'desc')
        .select('ancestor_id');

      for (const row of ancestorRows) {
        const groupBindings = await this.getBindings('group', row.ancestor_id);
        const groupRow = await db('device_groups').where({ id: row.ancestor_id }).first('name');
        applyBindingsWithSources(
          groupBindings,
          'group',
          row.ancestor_id,
          groupRow?.name || `Group #${row.ancestor_id}`,
          false,
        );
      }
    }

    // 3. Direct bindings at this scope
    const directBindings = await this.getBindings(scope, scopeId);
    applyBindingsWithSources(directBindings, scope, scopeId, 'Direct', true);

    // Enrich with channel name/type
    const channelIds = Array.from(result.keys());
    if (channelIds.length === 0) return [];

    const channels = await db<ChannelRow>('notification_channels').whereIn('id', channelIds);
    const channelMap = new Map(channels.map((c) => [c.id, c]));

    return Array.from(result.values()).map((r) => {
      const ch = channelMap.get(r.channelId);
      return {
        ...r,
        channelName: ch?.name || `Channel #${r.channelId}`,
        channelType: ch?.type || 'unknown',
      };
    });
  },

  // ── Send notifications ──

  async sendForMonitor(
    monitorId: number,
    groupId: number | null,
    payload: NotificationPayload,
  ): Promise<void> {
    const channelIds = await this.resolveChannelsForMonitor(monitorId, groupId);
    if (channelIds.length === 0) {
      logger.warn(`No notification channels resolved for monitor ${monitorId} (event: ${payload.newStatus}) — check global/group/monitor bindings`);
      return;
    }

    // Enrich payload with app name from config
    const enrichedPayload: NotificationPayload = { ...payload, appName: config.appName };

    const channels = await db<ChannelRow>('notification_channels')
      .whereIn('id', channelIds)
      .where({ is_enabled: true });

    for (const row of channels) {
      const channel = rowToChannel(row);
      const plugin = getPlugin(channel.type);
      if (!plugin) {
        logger.warn(`No plugin for notification type "${channel.type}"`);
        continue;
      }

      try {
        const resolvedConfig = await this.resolveChannelConfig(channel);
        await plugin.send(resolvedConfig, enrichedPayload);
        await this.logNotification(channel.id, monitorId, 'status_change', true);
        logger.info(`Notification sent: ${channel.name} (${channel.type}) for monitor ${payload.monitorName}`);
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : 'Unknown error';
        await this.logNotification(channel.id, monitorId, 'status_change', false, errMsg);
        logger.error(`Notification failed: ${channel.name} (${channel.type}): ${errMsg}`);
      }
    }
  },

  /**
   * Resolve channels for a group-level notification.
   * Chain: Global → Group ancestors (root→leaf, including the group itself).
   * No monitor-level bindings are included.
   */
  async resolveChannelsForGroup(groupId: number): Promise<number[]> {
    let channelIds: Set<number> = new Set();

    // 1. Global bindings
    const globalBindings = await this.getBindings('global', null);
    channelIds = this._applyBindings(channelIds, globalBindings);

    // 2. Group chain (root → leaf, including self via depth >= 0)
    const ancestorRows = await db('device_group_closure')
      .where('descendant_id', groupId)
      .orderBy('depth', 'desc')
      .select('ancestor_id');

    for (const row of ancestorRows) {
      const groupBindings = await this.getBindings('group', row.ancestor_id);
      channelIds = this._applyBindings(channelIds, groupBindings);
    }

    return Array.from(channelIds);
  },

  /**
   * Resolve which channels should fire for a given agent device.
   * Chain: Global → Agent Group ancestors (root→leaf) → Agent-level bindings.
   */
  async resolveChannelsForAgent(deviceId: number): Promise<number[]> {
    let channelIds: Set<number> = new Set();

    // 1. Global bindings
    const globalBindings = await this.getBindings('global', null);
    channelIds = this._applyBindings(channelIds, globalBindings);

    // 2. Agent group hierarchy (root → leaf)
    const device = await db('devices').where({ id: deviceId }).select('group_id').first() as { group_id: number | null } | undefined;
    if (device?.group_id) {
      const ancestorRows = await db('device_group_closure')
        .where('descendant_id', device.group_id)
        .orderBy('depth', 'desc')
        .select('ancestor_id');

      for (const row of ancestorRows) {
        const groupBindings = await this.getBindings('group', row.ancestor_id);
        channelIds = this._applyBindings(channelIds, groupBindings);
      }
    }

    // 3. Agent-level bindings
    const agentBindings = await this.getBindings('agent', deviceId);
    channelIds = this._applyBindings(channelIds, agentBindings);

    return Array.from(channelIds);
  },

  /**
   * Resolve bindings for an agent device WITH source info (for the UI).
   * Chain: Global → Agent Group ancestors (root→leaf) → Agent-level bindings.
   */
  async resolveBindingsWithSourcesForAgent(
    deviceId: number,
  ): Promise<{
    channelId: number;
    channelName: string;
    channelType: string;
    source: 'global' | 'group' | 'agent';
    sourceId: number | null;
    sourceName: string;
    isDirect: boolean;
    isExcluded: boolean;
  }[]> {
    interface SourceInfo {
      channelId: number;
      source: 'global' | 'group' | 'agent';
      sourceId: number | null;
      sourceName: string;
      isDirect: boolean;
      isExcluded: boolean;
    }

    const result: Map<number, SourceInfo> = new Map();
    const excludedSet: Set<number> = new Set();

    const applyBindingsWithSources = (
      bindings: NotificationBinding[],
      source: SourceInfo['source'],
      sourceId: number | null,
      sourceName: string,
      isDirect: boolean,
    ) => {
      if (bindings.length === 0) return;

      const hasReplace = bindings.some((b) => b.overrideMode === 'replace');
      if (hasReplace) {
        result.clear();
        excludedSet.clear();
      }

      for (const b of bindings) {
        if (b.overrideMode !== 'exclude') {
          result.set(b.channelId, {
            channelId: b.channelId,
            source,
            sourceId,
            sourceName,
            isDirect,
            isExcluded: false,
          });
          excludedSet.delete(b.channelId);
        }
      }

      for (const b of bindings) {
        if (b.overrideMode === 'exclude') {
          const existing = result.get(b.channelId);
          if (existing) {
            existing.isExcluded = true;
          }
          excludedSet.add(b.channelId);
        }
      }
    };

    // 1. Global bindings
    const globalBindings = await this.getBindings('global', null);
    applyBindingsWithSources(globalBindings, 'global', null, 'Global', false);

    // 2. Agent group hierarchy (root → leaf)
    const device = await db('devices').where({ id: deviceId }).select('group_id').first() as { group_id: number | null } | undefined;
    if (device?.group_id) {
      const ancestorRows = await db('device_group_closure')
        .where('descendant_id', device.group_id)
        .orderBy('depth', 'desc')
        .select('ancestor_id');

      for (const row of ancestorRows) {
        const groupBindings = await this.getBindings('group', row.ancestor_id);
        const groupRow = await db('device_groups').where({ id: row.ancestor_id }).first('name') as { name: string } | undefined;
        applyBindingsWithSources(
          groupBindings,
          'group',
          row.ancestor_id,
          groupRow?.name || `Group #${row.ancestor_id}`,
          false,
        );
      }
    }

    // 3. Agent-level bindings
    const agentBindings = await this.getBindings('agent', deviceId);
    applyBindingsWithSources(agentBindings, 'agent', deviceId, 'Direct', true);

    // Enrich with channel name/type
    const channelIds = Array.from(result.keys());
    if (channelIds.length === 0) return [];

    const channels = await db<ChannelRow>('notification_channels').whereIn('id', channelIds);
    const channelMap = new Map(channels.map((c) => [c.id, c]));

    return Array.from(result.values()).map((r) => {
      const ch = channelMap.get(r.channelId);
      return {
        ...r,
        channelName: ch?.name || `Channel #${r.channelId}`,
        channelType: ch?.type || 'unknown',
      };
    });
  },

  /**
   * Resolve the effective notification types for an agent device.
   * Chain: device notification_types → group agentGroupConfig.notificationTypes (ancestor chain) → system defaults.
   * Each field uses the first non-null value found in the chain.
   */
  async resolveNotificationTypesForDevice(deviceId: number): Promise<{
    online: boolean; offline: boolean; warning: boolean; critical: boolean; update: boolean;
  }> {
    // Accumulated values — undefined means "not yet resolved"
    let online: boolean | undefined;
    let offline: boolean | undefined;
    let warning: boolean | undefined;
    let critical: boolean | undefined;
    let update: boolean | undefined;

    const applyConfig = (cfg: DeviceNotificationTypes | null | undefined) => {
      if (!cfg) return;
      if (online === undefined && cfg.online !== null && cfg.online !== undefined) online = cfg.online;
      if (offline  === undefined && cfg.offline  !== null && cfg.offline  !== undefined) offline  = cfg.offline;
      if (warning  === undefined && cfg.warning  !== null && cfg.warning  !== undefined) warning  = cfg.warning;
      if (critical === undefined && cfg.critical !== null && cfg.critical !== undefined) critical = cfg.critical;
      if (update === undefined && cfg.update !== null && cfg.update !== undefined) update = cfg.update;
    };

    // 1. Device-level override
    const deviceRow = await db('devices')
      .where({ id: deviceId })
      .select('group_id', 'notification_types')
      .first() as { group_id: number | null; notification_types: unknown } | undefined;

    if (deviceRow?.notification_types) {
      const nt = typeof deviceRow.notification_types === 'string'
        ? JSON.parse(deviceRow.notification_types)
        : deviceRow.notification_types as DeviceNotificationTypes;
      applyConfig(nt);
    }

    // 2. Walk up the group hierarchy (leaf → root)
    if (deviceRow?.group_id) {
      const ancestorRows = await db('device_group_closure')
        .where('descendant_id', deviceRow.group_id)
        .orderBy('depth', 'asc')
        .select('ancestor_id');

      for (const row of ancestorRows) {
        const groupRow = await db('device_groups')
          .where({ id: row.ancestor_id })
          .select('group_config')
          .first() as { group_config: unknown } | undefined;
        if (groupRow?.group_config) {
          const cfg = typeof groupRow.group_config === 'string'
            ? JSON.parse(groupRow.group_config)
            : groupRow.group_config as { notificationTypes?: DeviceNotificationTypes | null };
          applyConfig(cfg.notificationTypes);
        }
      }
    }

    // 3. Global agent defaults (from app_config agent_global_config)
    if (online === undefined || offline === undefined || warning === undefined || critical === undefined || update === undefined) {
      const { appConfigService } = await import('./appConfig.service');
      const globalTypes = await appConfigService.getResolvedAgentNotificationTypes();
      if (online === undefined) online = globalTypes.online;
      if (offline  === undefined) offline  = globalTypes.offline;
      if (warning  === undefined) warning  = globalTypes.warning;
      if (critical === undefined) critical = globalTypes.critical;
      if (update === undefined) update = globalTypes.update;
    }

    // 4. Hardcoded system defaults for any still-unresolved fields
    return {
      online:   online   ?? DEFAULT_NOTIFICATION_TYPES.online,
      offline:  offline  ?? DEFAULT_NOTIFICATION_TYPES.offline,
      warning:  warning  ?? DEFAULT_NOTIFICATION_TYPES.warning,
      critical: critical ?? DEFAULT_NOTIFICATION_TYPES.critical,
      update: update ?? DEFAULT_NOTIFICATION_TYPES.update,
    };
  },

  /**
   * Send notifications for an agent device threshold alert.
   * Resolves channels using the global → agent chain.
   */
  async sendForAgent(
    deviceId: number,
    deviceName: string,
    newStatus: string,
    previousStatus: string,
    violations?: string[],
    notifType?: 'alert' | 'up' | 'update',
  ): Promise<void> {
    // Only notify on status transitions (up → alert or alert → up)
    if (newStatus === previousStatus) return;

    // Check notification type preferences
    const types = await this.resolveNotificationTypesForDevice(deviceId);
    if (!types.online) {
      logger.info(`Agent notification suppressed (global=off) for device ${deviceId}`);
      return;
    }
    const effectiveType = notifType ?? (newStatus === 'alert' ? 'alert' : 'up');
    if ((effectiveType as string) === 'critical' && !types.critical) {
      logger.info(`Agent notification suppressed (alert type disabled) for device ${deviceId}`);
      return;
    }
    if ((effectiveType as string) === 'warning' && !types.warning) {
      logger.info(`Agent notification suppressed (up type disabled) for device ${deviceId}`);
      return;
    }
    if (effectiveType === 'update' && !types.update) {
      logger.info(`Agent notification suppressed (update type disabled) for device ${deviceId}`);
      return;
    }

    const channelIds = await this.resolveChannelsForAgent(deviceId);
    if (channelIds.length === 0) {
      logger.warn(`No notification channels resolved for agent device ${deviceId} (event: ${newStatus}) — check global/agent bindings`);
      return;
    }

    const payload: NotificationPayload = {
      monitorName: deviceName,
      oldStatus: previousStatus,
      newStatus,
      message: newStatus === 'alert'
        ? (violations && violations.length > 0
            ? violations.join('; ')
            : `Agent device "${deviceName}" has threshold violations`)
        : `Agent device "${deviceName}" metrics are back to normal`,
      timestamp: new Date().toISOString(),
      appName: config.appName,
    };

    const channels = await db<ChannelRow>('notification_channels')
      .whereIn('id', channelIds)
      .where({ is_enabled: true });

    for (const row of channels) {
      const channel = rowToChannel(row);
      const plugin = getPlugin(channel.type);
      if (!plugin) {
        logger.warn(`No plugin for notification type "${channel.type}"`);
        continue;
      }

      try {
        const resolvedConfig = await this.resolveChannelConfig(channel);
        await plugin.send(resolvedConfig, payload);
        await this.logNotification(channel.id, null, 'agent_status_change', true);
        logger.info(`Agent notification sent: ${channel.name} (${channel.type}) for device "${deviceName}"`);
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : 'Unknown error';
        await this.logNotification(channel.id, null, 'agent_status_change', false, errMsg);
        logger.error(`Agent notification failed: ${channel.name} (${channel.type}): ${errMsg}`);
      }
    }
  },

  /**
   * Send a group-level notification (for grouped notifications feature).
   * Resolves channels at the group level (no monitor bindings) and dispatches.
   */
  async sendForGroup(
    groupId: number,
    groupName: string,
    payload: NotificationPayload,
  ): Promise<void> {
    const channelIds = await this.resolveChannelsForGroup(groupId);
    if (channelIds.length === 0) return;

    const enrichedPayload: NotificationPayload = { ...payload, appName: config.appName };

    const channels = await db<ChannelRow>('notification_channels')
      .whereIn('id', channelIds)
      .where({ is_enabled: true });

    for (const row of channels) {
      const channel = rowToChannel(row);
      const plugin = getPlugin(channel.type);
      if (!plugin) {
        logger.warn(`No plugin for notification type "${channel.type}"`);
        continue;
      }

      try {
        const resolvedConfig = await this.resolveChannelConfig(channel);
        await plugin.send(resolvedConfig, enrichedPayload);
        await this.logNotification(channel.id, null, 'group_status_change', true);
        logger.info(`Group notification sent: ${channel.name} (${channel.type}) for group "${groupName}"`);
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : 'Unknown error';
        await this.logNotification(channel.id, null, 'group_status_change', false, errMsg);
        logger.error(`Group notification failed: ${channel.name} (${channel.type}): ${errMsg}`);
      }
    }
  },

  async logNotification(
    channelId: number,
    monitorId: number | null,
    eventType: string,
    success: boolean,
    error?: string,
  ): Promise<void> {
    await db('notification_log').insert({
      channel_id: channelId,
      monitor_id: monitorId,
      event_type: eventType,
      success,
      error: error ?? null,
    });
  },
};
