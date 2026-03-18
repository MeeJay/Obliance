import { db } from '../db';
import { commandService } from './command.service';
import type { CompliancePolicy, CompliancePreset, ComplianceResult, ComplianceRuleResult, ConfigTemplate } from '@obliance/shared';

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
    // Get latest result per policy, hydrated with policy name+framework
    const rows = await db('compliance_results as cr')
      .leftJoin('compliance_policies as cp', 'cp.id', 'cr.policy_id')
      .where({ 'cr.device_id': deviceId, 'cr.tenant_id': tenantId })
      .orderBy('cr.checked_at', 'desc')
      .limit(50)
      .select(
        'cr.*',
        'cp.name as policy_name',
        'cp.framework as policy_framework',
        db.raw('cr.policy_id as policy_id_raw'),
      );
    return rows.map((row: any) => {
      const result = this.rowToResult(row);
      if (row.policy_name) {
        result.policy = { id: row.policy_id, name: row.policy_name, framework: row.policy_framework };
      }
      return result;
    });
  }

  async getAllResults(tenantId: number, page = 1, limit = 100) {
    const offset = (page - 1) * limit;
    const rows = await db('compliance_results as cr')
      .leftJoin('compliance_policies as cp', 'cp.id', 'cr.policy_id')
      .where({ 'cr.tenant_id': tenantId })
      .orderBy('cr.checked_at', 'desc')
      .limit(limit)
      .offset(offset)
      .select(
        'cr.*',
        'cp.name as policy_name',
        'cp.framework as policy_framework',
      );
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
    const uid = (prefix: string, n: number) => `${prefix}-${String(n).padStart(3, '0')}`;
    return [
      {
        id: 'windows-security-baseline',
        name: 'Windows Security Baseline',
        description: 'Fundamental security checks for Windows 10/11 and Server 2016+.',
        framework: 'custom',
        targetPlatform: 'windows',
        rules: [
          {
            id: uid('win', 1), name: 'Windows Firewall (Domain profile enabled)',
            category: 'Firewall', checkType: 'command', targetPlatform: 'windows',
            target: `(Get-NetFirewallProfile -Profile Domain).Enabled`,
            expected: 'True', operator: 'eq', severity: 'critical', autoRemediateScriptId: null,
          },
          {
            id: uid('win', 2), name: 'Windows Firewall (Public profile enabled)',
            category: 'Firewall', checkType: 'command', targetPlatform: 'windows',
            target: `(Get-NetFirewallProfile -Profile Public).Enabled`,
            expected: 'True', operator: 'eq', severity: 'critical', autoRemediateScriptId: null,
          },
          {
            id: uid('win', 3), name: 'SMBv1 disabled',
            category: 'Network', checkType: 'registry', targetPlatform: 'windows',
            target: `HKLM\\SYSTEM\\CurrentControlSet\\Services\\LanmanServer\\Parameters|SMB1`,
            expected: '0', operator: 'eq', severity: 'critical', autoRemediateScriptId: null,
          },
          {
            id: uid('win', 4), name: 'Windows Defender real-time protection enabled',
            category: 'Antivirus', checkType: 'command', targetPlatform: 'windows',
            target: `(Get-MpComputerStatus -ErrorAction SilentlyContinue).RealTimeProtectionEnabled`,
            expected: 'True', operator: 'eq', severity: 'high', autoRemediateScriptId: null,
          },
          {
            id: uid('win', 5), name: 'AutoRun disabled',
            category: 'System', checkType: 'registry', targetPlatform: 'windows',
            target: `HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer|NoDriveTypeAutoRun`,
            expected: '255', operator: 'eq', severity: 'medium', autoRemediateScriptId: null,
          },
          {
            id: uid('win', 6), name: 'Guest account disabled',
            category: 'Accounts', checkType: 'command', targetPlatform: 'windows',
            target: `(Get-LocalUser -Name Guest -ErrorAction SilentlyContinue).Enabled`,
            expected: 'False', operator: 'eq', severity: 'medium', autoRemediateScriptId: null,
          },
          {
            id: uid('win', 7), name: 'RDP requires Network Level Authentication',
            category: 'Remote Access', checkType: 'registry', targetPlatform: 'windows',
            target: `HKLM\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server\\WinStations\\RDP-Tcp|UserAuthentication`,
            expected: '1', operator: 'eq', severity: 'high', autoRemediateScriptId: null,
          },
          {
            id: uid('win', 8), name: 'Windows Update service running',
            category: 'Updates', checkType: 'service', targetPlatform: 'windows',
            target: 'wuauserv',
            expected: 'running', operator: 'eq', severity: 'low', autoRemediateScriptId: null,
          },
        ],
      },
      {
        id: 'linux-security-baseline',
        name: 'Linux Security Baseline',
        description: 'Essential security checks for Linux servers (Debian/Ubuntu/RHEL).',
        framework: 'custom',
        targetPlatform: 'linux',
        rules: [
          {
            id: uid('lin', 1), name: 'Firewall active (UFW)',
            category: 'Firewall', checkType: 'command', targetPlatform: 'linux',
            target: `ufw status | head -1`,
            expected: 'Status: active', operator: 'contains', severity: 'critical', autoRemediateScriptId: null,
          },
          {
            id: uid('lin', 2), name: 'SSH PasswordAuthentication disabled',
            category: 'SSH', checkType: 'file', targetPlatform: 'linux',
            target: '/etc/ssh/sshd_config',
            expected: 'PasswordAuthentication no', operator: 'contains', severity: 'critical', autoRemediateScriptId: null,
          },
          {
            id: uid('lin', 3), name: 'SSH root login disabled',
            category: 'SSH', checkType: 'file', targetPlatform: 'linux',
            target: '/etc/ssh/sshd_config',
            expected: 'PermitRootLogin no', operator: 'contains', severity: 'high', autoRemediateScriptId: null,
          },
          {
            id: uid('lin', 4), name: 'SSH service running',
            category: 'SSH', checkType: 'service', targetPlatform: 'linux',
            target: 'sshd',
            expected: 'active', operator: 'eq', severity: 'low', autoRemediateScriptId: null,
          },
          {
            id: uid('lin', 5), name: 'Automatic updates configured',
            category: 'Updates', checkType: 'file', targetPlatform: 'linux',
            target: '/etc/apt/apt.conf.d/20auto-upgrades',
            expected: '', operator: 'exists', severity: 'medium', autoRemediateScriptId: null,
          },
          {
            id: uid('lin', 6), name: 'No world-writable files in /etc',
            category: 'Filesystem', checkType: 'command', targetPlatform: 'linux',
            target: `find /etc -maxdepth 2 -perm -002 -type f 2>/dev/null | wc -l`,
            expected: '0', operator: 'eq', severity: 'high', autoRemediateScriptId: null,
          },
        ],
      },
      {
        id: 'cis-windows-level1',
        name: 'CIS Windows Level 1 (Subset)',
        description: 'Key CIS Benchmark Level 1 checks for Windows. Covers the most impactful controls.',
        framework: 'CIS',
        targetPlatform: 'windows',
        rules: [
          {
            id: uid('cis', 1), name: 'CIS 1.1.1 — Minimum password length ≥ 14',
            category: 'Passwords', checkType: 'command', targetPlatform: 'windows',
            target: `(Get-LocalUser | Where-Object {$_.PasswordRequired -eq $false} | Measure-Object).Count`,
            expected: '0', operator: 'eq', severity: 'high', autoRemediateScriptId: null,
          },
          {
            id: uid('cis', 2), name: 'CIS 2.3.1.1 — Accounts: Guest disabled',
            category: 'Accounts', checkType: 'command', targetPlatform: 'windows',
            target: `(Get-LocalUser -Name Guest -ErrorAction SilentlyContinue).Enabled`,
            expected: 'False', operator: 'eq', severity: 'high', autoRemediateScriptId: null,
          },
          {
            id: uid('cis', 3), name: 'CIS 9.1.1 — Windows Firewall: Domain profile on',
            category: 'Firewall', checkType: 'command', targetPlatform: 'windows',
            target: `(Get-NetFirewallProfile -Profile Domain).Enabled`,
            expected: 'True', operator: 'eq', severity: 'critical', autoRemediateScriptId: null,
          },
          {
            id: uid('cis', 4), name: 'CIS 9.2.1 — Windows Firewall: Private profile on',
            category: 'Firewall', checkType: 'command', targetPlatform: 'windows',
            target: `(Get-NetFirewallProfile -Profile Private).Enabled`,
            expected: 'True', operator: 'eq', severity: 'critical', autoRemediateScriptId: null,
          },
          {
            id: uid('cis', 5), name: 'CIS 9.3.1 — Windows Firewall: Public profile on',
            category: 'Firewall', checkType: 'command', targetPlatform: 'windows',
            target: `(Get-NetFirewallProfile -Profile Public).Enabled`,
            expected: 'True', operator: 'eq', severity: 'critical', autoRemediateScriptId: null,
          },
          {
            id: uid('cis', 6), name: 'CIS 18.4.1 — SMBv1 server disabled',
            category: 'Network', checkType: 'registry', targetPlatform: 'windows',
            target: `HKLM\\SYSTEM\\CurrentControlSet\\Services\\LanmanServer\\Parameters|SMB1`,
            expected: '0', operator: 'eq', severity: 'critical', autoRemediateScriptId: null,
          },
          {
            id: uid('cis', 7), name: 'CIS 18.9.77 — Windows Defender real-time on',
            category: 'Antivirus', checkType: 'command', targetPlatform: 'windows',
            target: `(Get-MpComputerStatus -ErrorAction SilentlyContinue).RealTimeProtectionEnabled`,
            expected: 'True', operator: 'eq', severity: 'critical', autoRemediateScriptId: null,
          },
          {
            id: uid('cis', 8), name: 'CIS 19.7.4.1 — AutoPlay disabled',
            category: 'System', checkType: 'registry', targetPlatform: 'windows',
            target: `HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer|NoDriveTypeAutoRun`,
            expected: '255', operator: 'eq', severity: 'medium', autoRemediateScriptId: null,
          },
        ],
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
