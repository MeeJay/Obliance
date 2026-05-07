import { db } from '../db';
import type { Script, ScriptCategory, ScriptParameter } from '@obliance/shared';
import { isMasterTenant } from '@obliance/shared';

class ScriptService {
  rowToScript(row: any, params?: any[]): Script {
    return {
      id: row.id,
      uuid: row.uuid,
      tenantId: row.tenant_id,
      categoryId: row.category_id,
      parentScriptId: row.parent_script_id ?? null,
      name: row.name,
      description: row.description,
      tags: row.tags || [],
      platform: row.platform,
      runtime: row.runtime,
      content: row.content,
      timeoutSeconds: row.timeout_seconds,
      expectedExitCode: row.expected_exit_code ?? 0,
      runAs: row.run_as,
      scriptType: (row.script_type ?? 'user') as 'system' | 'user',
      availableInReach: !!row.available_in_reach,
      purpose: row.purpose ?? 'execute',
      isBuiltin: row.is_builtin,
      createdBy: row.created_by,
      updatedBy: row.updated_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      // Master-only fan-out target list. Always surfaced to the client
      // so a script editor on the master tenant can render its existing
      // fan-out chips; non-master tenants ignore it (it's read-only for
      // them anyway).
      targetTenantIds: Array.isArray(row.target_tenant_ids) ? row.target_tenant_ids : null,
      parameters: params?.map(p => ({
        id: p.id,
        scriptId: p.script_id,
        name: p.name,
        label: p.label,
        description: p.description,
        type: p.type,
        options: p.options || [],
        defaultValue: p.default_value,
        required: p.required,
        sortOrder: p.sort_order,
      })),
    };
  }

  /** For each script id, count how many scenarios + schedules
   *  reference it. Joined into the list response so the UI can
   *  badge "used by N scenarios / M schedules" or filter "Unused".
   *  Two distinct queries because the references live in different
   *  shapes:
   *    - scenarios: `scenario_nodes.config->>'scriptId'` (jsonb path)
   *    - schedules: `script_schedules.script_id` (plain int FK)
   *  Returns a Map<scriptId, { scenarios, schedules }>. */
  async getScriptUsage(scriptIds: number[]): Promise<Map<number, { scenarios: number; schedules: number }>> {
    const out = new Map<number, { scenarios: number; schedules: number }>();
    if (scriptIds.length === 0) return out;
    for (const id of scriptIds) out.set(id, { scenarios: 0, schedules: 0 });

    // Scenarios — count distinct scenarios that have AT LEAST one
    // run_script node pointing at the script. (A scenario can have
    // many run_script nodes pointing at the same script; the user
    // wants "how many scenarios use this", not the node count.)
    // jsonb_exists(field, key) instead of `field ? 'key'`: the `?` form
    // collides with knex/pg-binding placeholders (the driver thinks it's
    // a positional binding and the count goes off-by-one), which threw
    // on EVERY call to getScripts and broke the whole library page.
    const scenarioRows = await db.raw(
      `SELECT (n.config->>'scriptId')::int AS script_id, COUNT(DISTINCT n.scenario_id)::int AS c
         FROM scenario_nodes n
        WHERE n.type = 'run_script'
          AND jsonb_exists(n.config, 'scriptId')
          AND (n.config->>'scriptId')::int = ANY(?::int[])
        GROUP BY (n.config->>'scriptId')::int`,
      [scriptIds],
    ) as { rows: Array<{ script_id: number; c: number }> };
    for (const r of scenarioRows.rows) {
      const entry = out.get(r.script_id);
      if (entry) entry.scenarios = Number(r.c);
    }

    const scheduleRows = await db('script_schedules')
      .whereIn('script_id', scriptIds)
      .groupBy('script_id')
      .select('script_id')
      .count<{ script_id: number; c: string | number }[]>('* as c');
    for (const r of scheduleRows) {
      const entry = out.get(r.script_id);
      if (entry) entry.schedules = typeof r.c === 'number' ? r.c : parseInt(r.c, 10);
    }
    return out;
  }

  async getScripts(tenantId: number, filters?: { platform?: string; categoryId?: number; search?: string; scriptType?: string; availableInReach?: boolean }) {
    // Master tenant gets god view: every script across the install plus
    // built-ins (tenant_id NULL). Other tenants see their own scripts +
    // built-ins, and (phase 2 / fan-out) any script whose
    // `target_tenant_ids` array contains them.
    const isMaster = isMasterTenant(tenantId);
    let q = db('scripts');
    if (!isMaster) {
      q = q.where(function() {
        this.where({ tenant_id: tenantId })
          .orWhereNull('tenant_id')
          .orWhereRaw('? = ANY(target_tenant_ids)', [tenantId]);
      });
    }
    if (filters?.platform && filters.platform !== 'all') q = q.where({ platform: filters.platform });
    if (filters?.categoryId) q = q.where({ category_id: filters.categoryId });
    if (filters?.search) q = q.whereILike('name', `%${filters.search}%`);
    if (filters?.scriptType) q = q.where({ script_type: filters.scriptType });
    if (filters?.availableInReach) q = q.where({ available_in_reach: true });
    const rows = await q.orderBy([{ column: 'script_type', order: 'desc' }, { column: 'is_builtin', order: 'asc' }, { column: 'name' }]);
    const scripts = rows.map((r: any) => this.rowToScript(r));
    // Annotate each row with usage counts so the UI can render the
    // "used by N scenarios / M schedules" chip + the "Unused" filter
    // without an N+1 round-trip. Two queries against indexed columns,
    // safe at fleet scale.
    const usage = await this.getScriptUsage(scripts.map((s) => s.id));
    for (const s of scripts) {
      const u = usage.get(s.id);
      (s as any).usage = { scenarios: u?.scenarios ?? 0, schedules: u?.schedules ?? 0 };
    }
    return scripts;
  }

  async getScriptById(id: number, tenantId: number): Promise<Script | null> {
    const isMaster = isMasterTenant(tenantId);
    const q = db('scripts').where({ id });
    if (!isMaster) {
      q.where(function() {
        this.where({ tenant_id: tenantId })
          .orWhereNull('tenant_id')
          .orWhereRaw('? = ANY(target_tenant_ids)', [tenantId]);
      });
    }
    const row = await q.first();
    if (!row) return null;
    const params = await db('script_parameters').where({ script_id: id }).orderBy('sort_order');
    return this.rowToScript(row, params);
  }

  async createScript(tenantId: number, data: {
    name: string; description?: string; categoryId?: number; platform: string;
    runtime: string; content: string; timeoutSeconds?: number; expectedExitCode?: number; runAs?: string;
    tags?: string[]; parameters?: Omit<ScriptParameter, 'id' | 'scriptId'>[];
    availableInReach?: boolean;
    purpose?: string;
    parentScriptId?: number | null;
    createdBy?: number;
    /** Master-only fan-out: extra tenants where this script becomes
     *  visible (read-only). Sanitised below — only the master tenant
     *  can set this; child tenants pass null/undefined. */
    targetTenantIds?: number[] | null;
  }): Promise<Script> {
    const fanOut = isMasterTenant(tenantId) && Array.isArray(data.targetTenantIds) && data.targetTenantIds.length > 0
      ? data.targetTenantIds.map(Number).filter(Number.isFinite)
      : null;
    const [row] = await db('scripts').insert({
      tenant_id: tenantId,
      category_id: data.categoryId,
      parent_script_id: data.parentScriptId ?? null,
      name: data.name,
      description: data.description,
      tags: JSON.stringify(data.tags || []),
      platform: data.platform || 'all',
      runtime: data.runtime || 'bash',
      content: data.content,
      timeout_seconds: data.timeoutSeconds || 300,
      expected_exit_code: data.expectedExitCode ?? 0,
      run_as: data.runAs || 'system',
      available_in_reach: data.availableInReach ?? false,
      purpose: data.purpose || 'execute',
      is_builtin: false,
      created_by: data.createdBy,
      updated_by: data.createdBy,
      target_tenant_ids: fanOut,
    }).returning('*');

    const params = [];
    if (data.parameters?.length) {
      const paramRows = data.parameters.map((p, i) => ({
        script_id: row.id,
        name: p.name, label: p.label, description: p.description,
        type: p.type, options: JSON.stringify(p.options || []),
        default_value: p.defaultValue, required: p.required,
        sort_order: i,
      }));
      const inserted = await db('script_parameters').insert(paramRows).returning('*');
      params.push(...inserted);
    }

    return this.rowToScript(row, params);
  }

  async updateScript(id: number, tenantId: number, data: Partial<{
    name: string; description: string; categoryId: number; platform: string;
    runtime: string; content: string; timeoutSeconds: number; expectedExitCode: number; runAs: string;
    tags: string[]; availableInReach: boolean; purpose: string;
    parentScriptId: number | null;
    updatedBy: number;
    /** Master-only: array of tenants this script is fan-outed to.
     *  Pass `null` to clear all fan-out. Ignored from non-master callers. */
    targetTenantIds: number[] | null;
  }>): Promise<Script | null> {
    const updates: any = { updated_at: new Date() };
    if (data.name !== undefined) updates.name = data.name;
    if (data.description !== undefined) updates.description = data.description;
    if (data.categoryId !== undefined) updates.category_id = data.categoryId;
    if (data.platform !== undefined) updates.platform = data.platform;
    if (data.runtime !== undefined) updates.runtime = data.runtime;
    if (data.content !== undefined) updates.content = data.content;
    if (data.timeoutSeconds !== undefined) updates.timeout_seconds = data.timeoutSeconds;
    if (data.expectedExitCode !== undefined) updates.expected_exit_code = data.expectedExitCode;
    if (data.runAs !== undefined) updates.run_as = data.runAs;
    if (data.tags !== undefined) updates.tags = JSON.stringify(data.tags);
    if (data.availableInReach !== undefined) updates.available_in_reach = data.availableInReach;
    if (data.purpose !== undefined) updates.purpose = data.purpose;
    if (data.updatedBy !== undefined) updates.updated_by = data.updatedBy;
    // Fan-out edits are master-only. A child-tenant admin updating a
    // script they own (tenant_id matches) cannot turn it into a fan-out
    // (would let them pollute other tenants' visibility).
    if (data.targetTenantIds !== undefined && isMasterTenant(tenantId)) {
      const arr = Array.isArray(data.targetTenantIds) ? data.targetTenantIds.map(Number).filter(Number.isFinite) : [];
      updates.target_tenant_ids = arr.length > 0 ? arr : null;
    }
    if (data.parentScriptId !== undefined) {
      // Reject self-reference and descendant cycles before writing.
      if (data.parentScriptId !== null) {
        if (data.parentScriptId === id) throw new Error('A script cannot be its own parent');
        if (await this._isDescendant(id, data.parentScriptId, tenantId)) {
          throw new Error('Cannot parent a script under one of its descendants');
        }
      }
      updates.parent_script_id = data.parentScriptId;
    }

    await db('scripts').where({ id, tenant_id: tenantId }).update(updates);
    return this.getScriptById(id, tenantId);
  }

  // Walks the parent chain starting from `candidateId`. Returns true if
  // `id` is found anywhere in the chain — meaning making `candidateId` the
  // parent of `id` would close a cycle.
  private async _isDescendant(id: number, candidateId: number, tenantId: number): Promise<boolean> {
    const seen = new Set<number>();
    let cursor: number | null = candidateId;
    while (cursor != null) {
      if (cursor === id) return true;
      if (seen.has(cursor)) return false; // pre-existing loop, bail safely
      seen.add(cursor);
      const row = await db('scripts')
        .where({ id: cursor })
        .where(function() { this.where({ tenant_id: tenantId }).orWhereNull('tenant_id'); })
        .select('parent_script_id')
        .first() as { parent_script_id: number | null } | undefined;
      cursor = row?.parent_script_id ?? null;
    }
    return false;
  }

  async deleteScript(id: number, tenantId: number) {
    // Only delete user scripts (not system/builtin)
    await db('scripts').where({ id, tenant_id: tenantId, is_builtin: false }).delete();
  }

  // Allow admins to edit system (is_builtin) scripts without tenant_id constraint
  async updateSystemScript(id: number, data: Partial<{
    name: string; description: string; categoryId: number; platform: string;
    runtime: string; content: string; timeoutSeconds: number; expectedExitCode: number; runAs: string;
    tags: string[]; availableInReach: boolean; purpose: string;
    parentScriptId: number | null;
    updatedBy: number;
  }>): Promise<Script | null> {
    const updates: any = { updated_at: new Date() };
    if (data.name !== undefined) updates.name = data.name;
    if (data.description !== undefined) updates.description = data.description;
    if (data.categoryId !== undefined) updates.category_id = data.categoryId;
    if (data.platform !== undefined) updates.platform = data.platform;
    if (data.runtime !== undefined) updates.runtime = data.runtime;
    if (data.content !== undefined) updates.content = data.content;
    if (data.timeoutSeconds !== undefined) updates.timeout_seconds = data.timeoutSeconds;
    if (data.expectedExitCode !== undefined) updates.expected_exit_code = data.expectedExitCode;
    if (data.runAs !== undefined) updates.run_as = data.runAs;
    if (data.tags !== undefined) updates.tags = JSON.stringify(data.tags);
    if (data.availableInReach !== undefined) updates.available_in_reach = data.availableInReach;
    if (data.purpose !== undefined) updates.purpose = data.purpose;
    if (data.updatedBy !== undefined) updates.updated_by = data.updatedBy;
    if (data.parentScriptId !== undefined) updates.parent_script_id = data.parentScriptId;

    await db('scripts').where({ id, is_builtin: true }).update(updates);
    // Return with a null tenantId since it's a global script
    const row = await db('scripts').where({ id }).first();
    if (!row) return null;
    const params = await db('script_parameters').where({ script_id: id }).orderBy('sort_order');
    return this.rowToScript(row, params);
  }

  async getCategories(tenantId: number): Promise<ScriptCategory[]> {
    const rows = await db('script_categories')
      .where(function() { this.where({ tenant_id: tenantId }).orWhereNull('tenant_id'); })
      .orderBy('sort_order');
    return rows.map((r: any) => ({
      id: r.id, tenantId: r.tenant_id, name: r.name,
      icon: r.icon, color: r.color, sortOrder: r.sort_order,
      createdAt: r.created_at, updatedAt: r.updated_at,
    }));
  }

  async createCategory(tenantId: number, name: string): Promise<ScriptCategory> {
    const [row] = await db('script_categories').insert({
      tenant_id: tenantId,
      name,
    }).returning('*');
    return {
      id: row.id, tenantId: row.tenant_id, name: row.name,
      icon: row.icon, color: row.color, sortOrder: row.sort_order,
      createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }
}

export const scriptService = new ScriptService();
