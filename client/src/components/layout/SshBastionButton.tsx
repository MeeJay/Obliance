import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { TerminalSquare, ShieldCheck, Copy, KeyRound } from 'lucide-react';
import toast from 'react-hot-toast';
import { sshBastionApi, apiErrorMessage, type SshBastionInfo } from '@/api/sshBastion.api';
import { sshConnectCommand, copyText } from '@/components/profile/SshKeysSection';
import { useAuthStore } from '@/store/authStore';
import { cn } from '@/utils/cn';

// ── Header "SSH" button (ObliJump) ──────────────────────────────────────────
// Authorizes the caller's CURRENT IP to reach the SSH bastion for 24h, after a
// fresh 2FA code (the api client interceptor prompts and replays). Hidden when
// the bastion is disabled in .env.

function remaining(iso: string | null): number {
  return iso ? new Date(iso).getTime() - Date.now() : 0;
}

export function SshBastionButton() {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const [info, setInfo] = useState<SshBastionInfo | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [, setTick] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const load = () => sshBastionApi.info().then(setInfo).catch(() => { /* stays hidden */ });
  useEffect(() => { load(); }, []);

  // Refresh the countdown every minute; refetch when the menu opens (IP may have changed).
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => { if (open) load(); }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  if (!info?.enabled) return null;

  const ms = remaining(info.ipAuthorizedUntil);
  const authorized = ms > 0;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const left = h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m}min`;

  const authorize = async () => {
    setBusy(true);
    try {
      await sshBastionApi.authorizeIp();
      toast.success(t('sshBastion.button.authorized') || 'This IP can connect over SSH for 24h');
      await load();
    } catch (err) {
      const msg = apiErrorMessage(err, t('sshBastion.button.authorizeFailed') || 'Could not authorize this IP');
      if (msg) toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    setBusy(true);
    try {
      await sshBastionApi.revokeIp();
      toast.success(t('sshBastion.button.revoked') || 'SSH authorization revoked for this IP');
      await load();
    } catch (err) {
      const msg = apiErrorMessage(err, t('common.error') || 'Error');
      if (msg) toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const command = sshConnectCommand(info, user?.username);

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[13px] font-medium transition-colors',
          authorized ? 'text-status-up hover:bg-bg-hover' : 'text-text-muted hover:bg-bg-hover hover:text-text-primary',
        )}
        title={authorized
          ? (t('sshBastion.button.authorizedFor', { time: left }) || `SSH authorized for this IP (${left} left)`)
          : (t('sshBastion.button.tooltip') || 'SSH bastion access')}
      >
        <TerminalSquare size={14} />
        SSH
        {authorized && <span className="text-[11px] font-normal opacity-80">{left}</span>}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-[22rem] max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-bg-secondary p-4 shadow-xl z-50 space-y-3">
          <div>
            <p className="text-sm font-semibold text-text-primary">{t('sshBastion.button.title') || 'SSH bastion'}</p>
            <p className="text-xs text-text-muted mt-0.5">
              {t('sshBastion.button.currentIp') || 'Your IP'}:{' '}
              <span className="font-mono text-text-secondary">{info.currentIp || '—'}</span>
            </p>
          </div>

          {authorized ? (
            <div className="flex items-center justify-between gap-2 rounded-md bg-status-up/10 px-3 py-2">
              <span className="flex items-center gap-1.5 text-xs text-status-up">
                <ShieldCheck size={14} />
                {t('sshBastion.button.authorizedUntil', { time: new Date(info.ipAuthorizedUntil!).toLocaleString() })
                  || `Authorized until ${new Date(info.ipAuthorizedUntil!).toLocaleString()}`}
              </span>
              <button
                onClick={revoke}
                disabled={busy}
                className="text-xs text-red-400 hover:text-red-300 hover:bg-red-400/10 px-2 py-0.5 rounded disabled:opacity-50"
              >
                {t('sshBastion.button.revoke') || 'Revoke'}
              </button>
            </div>
          ) : info.has2fa ? (
            <div className="space-y-1.5">
              <button
                onClick={authorize}
                disabled={busy}
                className="w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
              >
                {t('sshBastion.button.authorize') || 'Authorize this IP for 24h'}
              </button>
              <p className="text-[11px] text-text-muted">
                {t('sshBastion.button.authorizeHint') || 'A two-factor code is requested. Only this IP is authorized, and only for the SSH bastion.'}
              </p>
            </div>
          ) : (
            <p className="rounded-md border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-300">
              {t('sshBastion.button.need2fa') || 'Enable two-factor authentication on your account to authorize an IP.'}
            </p>
          )}

          {!info.enforce && !authorized && (
            <p className="text-[11px] text-text-muted">
              {t('sshBastion.button.notEnforced') || 'IP restriction is currently disabled by an administrator: any IP can connect with a valid key.'}
            </p>
          )}

          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">{t('sshBastion.connect.title') || 'Connect'}</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 min-w-0 truncate rounded bg-bg-primary px-2 py-1 font-mono text-xs text-text-primary select-all">{command}</code>
              <button
                onClick={() => copyText(command, t('common.copied') || 'Copied')}
                className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover"
                title={t('common.copy') || 'Copy'}
              >
                <Copy size={13} />
              </button>
            </div>
            {info.hostKey && (
              <p className="text-[11px] text-text-muted break-all">
                {t('sshBastion.connect.fingerprint') || 'Fingerprint'}:{' '}
                <span className="font-mono text-text-secondary select-all">{info.hostKey.fingerprint}</span>
              </p>
            )}
          </div>

          <Link
            to="/profile#ssh-keys"
            onClick={() => {
              setOpen(false);
              // Already on /profile: the hash change alone does not scroll.
              setTimeout(() => document.getElementById('ssh-keys')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
            }}
            className="flex items-center gap-1.5 text-xs text-accent hover:underline"
          >
            <KeyRound size={12} />
            {t('sshBastion.button.manageKeys') || 'Manage my SSH keys'}
          </Link>
        </div>
      )}
    </div>
  );
}
