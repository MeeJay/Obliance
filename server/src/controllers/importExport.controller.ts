import type { Request, Response, NextFunction } from 'express';
import type { Knex } from 'knex';
import { randomUUID } from 'crypto';
import { db } from '../db';
import { AppError } from '../middleware/errorHandler';

type ExportSection =
  | 'deviceGroups'
  | 'settings'
  | 'notificationChannels'
  | 'teams'
  | 'remediationActions'
  | 'remediationBindings';

/**
 * What to do when an imported item's UUID already exists in the database.
 *  - update      : overwrite the existing record with the imported data (default)
 *  - generateNew : create a brand-new copy with a fresh UUID
 *  - ignore      : skip the item entirely
 */
type ConflictStrategy = 'update' | 'generateNew' | 'ignore';

// ── Helpers ───────────────────────────────────────────────────────────────────

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function ensureUniqueSlugTrx(trx: Knex.Transaction, slug: string, tenantId: number): Promise<string> {
  let candidate = slug;
  let i = 1;
  for (;;) {
    const exists = await trx('device_groups').where({ slug: candidate, tenant_id: tenantId }).first();
    if (!exists) return candidate;
    candidate = `${slug}-${i++}`;
  }
}

/** Topological sort — parents before children. Cycles are silently ignored. */
function topoSort<T extends Record<string, unknown>>(
  items: T[],
  uuidKey: string,
  parentKey: string,
): T[] {
  const byUuid = new Map<string, T>(
    items.filter(i => i[uuidKey]).map(i => [i[uuidKey] as string, i]),
  );
  const sorted: T[] = [];
  const visited = new Set<string | undefined>();

  function visit(item: T) {
    const uuid = item[uuidKey] as string | undefined;
    if (visited.has(uuid)) return;
    visited.add(uuid);
    const parentUuid = item[parentKey] as string | null | undefined;
    if (parentUuid) {
      const parent = byUuid.get(parentUuid);
      if (parent) visit(parent);
    }
    sorted.push(item);
  }

  for (const item of items) visit(item);
  return sorted;
}

/** Insert closure-table entries for a newly created group */
async function insertGroupClosure(
  trx: Knex.Transaction,
  groupId: number,
  parentId: number | null,
): Promise<void> {
  await trx('device_group_closure').insert({ ancestor_id: groupId, descendant_id: groupId, depth: 0 });
  if (parentId !== null) {
    await trx.raw(
      `INSERT INTO device_group_closure (ancestor_id, descendant_id, depth)
       SELECT gc.ancestor_id, ?, gc.depth + 1
       FROM   device_group_closure gc
       WHERE  gc.descendant_id = ?`,
      [groupId, parentId],
    );
  }
}

// ── Controller ────────────────────────────────────────────────────────────────

export const importExportController = {

  // ── EXPORT ──────────────────────────────────────────────────────────────────

  async exportData(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const rawSections = (req.query.sections as string | undefined) ?? '';
      const requested   = rawSections ? rawSections.split(',').map(s => s.trim()) : [];
      const all         = requested.length === 0 || requested.includes('all');
      const want        = (s: ExportSection) => all || requested.includes(s);

      const tenantId = req.session.currentTenantId ?? 1;

      const payload: Record<string, unknown> = {
        version:    2,
        exportedAt: new Date().toISOString(),
        _note: [
          'UUIDs are optional — omit them to always create new records on import.',
          'When a UUID is present and matches an existing record, the conflict strategy',
          'chosen at import time determines whether to update, ignore, or duplicate it.',
          'UUIDs are automatically assigned to all records on first export.',
        ].join(' '),
        sections: all
          ? (['deviceGroups', 'settings', 'notificationChannels', 'teams', 'remediationActions', 'remediationBindings'] as ExportSection[])
          : (requested as ExportSection[]),
      };

      // ── Lazily-built UUID maps (shared across sections) ─────────────────────
      let _groupUuidMap: Map<number, string> | null = null;

      async function getGroupUuidMap(): Promise<Map<number, string>> {
        if (!_groupUuidMap) {
          const rows = await db('device_groups').where({ tenant_id: tenantId }).select('id', 'uuid');
          _groupUuidMap = new Map(rows.map((r: { id: number; uuid: string }) => [r.id, r.uuid]));
        }
        return _groupUuidMap;
      }

      // ── Device Groups ────────────────────────────────────────────────────────
      if (want('deviceGroups')) {
        const groups  = await db('device_groups').where({ tenant_id: tenantId }).orderBy('sort_order').orderBy('name');
        const selfMap = new Map<number, string>(groups.map((g: any) => [g.id as number, g.uuid as string]));

        payload.deviceGroups = groups.map((g: any) => ({
          uuid:               g.uuid,
          name:               g.name,
          description:        g.description,
          parentUuid:         g.parent_id != null ? (selfMap.get(g.parent_id) ?? null) : null,
          sortOrder:          g.sort_order,
          groupNotifications: g.group_notifications,
          groupConfig:        g.group_config,
        }));
      }

      // ── Settings (all scopes) ────────────────────────────────────────────────
      if (want('settings')) {
        const settings = await db('settings').where({ tenant_id: tenantId }).orderBy('scope').orderBy('scope_id').orderBy('key');
        const guMap    = await getGroupUuidMap();

        payload.settings = settings
          .map((s: any) => ({
            scope:     s.scope,
            scopeUuid:
              s.scope === 'global' ? null :
              s.scope === 'group'  ? (guMap.get(s.scope_id) ?? null) :
              null,
            key:   s.key,
            value: s.value,
          }))
          .filter((s: any) => s.scope === 'global' || s.scopeUuid !== null);
      }

      // ── Notification Channels + Bindings ─────────────────────────────────────
      if (want('notificationChannels')) {
        const channels = await db('notification_channels').where({ tenant_id: tenantId }).orderBy('id');
        const bindings = await db('notification_bindings').orderBy('channel_id');
        const guMap    = await getGroupUuidMap();

        payload.notificationChannels = channels.map((c: any) => ({
          uuid:      c.uuid,
          name:      c.name,
          type:      c.type,
          config:    c.config,
          isEnabled: c.is_enabled,
          bindings:  bindings
            .filter((b: any) => b.channel_id === c.id)
            .map((b: any) => ({
              scope:        b.scope,
              scopeUuid:
                b.scope === 'global' ? null :
                b.scope === 'group'  ? (guMap.get(b.scope_id) ?? null) :
                null,
              overrideMode: b.override_mode,
            }))
            .filter((b: any) => b.scope === 'global' || b.scopeUuid !== null),
        }));
      }

      // ── Remediation Actions ──────────────────────────────────────────────────
      if (want('remediationActions')) {
        const includeSSHCredentials = req.query.includeSSHCredentials === 'true';
        const actions = await db('remediation_actions').where({ tenant_id: tenantId }).orderBy('id');

        payload.remediationActions = actions.map((a: any) => {
          let config = a.config;
          const parsedConfig: Record<string, unknown> =
            typeof config === 'string' ? (JSON.parse(config) as Record<string, unknown>) : (config as Record<string, unknown>) ?? {};

          if (a.type === 'ssh' && !includeSSHCredentials) {
            const redacted = { ...parsedConfig };
            if ('credentialEnc' in redacted) redacted.credentialEnc = '[redacted]';
            if ('password' in redacted) redacted.password = '[redacted]';
            if ('privateKey' in redacted) redacted.privateKey = '[redacted]';
            config = redacted;
          } else {
            config = parsedConfig;
          }

          return {
            uuid:    a.uuid,
            name:    a.name,
            type:    a.type,
            config,
            enabled: a.enabled,
          };
        });
      }

      // ── Remediation Bindings ─────────────────────────────────────────────────
      if (want('remediationBindings')) {
        const bindings  = await db('remediation_bindings').orderBy('id');
        const actions   = await db('remediation_actions').where({ tenant_id: tenantId }).select('id', 'uuid');
        const guMap     = await getGroupUuidMap();
        const actionUuidById = new Map<number, string>(
          actions.map((a: { id: number; uuid: string }) => [a.id, a.uuid]),
        );

        payload.remediationBindings = bindings
          .map((b: any) => {
            const actionUuid = actionUuidById.get(b.action_id);
            if (!actionUuid) return null;

            const scopeUuid =
              b.scope === 'global' ? null :
              b.scope === 'group'  ? (guMap.get(b.scope_id) ?? null) :
              null;

            if (b.scope !== 'global' && scopeUuid === null) return null;

            return {
              actionUuid,
              scope:           b.scope,
              scopeUuid,
              overrideMode:    b.override_mode,
              triggerOn:       b.trigger_on,
              cooldownSeconds: b.cooldown_seconds,
            };
          })
          .filter(Boolean);
      }

      // ── Teams + Permissions (no memberships — users are never exported) ───────
      if (want('teams')) {
        const teams       = await db('user_teams').where({ tenant_id: tenantId }).orderBy('id');
        const permissions = await db('team_permissions').orderBy('team_id');
        const guMap       = await getGroupUuidMap();

        payload.teams = teams.map((t: any) => ({
          uuid:        t.uuid,
          name:        t.name,
          description: t.description,
          canCreate:   t.can_create,
          permissions: permissions
            .filter((p: any) => p.team_id === t.id)
            .map((p: any) => ({
              scope:     p.scope,
              scopeUuid: p.scope === 'group'
                ? (guMap.get(p.scope_id) ?? null)
                : null,
              level: p.level,
            }))
            .filter((p: any) => p.scopeUuid !== null),
        }));
      }

      const filename = `obliance-export-${new Date().toISOString().slice(0, 10)}.json`;
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', 'application/json');
      res.json(payload);
    } catch (err) {
      next(err);
    }
  },

  // ── IMPORT ──────────────────────────────────────────────────────────────────

  async importData(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const {
        sections,
        data,
        conflictStrategy = 'update',
      } = req.body as {
        sections:         ExportSection[];
        data:             Record<string, unknown>;
        conflictStrategy: ConflictStrategy;
      };

      if (!Array.isArray(sections) || sections.length === 0)
        throw new AppError(400, 'sections array is required');
      if (!data || typeof data !== 'object')
        throw new AppError(400, 'data object is required');
      if (!['update', 'generateNew', 'ignore'].includes(conflictStrategy))
        throw new AppError(400, 'conflictStrategy must be "update", "generateNew", or "ignore"');

      const want = (s: ExportSection) => sections.includes(s);
      const tenantId = req.session.currentTenantId ?? 1;

      type SectionResult = { created: number; updated: number; skipped: number };
      const results: Record<string, SectionResult> = {};

      await db.transaction(async (trx) => {

        // ── Pre-populate UUID → DB id maps (scoped to current tenant) ─────────
        const groupIdByUuid:   Map<string, number> = new Map();
        const channelIdByUuid: Map<string, number> = new Map();
        const teamIdByUuid:    Map<string, number> = new Map();

        for (const r of await trx('device_groups').where({ tenant_id: tenantId }).select('id', 'uuid'))
          groupIdByUuid.set(r.uuid, r.id);
        for (const r of await trx('notification_channels').where({ tenant_id: tenantId }).select('id', 'uuid'))
          channelIdByUuid.set(r.uuid, r.id);
        for (const r of await trx('user_teams').where({ tenant_id: tenantId }).select('id', 'uuid'))
          teamIdByUuid.set(r.uuid, r.id);

        /**
         * Batch resolution maps: track original-UUID → new DB id for items
         * imported in this run.
         */
        const batchGroupByOrigUuid: Map<string, number> = new Map();

        /** Resolve a group UUID → DB id: batch-result first, then existing DB */
        function resolveGroup(uuid: string | null | undefined): number | null {
          if (!uuid) return null;
          return batchGroupByOrigUuid.get(uuid) ?? groupIdByUuid.get(uuid) ?? null;
        }

        // ── Cross-tenant UUID collision pre-check ─────────────────────────────
        const _importedGroupUuids   = ((data.deviceGroups as any[]) ?? []).map((g: any) => g.uuid).filter(Boolean) as string[];
        const _importedChannelUuids = ((data.notificationChannels as any[]) ?? []).map((c: any) => c.uuid).filter(Boolean) as string[];
        const _importedTeamUuids    = ((data.teams as any[]) ?? []).map((t: any) => t.uuid).filter(Boolean) as string[];
        const _importedActionUuids  = ((data.remediationActions as any[]) ?? []).map((a: any) => a.uuid).filter(Boolean) as string[];

        const _toUuidSet = (rows: { uuid: string }[]) => new Set<string>(rows.map(r => r.uuid));

        const foreignGroupUuids = _importedGroupUuids.length
          ? _toUuidSet(await trx('device_groups').whereIn('uuid', _importedGroupUuids).whereNot({ tenant_id: tenantId }).select('uuid'))
          : new Set<string>();
        const foreignChannelUuids = _importedChannelUuids.length
          ? _toUuidSet(await trx('notification_channels').whereIn('uuid', _importedChannelUuids).whereNot({ tenant_id: tenantId }).select('uuid'))
          : new Set<string>();
        const foreignTeamUuids = _importedTeamUuids.length
          ? _toUuidSet(await trx('user_teams').whereIn('uuid', _importedTeamUuids).whereNot({ tenant_id: tenantId }).select('uuid'))
          : new Set<string>();
        const foreignActionUuids = _importedActionUuids.length
          ? _toUuidSet(await trx('remediation_actions').whereIn('uuid', _importedActionUuids).whereNot({ tenant_id: tenantId }).select('uuid'))
          : new Set<string>();

        /**
         * Determine the effective (uuid, strategy) for an item being imported.
         */
        function resolveConflict(
          inputUuid: string | null | undefined,
          idMap: Map<string, number>,
          foreignUuids: Set<string>,
        ): { action: 'create'; uuid: string } | { action: 'update'; uuid: string; existingId: number } | { action: 'skip' } {
          if (!inputUuid) {
            return { action: 'create', uuid: randomUUID() };
          }
          if (foreignUuids.has(inputUuid)) {
            return { action: 'create', uuid: randomUUID() };
          }
          const existingId = idMap.get(inputUuid);
          if (existingId === undefined) {
            return { action: 'create', uuid: inputUuid };
          }
          if (conflictStrategy === 'update')      return { action: 'update', uuid: inputUuid, existingId };
          if (conflictStrategy === 'generateNew') return { action: 'create', uuid: randomUUID() };
          /* ignore */                            return { action: 'skip' };
        }

        // ── Device Groups ─────────────────────────────────────────────────────
        if (want('deviceGroups') && Array.isArray(data.deviceGroups)) {
          let created = 0, updated = 0, skipped = 0;

          const sorted = topoSort(
            data.deviceGroups as Record<string, unknown>[],
            'uuid', 'parentUuid',
          );

          for (const g of sorted) {
            if (!g.name) { skipped++; continue; }

            const decision  = resolveConflict(g.uuid as string | undefined, groupIdByUuid, foreignGroupUuids);
            const parentId  = resolveGroup(g.parentUuid as string | null | undefined);

            if (decision.action === 'skip') {
              if (g.uuid) batchGroupByOrigUuid.set(g.uuid as string, groupIdByUuid.get(g.uuid as string)!);
              skipped++;
              continue;
            }

            if (decision.action === 'update') {
              await trx('device_groups').where({ uuid: decision.uuid, tenant_id: tenantId }).update({
                name:                g.name,
                description:         (g.description as string | null) ?? null,
                sort_order:          (g.sortOrder as number) ?? 0,
                group_notifications: (g.groupNotifications as boolean) ?? false,
                group_config:        g.groupConfig ? JSON.stringify(g.groupConfig) : '{}',
                parent_id:           parentId,
                updated_at:          new Date(),
              });
              batchGroupByOrigUuid.set(decision.uuid, decision.existingId);
              if (g.uuid && g.uuid !== decision.uuid)
                batchGroupByOrigUuid.set(g.uuid as string, decision.existingId);
              updated++;
            } else {
              const slug  = await ensureUniqueSlugTrx(trx, slugify(g.name as string), tenantId);
              const [row] = await trx('device_groups').insert({
                uuid:                decision.uuid,
                name:                g.name,
                slug,
                description:         (g.description as string | null) ?? null,
                parent_id:           parentId,
                sort_order:          (g.sortOrder as number) ?? 0,
                group_notifications: (g.groupNotifications as boolean) ?? false,
                group_config:        g.groupConfig ? JSON.stringify(g.groupConfig) : '{}',
                tenant_id:           tenantId,
              }).returning('*');

              await insertGroupClosure(trx, row.id, parentId);
              groupIdByUuid.set(decision.uuid, row.id);
              if (g.uuid) batchGroupByOrigUuid.set(g.uuid as string, row.id);
              batchGroupByOrigUuid.set(decision.uuid, row.id);
              created++;
            }
          }
          results.deviceGroups = { created, updated, skipped };
        }

        // ── Settings ─────────────────────────────────────────────────────────
        if (want('settings') && Array.isArray(data.settings)) {
          let created = 0, skipped = 0;

          for (const s of data.settings as Record<string, unknown>[]) {
            if (!s.scope || !s.key) { skipped++; continue; }

            const scope = s.scope as string;
            let scopeId: number | null = null;

            if (scope !== 'global') {
              const scopeUuid = s.scopeUuid as string | null;
              if (!scopeUuid) { skipped++; continue; }
              if (scope === 'group') scopeId = resolveGroup(scopeUuid);
              if (scopeId === null) { skipped++; continue; }
            }

            const value = typeof s.value === 'string' ? s.value : JSON.stringify(s.value);

            await trx('settings').where({ scope, scope_id: scopeId, key: s.key, tenant_id: tenantId }).del();
            await trx('settings').insert({ scope, scope_id: scopeId, key: s.key, value, tenant_id: tenantId, updated_at: new Date() });
            created++;
          }
          results.settings = { created, updated: 0, skipped };
        }

        // ── Notification Channels ─────────────────────────────────────────────
        if (want('notificationChannels') && Array.isArray(data.notificationChannels)) {
          let created = 0, updated = 0, skipped = 0;

          for (const c of data.notificationChannels as Record<string, unknown>[]) {
            if (!c.name || !c.type) { skipped++; continue; }

            const decision = resolveConflict(c.uuid as string | undefined, channelIdByUuid, foreignChannelUuids);

            if (decision.action === 'skip') { skipped++; continue; }

            const channelRow: Record<string, unknown> = {
              name:       c.name,
              type:       c.type,
              config:     typeof c.config === 'string' ? c.config : JSON.stringify(c.config ?? {}),
              is_enabled: (c.isEnabled as boolean) ?? true,
              tenant_id:  tenantId,
              updated_at: new Date(),
            };

            let channelId: number;
            if (decision.action === 'update') {
              await trx('notification_channels').where({ uuid: decision.uuid, tenant_id: tenantId }).update(channelRow);
              channelId = decision.existingId;
              updated++;
            } else {
              const [inserted] = await trx('notification_channels')
                .insert({ ...channelRow, uuid: decision.uuid })
                .returning('id');
              channelId = inserted.id;
              if (c.uuid) channelIdByUuid.set(c.uuid as string, channelId);
              channelIdByUuid.set(decision.uuid, channelId);
              created++;
            }

            if (Array.isArray(c.bindings)) {
              await trx('notification_bindings').where({ channel_id: channelId }).del();
              for (const b of c.bindings as Record<string, unknown>[]) {
                const bScope   = b.scope as string;
                let   bScopeId: number | null = null;

                if (bScope !== 'global') {
                  const bUuid = b.scopeUuid as string | null;
                  if (!bUuid) continue;
                  if (bScope === 'group') bScopeId = resolveGroup(bUuid);
                  if (bScopeId === null) continue;
                }

                await trx('notification_bindings').insert({
                  channel_id:    channelId,
                  scope:         bScope,
                  scope_id:      bScopeId,
                  override_mode: (b.overrideMode as string) ?? 'merge',
                });
              }
            }
          }
          results.notificationChannels = { created, updated, skipped };
        }

        // ── Teams ─────────────────────────────────────────────────────────────
        if (want('teams') && Array.isArray(data.teams)) {
          let created = 0, updated = 0, skipped = 0;

          for (const t of data.teams as Record<string, unknown>[]) {
            if (!t.name) { skipped++; continue; }

            const decision = resolveConflict(t.uuid as string | undefined, teamIdByUuid, foreignTeamUuids);

            if (decision.action === 'skip') { skipped++; continue; }

            const teamRow: Record<string, unknown> = {
              name:        t.name,
              description: (t.description as string | null) ?? null,
              can_create:  (t.canCreate as boolean) ?? false,
              tenant_id:   tenantId,
              updated_at:  new Date(),
            };

            let teamId: number;
            if (decision.action === 'update') {
              try {
                await trx('user_teams').where({ uuid: decision.uuid, tenant_id: tenantId }).update(teamRow);
              } catch {
                // Name conflict with another team — keep existing
              }
              teamId = decision.existingId;
              updated++;
            } else {
              const nameConflict = await trx('user_teams').where({ name: t.name, tenant_id: tenantId }).first();
              if (nameConflict) { skipped++; continue; }

              const [inserted] = await trx('user_teams').insert({ ...teamRow, uuid: decision.uuid }).returning('id');
              teamId = inserted.id;
              if (t.uuid) teamIdByUuid.set(t.uuid as string, teamId);
              teamIdByUuid.set(decision.uuid, teamId);
              created++;
            }

            if (Array.isArray(t.permissions)) {
              await trx('team_permissions').where({ team_id: teamId }).del();
              for (const p of t.permissions as Record<string, unknown>[]) {
                const pScope = p.scope as string;
                const pUuid  = p.scopeUuid as string | null;
                if (!pUuid) continue;

                let scopeId: number | null = null;
                if (pScope === 'group') scopeId = resolveGroup(pUuid);
                if (scopeId === null) continue;

                await trx('team_permissions').insert({
                  team_id:  teamId,
                  scope:    pScope,
                  scope_id: scopeId,
                  level:    (p.level as string) ?? 'ro',
                }).onConflict(['team_id', 'scope', 'scope_id']).ignore();
              }
            }
          }
          results.teams = { created, updated, skipped };
        }

        // ── Remediation Actions ─────────────────────────────────────────────────
        if (want('remediationActions') && Array.isArray(data.remediationActions)) {
          let created = 0, updated = 0, skipped = 0;

          const actionIdByUuid: Map<string, number> = new Map();
          for (const r of await trx('remediation_actions').where({ tenant_id: tenantId }).select('id', 'uuid'))
            actionIdByUuid.set(r.uuid, r.id);

          const batchActionByOrigUuid: Map<string, number> = new Map();

          for (const a of data.remediationActions as Record<string, unknown>[]) {
            if (!a.name || !a.type) { skipped++; continue; }

            const decision = resolveConflict(a.uuid as string | undefined, actionIdByUuid, foreignActionUuids);

            if (decision.action === 'skip') {
              if (a.uuid) batchActionByOrigUuid.set(a.uuid as string, actionIdByUuid.get(a.uuid as string)!);
              skipped++;
              continue;
            }

            const configVal = typeof a.config === 'string'
              ? a.config
              : JSON.stringify(a.config ?? {});

            const actionRow: Record<string, unknown> = {
              name:       a.name,
              type:       a.type,
              config:     configVal,
              enabled:    (a.enabled as boolean) ?? true,
              tenant_id:  tenantId,
              updated_at: new Date(),
            };

            if (decision.action === 'update') {
              await trx('remediation_actions').where({ uuid: decision.uuid, tenant_id: tenantId }).update(actionRow);
              batchActionByOrigUuid.set(decision.uuid, decision.existingId);
              if (a.uuid) batchActionByOrigUuid.set(a.uuid as string, decision.existingId);
              updated++;
            } else {
              const [inserted] = await trx('remediation_actions')
                .insert({ ...actionRow, uuid: decision.uuid })
                .returning('id');
              actionIdByUuid.set(decision.uuid, inserted.id);
              if (a.uuid) batchActionByOrigUuid.set(a.uuid as string, inserted.id);
              batchActionByOrigUuid.set(decision.uuid, inserted.id);
              created++;
            }
          }

          (trx as any).__remediationActionBatchMap = batchActionByOrigUuid;
          (trx as any).__remediationActionIdByUuid = actionIdByUuid;

          results.remediationActions = { created, updated, skipped };
        }

        // ── Remediation Bindings ────────────────────────────────────────────────
        if (want('remediationBindings') && Array.isArray(data.remediationBindings)) {
          let created = 0, skipped = 0;

          const batchActionMap: Map<string, number> =
            (trx as any).__remediationActionBatchMap ?? new Map<string, number>();
          let actionIdByUuid: Map<string, number> =
            (trx as any).__remediationActionIdByUuid ?? new Map<string, number>();

          if (actionIdByUuid.size === 0) {
            const rows = await trx('remediation_actions').where({ tenant_id: tenantId }).select('id', 'uuid');
            actionIdByUuid = new Map(rows.map((r: { id: number; uuid: string }) => [r.uuid, r.id]));
          }

          function resolveAction(uuid: string | null | undefined): number | null {
            if (!uuid) return null;
            return batchActionMap.get(uuid) ?? actionIdByUuid.get(uuid) ?? null;
          }

          for (const b of data.remediationBindings as Record<string, unknown>[]) {
            const bScope = b.scope as string;
            if (!bScope) { skipped++; continue; }

            const actionId = resolveAction(b.actionUuid as string | null | undefined);
            if (actionId === null) { skipped++; continue; }

            let bScopeId: number | null = null;
            if (bScope !== 'global') {
              const bUuid = b.scopeUuid as string | null;
              if (!bUuid) { skipped++; continue; }
              if (bScope === 'group') bScopeId = resolveGroup(bUuid);
              if (bScopeId === null) { skipped++; continue; }
            }

            await trx('remediation_bindings')
              .where({ action_id: actionId, scope: bScope, scope_id: bScopeId })
              .del();

            await trx('remediation_bindings').insert({
              action_id:       actionId,
              scope:           bScope,
              scope_id:        bScopeId,
              override_mode:   (b.overrideMode as string) ?? 'merge',
              trigger_on:      (b.triggerOn   as string) ?? 'offline',
              cooldown_seconds:(b.cooldownSeconds as number) ?? 300,
            });
            created++;
          }
          results.remediationBindings = { created, updated: 0, skipped };
        }

      }); // end transaction

      res.json({ success: true, data: results });
    } catch (err) {
      console.error('[Import] Failed:', err instanceof Error ? err.message : String(err));
      if (err instanceof Error && err.stack) console.error(err.stack);
      next(err);
    }
  },
};
