import { useState, useEffect, useMemo } from 'react';
import { X, Copy, Download, Check, Search, AlertTriangle } from 'lucide-react';
import { deviceApi } from '@/api/device.api';
import type { AgentApiKey, DiscoveredDevice } from '@obliance/shared';
import toast from 'react-hot-toast';
import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';

type OsTarget = 'linux' | 'windows';

interface Props {
  hosts: DiscoveredDevice[];
  onClose: () => void;
}

export function GenerateDeployScriptModal({ hosts, onClose }: Props) {
  const { t } = useTranslation();

  const [keys, setKeys] = useState<AgentApiKey[]>([]);
  const [keyQuery, setKeyQuery] = useState('');
  const [selectedKeyId, setSelectedKeyId] = useState<number | null>(null);
  const [osTarget, setOsTarget] = useState<OsTarget>('linux');
  const [copied, setCopied] = useState(false);

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

  const script = useMemo(() => {
    if (!selectedKey) return '';
    const ips = hosts.map((h) => h.ip).filter(Boolean);
    return osTarget === 'linux'
      ? buildLinuxScript(serverUrl, selectedKey.key, ips)
      : buildWindowsScript(serverUrl, selectedKey.key, ips);
  }, [hosts, osTarget, selectedKey, serverUrl]);

  const filename = osTarget === 'linux' ? 'obliance-deploy.sh' : 'obliance-deploy.ps1';

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
          {/* OS tabs */}
          <div className="flex items-center gap-2 border-b border-border">
            {(['linux', 'windows'] as OsTarget[]).map((os) => (
              <button
                key={os}
                onClick={() => setOsTarget(os)}
                className={clsx(
                  'px-3 py-1.5 text-xs font-medium transition-colors border-b-2 -mb-px',
                  osTarget === os
                    ? 'text-accent border-accent'
                    : 'text-text-muted border-transparent hover:text-text-primary',
                )}
              >
                {os === 'linux'
                  ? (t('discovery.deployScript.linux') || 'Linux / macOS (SSH)')
                  : (t('discovery.deployScript.windows') || 'Windows (WinRM)')}
              </button>
            ))}
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

          {/* Host list preview */}
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">
              {t('discovery.deployScript.targets') || 'Target hosts'} ({hosts.length})
            </label>
            <div className="max-h-24 overflow-y-auto p-2 bg-bg-secondary border border-border rounded-lg text-xs font-mono text-text-muted">
              {hosts.map((h) => (
                <div key={h.id}>
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
                'Edit USERS, SSH_KEYS / SSH_KEY_DIR and the commented PASSWORD variable before running. The script will SSH into each host and install the Obliance agent. Credentials live only on your local machine.'}
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
{script || `# ${t('discovery.deployScript.pickKey') || 'Pick an API key to generate the script.'}`}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Script templates ─────────────────────────────────────────────────────────

function buildLinuxScript(serverUrl: string, apiKey: string, ips: string[]): string {
  const hosts = ips.map((ip) => `  "${ip}"`).join('\n');
  return `#!/usr/bin/env bash
# Obliance agent deployment — generated ${new Date().toISOString()}
# Targets: ${ips.length} host(s) on ${serverUrl}
#
# The script tries every (user x private key) combination per host, then
# falls back to password auth if PASSWORD is uncommented. The first combo
# that succeeds wins and the script moves on to the next host.
#
# Requirements on the local machine:
#   - ssh client (always)
#   - sshpass        (only if PASSWORD is uncommented)
#   - reachable network path to each target on tcp/22

set -u

# ── Config — edit below ──────────────────────────────────────────────────────

SERVER_URL="${serverUrl}"
API_KEY="${apiKey}"

HOSTS=(
${hosts}
)

# Users to try, in order. Extend for your environment.
USERS=(
  "root"
  "admin"
  "ubuntu"
  "debian"
  "opc"
  # "Agitel"
)

# Explicit list of SSH private keys to try, in order.
# Leave empty to have the script enumerate SSH_KEY_DIR instead.
SSH_KEYS=(
  # "$HOME/.ssh/id_ed25519"
  # "$HOME/.ssh/prod_rsa"
)

# Directory scanned for private keys when SSH_KEYS is empty.
# Every regular file whose first 60 bytes contain "PRIVATE KEY" is tried.
SSH_KEY_DIR="$HOME/.ssh"

# Fallback password — uncomment to enable password auth via sshpass.
# Used ONLY after every (user x key) combo has failed for a given host.
# PASSWORD="change-me"

SSH_TIMEOUT=5

# ── End of config ────────────────────────────────────────────────────────────

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
  command -v sshpass >/dev/null 2>&1 || { log "  sshpass not installed — skipping password auth"; return 1; }
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

function buildWindowsScript(serverUrl: string, apiKey: string, ips: string[]): string {
  const hosts = ips.map((ip) => `  "${ip}"`).join('\n');
  return `<#
  Obliance agent deployment — generated ${new Date().toISOString()}
  Targets: ${ips.length} Windows host(s) on ${serverUrl}

  The script tries every (user x password) combination per host via WinRM
  and installs the Obliance MSI when a combo succeeds. The first combo
  that works wins and the script moves on to the next host.

  Requirements on the local machine:
    - PowerShell 5.1+
    - WinRM reachable on each target (tcp/5985 or 5986)
    - WinRM client must trust the targets or use explicit -Authentication
      (Negotiate/Kerberos for domain, Basic+HTTPS or CredSSP for workgroup)
#>

$ServerURL = "${serverUrl}"
$APIKey    = "${apiKey}"

$Hosts = @(
${hosts}
)

# Users to try, in order. Prefix with "DOMAIN\\" or "host\\" as needed.
$Users = @(
  "Administrator"
  "admin"
  # "CORP\\Administrator"
)

# Passwords to try, in order. The script loops through every (user x password)
# pair, so pass every credential your fleet uses. Leave the array empty to
# disable password auth entirely (rare — WinRM without creds means Kerberos
# SSO only, which usually fails from a workgroup).
$Passwords = @(
  # "first-password"
  # "second-password"
)

# Authentication mechanism. Negotiate covers Kerberos + NTLM for domain hosts.
# Use "Basic" with HTTPS for workgroup, "CredSSP" to delegate for second hop.
$AuthMechanism = "Negotiate"

# Operation timeout per WinRM call (seconds).
$Timeout = 60

# ── End of config ────────────────────────────────────────────────────────────

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
