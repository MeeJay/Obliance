import { db } from '../db';

import type { SettingScope, SettingKey, SettingDefinition } from '@obliance/shared';
import { SETTINGS_KEYS, HARDCODED_DEFAULTS, SETTINGS_DEFINITIONS } from '@obliance/shared';

interface SettingsRow {
  id: number;
  tenant_id: number;
  scope: string;
  scope_id: number | null;
  key: string;
  value: unknown;
  created_at: Date;
  updated_at: Date;
}

export interface ResolvedSettingValue {
  value: number | boolean;
  source: 'default' | 'global' | 'group' | 'device';
  sourceName: string;
  sourceId: number | null;
}

export type ResolvedSettings = Record<string, ResolvedSettingValue>;

export interface SettingOverride {
  key: SettingKey;
  value: number;
}

export const settingsService = {
  // ── Raw CRUD ──

  async getByScope(tenantId: number, scope: SettingScope, scopeId: number | null): Promise<Record<string, number>> {
    const rows = await db<SettingsRow>('settings')
      .where({ tenant_id: tenantId, scope, scope_id: scopeId })
      .select('key', 'value');

    const result: Record<string, number> = {};
    for (const row of rows) {
      result[row.key] = row.value as number;
    }
    return result;
  },

  async set(tenantId: number, scope: SettingScope, scopeId: number | null, key: SettingKey, value: number): Promise<void> {
    // Validate key
    const def = SETTINGS_DEFINITIONS.find((d: SettingDefinition) => d.key === key);
    if (!def) throw new Error(`Unknown setting key: ${key}`);
    if ((def.min !== undefined && value < def.min) || (def.max !== undefined && value > def.max)) {
      throw new Error(`Value for ${key} must be between ${def.min} and ${def.max}`);
    }

    const serialized = JSON.stringify(value);

    if (scopeId === null) {
      // Global scope: scope_id IS NULL — PostgreSQL's standard UNIQUE constraint
      // treats NULL != NULL so ON CONFLICT never fires.  We use the dedicated
      // partial index (WHERE scope_id IS NULL) via a raw upsert instead.
      await db.raw(
        `INSERT INTO settings (tenant_id, scope, scope_id, key, value, created_at, updated_at)
         VALUES (?, ?, NULL, ?, ?, NOW(), NOW())
         ON CONFLICT (tenant_id, scope, key) WHERE scope_id IS NULL
         DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [tenantId, scope, key, serialized],
      );
    } else {
      // Scoped (group / device): scope_id IS NOT NULL — standard knex upsert works.
      await db('settings')
        .insert({
          tenant_id: tenantId,
          scope,
          scope_id: scopeId,
          key,
          value: serialized,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .onConflict(['tenant_id', 'scope', 'scope_id', 'key'])
        .merge({ value: serialized, updated_at: new Date() });
    }
  },

  async remove(tenantId: number, scope: SettingScope, scopeId: number | null, key: SettingKey): Promise<boolean> {
    const count = await db('settings')
      .where({ tenant_id: tenantId, scope, scope_id: scopeId, key })
      .del();
    return count > 0;
  },

  async setBulk(tenantId: number, scope: SettingScope, scopeId: number | null, overrides: SettingOverride[]): Promise<void> {
    for (const { key, value } of overrides) {
      await this.set(tenantId, scope, scopeId, key, value);
    }
  },

  // ── Inheritance Resolution ──

  /**
   * Resolve all settings for a given scope, walking up the hierarchy:
   *   Hardcoded defaults → Global → Group ancestors (root→leaf) → Device
   *
   * Each resolved value tracks its source for UI display.
   */
  async resolveForDevice(tenantId: number, deviceId: number, groupId: number | null): Promise<ResolvedSettings> {
    // 1. Start with hardcoded defaults
    const resolved: ResolvedSettings = {} as ResolvedSettings;
    const allKeys = Object.values(SETTINGS_KEYS);

    for (const key of allKeys) {
      resolved[key as SettingKey] = {
        value: HARDCODED_DEFAULTS[key],
        source: 'default',
        sourceId: null,
        sourceName: 'Default',
      };
    }

    // 2. Apply global overrides
    const globalOverrides = await this.getByScope(tenantId, 'global', null);
    for (const key of allKeys) {
      if (globalOverrides[key] !== undefined) {
        resolved[key as SettingKey] = {
          value: globalOverrides[key],
          source: 'global',
          sourceId: null,
          sourceName: 'Global',
        };
      }
    }

    // 3. Apply group chain (root → leaf) if device is in a group
    if (groupId !== null) {
      // Get ancestors ordered by depth DESC (root first → direct parent last)
      const ancestorRows = await db('device_group_closure')
        .join('device_groups', 'device_groups.id', 'device_group_closure.ancestor_id')
        .where('device_group_closure.descendant_id', groupId)
        .orderBy('device_group_closure.depth', 'desc')
        .select('device_groups.id', 'device_groups.name', 'device_group_closure.depth');

      for (const ancestor of ancestorRows) {
        const groupOverrides = await this.getByScope(tenantId, 'group', ancestor.id);
        for (const key of allKeys) {
          if (groupOverrides[key] !== undefined) {
            resolved[key as SettingKey] = {
              value: groupOverrides[key],
              source: 'group',
              sourceId: ancestor.id,
              sourceName: ancestor.name,
            };
          }
        }
      }
    }

    // 4. Apply device-level overrides
    const deviceOverrides = await this.getByScope(tenantId, 'device', deviceId);
    for (const key of allKeys) {
      if (deviceOverrides[key] !== undefined) {
        resolved[key as SettingKey] = {
          value: deviceOverrides[key],
          source: 'device',
          sourceId: deviceId,
          sourceName: 'This device',
        };
      }
    }

    return resolved;
  },

  /**
   * Resolve settings for a group level (for display in group settings UI).
   * Chain: Hardcoded → Global → Ancestor groups (root→parent)
   * Does NOT include the group's own overrides as resolved — returns them separately.
   */
  async resolveForGroup(tenantId: number, groupId: number): Promise<{ resolved: ResolvedSettings; overrides: Record<string, number> }> {
    const allKeys = Object.values(SETTINGS_KEYS);

    // 1. Start with hardcoded defaults
    const resolved: ResolvedSettings = {} as ResolvedSettings;
    for (const key of allKeys) {
      resolved[key as SettingKey] = {
        value: HARDCODED_DEFAULTS[key],
        source: 'default',
        sourceId: null,
        sourceName: 'Default',
      };
    }

    // 2. Global
    const globalOverrides = await this.getByScope(tenantId, 'global', null);
    for (const key of allKeys) {
      if (globalOverrides[key] !== undefined) {
        resolved[key as SettingKey] = {
          value: globalOverrides[key],
          source: 'global',
          sourceId: null,
          sourceName: 'Global',
        };
      }
    }

    // 3. Ancestors (root→parent, excluding self)
    const ancestorRows = await db('device_group_closure')
      .join('device_groups', 'device_groups.id', 'device_group_closure.ancestor_id')
      .where('device_group_closure.descendant_id', groupId)
      .where('device_group_closure.depth', '>', 0) // exclude self
      .orderBy('device_group_closure.depth', 'desc')
      .select('device_groups.id', 'device_groups.name', 'device_group_closure.depth');

    for (const ancestor of ancestorRows) {
      const groupOvr = await this.getByScope(tenantId, 'group', ancestor.id);
      for (const key of allKeys) {
        if (groupOvr[key] !== undefined) {
          resolved[key as SettingKey] = {
            value: groupOvr[key],
            source: 'group',
            sourceId: ancestor.id,
            sourceName: ancestor.name,
          };
        }
      }
    }

    // 4. Get this group's own overrides (separate, not merged into resolved)
    const overrides = await this.getByScope(tenantId, 'group', groupId);

    return { resolved, overrides };
  },

  /**
   * Resolve for global scope (just hardcoded defaults + global overrides)
   */
  async resolveGlobal(tenantId: number): Promise<{ resolved: ResolvedSettings; overrides: Record<string, number> }> {
    const allKeys = Object.values(SETTINGS_KEYS);
    const resolved: ResolvedSettings = {} as ResolvedSettings;

    for (const key of allKeys) {
      resolved[key as SettingKey] = {
        value: HARDCODED_DEFAULTS[key],
        source: 'default',
        sourceId: null,
        sourceName: 'Default',
      };
    }

    const overrides = await this.getByScope(tenantId, 'global', null);

    return { resolved, overrides };
  },
};
