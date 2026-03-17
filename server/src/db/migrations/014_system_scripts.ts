import type { Knex } from 'knex';

// Seed built-in "system" fix scripts.
// These have tenant_id=null (visible to all tenants) and script_type='system'.
// Admins can edit them; users can only run them.

const SCRIPTS: Array<{
  name: string; description: string; platform: string; runtime: string;
  content: string; timeoutSeconds: number; tags: string[];
}> = [
  // ─── Windows ─────────────────────────────────────────────────────────────────
  {
    name: 'Disable SMBv1',
    description: 'Disables the SMBv1 protocol on Windows to mitigate EternalBlue/WannaCry attacks.',
    platform: 'windows', runtime: 'powershell',
    timeoutSeconds: 60,
    tags: ['security', 'smb', 'hardening'],
    content: `# Disable SMBv1 via registry
Set-ItemProperty -Path "HKLM:\\SYSTEM\\CurrentControlSet\\Services\\LanmanServer\\Parameters" -Name "SMB1" -Type DWORD -Value 0 -Force
Disable-WindowsOptionalFeature -Online -FeatureName SMB1Protocol -NoRestart -ErrorAction SilentlyContinue
Write-Output "SMBv1 disabled successfully."`,
  },
  {
    name: 'Enable Windows Firewall (All Profiles)',
    description: 'Enables Windows Firewall for Domain, Public and Private profiles.',
    platform: 'windows', runtime: 'powershell',
    timeoutSeconds: 30,
    tags: ['security', 'firewall', 'hardening'],
    content: `Set-NetFirewallProfile -Profile Domain,Public,Private -Enabled True
Write-Output "Windows Firewall enabled for all profiles."`,
  },
  {
    name: 'Enable Windows Defender Real-Time Protection',
    description: 'Turns on real-time protection in Windows Defender / Microsoft Defender Antivirus.',
    platform: 'windows', runtime: 'powershell',
    timeoutSeconds: 60,
    tags: ['security', 'antivirus', 'defender', 'hardening'],
    content: `Set-MpPreference -DisableRealtimeMonitoring $false
Write-Output "Windows Defender real-time protection enabled."`,
  },
  {
    name: 'Disable AutoRun / AutoPlay',
    description: 'Disables AutoRun for all drive types via registry (prevents autorun malware).',
    platform: 'windows', runtime: 'powershell',
    timeoutSeconds: 30,
    tags: ['security', 'autorun', 'hardening'],
    content: `# NoDriveTypeAutoRun = 0xFF (255) = disable for all drive types
Set-ItemProperty -Path "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer" -Name "NoDriveTypeAutoRun" -Type DWORD -Value 255 -Force
Set-ItemProperty -Path "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer" -Name "NoDriveTypeAutoRun" -Type DWORD -Value 255 -Force
Write-Output "AutoRun disabled for all drive types."`,
  },
  {
    name: 'Disable Guest Account',
    description: 'Disables the built-in Guest account on Windows.',
    platform: 'windows', runtime: 'powershell',
    timeoutSeconds: 30,
    tags: ['security', 'accounts', 'hardening'],
    content: `Disable-LocalUser -Name "Guest" -ErrorAction SilentlyContinue
Write-Output "Guest account disabled."`,
  },
  {
    name: 'Enable BitLocker (System Drive)',
    description: 'Enables BitLocker encryption on the system drive (C:) with TPM. Requires TPM chip.',
    platform: 'windows', runtime: 'powershell',
    timeoutSeconds: 300,
    tags: ['security', 'encryption', 'bitlocker'],
    content: `$drive = $env:SystemDrive
if ((Get-BitLockerVolume -MountPoint $drive -ErrorAction SilentlyContinue).ProtectionStatus -eq 'On') {
    Write-Output "BitLocker is already enabled on $drive"
    exit 0
}
Enable-BitLocker -MountPoint $drive -TpmProtector -UsedSpaceOnly -SkipHardwareTest
Write-Output "BitLocker encryption started on $drive"`,
  },
  {
    name: 'Disable RDP (Remote Desktop)',
    description: 'Disables Remote Desktop Protocol access on Windows.',
    platform: 'windows', runtime: 'powershell',
    timeoutSeconds: 30,
    tags: ['security', 'rdp', 'hardening'],
    content: `Set-ItemProperty -Path "HKLM:\\System\\CurrentControlSet\\Control\\Terminal Server" -Name "fDenyTSConnections" -Value 1 -Force
Disable-NetFirewallRule -DisplayGroup "Remote Desktop"
Write-Output "RDP disabled."`,
  },
  {
    name: 'Install Windows Security Updates',
    description: 'Installs all available security updates via Windows Update (requires PSWindowsUpdate module).',
    platform: 'windows', runtime: 'powershell',
    timeoutSeconds: 1800,
    tags: ['updates', 'patching'],
    content: `if (-not (Get-Module -ListAvailable -Name PSWindowsUpdate)) {
    Install-Module -Name PSWindowsUpdate -Force -Scope CurrentUser
}
Import-Module PSWindowsUpdate
Get-WUInstall -Category "Security Updates" -AcceptAll -AutoReboot`,
  },

  // ─── Linux ───────────────────────────────────────────────────────────────────
  {
    name: 'Enable UFW Firewall (Linux)',
    description: 'Installs and enables UFW (Uncomplicated Firewall) with SSH allowed.',
    platform: 'linux', runtime: 'bash',
    timeoutSeconds: 60,
    tags: ['security', 'firewall', 'ufw', 'hardening'],
    content: `#!/bin/bash
apt-get install -y ufw 2>/dev/null || yum install -y ufw 2>/dev/null || true
ufw allow ssh
ufw --force enable
ufw status
echo "UFW enabled."`,
  },
  {
    name: 'Disable SSH Password Authentication (Linux)',
    description: 'Disables SSH password authentication and enforces key-based login.',
    platform: 'linux', runtime: 'bash',
    timeoutSeconds: 30,
    tags: ['security', 'ssh', 'hardening'],
    content: `#!/bin/bash
SSHD_CONFIG="/etc/ssh/sshd_config"
# Disable password authentication
sed -i 's/^#*PasswordAuthentication .*/PasswordAuthentication no/' "$SSHD_CONFIG"
grep -q "^PasswordAuthentication" "$SSHD_CONFIG" || echo "PasswordAuthentication no" >> "$SSHD_CONFIG"
# Disable root login
sed -i 's/^#*PermitRootLogin .*/PermitRootLogin no/' "$SSHD_CONFIG"
grep -q "^PermitRootLogin" "$SSHD_CONFIG" || echo "PermitRootLogin no" >> "$SSHD_CONFIG"
systemctl reload sshd || service sshd reload
echo "SSH hardened: password auth and root login disabled."`,
  },
  {
    name: 'Enable Automatic Security Updates (Linux)',
    description: 'Configures automatic installation of security updates (Debian/Ubuntu).',
    platform: 'linux', runtime: 'bash',
    timeoutSeconds: 120,
    tags: ['security', 'updates', 'unattended-upgrades'],
    content: `#!/bin/bash
apt-get install -y unattended-upgrades 2>/dev/null || { echo "Not a Debian-based system, skipping."; exit 0; }
dpkg-reconfigure -f noninteractive unattended-upgrades
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
echo "Automatic security updates enabled."`,
  },
  {
    name: 'Disable Root SSH Login (Linux)',
    description: 'Disables direct root login via SSH.',
    platform: 'linux', runtime: 'bash',
    timeoutSeconds: 30,
    tags: ['security', 'ssh', 'root', 'hardening'],
    content: `#!/bin/bash
sed -i 's/^#*PermitRootLogin .*/PermitRootLogin no/' /etc/ssh/sshd_config
grep -q "^PermitRootLogin" /etc/ssh/sshd_config || echo "PermitRootLogin no" >> /etc/ssh/sshd_config
systemctl reload sshd || service sshd reload
echo "Root SSH login disabled."`,
  },
  {
    name: 'Set Strong Password Policy (Linux)',
    description: 'Configures password complexity and expiry via PAM and login.defs.',
    platform: 'linux', runtime: 'bash',
    timeoutSeconds: 60,
    tags: ['security', 'passwords', 'hardening'],
    content: `#!/bin/bash
# Install libpam-pwquality if available
apt-get install -y libpam-pwquality 2>/dev/null || true
# Set max password age = 90 days, min = 7 days
sed -i 's/^PASS_MAX_DAYS.*/PASS_MAX_DAYS   90/' /etc/login.defs
sed -i 's/^PASS_MIN_DAYS.*/PASS_MIN_DAYS   7/' /etc/login.defs
grep -q "^PASS_MAX_DAYS" /etc/login.defs || echo "PASS_MAX_DAYS 90" >> /etc/login.defs
grep -q "^PASS_MIN_DAYS" /etc/login.defs || echo "PASS_MIN_DAYS 7" >> /etc/login.defs
echo "Password policy updated."`,
  },

  // ─── macOS ───────────────────────────────────────────────────────────────────
  {
    name: 'Enable macOS Firewall',
    description: 'Enables the built-in macOS Application Firewall.',
    platform: 'macos', runtime: 'bash',
    timeoutSeconds: 30,
    tags: ['security', 'firewall', 'macos', 'hardening'],
    content: `#!/bin/bash
/usr/libexec/ApplicationFirewall/socketfilterfw --setglobalstate on
/usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate
echo "macOS firewall enabled."`,
  },
  {
    name: 'Enable FileVault (macOS)',
    description: 'Enables FileVault disk encryption on macOS.',
    platform: 'macos', runtime: 'bash',
    timeoutSeconds: 60,
    tags: ['security', 'encryption', 'filevault', 'macos'],
    content: `#!/bin/bash
STATUS=$(fdesetup status 2>/dev/null)
if echo "$STATUS" | grep -q "FileVault is On"; then
  echo "FileVault is already enabled."
  exit 0
fi
# Enable FileVault - requires interactive auth, this starts the process
fdesetup enable -defer /tmp/filevault_key.plist
echo "FileVault encryption initiated. Reboot required."`,
  },
];

export async function up(knex: Knex): Promise<void> {
  for (const s of SCRIPTS) {
    // Only insert if not already present (idempotent)
    const existing = await knex('scripts')
      .whereNull('tenant_id')
      .where({ name: s.name, is_builtin: true })
      .first();
    if (!existing) {
      await knex('scripts').insert({
        tenant_id: null,
        name: s.name,
        description: s.description,
        tags: JSON.stringify(s.tags),
        platform: s.platform,
        runtime: s.runtime,
        content: s.content,
        timeout_seconds: s.timeoutSeconds,
        expected_exit_code: 0,
        run_as: 'system',
        script_type: 'system',
        is_builtin: true,
      });
    }
  }
}

export async function down(knex: Knex): Promise<void> {
  // Remove the seeded system scripts
  await knex('scripts')
    .whereNull('tenant_id')
    .where({ is_builtin: true, script_type: 'system' })
    .delete();
}
