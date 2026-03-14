import { db } from '../db';
import { commandService } from './command.service';
import type { CompliancePolicy, ComplianceResult, ConfigTemplate } from '@obliance/shared';

class ComplianceService {
  rowToPolicy(row: any): CompliancePolicy {
    return {
      id: row.id, uuid: row.uuid, tenantId: row.tenant_id,
      name: row.name, description: row.description,
      framework: row.framework, targetType: row.target_type, targetId: row.target_id,
      rules: row.rules || [], enabled: row.enabled,
      createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }

  rowToResult(row: any): ComplianceResult {
    return {
      id: row.id, deviceId: row.device_id, policyId: row.policy_id, tenantId: row.tenant_id,
      results: row.results || [], complianceScore: parseFloat(row.compliance_score),
      checkedAt: row.checked_at, createdAt: row.created_at,
    };
  }

  // ─── Policies ─────────────────────────────────────────────────────────────
  async getPolicies(tenantId: number) {
    const rows = await db('compliance_policies').where({ tenant_id: tenantId });
    return rows.map(this.rowToPolicy.bind(this));
  }

  async getPolicyById(id: number, tenantId: number): Promise<CompliancePolicy | null> {
    const row = await db('compliance_policies').where({ id, tenant_id: tenantId }).first();
    return row ? this.rowToPolicy(row) : null;
  }

  async createPolicy(tenantId: number, data: Partial<CompliancePolicy> & { name: string; createdBy?: number }) {
    const [row] = await db('compliance_policies').insert({
      tenant_id: tenantId, name: data.name, description: data.description,
      framework: data.framework || 'custom',
      target_type: data.targetType || 'all', target_id: data.targetId,
      rules: JSON.stringify(data.rules || []),
      enabled: data.enabled !== false, created_by: data.createdBy,
    }).returning('*');
    return this.rowToPolicy(row);
  }

  async updatePolicy(id: number, tenantId: number, data: Partial<CompliancePolicy>) {
    const updates: any = { updated_at: new Date() };
    if (data.name !== undefined) updates.name = data.name;
    if (data.description !== undefined) updates.description = data.description;
    if (data.rules !== undefined) updates.rules = JSON.stringify(data.rules);
    if (data.enabled !== undefined) updates.enabled = data.enabled;
    if (data.targetType !== undefined) updates.target_type = data.targetType;
    if (data.targetId !== undefined) updates.target_id = data.targetId;
    await db('compliance_policies').where({ id, tenant_id: tenantId }).update(updates);
    return this.getPolicyById(id, tenantId);
  }

  async deletePolicy(id: number, tenantId: number) {
    await db('compliance_policies').where({ id, tenant_id: tenantId }).delete();
  }

  // ─── Results ──────────────────────────────────────────────────────────────
  async getLatestResults(deviceId: number, tenantId: number) {
    // Get latest result per policy
    const rows = await db('compliance_results')
      .where({ device_id: deviceId, tenant_id: tenantId })
      .orderBy('checked_at', 'desc')
      .limit(50);
    return rows.map(this.rowToResult.bind(this));
  }

  async getTenantCompliance(tenantId: number) {
    const rows = await db('compliance_results')
      .where({ tenant_id: tenantId })
      .select(db.raw('device_id, policy_id, compliance_score, checked_at'))
      .orderBy('checked_at', 'desc');

    // Aggregate per device
    const deviceScores: Record<number, { scores: number[]; latest: string }> = {};
    for (const r of rows) {
      if (!deviceScores[r.device_id]) deviceScores[r.device_id] = { scores: [], latest: r.checked_at };
      deviceScores[r.device_id].scores.push(parseFloat(r.compliance_score));
    }

    const avgScore = Object.values(deviceScores).reduce((sum, d) => {
      return sum + d.scores.reduce((a, b) => a + b, 0) / d.scores.length;
    }, 0) / Math.max(Object.keys(deviceScores).length, 1);

    return { deviceCount: Object.keys(deviceScores).length, avgScore: Math.round(avgScore) };
  }

  async triggerCheck(deviceId: number, policyId: number, tenantId: number, createdBy: number) {
    const policy = await this.getPolicyById(policyId, tenantId);
    if (!policy) throw new Error('Policy not found');

    return commandService.enqueue({
      deviceId, tenantId, type: 'check_compliance',
      payload: { policyId, rules: policy.rules },
      priority: 'normal', expiresInSeconds: 600, createdBy,
    });
  }

  // ─── Config Templates ─────────────────────────────────────────────────────
  async getTemplates(tenantId: number): Promise<ConfigTemplate[]> {
    const rows = await db('config_templates')
      .where(function() { this.where({ tenant_id: tenantId }).orWhereNull('tenant_id'); })
      .orderBy([{ column: 'is_builtin', order: 'asc' }, { column: 'name' }]);
    return rows.map((r: any) => ({
      id: r.id, uuid: r.uuid, tenantId: r.tenant_id, name: r.name,
      description: r.description, platform: r.platform, category: r.category,
      checks: r.checks || [], isBuiltin: r.is_builtin,
      createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at,
    }));
  }

  async createTemplate(tenantId: number, data: Partial<ConfigTemplate> & { name: string; createdBy?: number }) {
    const [row] = await db('config_templates').insert({
      tenant_id: tenantId, name: data.name, description: data.description,
      platform: data.platform || 'all', category: data.category || 'custom',
      checks: JSON.stringify(data.checks || []),
      is_builtin: false, created_by: data.createdBy,
    }).returning('*');
    return row;
  }
}

export const complianceService = new ComplianceService();
