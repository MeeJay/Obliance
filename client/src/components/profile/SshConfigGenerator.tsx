import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, FileCode } from 'lucide-react';
import { cn } from '@/utils/cn';
import { copyText } from './SshKeysSection';

// ── ~/.ssh/config generator for this Obliance instance ──────────────────────
// Two blocks:
//   Host <alias>     -> the bastion (no need to type the port)
//   Host *.<alias>   -> every machine through ProxyJump, account `obli`, with
//                       the SAME IdentityFile: the one-time key installed on the
//                       target is the key used at the bastion, so the target
//                       hop must offer that key too (otherwise sshd falls back
//                       to a password prompt).
// The bastion resolves "<machine>.<alias>" by dropping the last label.

type Format = 'config' | 'powershell' | 'bash';
const STORAGE_KEY = 'obliance.sshConfig.identityFile';
const DEFAULT_IDENTITY = '~/.ssh/id_ed25519';

function loadIdentity(): string {
  try { return localStorage.getItem(STORAGE_KEY) || DEFAULT_IDENTITY; } catch { return DEFAULT_IDENTITY; }
}

// Paths only: letters, digits, ~ / \ . _ - : and spaces. Everything else is
// dropped so the value is inert inside ssh_config, PowerShell "…" and bash '…'.
function sanitizePath(raw: string): string {
  return raw.replace(/[^A-Za-z0-9~/\\._:\- ]/g, '').trim();
}

export function SshConfigGenerator({ port, username }: { port: number; username?: string | null }) {
  const { t } = useTranslation();
  const [identity, setIdentity] = useState(loadIdentity);
  const [format, setFormat] = useState<Format>('config');

  const host = window.location.hostname;
  const alias = (host.split('.')[0] || 'obliance').replace(/[^A-Za-z0-9-]/g, '') || 'obliance';
  const id = sanitizePath(identity) || DEFAULT_IDENTITY;
  const idValue = id.includes(' ') ? `"${id}"` : id;
  const user = (username || '').replace(/[^A-Za-z0-9._@-]/g, '');

  const lines = [
    `Host ${alias}`,
    `    HostName ${host}`,
    ...(port !== 22 ? [`    Port ${port}`] : []),
    ...(user ? [`    User ${user}`] : []),
    `    IdentityFile ${idValue}`,
    '    IdentitiesOnly yes',
    '',
    `Host *.${alias}`,
    '    User obli',
    `    ProxyJump ${alias}`,
    `    IdentityFile ${idValue}`,
    '    IdentitiesOnly yes',
  ];

  const text = format === 'config'
    ? lines.join('\n')
    : format === 'powershell'
      // One line (multi-line pastes break in PowerShell). `n = newline; the
      // values are sanitized, so no $, backtick or quote can reach the string.
      // A quoted IdentityFile (path with spaces) needs `" inside the PS string.
      ? `New-Item -ItemType Directory -Force "$env:USERPROFILE\\.ssh" | Out-Null; Add-Content -Encoding ascii -Path "$env:USERPROFILE\\.ssh\\config" -Value "\`n${lines.map((l) => l.replace(/"/g, '`"')).join('`n')}"`
      : `mkdir -p ~/.ssh && printf '%s\\n' '' ${lines.map((l) => `'${l}'`).join(' ')} >> ~/.ssh/config && chmod 600 ~/.ssh/config`;

  const onIdentity = (v: string) => {
    setIdentity(v);
    try { localStorage.setItem(STORAGE_KEY, v); } catch { /* per-viewer convenience only */ }
  };

  const tabs: { key: Format; label: string }[] = [
    { key: 'config', label: t('sshBastion.sshConfig.formatConfig') || '~/.ssh/config' },
    { key: 'powershell', label: t('sshBastion.sshConfig.formatPowershell') || 'Windows (PowerShell)' },
    { key: 'bash', label: t('sshBastion.sshConfig.formatBash') || 'Linux / macOS' },
  ];

  return (
    <div className="space-y-2 pt-2">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
        <FileCode size={12} /> {t('sshBastion.sshConfig.title') || 'SSH profile for this Obliance'}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-[11px] text-text-muted" htmlFor="ssh-identity-file">
          {t('sshBastion.sshConfig.identityFile') || 'Private key (IdentityFile)'}
        </label>
        <input
          id="ssh-identity-file"
          value={identity}
          onChange={(e) => onIdentity(e.target.value)}
          spellCheck={false}
          placeholder={DEFAULT_IDENTITY}
          className="min-w-[14rem] flex-1 rounded-md bg-bg-primary px-2 py-1 font-mono text-xs text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </div>
      <div className="flex gap-1">
        {tabs.map((tb) => (
          <button
            key={tb.key}
            onClick={() => setFormat(tb.key)}
            className={cn(
              'rounded px-2 py-0.5 text-[11px]',
              format === tb.key ? 'bg-accent/15 text-accent' : 'text-text-muted hover:bg-bg-hover hover:text-text-primary',
            )}
          >
            {tb.label}
          </button>
        ))}
      </div>
      <div className="relative">
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-bg-primary p-3 pr-9 font-mono text-[11px] text-text-primary select-all">{text}</pre>
        <button
          onClick={() => copyText(text, t('common.copied') || 'Copied')}
          className="absolute right-1.5 top-1.5 p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover"
          title={t('common.copy') || 'Copy'}
        >
          <Copy size={13} />
        </button>
      </div>
      <p className="text-[11px] text-text-muted">
        {format === 'config'
          ? (t('sshBastion.sshConfig.hintConfig', { alias }) || `Add to ~/.ssh/config (Windows: %USERPROFILE%\\.ssh\\config). Then: "ssh ${alias}" for the bastion, "ssh <machine>.${alias}" to jump to a machine (scp, sftp, VS Code Remote too).`)
          : (t('sshBastion.sshConfig.hintScript', { alias }) || `Appends the profile to your SSH config. Then: "ssh ${alias}" for the bastion, "ssh <machine>.${alias}" to jump to a machine.`)}
      </p>
    </div>
  );
}
