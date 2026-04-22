import { useState, useEffect, useMemo } from 'react';
import { X, Copy, Download, Check, Search, AlertTriangle } from 'lucide-react';
import { deviceApi } from '@/api/device.api';
import type { AgentApiKey, DiscoveredDevice } from '@obliance/shared';
import toast from 'react-hot-toast';
import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';

type TargetOs = 'linux' | 'windows';
type ScriptFormat = 'sh' | 'ps1';

interface Props {
  hosts: DiscoveredDevice[];
  onClose: () => void;
}

interface HostRow { ip: string; hostname: string }

export function GenerateDeployScriptModal({ hosts, onClose }: Props) {
  const { t } = useTranslation();

  const [keys, setKeys] = useState<AgentApiKey[]>([]);
  const [keyQuery, setKeyQuery] = useState('');
  const [selectedKeyId, setSelectedKeyId] = useState<number | null>(null);
  // Target OS = remote protocol: linux → SSH, windows → WinRM.
  const [targetOs, setTargetOs] = useState<TargetOs>('linux');
  // Local script language — independent of the target. Covers the
  // cross-platform cases (bash → Windows via pywinrm, PowerShell → Linux
  // via ssh.exe).
  const [scriptFormat, setScriptFormat] = useState<ScriptFormat>('sh');
  const [copied, setCopied] = useState(false);

  // Users are NEVER hard-coded into the script. The admin enters them
  // here (one per line or comma-separated) and they flow into the
  // script's loop. Empty = no usable script.
  const [usersInput, setUsersInput] = useState('');

  const users = useMemo(
    () => usersInput.split(/[\n,]/).map((s) => s.trim()).filter(Boolean),
    [usersInput],
  );

  useEffect(() => {
    deviceApi.listKeys()
      .then((rows) => {
        setKeys(rows);
        if (rows.length === 1) setSelectedKeyId(rows[0].id);
      })
      .catch(() => toast.error(t('common.error')));
  }, [t]);

  const filteredKeys = useMemo(() => {
    const q = keyQuery.trim().toLowerCase();
    if (!q) return keys;
    return keys.filter((k) =>
      (k.name || '').toLowerCase().includes(q) ||
      (k.defaultGroupName || '').toLowerCase().includes(q) ||
      k.key.toLowerCase().includes(q),
    );
  }, [keys, keyQuery]);

  const selectedKey = keys.find((k) => k.id === selectedKeyId) ?? null;
  const serverUrl = window.location.origin;

  const hostRows: HostRow[] = useMemo(
    () => hosts
      .filter((h) => h.ip)
      .map((h) => ({ ip: h.ip, hostname: h.hostname ?? '' })),
    [hosts],
  );

  const script = useMemo(() => {
    if (!selectedKey || users.length === 0) return '';
    const ctx = { serverUrl, apiKey: selectedKey.key, hosts: hostRows, users };
    if (targetOs === 'linux') {
      return scriptFormat === 'sh' ? buildSshFromBash(ctx) : buildSshFromPs1(ctx);
    }
    return scriptFormat === 'ps1' ? buildWinRmFromPs1(ctx) : buildWinRmFromBash(ctx);
  }, [hostRows, targetOs, scriptFormat, selectedKey, serverUrl, users]);

  const filename = scriptFormat === 'sh' ? 'obliance-deploy.sh' : 'obliance-deploy.ps1';

  const handleCopy = async () => {
    if (!script) return;
    try {
      await navigator.clipboard.writeText(script);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error(t('common.error'));
    }
  };

  const handleDownload = () => {
    if (!script) return;
    const blob = new Blob([script], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="bg-bg-primary border border-border rounded-xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border flex-shrink-0">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">
              {t('discovery.deployScript.title') || 'Generate deploy script'}
            </h3>
            <p className="text-xs text-text-muted mt-0.5">
              {t('discovery.deployScript.subtitle', { count: hosts.length }) ||
                `${hosts.length} host(s) selected`}
            </p>
          </div>
          <button onClick={onClose} className="p-1 text-text-muted hover:text-text-primary rounded">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Target OS selector — chooses remote protocol */}
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">
              {t('discovery.deployScript.target') || 'Target operating system'}
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(['linux', 'windows'] as TargetOs[]).map((os) => (
                <button
                  key={os}
                  onClick={() => setTargetOs(os)}
                  className={clsx(
                    'px-3 py-2 text-xs font-medium rounded-lg border transition-colors text-left',
                    targetOs === os
                      ? 'bg-accent/15 text-text-primary border-accent'
                      : 'bg-bg-secondary text-text-muted border-border hover:text-text-primary',
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span>
                      {os === 'linux'
                        ? (t('discovery.deployScript.targetLinux') || 'Linux / macOS')
                        : (t('discovery.deployScript.targetWindows') || 'Windows')}
                    </span>
                    <span className="text-[10px] text-text-muted/70 font-mono">
                      {os === 'linux' ? 'ssh' : 'winrm'}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Script format selector — chooses LOCAL runner language */}
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">
              {t('discovery.deployScript.format') || 'Script format'}
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(['sh', 'ps1'] as ScriptFormat[]).map((fmt) => (
                <button
                  key={fmt}
                  onClick={() => setScriptFormat(fmt)}
                  className={clsx(
                    'px-3 py-2 text-xs font-medium rounded-lg border transition-colors text-left',
                    scriptFormat === fmt
                      ? 'bg-accent/15 text-text-primary border-accent'
                      : 'bg-bg-secondary text-text-muted border-border hover:text-text-primary',
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span>{fmt === 'sh' ? 'Shell (.sh)' : 'PowerShell (.ps1)'}</span>
                    <span className="text-[10px] text-text-muted/70 font-mono">
                      {fmt === 'sh' ? 'bash' : 'pwsh'}
                    </span>
                  </div>
                </button>
              ))}
            </div>
            {isCrossPlatform(targetOs, scriptFormat) && (
              <p className="text-[11px] text-text-muted mt-1.5">
                {getCrossPlatformNote(targetOs, scriptFormat, t)}
              </p>
            )}
          </div>

          {/* API Key picker */}
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">
              {t('discovery.deployScript.apiKey') || 'Target API key'}
            </label>
            <div className="relative mb-2">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
              <input
                type="text"
                value={keyQuery}
                onChange={(e) => setKeyQuery(e.target.value)}
                placeholder={
                  t('discovery.deployScript.searchKey') || 'Search by name, group or key...'
                }
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-bg-secondary border border-border rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
              />
            </div>
            <div className="max-h-40 overflow-y-auto border border-border rounded-lg divide-y divide-border/50">
              {filteredKeys.length === 0 ? (
                <p className="text-xs text-text-muted py-3 text-center">
                  {t('discovery.deployScript.noKeys') || 'No API keys match'}
                </p>
              ) : (
                filteredKeys.map((k) => (
                  <button
                    key={k.id}
                    onClick={() => setSelectedKeyId(k.id)}
                    className={clsx(
                      'w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors',
                      selectedKeyId === k.id
                        ? 'bg-accent/15 text-text-primary'
                        : 'text-text-muted hover:bg-bg-secondary hover:text-text-primary',
                    )}
                  >
                    <span className="flex-1 truncate">{k.name || `#${k.id}`}</span>
                    {k.defaultGroupName && (
                      <span className="text-[10px] px-1.5 rounded bg-accent/10 text-accent flex-shrink-0">
                        {k.defaultGroupName}
                      </span>
                    )}
                    <span className="text-[10px] text-text-muted/70 font-mono flex-shrink-0">
                      {k.key.slice(0, 6)}…{k.key.slice(-4)}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Users textarea — required, no defaults */}
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">
              {t('discovery.deployScript.users') || 'Users to try'}
              <span className="text-red-400 ml-1">*</span>
              <span className="text-text-muted/60 font-normal ml-2">
                {t('discovery.deployScript.usersHint') ||
                  '(one per line or comma-separated — tried in order per host)'}
              </span>
            </label>
            <textarea
              value={usersInput}
              onChange={(e) => setUsersInput(e.target.value)}
              rows={3}
              placeholder={t('discovery.deployScript.usersPlaceholder') || 'e.g. root, admin'}
              className="w-full px-3 py-2 text-xs font-mono bg-bg-secondary border border-border rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent resize-none"
            />
            {users.length === 0 && (
              <p className="text-[11px] text-red-400 mt-1">
                {t('discovery.deployScript.usersRequired') ||
                  'Enter at least one username to generate the script.'}
              </p>
            )}
          </div>

          {/* Host list preview — IP + hostname */}
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">
              {t('discovery.deployScript.targets') || 'Target hosts'} ({hostRows.length})
            </label>
            <div className="max-h-24 overflow-y-auto p-2 bg-bg-secondary border border-border rounded-lg text-xs font-mono text-text-muted">
              {hostRows.map((h, i) => (
                <div key={i}>
                  {h.ip}
                  {h.hostname ? `  # ${h.hostname}` : ''}
                </div>
              ))}
            </div>
          </div>

          {/* Warning */}
          <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-400/10 border border-amber-400/30 text-amber-400 text-xs">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              {t('discovery.deployScript.warning') ||
                'Edit SSH_KEYS / SSH_KEY_DIR or the PASSWORD section of the script before running. Credentials never leave your local machine.'}
            </div>
          </div>

          {/* Script preview */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-medium text-text-muted">
                {t('discovery.deployScript.preview') || 'Generated script'}{' '}
                <span className="text-text-muted/60 font-normal">({filename})</span>
              </label>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleCopy}
                  disabled={!script}
                  className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium bg-bg-secondary border border-border rounded text-text-muted hover:text-text-primary disabled:opacity-40 transition-colors"
                >
                  {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                  {copied ? t('common.copied') || 'Copied' : t('common.copy') || 'Copy'}
                </button>
                <button
                  onClick={handleDownload}
                  disabled={!script}
                  className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium bg-accent text-white rounded hover:bg-accent/80 disabled:opacity-40 transition-colors"
                >
                  <Download className="w-3 h-3" />
                  {t('common.download') || 'Download'}
                </button>
              </div>
            </div>
            <pre className="p-3 bg-bg-secondary border border-border rounded-lg text-[11px] font-mono text-text-primary whitespace-pre overflow-x-auto max-h-[40vh]">
{script || `# ${t('discovery.deployScript.pickKey') || 'Pick an API key and fill in users to generate the script.'}`}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Cross-platform notes ──────────────────────────────────────────────────────

function isCrossPlatform(target: TargetOs, format: ScriptFormat): boolean {
  return (target === 'linux' && format === 'ps1') ||
         (target === 'windows' && format === 'sh');
}

function getCrossPlatformNote(target: TargetOs, format: ScriptFormat, t: any): string {
  if (target === 'linux' && format === 'ps1') {
    return t('discovery.deployScript.noteLinuxFromPs1') ||
      'Requires ssh.exe in PATH (built into Windows 10 1803+ and PowerShell 7).';
  }
  if (target === 'windows' && format === 'sh') {
    return t('discovery.deployScript.noteWindowsFromBash') ||
      'Requires Python 3 + pywinrm on the machine running the script (pip install pywinrm).';
  }
  return '';
}

// ── Script builders ──────────────────────────────────────────────────────────

interface BuildCtx {
  serverUrl: string;
  apiKey: string;
  hosts: HostRow[];
  users: string[];
}

// bash + ssh → Linux/macOS targets
function buildSshFromBash(ctx: BuildCtx): string {
  const hostLines = ctx.hosts.map((h) => {
    const c = h.hostname ? `    # ${sanitiseShellComment(h.hostname)}` : '';
    return `  "${h.ip}"${c}`;
  }).join('\n');
  const userLines = ctx.users.map((u) => `  "${shellQuote(u)}"`).join('\n');
  return `#!/usr/bin/env bash
# Obliance agent deployment — bash + ssh → Linux/macOS
# Generated ${new Date().toISOString()}
# Targets: ${ctx.hosts.length} host(s) on ${ctx.serverUrl}
#
# The script tries every (user x private key) per host, then falls back
# to password auth if PASSWORD is uncommented. First combo that works
# wins; the script moves on to the next host.
#
# Local requirements: ssh client, sshpass (only if PASSWORD enabled).

set -u

SERVER_URL="${ctx.serverUrl}"
API_KEY="${ctx.apiKey}"

HOSTS=(
${hostLines}
)

USERS=(
${userLines}
)

# Explicit private keys to try, in order. Leave empty to auto-enumerate
# SSH_KEY_DIR instead.
SSH_KEYS=(
  # "$HOME/.ssh/id_ed25519"
  # "$HOME/.ssh/prod_rsa"
)

SSH_KEY_DIR="$HOME/.ssh"

# Password fallback — uncomment to enable (requires sshpass).
# PASSWORD="change-me"

SSH_TIMEOUT=5

if [ \${#SSH_KEYS[@]} -eq 0 ] && [ -d "$SSH_KEY_DIR" ]; then
  while IFS= read -r f; do
    if head -c 60 "$f" 2>/dev/null | grep -q "PRIVATE KEY"; then
      SSH_KEYS+=("$f")
    fi
  done < <(find "$SSH_KEY_DIR" -maxdepth 1 -type f ! -name "*.pub" 2>/dev/null)
fi

log() { printf '[%s] %s\\n' "$(date +%H:%M:%S)" "$*"; }

INSTALL_CMD="curl -fsSL \\"$SERVER_URL/api/agent/installer/linux?key=$API_KEY\\" | sudo bash"

try_key() {
  local host="$1" user="$2" key="$3"
  ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new \\
      -o ConnectTimeout=$SSH_TIMEOUT -o LogLevel=ERROR \\
      -i "$key" "$user@$host" "$INSTALL_CMD" </dev/null >/dev/null 2>&1
}

try_password() {
  local host="$1" user="$2" pass="$3"
  command -v sshpass >/dev/null 2>&1 || { log "  sshpass not installed — skipping"; return 1; }
  SSHPASS="$pass" sshpass -e ssh -o StrictHostKeyChecking=accept-new \\
      -o ConnectTimeout=$SSH_TIMEOUT -o LogLevel=ERROR \\
      "$user@$host" "$INSTALL_CMD" </dev/null >/dev/null 2>&1
}

deploy_one() {
  local host="$1"
  log "=== $host ==="
  for user in "\${USERS[@]}"; do
    for key in "\${SSH_KEYS[@]}"; do
      log "  try $user@$host with $(basename "$key")"
      if try_key "$host" "$user" "$key"; then
        log "  OK   $user@$host via key $(basename "$key")"
        return 0
      fi
    done
    if [ -n "\${PASSWORD-}" ]; then
      log "  try $user@$host with password"
      if try_password "$host" "$user" "$PASSWORD"; then
        log "  OK   $user@$host via password"
        return 0
      fi
    fi
  done
  log "  FAIL all attempts exhausted for $host"
  return 1
}

SUCCESS=0; FAIL=0
for host in "\${HOSTS[@]}"; do
  if deploy_one "$host"; then SUCCESS=$((SUCCESS+1)); else FAIL=$((FAIL+1)); fi
done
log "done — $SUCCESS deployed, $FAIL failed"
`;
}

// PowerShell + Invoke-Command → Windows targets
function buildWinRmFromPs1(ctx: BuildCtx): string {
  const hostLines = ctx.hosts.map((h) => {
    const c = h.hostname ? `    # ${sanitisePsComment(h.hostname)}` : '';
    return `  "${h.ip}"${c}`;
  }).join('\n');
  const userLines = ctx.users.map((u) => `  "${psQuote(u)}"`).join('\n');
  return `<#
  Obliance agent deployment — PowerShell + WinRM → Windows
  Generated ${new Date().toISOString()}
  Targets: ${ctx.hosts.length} Windows host(s) on ${ctx.serverUrl}

  Tries every (user x password) per host via WinRM and installs the
  Obliance MSI when a combo succeeds. First combo that works wins.

  Local requirements: PowerShell 5.1+, WinRM client configured (TrustedHosts
  or Kerberos), network path to each target on tcp/5985 or 5986.
#>

$ServerURL = "${ctx.serverUrl}"
$APIKey    = "${ctx.apiKey}"

$Hosts = @(
${hostLines}
)

$Users = @(
${userLines}
)

# Passwords to try, in order. Fill with the credentials used across your
# fleet. Leave empty to disable password auth (Kerberos/negotiate SSO only).
$Passwords = @(
  # "first-password"
  # "second-password"
)

# Negotiate covers Kerberos + NTLM for domain hosts. Use Basic over HTTPS
# for workgroup, CredSSP for second-hop delegation.
$AuthMechanism = "Negotiate"
$Timeout = 60

$InstallScript = {
  param($url, $key)
  $m = Join-Path $env:TEMP "obliance-agent.msi"
  try {
    Import-Module BitsTransfer -ErrorAction Stop
    Start-BitsTransfer -Source "$url/api/agent/installer/windows.msi" -Destination $m
  } catch {
    Invoke-WebRequest -Uri "$url/api/agent/installer/windows.msi" -OutFile $m -UseBasicParsing
  }
  $msiArgs = "/i \`"$m\`" SERVERURL=\`"$url\`" APIKEY=\`"$key\`" /quiet /norestart"
  $p = Start-Process msiexec -ArgumentList $msiArgs -Wait -PassThru -NoNewWindow
  Remove-Item $m -ErrorAction SilentlyContinue
  if ($p.ExitCode -ne 0) { throw "msiexec exit $($p.ExitCode)" }
}

function Try-Deploy {
  param([string]$HostIp, [string]$User, [string]$Pass)
  try {
    $sec = ConvertTo-SecureString $Pass -AsPlainText -Force
    $cred = New-Object System.Management.Automation.PSCredential($User, $sec)
    $opts = New-PSSessionOption -OperationTimeout ($Timeout * 1000) -OpenTimeout 10000
    Invoke-Command -ComputerName $HostIp -Credential $cred -Authentication $AuthMechanism \`
                   -SessionOption $opts -ScriptBlock $InstallScript \`
                   -ArgumentList $ServerURL, $APIKey -ErrorAction Stop | Out-Null
    return $true
  } catch {
    return $false
  }
}

$success = 0; $fail = 0
foreach ($h in $Hosts) {
  Write-Host "=== $h ==="
  $deployed = $false
  foreach ($u in $Users) {
    foreach ($p in $Passwords) {
      Write-Host "  try $u@$h with password ***"
      if (Try-Deploy -HostIp $h -User $u -Pass $p) {
        Write-Host "  OK   $u@$h"
        $deployed = $true; break
      }
    }
    if ($deployed) { break }
  }
  if ($deployed) { $success++ } else { $fail++; Write-Host "  FAIL $h" }
}
Write-Host "done — $success deployed, $fail failed"
`;
}

// PowerShell + ssh.exe → Linux/macOS targets (cross-platform: ps1 → Linux)
function buildSshFromPs1(ctx: BuildCtx): string {
  const hostLines = ctx.hosts.map((h) => {
    const c = h.hostname ? `    # ${sanitisePsComment(h.hostname)}` : '';
    return `  "${h.ip}"${c}`;
  }).join('\n');
  const userLines = ctx.users.map((u) => `  "${psQuote(u)}"`).join('\n');
  return `<#
  Obliance agent deployment — PowerShell + ssh.exe → Linux/macOS
  Generated ${new Date().toISOString()}
  Targets: ${ctx.hosts.length} host(s) on ${ctx.serverUrl}

  Tries every (user x private key) per host. Uses the OpenSSH client
  shipped with Windows 10 1803+ / PowerShell 7. Password auth is not
  supported in this variant — use the .sh format if you need sshpass.

  Local requirements: ssh.exe in PATH.
#>

$ServerURL = "${ctx.serverUrl}"
$APIKey    = "${ctx.apiKey}"

$Hosts = @(
${hostLines}
)

$Users = @(
${userLines}
)

# Explicit private keys to try, in order. Leave empty to auto-enumerate
# $SshKeyDir.
$SshKeys = @(
  # "$env:USERPROFILE\\.ssh\\id_ed25519"
  # "$env:USERPROFILE\\.ssh\\prod_rsa"
)

$SshKeyDir = "$env:USERPROFILE\\.ssh"

$SshTimeout = 5

if ($SshKeys.Count -eq 0 -and (Test-Path $SshKeyDir)) {
  $SshKeys = Get-ChildItem -Path $SshKeyDir -File |
    Where-Object {
      $_.Name -notlike "*.pub" -and
      (Get-Content $_.FullName -TotalCount 1 -ErrorAction SilentlyContinue) -match "PRIVATE KEY"
    } |
    ForEach-Object { $_.FullName }
}

$InstallCmd = "curl -fsSL '$ServerURL/api/agent/installer/linux?key=$APIKey' | sudo bash"

function Try-Ssh {
  param([string]$HostIp, [string]$User, [string]$Key)
  $null = & ssh.exe -o BatchMode=yes -o StrictHostKeyChecking=accept-new \`
    -o ConnectTimeout=$SshTimeout -o LogLevel=ERROR \`
    -i "$Key" "$User@$HostIp" $InstallCmd 2>$null
  return ($LASTEXITCODE -eq 0)
}

$success = 0; $fail = 0
foreach ($h in $Hosts) {
  Write-Host "=== $h ==="
  $deployed = $false
  foreach ($u in $Users) {
    foreach ($k in $SshKeys) {
      Write-Host "  try $u@$h with $(Split-Path -Leaf $k)"
      if (Try-Ssh -HostIp $h -User $u -Key $k) {
        Write-Host "  OK   $u@$h via $(Split-Path -Leaf $k)"
        $deployed = $true; break
      }
    }
    if ($deployed) { break }
  }
  if ($deployed) { $success++ } else { $fail++; Write-Host "  FAIL $h" }
}
Write-Host "done — $success deployed, $fail failed"
`;
}

// bash + pywinrm → Windows targets (cross-platform: sh → Windows)
function buildWinRmFromBash(ctx: BuildCtx): string {
  const hostLines = ctx.hosts.map((h) => {
    const c = h.hostname ? `    # ${sanitiseShellComment(h.hostname)}` : '';
    return `  "${h.ip}"${c}`;
  }).join('\n');
  const userLines = ctx.users.map((u) => `  "${shellQuote(u)}"`).join('\n');
  return `#!/usr/bin/env bash
# Obliance agent deployment — bash + pywinrm → Windows
# Generated ${new Date().toISOString()}
# Targets: ${ctx.hosts.length} Windows host(s) on ${ctx.serverUrl}
#
# Tries every (user x password) per host via WinRM (HTTP 5985 or HTTPS
# 5986) and installs the Obliance MSI when a combo works.
#
# Local requirements:
#   - python3
#   - pywinrm          (pip install pywinrm)
#   - network path to each target on tcp/5985 or 5986

set -u

SERVER_URL="${ctx.serverUrl}"
API_KEY="${ctx.apiKey}"

HOSTS=(
${hostLines}
)

USERS=(
${userLines}
)

# Passwords to try, in order. Leave empty to disable password auth.
PASSWORDS=(
  # "first-password"
  # "second-password"
)

# WinRM transport — "ntlm" for workgroup (HTTP 5985) or domain without
# Kerberos ticket, "kerberos" for domain + ticket, "ssl" for HTTPS 5986
# with self-signed/internal CA.
WINRM_TRANSPORT="ntlm"
WINRM_PORT=5985
WINRM_TIMEOUT=60

command -v python3 >/dev/null 2>&1 || { echo "python3 required"; exit 1; }
python3 -c "import winrm" 2>/dev/null || {
  echo "pywinrm required — run: pip install pywinrm"
  exit 1
}

log() { printf '[%s] %s\\n' "$(date +%H:%M:%S)" "$*"; }

# POWERSHELL install block run remotely on the Windows target.
read -r -d '' INSTALL_PS1 <<'PSEOF' || true
param($Url, $Key)
$m = Join-Path $env:TEMP "obliance-agent.msi"
try {
  Import-Module BitsTransfer -ErrorAction Stop
  Start-BitsTransfer -Source "$Url/api/agent/installer/windows.msi" -Destination $m
} catch {
  Invoke-WebRequest -Uri "$Url/api/agent/installer/windows.msi" -OutFile $m -UseBasicParsing
}
$msiArgs = "/i \\"$m\\" SERVERURL=\\"$Url\\" APIKEY=\\"$Key\\" /quiet /norestart"
$p = Start-Process msiexec -ArgumentList $msiArgs -Wait -PassThru -NoNewWindow
Remove-Item $m -ErrorAction SilentlyContinue
if ($p.ExitCode -ne 0) { throw "msiexec exit $($p.ExitCode)" }
PSEOF

try_winrm() {
  local host="$1" user="$2" pass="$3"
  WINRM_HOST="$host" WINRM_USER="$user" WINRM_PASS="$pass" \\
  WINRM_TRANSPORT="$WINRM_TRANSPORT" WINRM_PORT="$WINRM_PORT" \\
  WINRM_TIMEOUT="$WINRM_TIMEOUT" SERVER_URL="$SERVER_URL" \\
  API_KEY="$API_KEY" INSTALL_PS1="$INSTALL_PS1" \\
  python3 - <<'PYEOF' >/dev/null 2>&1
import os, sys, winrm
try:
    s = winrm.Session(
        f"{os.environ['WINRM_HOST']}:{os.environ['WINRM_PORT']}",
        auth=(os.environ['WINRM_USER'], os.environ['WINRM_PASS']),
        transport=os.environ['WINRM_TRANSPORT'],
        server_cert_validation='ignore',
        operation_timeout_sec=int(os.environ['WINRM_TIMEOUT']),
    )
    cmd = os.environ['INSTALL_PS1'] + f"\\nInstall-Args '{os.environ['SERVER_URL']}' '{os.environ['API_KEY']}'"
    # pywinrm's run_ps() wraps the string as a scriptblock — it still gets
    # the params via the parameter list on the first line.
    r = s.run_ps(os.environ['INSTALL_PS1'])
    sys.exit(0 if r.status_code == 0 else 1)
except Exception:
    sys.exit(1)
PYEOF
}

deploy_one() {
  local host="$1"
  log "=== $host ==="
  for user in "\${USERS[@]}"; do
    for pass in "\${PASSWORDS[@]}"; do
      log "  try $user@$host with password ***"
      if try_winrm "$host" "$user" "$pass"; then
        log "  OK   $user@$host"
        return 0
      fi
    done
  done
  log "  FAIL all attempts exhausted for $host"
  return 1
}

if [ \${#PASSWORDS[@]} -eq 0 ]; then
  log "no passwords configured — uncomment entries in the PASSWORDS array"
  exit 1
fi

SUCCESS=0; FAIL=0
for host in "\${HOSTS[@]}"; do
  if deploy_one "$host"; then SUCCESS=$((SUCCESS+1)); else FAIL=$((FAIL+1)); fi
done
log "done — $SUCCESS deployed, $FAIL failed"
`;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function shellQuote(s: string): string {
  return s.replace(/["\\$`]/g, '\\$&');
}

function psQuote(s: string): string {
  return s.replace(/"/g, '""');
}

function sanitiseShellComment(s: string): string {
  return s.replace(/[\r\n]/g, ' ');
}

function sanitisePsComment(s: string): string {
  return s.replace(/[\r\n]/g, ' ');
}
