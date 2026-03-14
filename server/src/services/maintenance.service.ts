import { db } from '../db';
import type { MaintenanceWindow, MaintenanceScopeType, MaintenanceRecurrenceRule } from '@obliance/shared';
import { getPlugin } from '../notifications/registry';
import { config } from '../config';
import { logger } from '../utils/logger';

// ─── DB Row → domain type ───────────────────────────────────────────────────

interface MaintenanceWindowRow {
  id: number;
  tenant_id: number;
  name: string;
  scope_type: string;
  scope_id: number | null;
  schedule_type: string;
  starts_at: Date;
  ends_at: Date;
  recurrence_rule: MaintenanceRecurrenceRule;
  timezone: string;
  notification_channels: number[];
  last_dedup_key: string | null;
  created_by: number | null;
  created_at: Date;
  updated_at: Date;
}

function rowToWindow(row: MaintenanceWindowRow): MaintenanceWindow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    scopeType: row.scope_type as MaintenanceWindow['scopeType'],
    scopeId: row.scope_id,
    scheduleType: row.schedule_type as MaintenanceWindow['scheduleType'],
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    recurrenceRule: row.recurrence_rule ?? {},
    timezone: row.timezone,
    notificationChannels: row.notification_channels ?? [],
    lastDedupKey: row.last_dedup_key,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

// ─── Time helpers ────────────────────────────────────────────────────────────

/**
 * Get the current HH:MM time string in a given IANA timezone.
 */
function getNowTimeInTz(timezone: string, now: Date): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);
    const h = parts.find((p) => p.type === 'hour')?.value ?? '00';
    const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
    return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
  } catch {
    return '00:00';
  }
}

/**
 * Get the current day of week (0=Mon … 6=Sun) in a given IANA timezone.
 */
function getNowDayOfWeekInTz(timezone: string, now: Date): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
    }).formatToParts(now);
    const weekday = parts.find((p) => p.type === 'weekday')?.value;
    const map: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
    return map[weekday ?? ''] ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Check if a given HH:MM time is within [startTime, endTime] range.
 * Handles overnight ranges (e.g. 23:00 – 01:00).
 */
function isTimeInRange(currentTime: string, startTime: string, endTime: string): boolean {
  if (startTime <= endTime) {
    return currentTime >= startTime && currentTime <= endTime;
  }
  // Overnight range
  return currentTime >= startTime || currentTime <= endTime;
}

/**
 * Pure function: check if a single maintenance window is currently active.
 */
export function isWindowActive(window: MaintenanceWindow, now: Date = new Date()): boolean {
  if (window.scheduleType === 'one_time') {
    const start = new Date(window.startsAt);
    const end = new Date(window.endsAt);
    return now >= start && now <= end;
  }

  // recurring
  const rule = window.recurrenceRule;
  if (!rule.time || rule.duration === undefined) return false;

  // Parse HH:MM start time and compute end time from duration (minutes)
  const [startHour, startMin] = rule.time.split(':').map(Number);
  if (isNaN(startHour) || isNaN(startMin)) return false;

  const startMinutes = startHour * 60 + startMin;
  const endMinutes = startMinutes + rule.duration;
  const endHour = Math.floor(endMinutes / 60) % 24;
  const endMin = endMinutes % 60;

  const startTime = `${String(startHour).padStart(2, '0')}:${String(startMin).padStart(2, '0')}`;
  const endTime = `${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}`;

  const currentTime = getNowTimeInTz(window.timezone, now);

  if (rule.frequency === 'daily') {
    return isTimeInRange(currentTime, startTime, endTime);
  }

  if (rule.frequency === 'weekly') {
    if (!rule.daysOfWeek || rule.daysOfWeek.length === 0) return false;
    const currentDay = getNowDayOfWeekInTz(window.timezone, now);
    return rule.daysOfWeek.includes(currentDay) &&
      isTimeInRange(currentTime, startTime, endTime);
  }

  return false;
}

// ─── Cache ───────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 60_000; // 60 seconds

interface CacheEntry {
  value: boolean;
  cachedAt: number;
}

const maintenanceCache = new Map<string, CacheEntry>();

function getCached(key: string): boolean | null {
  const entry = maintenanceCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    maintenanceCache.delete(key);
    return null;
  }
  return entry.value;
}

function setCache(key: string, value: boolean): void {
  maintenanceCache.set(key, { value, cachedAt: Date.now() });
}

// ─── Background job handles ───────────────────────────────────────────────────

let cleanupTimer: ReturnType<typeof setInterval> | null = null;
let transitionTimer: ReturnType<typeof setInterval> | null = null;

// ─── Core service ─────────────────────────────────────────────────────────────

export const maintenanceService = {
  // ── CRUD ──────────────────────────────────────────────────────────────────

  async list(tenantId: number, filters?: { scopeType?: string; scopeId?: number }): Promise<MaintenanceWindow[]> {
    const query = db<MaintenanceWindowRow>('maintenance_windows').where({ tenant_id: tenantId }).orderBy('created_at', 'desc');
    if (filters?.scopeType) {
      query.where({ scope_type: filters.scopeType });
      // For 'global', scope_id is NULL — do not add a scopeId filter
      if (filters.scopeType !== 'global' && filters?.scopeId !== undefined) {
        query.where({ scope_id: filters.scopeId });
      }
    } else if (filters?.scopeId !== undefined) {
      query.where({ scope_id: filters.scopeId });
    }
    const rows = await query;
    return rows.map(rowToWindow);
  },

  async getById(id: number): Promise<MaintenanceWindow | null> {
    const row = await db<MaintenanceWindowRow>('maintenance_windows').where({ id }).first();
    return row ? rowToWindow(row) : null;
  },

  async create(data: {
    name: string;
    scopeType: MaintenanceScopeType;
    scopeId?: number | null;
    scheduleType: string;
    startsAt: string;
    endsAt: string;
    recurrenceRule?: MaintenanceRecurrenceRule;
    timezone?: string;
    notificationChannels?: number[];
    createdBy?: number | null;
    tenantId: number;
  }): Promise<MaintenanceWindow> {
    const [row] = await db<MaintenanceWindowRow>('maintenance_windows')
      .insert({
        name: data.name,
        scope_type: data.scopeType,
        scope_id: data.scopeId ?? null,
        schedule_type: data.scheduleType,
        starts_at: new Date(data.startsAt),
        ends_at: new Date(data.endsAt),
        recurrence_rule: data.recurrenceRule ?? {},
        timezone: data.timezone ?? 'UTC',
        notification_channels: data.notificationChannels ?? [],
        last_dedup_key: null,
        created_by: data.createdBy ?? null,
        tenant_id: data.tenantId,
      })
      .returning('*');
    maintenanceCache.clear();
    return rowToWindow(row);
  },

  async update(id: number, data: {
    name?: string;
    scopeType?: MaintenanceScopeType;
    scopeId?: number | null;
    scheduleType?: string;
    startsAt?: string;
    endsAt?: string;
    recurrenceRule?: MaintenanceRecurrenceRule;
    timezone?: string;
    notificationChannels?: number[];
  }): Promise<MaintenanceWindow | null> {
    const patch: Record<string, unknown> = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.scopeType !== undefined) patch.scope_type = data.scopeType;
    if ('scopeId' in data) patch.scope_id = data.scopeId ?? null;
    if (data.scheduleType !== undefined) patch.schedule_type = data.scheduleType;
    if (data.startsAt !== undefined) patch.starts_at = new Date(data.startsAt);
    if (data.endsAt !== undefined) patch.ends_at = new Date(data.endsAt);
    if (data.recurrenceRule !== undefined) patch.recurrence_rule = data.recurrenceRule;
    if (data.timezone !== undefined) patch.timezone = data.timezone;
    if (data.notificationChannels !== undefined) patch.notification_channels = data.notificationChannels;

    if (Object.keys(patch).length === 0) return this.getById(id);

    const [row] = await db<MaintenanceWindowRow>('maintenance_windows')
      .where({ id })
      .update(patch)
      .returning('*');

    maintenanceCache.clear();
    return row ? rowToWindow(row) : null;
  },

  async delete(id: number): Promise<void> {
    await db('maintenance_windows').where({ id }).del();
    maintenanceCache.clear();
  },

  // ── Disable / Enable ───────────────────────────────────────────────────────

  /**
   * Disable an inherited maintenance window at the given scope.
   * Silently ignores duplicate disables (ON CONFLICT DO NOTHING).
   */
  async disableWindowForScope(
    windowId: number,
    scopeType: 'group' | 'device',
    scopeId: number,
  ): Promise<void> {
    await db('maintenance_window_disables')
      .insert({ window_id: windowId, scope_type: scopeType, scope_id: scopeId })
      .onConflict(['window_id', 'scope_type', 'scope_id'])
      .ignore();
    maintenanceCache.clear();
  },

  /**
   * Re-enable a previously disabled inherited maintenance window at the given scope.
   */
  async enableWindowForScope(
    windowId: number,
    scopeType: 'group' | 'device',
    scopeId: number,
  ): Promise<void> {
    await db('maintenance_window_disables')
      .where({ window_id: windowId, scope_type: scopeType, scope_id: scopeId })
      .del();
    maintenanceCache.clear();
  },

  // ── Scope queries ──────────────────────────────────────────────────────────

  async getWindowsForScope(scopeType: MaintenanceScopeType, scopeId: number): Promise<MaintenanceWindow[]> {
    const rows = await db<MaintenanceWindowRow>('maintenance_windows')
      .where({ scope_type: scopeType, scope_id: scopeId });
    return rows.map(rowToWindow);
  },

  /**
   * Get the ancestor group IDs for a given group (including itself).
   */
  async getAncestorGroupIds(groupId: number): Promise<number[]> {
    const rows = await db('device_group_closure')
      .where('descendant_id', groupId)
      .select('ancestor_id');
    return rows.map((r: { ancestor_id: number }) => r.ancestor_id);
  },

  /**
   * Build the set of disabled window IDs for a given scope entity.
   *
   * Disables come from two sources:
   *   1. Disables placed directly on this entity
   *   2. Disables placed on any ancestor group (propagated down)
   */
  async getDisabledWindowIds(
    scopeType: 'device' | 'group',
    scopeId: number,
    ancestorGroupIds: number[],
  ): Promise<Set<number>> {
    const rows = await db('maintenance_window_disables')
      .where(function () {
        this.where({ scope_type: scopeType, scope_id: scopeId });
        if (ancestorGroupIds.length > 0) {
          this.orWhere(function () {
            this.where('scope_type', 'group').whereIn('scope_id', ancestorGroupIds);
          });
        }
      })
      .select('window_id');

    return new Set(rows.map((r: { window_id: number }) => r.window_id));
  },

  /**
   * Build the set of window IDs disabled DIRECTLY at this scope (not via ancestors).
   * Used for the canEnable flag.
   */
  async getDirectlyDisabledWindowIds(
    scopeType: 'device' | 'group',
    scopeId: number,
  ): Promise<Set<number>> {
    const rows = await db('maintenance_window_disables')
      .where({ scope_type: scopeType, scope_id: scopeId })
      .select('window_id');
    return new Set(rows.map((r: { window_id: number }) => r.window_id));
  },

  // ── Effective Windows ─────────────────────────────────────────────────────

  /**
   * Get all maintenance windows that apply to a scope entity, with source metadata.
   * Returned sorted: local first, then group (by ancestor proximity), then global.
   * Each window carries: source, sourceId, sourceName, isDisabledHere,
   * canEdit, canDelete, canDisable, canEnable.
   */
  async getEffectiveWindows(
    scopeType: 'device' | 'group',
    scopeId: number,
    groupId?: number | null,
  ): Promise<Array<MaintenanceWindow & { isActiveNow: boolean; source?: string; sourceId?: number | null; sourceName?: string; isDisabledHere?: boolean; canEdit?: boolean; canDelete?: boolean; canDisable?: boolean; canEnable?: boolean }>> {
    const now = new Date();
    const result: Array<MaintenanceWindow & { isActiveNow: boolean; source?: string; sourceId?: number | null; sourceName?: string; isDisabledHere?: boolean; canEdit?: boolean; canDelete?: boolean; canDisable?: boolean; canEnable?: boolean }> = [];

    // 1. Ancestor group IDs
    const ancestorGroupIds: number[] = groupId
      ? await this.getAncestorGroupIds(groupId)
      : (scopeType === 'group' ? await this.getAncestorGroupIds(scopeId) : []);

    // 2. Disables for this entity (own + ancestor-group disables)
    const disabledIds = await this.getDisabledWindowIds(scopeType, scopeId, ancestorGroupIds);

    // 3. Disables placed directly at this scope (for canEnable)
    const directlyDisabledIds = await this.getDirectlyDisabledWindowIds(scopeType, scopeId);

    // ── Local windows (owned by this scope) ──────────────────────────────────
    const localRows = await db<MaintenanceWindowRow>('maintenance_windows')
      .where({ scope_type: scopeType, scope_id: scopeId });
    for (const row of localRows) {
      const w = rowToWindow(row);
      result.push({
        ...w,
        isActiveNow: isWindowActive(w, now),
        source: 'local',
        sourceId: scopeId,
        sourceName: undefined,
        isDisabledHere: false,
        canEdit: true,
        canDelete: true,
        canDisable: false,
        canEnable: false,
      });
    }

    // ── Group windows from ancestor groups ────────────────────────────────────
    // For a group scope: ancestors = parent groups only (self already in local)
    const groupAncestorIds = scopeType === 'group'
      ? ancestorGroupIds.filter((id) => id !== scopeId)
      : ancestorGroupIds;

    if (groupAncestorIds.length > 0) {
      const groupRows = await db<MaintenanceWindowRow>('maintenance_windows')
        .where({ scope_type: 'group' })
        .whereIn('scope_id', groupAncestorIds);

      const groupNames = new Map<number, string>();
      try {
        const nameRows = await db('device_groups')
          .whereIn('id', groupAncestorIds)
          .select('id', 'name');
        for (const nr of nameRows) groupNames.set(nr.id, nr.name);
      } catch { /* ignore */ }

      for (const row of groupRows) {
        const w = rowToWindow(row);
        const isDisabledHere = disabledIds.has(w.id);
        const isDirectlyDisabled = directlyDisabledIds.has(w.id);
        result.push({
          ...w,
          isActiveNow: isWindowActive(w, now),
          source: 'group',
          sourceId: w.scopeId,
          sourceName: groupNames.get(w.scopeId!) ?? `Group #${w.scopeId}`,
          isDisabledHere,
          canEdit: false,
          canDelete: false,
          canDisable: !isDisabledHere,
          canEnable: isDirectlyDisabled,
        });
      }
    }

    // ── Global windows ────────────────────────────────────────────────────────
    const globalRows = await db<MaintenanceWindowRow>('maintenance_windows')
      .where({ scope_type: 'global' });

    for (const row of globalRows) {
      const w = rowToWindow(row);
      const isDisabledHere = disabledIds.has(w.id);
      const isDirectlyDisabled = directlyDisabledIds.has(w.id);
      result.push({
        ...w,
        isActiveNow: isWindowActive(w, now),
        source: 'global',
        sourceId: null,
        sourceName: 'Global',
        isDisabledHere,
        canEdit: false,
        canDelete: false,
        canDisable: !isDisabledHere,
        canEnable: isDirectlyDisabled,
      });
    }

    return result;
  },

  // ── isInMaintenance (cached, new additive inheritance) ────────────────────

  /**
   * Check whether a device is currently in maintenance.
   * Additive logic: global + group + own windows, minus any that are disabled at
   * this scope (directly or via ancestor groups).
   */
  async isInMaintenance(
    scopeType: 'device',
    scopeId: number,
    groupId?: number | null,
  ): Promise<boolean> {
    const cacheKey = `${scopeType}:${scopeId}:${groupId ?? 'null'}`;
    const cached = getCached(cacheKey);
    if (cached !== null) return cached;

    const now = new Date();

    // 1. Ancestor group IDs
    const ancestorGroupIds: number[] = groupId
      ? await this.getAncestorGroupIds(groupId)
      : [];

    // 2. Build set of disabled window IDs for this entity
    const disabledIds = await this.getDisabledWindowIds(scopeType, scopeId, ancestorGroupIds);

    const disabledArr = disabledIds.size > 0 ? [...disabledIds] : [-1];

    // 3a. Own windows — always included
    const ownRows = await db<MaintenanceWindowRow>('maintenance_windows')
      .where({ scope_type: scopeType, scope_id: scopeId });
    const ownWindows = ownRows.map(rowToWindow);
    if (ownWindows.some((w) => isWindowActive(w, now))) {
      setCache(cacheKey, true);
      return true;
    }

    // 3b. Group windows from ancestors (minus disabled)
    if (ancestorGroupIds.length > 0) {
      const groupRows = await db<MaintenanceWindowRow>('maintenance_windows')
        .where({ scope_type: 'group' })
        .whereIn('scope_id', ancestorGroupIds)
        .whereNotIn('id', disabledArr);
      if (groupRows.map(rowToWindow).some((w) => isWindowActive(w, now))) {
        setCache(cacheKey, true);
        return true;
      }
    }

    // 3c. Global windows (minus disabled)
    const globalRows = await db<MaintenanceWindowRow>('maintenance_windows')
      .where({ scope_type: 'global' })
      .whereNotIn('id', disabledArr);
    if (globalRows.map(rowToWindow).some((w) => isWindowActive(w, now))) {
      setCache(cacheKey, true);
      return true;
    }

    setCache(cacheKey, false);
    return false;
  },

  /**
   * Batch check: returns the set of device IDs that are currently in maintenance.
   * Used by the device list API to avoid N+1 queries.
   */
  async getInMaintenanceDeviceIds(devices: Array<{ id: number; groupId: number | null }>): Promise<Set<number>> {
    const result = new Set<number>();
    const now = new Date();

    // Fetch all windows in one query (including global)
    const allWindows = await db<MaintenanceWindowRow>('maintenance_windows')
      .select('*');
    const windows = allWindows.map(rowToWindow);

    const globalWindows = windows.filter((w) => w.scopeType === 'global');

    // Build ancestor map for all unique group IDs
    const groupIds = [...new Set(devices.map((d) => d.groupId).filter((g): g is number => g !== null))];
    const ancestorMap = new Map<number, number[]>();
    if (groupIds.length > 0) {
      const closureRows = await db('device_group_closure')
        .whereIn('descendant_id', groupIds)
        .select('descendant_id', 'ancestor_id');
      for (const row of closureRows) {
        if (!ancestorMap.has(row.descendant_id)) ancestorMap.set(row.descendant_id, []);
        ancestorMap.get(row.descendant_id)!.push(row.ancestor_id);
      }
    }

    // Fetch all disables for devices + their ancestor groups in one query
    const allDeviceIds = devices.map((d) => d.id);
    const allAncestorIds = [...new Set([...ancestorMap.values()].flat())];

    const disableRows = await db('maintenance_window_disables')
      .where(function () {
        this.where('scope_type', 'device').whereIn('scope_id', allDeviceIds);
        if (allAncestorIds.length > 0) {
          this.orWhere(function () {
            this.where('scope_type', 'group').whereIn('scope_id', allAncestorIds);
          });
        }
      })
      .select('window_id', 'scope_type', 'scope_id');

    // Build per-device and per-group disable sets
    const deviceDisables = new Map<number, Set<number>>();
    const groupDisables = new Map<number, Set<number>>();
    for (const row of disableRows) {
      if (row.scope_type === 'device') {
        if (!deviceDisables.has(row.scope_id)) deviceDisables.set(row.scope_id, new Set());
        deviceDisables.get(row.scope_id)!.add(row.window_id);
      } else if (row.scope_type === 'group') {
        if (!groupDisables.has(row.scope_id)) groupDisables.set(row.scope_id, new Set());
        groupDisables.get(row.scope_id)!.add(row.window_id);
      }
    }

    for (const device of devices) {
      const ancestorIds = device.groupId ? (ancestorMap.get(device.groupId) ?? []) : [];

      // Effective disabled window IDs for this device
      const disabledIds = new Set<number>();
      for (const id of (deviceDisables.get(device.id) ?? [])) disabledIds.add(id);
      for (const gid of ancestorIds) {
        for (const id of (groupDisables.get(gid) ?? [])) disabledIds.add(id);
      }

      // Own windows — always applicable
      const ownWindows = windows.filter((w) => w.scopeType === 'device' && w.scopeId === device.id);
      if (ownWindows.some((w) => isWindowActive(w, now))) {
        result.add(device.id);
        continue;
      }

      // Group windows from ancestors (minus disabled)
      const groupWindows = device.groupId
        ? windows.filter((w) =>
            w.scopeType === 'group' &&
            ancestorIds.includes(w.scopeId!) &&
            !disabledIds.has(w.id)
          )
        : [];
      if (groupWindows.some((w) => isWindowActive(w, now))) {
        result.add(device.id);
        continue;
      }

      // Global windows (minus disabled)
      const applicableGlobals = globalWindows.filter((w) => !disabledIds.has(w.id));
      if (applicableGlobals.some((w) => isWindowActive(w, now))) {
        result.add(device.id);
        continue;
      }
    }

    return result;
  },

  // ── Background jobs ────────────────────────────────────────────────────────

  /**
   * Delete one-time windows that expired more than 30 days ago.
   * Windows are kept for 30 days so admins can review past maintenance periods
   * on the Maintenance page (they appear as greyed-out expired entries).
   */
  async cleanupExpiredOneTime(): Promise<void> {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await db('maintenance_windows')
      .where({ schedule_type: 'one_time' })
      .where('ends_at', '<', cutoff)
      .del();
  },

  /**
   * Send start/end notifications for windows that just became active or inactive.
   * Uses last_dedup_key to deduplicate: key is "start:<startsAt>" when notified of start,
   * and "end:<startsAt>" when notified of end.
   */
  async checkMaintenanceTransitions(): Promise<void> {
    const rows = await db<MaintenanceWindowRow>('maintenance_windows')
      .whereRaw('array_length(notification_channels, 1) > 0')
      .select('*');

    const now = new Date();

    for (const row of rows) {
      const window = rowToWindow(row);
      const active = isWindowActive(window, now);
      const startKey = `start:${window.startsAt}`;
      const endKey = `end:${window.startsAt}`;

      if (active && window.lastDedupKey !== startKey) {
        await this._sendMaintenanceNotification(window, 'start');
        await db('maintenance_windows').where({ id: window.id }).update({
          last_dedup_key: startKey,
        });
      } else if (!active && window.lastDedupKey === startKey) {
        await this._sendMaintenanceNotification(window, 'end');
        await db('maintenance_windows').where({ id: window.id }).update({
          last_dedup_key: endKey,
        });
      }
    }
  },

  async _sendMaintenanceNotification(window: MaintenanceWindow, event: 'start' | 'end'): Promise<void> {
    if (window.notificationChannels.length === 0) return;
    try {
      const message = event === 'start'
        ? `Maintenance window "${window.name}" has started. Alerts are suppressed during this period.`
        : `Maintenance window "${window.name}" has ended. Monitoring resumed.`;

      const payload = {
        monitorName: window.name,
        oldStatus: event === 'start' ? 'up' : 'maintenance',
        newStatus: event === 'start' ? 'maintenance' : 'up',
        message,
        timestamp: new Date().toISOString(),
        appName: config.appName,
      };

      const channels = await db('notification_channels')
        .whereIn('id', window.notificationChannels)
        .where({ is_enabled: true });

      for (const ch of channels) {
        const plugin = getPlugin(ch.type);
        if (!plugin) continue;
        try {
          let resolvedConfig: Record<string, unknown> = ch.config;
          if (ch.type === 'smtp' && ch.config?.smtpServerId) {
            const { smtpServerService } = await import('./smtpServer.service');
            const srv = await smtpServerService.getTransportConfig(Number(ch.config.smtpServerId));
            if (srv) resolvedConfig = { ...ch.config, host: srv.host, port: srv.port, secure: srv.secure, username: srv.username, password: srv.password, fromAddress: srv.fromAddress };
          }
          await plugin.send(resolvedConfig, payload);
          logger.info(`[Maintenance] Notification sent (${event}) via ${ch.name} for window "${window.name}"`);
        } catch (err) {
          logger.error(err, `[Maintenance] Failed to notify channel ${ch.id}`);
        }
      }
    } catch (err) {
      logger.error(err, '[MaintenanceService] Failed to send transition notification');
    }
  },

  startJobs(): void {
    cleanupTimer = setInterval(() => {
      this.cleanupExpiredOneTime().catch((err) =>
        console.error('[MaintenanceService] Cleanup job error:', err),
      );
    }, 5 * 60 * 1000);

    transitionTimer = setInterval(() => {
      maintenanceCache.clear();
      this.checkMaintenanceTransitions().catch((err) =>
        console.error('[MaintenanceService] Transition job error:', err),
      );
    }, 60 * 1000);

    console.log('[MaintenanceService] Background jobs started.');
  },

  stopJobs(): void {
    if (cleanupTimer) { clearInterval(cleanupTimer); cleanupTimer = null; }
    if (transitionTimer) { clearInterval(transitionTimer); transitionTimer = null; }
  },
};
