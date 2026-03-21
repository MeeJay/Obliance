import { db } from '../db';
import { commandService } from './command.service';
import type { CompliancePolicy, CompliancePreset, ComplianceResult, ComplianceRuleResult, ConfigTemplate } from '@obliance/shared';
import { windowsBaselineRules } from './compliance-presets/windows-baseline';
import { linuxBaselineRules } from './compliance-presets/linux-baseline';
import { macosBaselineRules } from './compliance-presets/macos-baseline';
import { nistSP800171Rules } from './compliance-presets/nist-800-171';
import { iso27001Rules } from './compliance-presets/iso-27001';
import { pciDSSv4Rules } from './compliance-presets/pci-dss-v4';
import { hipaaRules } from './compliance-presets/hipaa';
import { soc2Rules } from './compliance-presets/soc2';
import { cisWindowsL1Rules } from './compliance-presets/cis-windows-l1';
import { windowsPerformanceRules } from './compliance-presets/windows-performance';

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
      id: row.id, deviceId: row.device_id,
      deviceName: row.device_name ?? null,
      policyId: row.policy_id, tenantId: row.tenant_id,
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
    const rows = await db('compliance_results as cr')
      .leftJoin('compliance_policies as cp', 'cp.id', 'cr.policy_id')
      .leftJoin('devices as d', 'd.id', 'cr.device_id')
      .where({ 'cr.device_id': deviceId, 'cr.tenant_id': tenantId })
      .orderBy('cr.checked_at', 'desc')
      .limit(50)
      .select(
        'cr.*',
        'cp.name as policy_name',
        'cp.framework as policy_framework',
        db.raw(`COALESCE(NULLIF(d.display_name, ''), d.hostname) AS device_name`),
      );
    return rows.map((row: any) => {
      const result = this.rowToResult(row);
      if (row.policy_name) {
        result.policy = { id: row.policy_id, name: row.policy_name, framework: row.policy_framework };
      }
      return result;
    });
  }

  async getAllResults(tenantId: number, page = 1, limit = 100, deviceId?: number) {
    const offset = (page - 1) * limit;
    let q = db('compliance_results as cr')
      .leftJoin('compliance_policies as cp', 'cp.id', 'cr.policy_id')
      .leftJoin('devices as d', 'd.id', 'cr.device_id')
      .where({ 'cr.tenant_id': tenantId })
      .orderBy('cr.checked_at', 'desc')
      .limit(limit)
      .offset(offset)
      .select(
        'cr.*',
        'cp.name as policy_name',
        'cp.framework as policy_framework',
        db.raw(`COALESCE(NULLIF(d.display_name, ''), d.hostname) AS device_name`),
      );
    if (deviceId) q = q.where({ 'cr.device_id': deviceId });
    const rows = await q;
    return rows.map((row: any) => {
      const result = this.rowToResult(row);
      if (row.policy_name) {
        result.policy = { id: row.policy_id, name: row.policy_name, framework: row.policy_framework };
      }
      return result;
    });
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

  // ─── Store results (called from agent route) ─────────────────────────────
  async storeResults(
    deviceId: number,
    tenantId: number,
    policyId: number,
    results: ComplianceRuleResult[],
    score: number,
  ): Promise<ComplianceResult> {
    const [row] = await db('compliance_results')
      .insert({
        device_id: deviceId,
        policy_id: policyId,
        tenant_id: tenantId,
        results: JSON.stringify(results),
        compliance_score: score,
        checked_at: new Date(),
      })
      .returning('*');

    // Also hydrate policy name for the socket event
    const policy = await this.getPolicyById(policyId, tenantId);
    const result = this.rowToResult(row);
    if (policy) {
      result.policy = { id: policy.id, name: policy.name, framework: policy.framework };
    }
    return result;
  }

  // ─── Built-in presets ─────────────────────────────────────────────────────
  getPresets(): CompliancePreset[] {
    const r = (id: string, opts: Omit<import('@obliance/shared').ComplianceRule, 'id' | 'autoRemediateScriptId'>): import('@obliance/shared').ComplianceRule =>
      ({ id, autoRemediateScriptId: null, ...opts });

    return [
      // ── Windows Security Baseline ─────────────────────────────────────────
      {
        id: 'windows-security-baseline',
        name: 'Windows Security Baseline',
        description: `Fondation sécurité Windows 10/11 et Server 2016+. ${windowsBaselineRules.length} contrôles couvrant pare-feu, Defender, comptes, chiffrement, services et durcissement système.`,
        framework: 'custom',
        targetPlatform: 'windows',
        rules: windowsBaselineRules,
      },

      // ── Linux Security Baseline ───────────────────────────────────────────
      {
        id: 'linux-security-baseline',
        name: 'Linux Security Baseline',
        description: `Contrôles essentiels pour serveurs Linux (Debian/Ubuntu/RHEL/Fedora). ${linuxBaselineRules.length} contrôles. Compatible UFW et firewalld.`,
        framework: 'custom',
        targetPlatform: 'linux',
        rules: linuxBaselineRules,
      },

      // ── macOS Security Baseline ───────────────────────────────────────────
      {
        id: 'macos-security-baseline',
        name: 'macOS Security Baseline',
        description: `Contrôles fondamentaux pour macOS 12+ (Monterey, Ventura, Sonoma, Sequoia). ${macosBaselineRules.length} contrôles. Toutes les commandes s'exécutent en contexte root.`,
        framework: 'custom',
        targetPlatform: 'macos',
        rules: macosBaselineRules,
      },

      // ── CIS Windows Level 1 ───────────────────────────────────────────────
      {
        id: 'cis-windows-level1',
        name: 'CIS Windows Level 1',
        description: `CIS Benchmark Level 1 pour Windows 10/11 Enterprise. ${cisWindowsL1Rules.length} contrôles couvrant Account Policies, User Rights, Security Options, System Services, Windows Firewall, Advanced Audit Policy et Administrative Templates.`,
        framework: 'CIS',
        targetPlatform: 'windows',
        rules: cisWindowsL1Rules,
      },

      // ── NIST SP 800-171 ───────────────────────────────────────────────────
      {
        id: 'nist-sp800-171-windows',
        name: 'NIST SP 800-171 (Windows)',
        description: `NIST SP 800-171 Rev.2 — Protection des CUI (Controlled Unclassified Information). ${nistSP800171Rules.length} contrôles couvrant les 14 familles AC, AT, AU, CM, IA, IR, MA, MP, PE, PS, RA, CA, SC, SI.`,
        framework: 'NIST',
        targetPlatform: 'windows',
        rules: nistSP800171Rules,
      },

      // ── ISO 27001 ─────────────────────────────────────────────────────────
      {
        id: 'iso27001-windows',
        name: 'ISO 27001:2022 (Windows)',
        description: `ISO/IEC 27001:2022 Annexe A — ${iso27001Rules.length} contrôles pour endpoints Windows. Thèmes A.5 Organisational, A.6 People, A.7 Physical, A.8 Technological.`,
        framework: 'ISO27001',
        targetPlatform: 'windows',
        rules: iso27001Rules,
      },

      // ── PCI DSS v4 ────────────────────────────────────────────────────────
      {
        id: 'pci-dss-v4-windows',
        name: 'PCI DSS v4 (Windows)',
        description: `PCI DSS v4.0 — ${pciDSSv4Rules.length} exigences pour systèmes Windows dans le périmètre CDE. Couvre les 12 requirements. Non substitut à un audit complet QSA.`,
        framework: 'PCI_DSS',
        targetPlatform: 'windows',
        rules: pciDSSv4Rules,
      },

      // ── HIPAA Security Rule ───────────────────────────────────────────────
      {
        id: 'hipaa-security-rule-windows',
        name: 'HIPAA Security Rule (Windows)',
        description: `HIPAA 45 CFR Part 164 — ${hipaaRules.length} mesures de sécurité pour systèmes Windows traitant des ePHI. Administrative §164.308, Physical §164.310, Technical §164.312.`,
        framework: 'HIPAA',
        targetPlatform: 'windows',
        rules: hipaaRules,
      },

      // ── SOC 2 Type II ─────────────────────────────────────────────────────
      {
        id: 'soc2-typeii-windows',
        name: 'SOC 2 Type II (Windows)',
        description: `AICPA SOC 2 Trust Service Criteria — ${soc2Rules.length} contrôles pour Windows. CC1-CC9, A1 (Availability), PI1 (Processing Integrity), C1 (Confidentiality), P1 (Privacy).`,
        framework: 'SOC2',
        targetPlatform: 'windows',
        rules: soc2Rules,
      },

      // ── Windows Haute Performance ──────────────────────────────────────────
      {
        id: 'windows-high-performance',
        name: 'Windows Haute Performance',
        description: `Optimisation Gaming & Performance — ${windowsPerformanceRules.length} contrôles. Désactivation télémétrie, services inutiles, effets visuels, profil alimentation haute performance, optimisations réseau et GPU scheduling.`,
        framework: 'custom',
        targetPlatform: 'windows',
        rules: windowsPerformanceRules,
      },
    ];
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
