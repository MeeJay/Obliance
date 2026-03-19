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
        description: 'Fondation sécurité Windows 10/11 et Server 2016+. 15 contrôles essentiels couvrant pare-feu, Defender, comptes, chiffrement et durcissement système.',
        framework: 'custom',
        targetPlatform: 'windows',
        rules: [
          r('win-001', { name: 'Firewall — Domain profile enabled', category: 'Firewall', checkType: 'command', targetPlatform: 'windows',
            target: '(Get-NetFirewallProfile -Profile Domain).Enabled', expected: 'True', operator: 'eq', severity: 'critical' }),
          r('win-002', { name: 'Firewall — Private profile enabled', category: 'Firewall', checkType: 'command', targetPlatform: 'windows',
            target: '(Get-NetFirewallProfile -Profile Private).Enabled', expected: 'True', operator: 'eq', severity: 'critical' }),
          r('win-003', { name: 'Firewall — Public profile enabled', category: 'Firewall', checkType: 'command', targetPlatform: 'windows',
            target: '(Get-NetFirewallProfile -Profile Public).Enabled', expected: 'True', operator: 'eq', severity: 'critical' }),
          r('win-004', { name: 'SMBv1 server disabled (Get-SmbServerConfiguration)', category: 'Network', checkType: 'command', targetPlatform: 'windows',
            target: '(Get-SmbServerConfiguration -Property EnableSMB1Protocol).EnableSMB1Protocol',
            expected: 'False', operator: 'eq', severity: 'critical', minOsVersion: 'Windows Server 2016 / Windows 10' }),
          r('win-005', { name: 'Defender — real-time protection enabled', category: 'Antivirus', checkType: 'command', targetPlatform: 'windows',
            target: '(Get-MpComputerStatus -ErrorAction SilentlyContinue).RealTimeProtectionEnabled',
            expected: 'True', operator: 'eq', severity: 'critical' }),
          r('win-006', { name: 'AutoRun disabled (NoDriveTypeAutoRun = 255)', category: 'System', checkType: 'registry', targetPlatform: 'windows',
            target: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer|NoDriveTypeAutoRun',
            expected: '255', operator: 'eq', severity: 'medium' }),
          r('win-007', { name: 'Guest account disabled', category: 'Accounts', checkType: 'command', targetPlatform: 'windows',
            target: '(Get-LocalUser -Name Guest -ErrorAction SilentlyContinue).Enabled',
            expected: 'False', operator: 'eq', severity: 'high' }),
          r('win-008', { name: 'RDP — Network Level Authentication required', category: 'Remote Access', checkType: 'registry', targetPlatform: 'windows',
            target: 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server\\WinStations\\RDP-Tcp|UserAuthentication',
            expected: '1', operator: 'eq', severity: 'high' }),
          r('win-009', { name: 'Windows Update service not disabled (StartType ≠ Disabled)', category: 'Updates', checkType: 'command', targetPlatform: 'windows',
            target: '(Get-Service -Name wuauserv -ErrorAction SilentlyContinue).StartType',
            expected: 'Disabled', operator: 'neq', severity: 'high' }),
          r('win-010', { name: 'UAC enabled (EnableLUA = 1)', category: 'System', checkType: 'registry', targetPlatform: 'windows',
            target: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System|EnableLUA',
            expected: '1', operator: 'eq', severity: 'critical' }),
          r('win-011', { name: 'WDigest authentication disabled (UseLogonCredential = 0)', category: 'Credentials', checkType: 'registry', targetPlatform: 'windows',
            target: 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\SecurityProviders\\WDigest|UseLogonCredential',
            expected: '1', operator: 'neq', severity: 'critical' }),
          r('win-012', { name: 'LSA protected process enabled (RunAsPPL = 1)', category: 'Credentials', checkType: 'registry', targetPlatform: 'windows',
            target: 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Lsa|RunAsPPL',
            expected: '1', operator: 'eq', severity: 'high' }),
          r('win-013', { name: 'PowerShell Script Block Logging enabled', category: 'Audit', checkType: 'registry', targetPlatform: 'windows',
            target: 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\PowerShell\\ScriptBlockLogging|EnableScriptBlockLogging',
            expected: '1', operator: 'eq', severity: 'high' }),
          r('win-014', { name: 'Remote Registry service disabled', category: 'Services', checkType: 'command', targetPlatform: 'windows',
            target: '(Get-Service -Name RemoteRegistry -ErrorAction SilentlyContinue).StartType',
            expected: 'Disabled', operator: 'eq', severity: 'high' }),
          r('win-015', { name: 'Auto-logon disabled (AutoAdminLogon ≠ 1)', category: 'Accounts', checkType: 'registry', targetPlatform: 'windows',
            target: 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon|AutoAdminLogon',
            expected: '1', operator: 'neq', severity: 'critical' }),
        ],
      },

      // ── Linux Security Baseline ───────────────────────────────────────────
      {
        id: 'linux-security-baseline',
        name: 'Linux Security Baseline',
        description: 'Contrôles essentiels pour serveurs Linux (Debian/Ubuntu/RHEL/Fedora). Compatible UFW et firewalld.',
        framework: 'custom',
        targetPlatform: 'linux',
        rules: [
          r('lin-001', { name: 'Firewall active (UFW or firewalld)', category: 'Firewall', checkType: 'command', targetPlatform: 'linux',
            target: '(ufw status 2>/dev/null | grep -q "Status: active" || firewall-cmd --state 2>/dev/null | grep -q "running") && echo "active" || echo "inactive"',
            expected: 'active', operator: 'eq', severity: 'critical' }),
          r('lin-002', { name: 'SSH PasswordAuthentication disabled', category: 'SSH', checkType: 'command', targetPlatform: 'linux',
            target: 'sshd -T 2>/dev/null | grep -i "^passwordauthentication " | awk \'{print $2}\'',
            expected: 'no', operator: 'eq', severity: 'critical' }),
          r('lin-003', { name: 'SSH root login not allowed', category: 'SSH', checkType: 'command', targetPlatform: 'linux',
            target: 'sshd -T 2>/dev/null | grep -i "^permitrootlogin " | awk \'{print $2}\'',
            expected: 'yes', operator: 'neq', severity: 'high' }),
          r('lin-004', { name: 'SSH MaxAuthTries ≤ 4', category: 'SSH', checkType: 'command', targetPlatform: 'linux',
            target: 'v=$(sshd -T 2>/dev/null | grep -i "^maxauthtries " | awk \'{print $2}\'); [ -n "$v" ] && [ "$v" -le 4 ] && echo "PASS" || echo "FAIL"',
            expected: 'PASS', operator: 'eq', severity: 'medium' }),
          r('lin-005', { name: 'Automatic security updates configured', category: 'Updates', checkType: 'command', targetPlatform: 'linux',
            target: '([ -f /etc/apt/apt.conf.d/20auto-upgrades ] || [ -f /etc/yum/yum-cron.conf ] || [ -f /etc/dnf/automatic.conf ]) && echo "configured" || echo "not configured"',
            expected: 'configured', operator: 'eq', severity: 'medium' }),
          r('lin-006', { name: 'No world-writable files in /etc', category: 'Filesystem', checkType: 'command', targetPlatform: 'linux',
            target: 'find /etc -maxdepth 2 -perm -002 -type f 2>/dev/null | wc -l | tr -d " "',
            expected: '0', operator: 'eq', severity: 'high' }),
          r('lin-007', { name: '/tmp mounted with noexec option', category: 'Filesystem', checkType: 'command', targetPlatform: 'linux',
            target: 'mount | grep " /tmp " | grep -q "noexec" && echo "yes" || echo "no"',
            expected: 'yes', operator: 'eq', severity: 'medium' }),
          r('lin-008', { name: 'Brute-force protection active (fail2ban or sshguard)', category: 'SSH', checkType: 'command', targetPlatform: 'linux',
            target: '(systemctl is-active fail2ban 2>/dev/null | grep -q "^active" || systemctl is-active sshguard 2>/dev/null | grep -q "^active") && echo "active" || echo "not found"',
            expected: 'active', operator: 'eq', severity: 'medium' }),
        ],
      },

      // ── macOS Security Baseline ───────────────────────────────────────────
      {
        id: 'macos-security-baseline',
        name: 'macOS Security Baseline',
        description: 'Contrôles fondamentaux pour macOS 12+ (Monterey, Ventura, Sonoma, Sequoia). Toutes les commandes s\'exécutent en contexte root.',
        framework: 'custom',
        targetPlatform: 'macos',
        rules: [
          r('mac-001', { name: 'Application Firewall enabled (ALF)', category: 'Firewall', checkType: 'command', targetPlatform: 'macos',
            target: 'defaults read /Library/Preferences/com.apple.alf globalstate 2>/dev/null || echo 0',
            expected: '0', operator: 'neq', severity: 'critical' }),
          r('mac-002', { name: 'FileVault disk encryption enabled', category: 'Encryption', checkType: 'command', targetPlatform: 'macos',
            target: 'fdesetup status 2>/dev/null | head -1',
            expected: 'FileVault is On', operator: 'contains', severity: 'critical' }),
          r('mac-003', { name: 'Gatekeeper enabled', category: 'System', checkType: 'command', targetPlatform: 'macos',
            target: 'spctl --status 2>/dev/null',
            expected: 'assessments enabled', operator: 'contains', severity: 'high' }),
          r('mac-004', { name: 'SIP (System Integrity Protection) enabled', category: 'System', checkType: 'command', targetPlatform: 'macos',
            target: 'csrutil status 2>/dev/null | head -1',
            expected: 'enabled', operator: 'contains', severity: 'critical', minOsVersion: 'macOS 10.11' }),
          r('mac-005', { name: 'SSH root login disabled', category: 'SSH', checkType: 'command', targetPlatform: 'macos',
            target: 'sshd -T 2>/dev/null | grep -i "^permitrootlogin " | awk \'{print $2}\'',
            expected: 'yes', operator: 'neq', severity: 'high' }),
          r('mac-006', { name: 'Guest account disabled', category: 'Accounts', checkType: 'command', targetPlatform: 'macos',
            target: 'defaults read /Library/Preferences/com.apple.loginwindow GuestEnabled 2>/dev/null || echo 0',
            expected: '1', operator: 'neq', severity: 'medium' }),
          r('mac-007', { name: 'Automatic updates enabled', category: 'Updates', checkType: 'command', targetPlatform: 'macos',
            target: 'defaults read /Library/Preferences/com.apple.SoftwareUpdate AutomaticCheckEnabled 2>/dev/null || echo 0',
            expected: '1', operator: 'eq', severity: 'medium' }),
          r('mac-008', { name: 'Screen lock idle timeout configured (system-level)', category: 'Session', checkType: 'command', targetPlatform: 'macos',
            target: 'defaults read /Library/Preferences/com.apple.screensaver idleTime 2>/dev/null || defaults read /Library/Managed\\ Preferences/com.apple.screensaver idleTime 2>/dev/null || echo 0',
            expected: '0', operator: 'neq', severity: 'medium' }),
        ],
      },

      // ── CIS Windows Level 1 ───────────────────────────────────────────────
      {
        id: 'cis-windows-level1',
        name: 'CIS Windows Level 1',
        description: 'CIS Benchmark Level 1 pour Windows. 17 contrôles : pare-feu, comptes, politique de mots de passe, NTLMv2, session RDP et durcissement réseau.',
        framework: 'CIS',
        targetPlatform: 'windows',
        rules: [
          // Foundation
          r('cis-001', { name: 'CIS 9.x — Firewall all profiles enabled', category: 'Firewall', checkType: 'command', targetPlatform: 'windows',
            target: '(Get-NetFirewallProfile | Where-Object {$_.Enabled -eq $false} | Measure-Object).Count',
            expected: '0', operator: 'eq', severity: 'critical' }),
          r('cis-002', { name: 'CIS 18.9.77 — Defender real-time protection', category: 'Antivirus', checkType: 'command', targetPlatform: 'windows',
            target: '(Get-MpComputerStatus -ErrorAction SilentlyContinue).RealTimeProtectionEnabled',
            expected: 'True', operator: 'eq', severity: 'critical' }),
          r('cis-003', { name: 'CIS 2.3.1.1 — Guest account disabled', category: 'Accounts', checkType: 'command', targetPlatform: 'windows',
            target: '(Get-LocalUser -Name Guest -ErrorAction SilentlyContinue).Enabled',
            expected: 'False', operator: 'eq', severity: 'high' }),
          r('cis-004', { name: 'CIS 18.9.x — RDP Network Level Authentication', category: 'Remote Access', checkType: 'registry', targetPlatform: 'windows',
            target: 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server\\WinStations\\RDP-Tcp|UserAuthentication',
            expected: '1', operator: 'eq', severity: 'high' }),
          r('cis-005', { name: 'CIS 18.3.3 — SMBv1 server disabled', category: 'Network', checkType: 'command', targetPlatform: 'windows',
            target: '(Get-SmbServerConfiguration -Property EnableSMB1Protocol).EnableSMB1Protocol',
            expected: 'False', operator: 'eq', severity: 'critical', minOsVersion: 'Windows Server 2016 / Windows 10' }),
          // CIS-specific
          r('cis-006', { name: 'CIS 1.1.1 — Minimum password length ≥ 14 (secedit)', category: 'Password Policy', checkType: 'command', targetPlatform: 'windows',
            target: '$f="$env:TEMP\\sc$(Get-Random).cfg";secedit /export /cfg $f /quiet 2>$null;$v=[int]((Select-String "MinimumPasswordLength\\s*=\\s*(\\d+)" $f -EA SilentlyContinue).Matches[0].Groups[1].Value);Remove-Item $f -Force -EA SilentlyContinue;if($v -ge 14){"PASS"}else{"FAIL"}',
            expected: 'PASS', operator: 'eq', severity: 'high' }),
          r('cis-007', { name: 'CIS 1.1.2 — Password complexity enabled (secedit)', category: 'Password Policy', checkType: 'command', targetPlatform: 'windows',
            target: '$f="$env:TEMP\\sc$(Get-Random).cfg";secedit /export /cfg $f /quiet 2>$null;$v=(Select-String "PasswordComplexity\\s*=\\s*(\\d+)" $f -EA SilentlyContinue).Matches[0].Groups[1].Value;Remove-Item $f -Force -EA SilentlyContinue;$v',
            expected: '1', operator: 'eq', severity: 'high' }),
          r('cis-008', { name: 'CIS 1.2.1 — Account lockout threshold ≤ 5', category: 'Account Lockout', checkType: 'command', targetPlatform: 'windows',
            target: '$r=(net accounts 2>$null|Select-String "Lockout threshold").ToString();$v=[int]($r -replace ".*:\\s*","");if($v -le 5 -and $v -gt 0){"PASS"}else{"FAIL"}',
            expected: 'PASS', operator: 'eq', severity: 'high' }),
          r('cis-009', { name: "CIS 2.3.7.3 — Don't display last signed-in username", category: 'Authentication', checkType: 'registry', targetPlatform: 'windows',
            target: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System|DontDisplayLastUserName',
            expected: '1', operator: 'eq', severity: 'medium' }),
          r('cis-010', { name: 'CIS 17.5.1 — Audit: Logon failure events enabled (AuditPol)', category: 'Audit', checkType: 'command', targetPlatform: 'windows',
            target: '(AuditPol /get /subcategory:"Logon" 2>$null | Select-String "Failure").ToString() -replace ".*Failure\\s*",""',
            expected: 'No Auditing', operator: 'neq', severity: 'high' }),
          r('cis-011', { name: 'CIS 18.3.3 — SMB client packet signing required', category: 'Network', checkType: 'registry', targetPlatform: 'windows',
            target: 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\LanmanWorkstation\\Parameters|RequireSecuritySignature',
            expected: '1', operator: 'eq', severity: 'high' }),
          r('cis-012', { name: 'CIS 18.5.4 — LLMNR disabled', category: 'Network', checkType: 'registry', targetPlatform: 'windows',
            target: 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows NT\\DNSClient|EnableMulticast',
            expected: '0', operator: 'eq', severity: 'medium' }),
          r('cis-013', { name: 'CIS 2.3.11.7 — LAN Manager auth level = 5 (NTLMv2 only)', category: 'Authentication', checkType: 'registry', targetPlatform: 'windows',
            target: 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Lsa|LmCompatibilityLevel',
            expected: '5', operator: 'eq', severity: 'high' }),
          r('cis-014', { name: 'CIS 2.3.10.2 — Anonymous SID/Name translation disabled', category: 'Accounts', checkType: 'registry', targetPlatform: 'windows',
            target: 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Lsa|AnonymousNameLookup',
            expected: '0', operator: 'eq', severity: 'medium' }),
          r('cis-015', { name: 'CIS 2.3.10.3 — Null session pipes empty', category: 'Network', checkType: 'command', targetPlatform: 'windows',
            target: '(Get-ItemProperty "HKLM:\\SYSTEM\\CurrentControlSet\\Services\\LanmanServer\\Parameters" -Name NullSessionPipes -EA SilentlyContinue).NullSessionPipes -join ""',
            expected: '', operator: 'eq', severity: 'medium' }),
          r('cis-016', { name: 'CIS 2.3.17.6 — UAC admin consent mode enabled (ConsentPromptBehaviorAdmin ≠ 0)', category: 'System', checkType: 'registry', targetPlatform: 'windows',
            target: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System|ConsentPromptBehaviorAdmin',
            expected: '0', operator: 'neq', severity: 'high' }),
          r('cis-017', { name: 'CIS 18.9.65.3 — RDP active session idle timeout configured', category: 'Remote Access', checkType: 'registry', targetPlatform: 'windows',
            target: 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows NT\\Terminal Services|MaxIdleTime',
            expected: '0', operator: 'neq', severity: 'medium' }),
        ],
      },

      // ── NIST SP 800-171 ───────────────────────────────────────────────────
      {
        id: 'nist-sp800-171-windows',
        name: 'NIST SP 800-171 (Windows)',
        description: 'NIST SP 800-171 Rev.2 — Protection des CUI (Controlled Unclassified Information). 12 contrôles : chiffrement, journalisation, VBS, Secure Boot.',
        framework: 'NIST',
        targetPlatform: 'windows',
        rules: [
          // Foundation
          r('nist-001', { name: 'SC-7 — Firewall all profiles enabled (Boundary Protection)', category: 'Firewall', checkType: 'command', targetPlatform: 'windows',
            target: '(Get-NetFirewallProfile | Where-Object {$_.Enabled -eq $false} | Measure-Object).Count',
            expected: '0', operator: 'eq', severity: 'critical' }),
          r('nist-002', { name: 'SI-3 — Defender real-time protection (Malicious Code)', category: 'Antivirus', checkType: 'command', targetPlatform: 'windows',
            target: '(Get-MpComputerStatus -ErrorAction SilentlyContinue).RealTimeProtectionEnabled',
            expected: 'True', operator: 'eq', severity: 'critical' }),
          r('nist-003', { name: 'AC-2 — Guest account disabled (Account Management)', category: 'Accounts', checkType: 'command', targetPlatform: 'windows',
            target: '(Get-LocalUser -Name Guest -ErrorAction SilentlyContinue).Enabled',
            expected: 'False', operator: 'eq', severity: 'high' }),
          r('nist-004', { name: 'AC-17 — RDP NLA required (Remote Access)', category: 'Remote Access', checkType: 'registry', targetPlatform: 'windows',
            target: 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server\\WinStations\\RDP-Tcp|UserAuthentication',
            expected: '1', operator: 'eq', severity: 'high' }),
          // NIST-specific
          r('nist-005', { name: 'SC-28 — BitLocker encryption on C: (Data at Rest)', category: 'Encryption', checkType: 'command', targetPlatform: 'windows',
            target: '(Get-BitLockerVolume -MountPoint C: -ErrorAction SilentlyContinue).ProtectionStatus',
            expected: 'On', operator: 'eq', severity: 'critical' }),
          r('nist-006', { name: 'AU-2 — Logon/Logoff audit events enabled (AuditPol)', category: 'Audit', checkType: 'command', targetPlatform: 'windows',
            target: '(AuditPol /get /category:"Logon/Logoff" 2>$null | Select-String "Success and Failure" | Measure-Object).Count',
            expected: '0', operator: 'neq', severity: 'high' }),
          r('nist-007', { name: 'AU-12 — PowerShell Transcription Logging enabled', category: 'Audit', checkType: 'registry', targetPlatform: 'windows',
            target: 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\PowerShell\\Transcription|EnableTranscripting',
            expected: '1', operator: 'eq', severity: 'high' }),
          r('nist-008', { name: 'AC-2 — LAPS installed (local admin password management)', category: 'Accounts', checkType: 'command', targetPlatform: 'windows',
            target: '(Get-Module -ListAvailable -Name LAPS -EA SilentlyContinue | Measure-Object).Count',
            expected: '0', operator: 'neq', severity: 'medium' }),
          r('nist-009', { name: 'SC-39 — Virtualization Based Security (VBS) enabled', category: 'Virtualization', checkType: 'command', targetPlatform: 'windows',
            target: '(Get-CimInstance -ClassName Win32_DeviceGuard -Namespace root\\Microsoft\\Windows\\DeviceGuard -EA SilentlyContinue).VirtualizationBasedSecurityStatus',
            expected: '2', operator: 'eq', severity: 'high', minOsVersion: 'Windows 10 1607 / Server 2016' }),
          r('nist-010', { name: 'SI-12 — Windows telemetry level ≤ Security (AllowTelemetry = 0)', category: 'Privacy', checkType: 'registry', targetPlatform: 'windows',
            target: 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\DataCollection|AllowTelemetry',
            expected: '0', operator: 'eq', severity: 'medium' }),
          r('nist-011', { name: 'SC-8 — WinRM HTTPS listener configured', category: 'Remote Management', checkType: 'command', targetPlatform: 'windows',
            target: '(Get-WSManInstance -ResourceURI winrm/config/Listener -SelectorSet @{Address="*";Transport="HTTPS"} -EA SilentlyContinue).Transport',
            expected: 'HTTPS', operator: 'eq', severity: 'high' }),
          r('nist-012', { name: 'SI-7 — Secure Boot enabled (UEFI)', category: 'Boot Security', checkType: 'command', targetPlatform: 'windows',
            target: 'Confirm-SecureBootUEFI -ErrorAction SilentlyContinue',
            expected: 'True', operator: 'eq', severity: 'high' }),
        ],
      },

      // ── ISO 27001 ─────────────────────────────────────────────────────────
      {
        id: 'iso27001-windows',
        name: 'ISO 27001:2022 (Windows)',
        description: 'ISO/IEC 27001:2022 Annexe A — Contrôles clés pour endpoints Windows. 12 vérifications : chiffrement, TLS, journaux, protocoles obsolètes.',
        framework: 'ISO27001',
        targetPlatform: 'windows',
        rules: [
          // Foundation
          r('iso-001', { name: 'A.8.20 — Network firewall all profiles active', category: 'Network Security', checkType: 'command', targetPlatform: 'windows',
            target: '(Get-NetFirewallProfile | Where-Object {$_.Enabled -eq $false} | Measure-Object).Count',
            expected: '0', operator: 'eq', severity: 'critical' }),
          r('iso-002', { name: 'A.8.7 — Defender real-time protection (Malware)', category: 'Antivirus', checkType: 'command', targetPlatform: 'windows',
            target: '(Get-MpComputerStatus -ErrorAction SilentlyContinue).RealTimeProtectionEnabled',
            expected: 'True', operator: 'eq', severity: 'critical' }),
          r('iso-003', { name: 'A.8.3 — Guest account disabled (Access Restriction)', category: 'Accounts', checkType: 'command', targetPlatform: 'windows',
            target: '(Get-LocalUser -Name Guest -ErrorAction SilentlyContinue).Enabled',
            expected: 'False', operator: 'eq', severity: 'high' }),
          r('iso-004', { name: 'A.8.9 — SMBv1 disabled (Configuration Management)', category: 'Network', checkType: 'command', targetPlatform: 'windows',
            target: '(Get-SmbServerConfiguration -Property EnableSMB1Protocol).EnableSMB1Protocol',
            expected: 'False', operator: 'eq', severity: 'critical', minOsVersion: 'Windows Server 2016 / Windows 10' }),
          // ISO-specific
          r('iso-005', { name: 'A.8.24 — BitLocker encryption on C: (Cryptography)', category: 'Cryptography', checkType: 'command', targetPlatform: 'windows',
            target: '(Get-BitLockerVolume -MountPoint C: -ErrorAction SilentlyContinue).ProtectionStatus',
            expected: 'On', operator: 'eq', severity: 'critical' }),
          r('iso-006', { name: 'A.8.24 — TLS 1.0 server disabled', category: 'Cryptography', checkType: 'registry', targetPlatform: 'windows',
            target: 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\SecurityProviders\\SCHANNEL\\Protocols\\TLS 1.0\\Server|Enabled',
            expected: '0', operator: 'eq', severity: 'high' }),
          r('iso-007', { name: 'A.8.24 — TLS 1.1 server disabled', category: 'Cryptography', checkType: 'registry', targetPlatform: 'windows',
            target: 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\SecurityProviders\\SCHANNEL\\Protocols\\TLS 1.1\\Server|Enabled',
            expected: '0', operator: 'eq', severity: 'high' }),
          r('iso-008', { name: 'A.8.24 — RC4 cipher disabled', category: 'Cryptography', checkType: 'registry', targetPlatform: 'windows',
            target: 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\SecurityProviders\\SCHANNEL\\Ciphers\\RC4 128/128|Enabled',
            expected: '0', operator: 'eq', severity: 'high' }),
          r('iso-009', { name: 'A.8.15 — Security event log size ≥ 64 MB (Logging)', category: 'Logging', checkType: 'command', targetPlatform: 'windows',
            target: '[math]::Round((Get-WinEvent -ListLog Security -EA SilentlyContinue).MaximumSizeInBytes / 1MB)',
            expected: '63', operator: 'gt', severity: 'medium' }),
          r('iso-010', { name: 'A.8.9 — Print Spooler service disabled (PrintNightmare)', category: 'Services', checkType: 'command', targetPlatform: 'windows',
            target: '(Get-Service -Name Spooler -ErrorAction SilentlyContinue).StartType',
            expected: 'Disabled', operator: 'eq', severity: 'medium' }),
          r('iso-011', { name: 'A.8.20 — Null session shares restricted', category: 'Network Security', checkType: 'registry', targetPlatform: 'windows',
            target: 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\LanmanServer\\Parameters|RestrictNullSessAccess',
            expected: '1', operator: 'eq', severity: 'medium' }),
          r('iso-012', { name: 'A.8.3 — Account lockout policy configured (net accounts)', category: 'Accounts', checkType: 'command', targetPlatform: 'windows',
            target: '$r=(net accounts 2>$null|Select-String "Lockout threshold");if($r){$v=[int]($r.ToString()-replace ".*:\\s*","");if($v -le 10 -and $v -gt 0){"PASS"}else{"FAIL"}}else{"FAIL"}',
            expected: 'PASS', operator: 'eq', severity: 'high' }),
        ],
      },

      // ── PCI DSS v4 ────────────────────────────────────────────────────────
      {
        id: 'pci-dss-v4-windows',
        name: 'PCI DSS v4 (Windows)',
        description: 'PCI DSS v4.0 — Contrôles clés pour systèmes Windows traitant des données de carte bancaire. 12 exigences. Non substitut à un audit complet QSA.',
        framework: 'PCI_DSS',
        targetPlatform: 'windows',
        rules: [
          // Foundation
          r('pci-001', { name: 'Req 1.3 — Firewall all profiles active (Network Controls)', category: 'Network Security', checkType: 'command', targetPlatform: 'windows',
            target: '(Get-NetFirewallProfile | Where-Object {$_.Enabled -eq $false} | Measure-Object).Count',
            expected: '0', operator: 'eq', severity: 'critical' }),
          r('pci-002', { name: 'Req 5.2 — Defender real-time protection (Malware)', category: 'Antivirus', checkType: 'command', targetPlatform: 'windows',
            target: '(Get-MpComputerStatus -ErrorAction SilentlyContinue).RealTimeProtectionEnabled',
            expected: 'True', operator: 'eq', severity: 'critical' }),
          r('pci-003', { name: 'Req 2.2.1 — Guest account disabled (Default Accounts)', category: 'Accounts', checkType: 'command', targetPlatform: 'windows',
            target: '(Get-LocalUser -Name Guest -ErrorAction SilentlyContinue).Enabled',
            expected: 'False', operator: 'eq', severity: 'critical' }),
          r('pci-004', { name: 'Req 8.2 — RDP NLA required (User Identification)', category: 'Authentication', checkType: 'registry', targetPlatform: 'windows',
            target: 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server\\WinStations\\RDP-Tcp|UserAuthentication',
            expected: '1', operator: 'eq', severity: 'critical' }),
          r('pci-005', { name: 'Req 2.2.7 — SMBv1 disabled (Insecure Protocols)', category: 'Network Security', checkType: 'command', targetPlatform: 'windows',
            target: '(Get-SmbServerConfiguration -Property EnableSMB1Protocol).EnableSMB1Protocol',
            expected: 'False', operator: 'eq', severity: 'critical', minOsVersion: 'Windows Server 2016 / Windows 10' }),
          // PCI-specific
          r('pci-006', { name: 'Req 3.5 — BitLocker encryption on C: (Data at Rest)', category: 'Encryption', checkType: 'command', targetPlatform: 'windows',
            target: '(Get-BitLockerVolume -MountPoint C: -ErrorAction SilentlyContinue).ProtectionStatus',
            expected: 'On', operator: 'eq', severity: 'critical' }),
          r('pci-007', { name: 'Req 10.2 — Security event log active (Audit Log)', category: 'Audit', checkType: 'command', targetPlatform: 'windows',
            target: '(Get-WinEvent -LogName Security -MaxEvents 1 -EA SilentlyContinue | Measure-Object).Count',
            expected: '0', operator: 'neq', severity: 'high' }),
          r('pci-008', { name: 'Req 8.3 — WDigest auth disabled (Credential Protection)', category: 'Credentials', checkType: 'registry', targetPlatform: 'windows',
            target: 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\SecurityProviders\\WDigest|UseLogonCredential',
            expected: '1', operator: 'neq', severity: 'critical' }),
          r('pci-009', { name: 'Req 8.3 — LSA RunAsPPL enabled (Credential Protection)', category: 'Credentials', checkType: 'registry', targetPlatform: 'windows',
            target: 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Lsa|RunAsPPL',
            expected: '1', operator: 'eq', severity: 'high' }),
          r('pci-010', { name: 'Req 1.2.4 — SMB client packet signing required', category: 'Network Security', checkType: 'registry', targetPlatform: 'windows',
            target: 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\LanmanWorkstation\\Parameters|RequireSecuritySignature',
            expected: '1', operator: 'eq', severity: 'high' }),
          r('pci-011', { name: 'Req 6.3.3 — Windows Update service not disabled (Patches)', category: 'Patch Management', checkType: 'command', targetPlatform: 'windows',
            target: '(Get-Service -Name wuauserv -EA SilentlyContinue).StartType',
            expected: 'Disabled', operator: 'neq', severity: 'high' }),
          r('pci-012', { name: 'Req 2.2.1 — AutoRun disabled (Removable Media)', category: 'System', checkType: 'registry', targetPlatform: 'windows',
            target: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer|NoDriveTypeAutoRun',
            expected: '255', operator: 'eq', severity: 'medium' }),
        ],
      },

      // ── HIPAA Security Rule ───────────────────────────────────────────────
      {
        id: 'hipaa-security-rule-windows',
        name: 'HIPAA Security Rule (Windows)',
        description: 'HIPAA 45 CFR Part 164 — Mesures de sécurité pour systèmes Windows traitant des ePHI. 10 contrôles couvrant accès, chiffrement, journaux et session.',
        framework: 'HIPAA',
        targetPlatform: 'windows',
        rules: [
          // Foundation
          r('hipaa-001', { name: '§164.312(e)(1) — Firewall all profiles (Transmission Security)', category: 'Network Security', checkType: 'command', targetPlatform: 'windows',
            target: '(Get-NetFirewallProfile | Where-Object {$_.Enabled -eq $false} | Measure-Object).Count',
            expected: '0', operator: 'eq', severity: 'critical' }),
          r('hipaa-002', { name: '§164.312(c)(1) — Defender real-time (Integrity Controls)', category: 'Antivirus', checkType: 'command', targetPlatform: 'windows',
            target: '(Get-MpComputerStatus -ErrorAction SilentlyContinue).RealTimeProtectionEnabled',
            expected: 'True', operator: 'eq', severity: 'critical' }),
          r('hipaa-003', { name: '§164.312(a)(1) — Guest account disabled (Access Control)', category: 'Accounts', checkType: 'command', targetPlatform: 'windows',
            target: '(Get-LocalUser -Name Guest -ErrorAction SilentlyContinue).Enabled',
            expected: 'False', operator: 'eq', severity: 'high' }),
          r('hipaa-004', { name: '§164.312(a)(2)(iv) — BitLocker on C: (Encryption at Rest)', category: 'Encryption', checkType: 'command', targetPlatform: 'windows',
            target: '(Get-BitLockerVolume -MountPoint C: -ErrorAction SilentlyContinue).ProtectionStatus',
            expected: 'On', operator: 'eq', severity: 'critical' }),
          // HIPAA-specific
          r('hipaa-005', { name: '§164.312(b) — Security event log active (Audit Controls)', category: 'Audit', checkType: 'command', targetPlatform: 'windows',
            target: '(Get-WinEvent -LogName Security -MaxEvents 1 -EA SilentlyContinue | Measure-Object).Count',
            expected: '0', operator: 'neq', severity: 'high' }),
          r('hipaa-006', { name: '§164.312(a)(2)(iii) — Idle session lockout policy (HKLM GP)', category: 'Session Management', checkType: 'registry', targetPlatform: 'windows',
            target: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System|InactivityTimeoutSecs',
            expected: '0', operator: 'neq', severity: 'medium' }),
          r('hipaa-007', { name: '§164.308(a)(5) — Windows Update not disabled (Patching)', category: 'Updates', checkType: 'command', targetPlatform: 'windows',
            target: '(Get-Service -Name wuauserv -EA SilentlyContinue).StartType',
            expected: 'Disabled', operator: 'neq', severity: 'high' }),
          r('hipaa-008', { name: '§164.312(a)(1) — RDP NLA required (Access Control)', category: 'Remote Access', checkType: 'registry', targetPlatform: 'windows',
            target: 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server\\WinStations\\RDP-Tcp|UserAuthentication',
            expected: '1', operator: 'eq', severity: 'high' }),
          r('hipaa-009', { name: '§164.312(b) — PowerShell Script Block Logging (Audit)', category: 'Audit', checkType: 'registry', targetPlatform: 'windows',
            target: 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\PowerShell\\ScriptBlockLogging|EnableScriptBlockLogging',
            expected: '1', operator: 'eq', severity: 'high' }),
          r('hipaa-010', { name: '§164.308(a)(5) — Account lockout policy configured', category: 'Accounts', checkType: 'command', targetPlatform: 'windows',
            target: '$r=(net accounts 2>$null|Select-String "Lockout threshold");if($r){$v=[int]($r.ToString()-replace ".*:\\s*","");if($v -le 10 -and $v -gt 0){"PASS"}else{"FAIL"}}else{"FAIL"}',
            expected: 'PASS', operator: 'eq', severity: 'medium' }),
        ],
      },

      // ── SOC 2 Type II ─────────────────────────────────────────────────────
      {
        id: 'soc2-typeii-windows',
        name: 'SOC 2 Type II (Windows)',
        description: 'AICPA SOC 2 Trust Service Criteria — CC6, CC7, CC9 pour Windows. 10 contrôles couvrant accès logique, détection de menaces et durcissement.',
        framework: 'SOC2',
        targetPlatform: 'windows',
        rules: [
          // Foundation
          r('soc-001', { name: 'CC6.7 — Firewall all profiles (Data in Transit)', category: 'Network Security', checkType: 'command', targetPlatform: 'windows',
            target: '(Get-NetFirewallProfile | Where-Object {$_.Enabled -eq $false} | Measure-Object).Count',
            expected: '0', operator: 'eq', severity: 'critical' }),
          r('soc-002', { name: 'CC7.1 — Defender real-time (Threat Detection)', category: 'Antivirus', checkType: 'command', targetPlatform: 'windows',
            target: '(Get-MpComputerStatus -ErrorAction SilentlyContinue).RealTimeProtectionEnabled',
            expected: 'True', operator: 'eq', severity: 'critical' }),
          r('soc-003', { name: 'CC6.2 — Guest account disabled (Logical Access)', category: 'Accounts', checkType: 'command', targetPlatform: 'windows',
            target: '(Get-LocalUser -Name Guest -ErrorAction SilentlyContinue).Enabled',
            expected: 'False', operator: 'eq', severity: 'high' }),
          r('soc-004', { name: 'CC6.1 — RDP NLA required (Logical Access Controls)', category: 'Remote Access', checkType: 'registry', targetPlatform: 'windows',
            target: 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server\\WinStations\\RDP-Tcp|UserAuthentication',
            expected: '1', operator: 'eq', severity: 'critical' }),
          // SOC2-specific
          r('soc-005', { name: 'CC6.7 — BitLocker on C: (Encryption at Rest)', category: 'Encryption', checkType: 'command', targetPlatform: 'windows',
            target: '(Get-BitLockerVolume -MountPoint C: -ErrorAction SilentlyContinue).ProtectionStatus',
            expected: 'On', operator: 'eq', severity: 'critical' }),
          r('soc-006', { name: 'CC7.2 — Security audit log active (Anomaly Monitoring)', category: 'Audit', checkType: 'command', targetPlatform: 'windows',
            target: '(Get-WinEvent -LogName Security -MaxEvents 1 -EA SilentlyContinue | Measure-Object).Count',
            expected: '0', operator: 'neq', severity: 'high' }),
          r('soc-007', { name: 'CC7.2 — PowerShell Script Block Logging (Change Audit)', category: 'Audit', checkType: 'registry', targetPlatform: 'windows',
            target: 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\PowerShell\\ScriptBlockLogging|EnableScriptBlockLogging',
            expected: '1', operator: 'eq', severity: 'high' }),
          r('soc-008', { name: 'CC6.8 — SMB client packet signing required (Hardening)', category: 'Network Security', checkType: 'registry', targetPlatform: 'windows',
            target: 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\LanmanWorkstation\\Parameters|RequireSecuritySignature',
            expected: '1', operator: 'eq', severity: 'high' }),
          r('soc-009', { name: 'CC6.8 — WDigest auth disabled (Credential Protection)', category: 'Credentials', checkType: 'registry', targetPlatform: 'windows',
            target: 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\SecurityProviders\\WDigest|UseLogonCredential',
            expected: '1', operator: 'neq', severity: 'critical' }),
          r('soc-010', { name: 'CC7.1 — Virtualization Based Security enabled (VBS)', category: 'Virtualization', checkType: 'command', targetPlatform: 'windows',
            target: '(Get-CimInstance -ClassName Win32_DeviceGuard -Namespace root\\Microsoft\\Windows\\DeviceGuard -EA SilentlyContinue).VirtualizationBasedSecurityStatus',
            expected: '2', operator: 'eq', severity: 'high', minOsVersion: 'Windows 10 1607 / Server 2016' }),
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
