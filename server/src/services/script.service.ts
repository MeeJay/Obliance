import { db } from '../db';
import type { Script, ScriptCategory, ScriptParameter } from '@obliance/shared';

class ScriptService {
  rowToScript(row: any, params?: any[]): Script {
    return {
      id: row.id,
      uuid: row.uuid,
      tenantId: row.tenant_id,
      categoryId: row.category_id,
      name: row.name,
      description: row.description,
      tags: row.tags || [],
      platform: row.platform,
      runtime: row.runtime,
      content: row.content,
      timeoutSeconds: row.timeout_seconds,
      expectedExitCode: row.expected_exit_code ?? 0,
      runAs: row.run_as,
      isBuiltin: row.is_builtin,
      createdBy: row.created_by,
      updatedBy: row.updated_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
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

  async getScripts(tenantId: number, filters?: { platform?: string; categoryId?: number; search?: string }) {
    let q = db('scripts').where(function() {
      this.where({ tenant_id: tenantId }).orWhereNull('tenant_id'); // include built-ins
    });
    if (filters?.platform && filters.platform !== 'all') q = q.where({ platform: filters.platform });
    if (filters?.categoryId) q = q.where({ category_id: filters.categoryId });
    if (filters?.search) q = q.whereILike('name', `%${filters.search}%`);
    const rows = await q.orderBy([{ column: 'is_builtin', order: 'asc' }, { column: 'name' }]);
    return rows.map((r: any) => this.rowToScript(r));
  }

  async getScriptById(id: number, tenantId: number): Promise<Script | null> {
    const row = await db('scripts').where({ id })
      .where(function() { this.where({ tenant_id: tenantId }).orWhereNull('tenant_id'); })
      .first();
    if (!row) return null;
    const params = await db('script_parameters').where({ script_id: id }).orderBy('sort_order');
    return this.rowToScript(row, params);
  }

  async createScript(tenantId: number, data: {
    name: string; description?: string; categoryId?: number; platform: string;
    runtime: string; content: string; timeoutSeconds?: number; expectedExitCode?: number; runAs?: string;
    tags?: string[]; parameters?: Omit<ScriptParameter, 'id' | 'scriptId'>[];
    createdBy?: number;
  }): Promise<Script> {
    const [row] = await db('scripts').insert({
      tenant_id: tenantId,
      category_id: data.categoryId,
      name: data.name,
      description: data.description,
      tags: JSON.stringify(data.tags || []),
      platform: data.platform || 'all',
      runtime: data.runtime || 'bash',
      content: data.content,
      timeout_seconds: data.timeoutSeconds || 300,
      expected_exit_code: data.expectedExitCode ?? 0,
      run_as: data.runAs || 'system',
      is_builtin: false,
      created_by: data.createdBy,
      updated_by: data.createdBy,
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
    tags: string[]; updatedBy: number;
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
    if (data.updatedBy !== undefined) updates.updated_by = data.updatedBy;

    await db('scripts').where({ id, tenant_id: tenantId }).update(updates);
    return this.getScriptById(id, tenantId);
  }

  async deleteScript(id: number, tenantId: number) {
    await db('scripts').where({ id, tenant_id: tenantId, is_builtin: false }).delete();
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
}

export const scriptService = new ScriptService();
