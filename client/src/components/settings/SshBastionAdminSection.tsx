import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TerminalSquare, Plus, Trash2, RotateCcw, ShieldOff, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  sshBastionApi, apiErrorMessage,
  type SshBastionStatus, type SshAllowEntry, type SshBan,
} from '@/api/sshBastion.api';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { cn } from '@/utils/cn';

// ── SSH bastion administration (platform admins) ────────────────────────────
// Status + host fingerprint, enforce toggle, static IP allow-list, active bans.
// The bastion itself is switched on/off in .env (SSH_BASTION_ENABLED).

export function SshBastionAdminSection() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<SshBastionStatus | null>(null);
  const [allow, setAllow] = useState<SshAllowEntry[]>([]);
  const [bans, setBans] = useState<SshBan[]>([]);
  const [myIp, setMyIp] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [cidr, setCidr] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);

  const fail = (err: unknown) => {
    const msg = apiErrorMessage(err, t('common.error') || 'Error');
    if (msg) toast.error(msg);
  };

  const load = async () => {
    try {
      const [s, a, b, i] = await Promise.all([
        sshBastionApi.status(), sshBastionApi.listAllowlist(), sshBastionApi.listBans(),
        sshBastionApi.info().catch(() => null),
      ]);
      setStatus(s); setAllow(a); setBans(b); setMyIp(i?.currentIp ?? null);
    } catch (err) { fail(err); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const toggleEnforce = async () => {
    if (!status) return;
    const next = !status.enforce;
    if (!next && !confirm(t('sshBastion.admin.confirmDisableEnforce')
      || 'Disable IP enforcement? Any IP holding a valid key will be able to reach the bastion, and refused IPs will no longer be banned.')) {
      return;
    }
    setBusy(true);
    try {
      await sshBastionApi.setEnforce(next);
      setStatus({ ...status, enforce: next });
      toast.success(next
        ? (t('sshBastion.admin.enforceOn') || 'IP enforcement enabled')
        : (t('sshBastion.admin.enforceOff') || 'IP enforcement disabled'));
    } catch (err) { fail(err); }
    finally { setBusy(false); }
  };

  const addEntry = async (value = cidr, lbl = label) => {
    if (!value.trim()) return;
    setBusy(true);
    try {
      await sshBastionApi.addAllowlist(value.trim(), lbl.trim() || null);
      setCidr(''); setLabel('');
      setAllow(await sshBastionApi.listAllowlist());
      toast.success(t('sshBastion.admin.entryAdded') || 'Entry added');
    } catch (err) { fail(err); }
    finally { setBusy(false); }
  };

  const removeEntry = async (e: SshAllowEntry) => {
    if (!confirm(t('sshBastion.admin.confirmRemoveEntry', { cidr: e.cidr }) || `Remove ${e.cidr} from the allow-list?`)) return;
    try {
      await sshBastionApi.deleteAllowlist(e.id);
      setAllow((prev) => prev.filter((x) => x.id !== e.id));
    } catch (err) { fail(err); }
  };

  const unban = async (b: SshBan) => {
    if (!confirm(t('sshBastion.admin.confirmUnban', { ip: b.ip }) || `Unban ${b.ip}?`)) return;
    try {
      await sshBastionApi.unban(b.ip);
      setBans((prev) => prev.filter((x) => x.ip !== b.ip));
      toast.success(t('sshBastion.admin.unbanned') || 'IP unbanned');
    } catch (err) { fail(err); }
  };

  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—');
  const myIpListed = !!myIp && allow.some((a) => a.cidr === myIp);

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <TerminalSquare size={18} className="text-accent" />
        <h2 className="text-lg font-semibold text-text-primary">{t('sshBastion.admin.title') || 'SSH bastion'}</h2>
      </div>

      <div className="rounded-lg bg-bg-secondary p-5 space-y-6">
        {loading ? (
          <p className="text-sm text-text-muted animate-pulse">{t('common.loading') || 'Loading…'}</p>
        ) : !status ? (
          <p className="text-sm text-text-muted">{t('common.error') || 'Error'}</p>
        ) : (
          <>
            {/* ── Status ── */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs">
                <span className="flex items-center gap-1.5">
                  <span className={cn('h-1.5 w-1.5 rounded-full', status.running ? 'bg-status-up' : status.enabled ? 'bg-status-down' : 'bg-text-muted')} />
                  <span className="text-text-primary font-medium">
                    {status.running
                      ? (t('sshBastion.admin.running', { port: status.port }) || `Listening on port ${status.port}`)
                      : status.enabled
                        ? (t('sshBastion.admin.enabledNotRunning') || 'Enabled but not running — check the server logs')
                        : (t('sshBastion.admin.disabled') || 'Disabled')}
                  </span>
                </span>
                {status.hostKey && (
                  <span className="text-text-muted">
                    {t('sshBastion.connect.fingerprint') || 'Fingerprint'}:{' '}
                    <span className="font-mono text-text-secondary select-all">{status.hostKey.fingerprint}</span>
                  </span>
                )}
              </div>
              {!status.enabled && (
                <p className="text-xs text-text-muted">
                  {t('sshBastion.admin.howToEnable') || 'To enable it, set SSH_BASTION_ENABLED=true (and optionally SSH_BASTION_PORT) in .env, publish the port in docker-compose.yml, then restart the server.'}
                </p>
              )}
            </div>

            {/* ── Enforce ── */}
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="flex items-center gap-1.5 text-sm font-medium text-text-primary">
                  {status.enforce ? <ShieldCheck size={14} className="text-status-up" /> : <ShieldOff size={14} className="text-amber-400" />}
                  {t('sshBastion.admin.enforceTitle') || 'Restrict access by IP'}
                </p>
                <p className="text-xs text-text-muted mt-0.5 max-w-2xl">
                  {t('sshBastion.admin.enforceDesc') || 'Only IPs from the allow-list below, or authorized by a user through the "SSH" button (2FA, 24h), can open a session. An IP refused 3 times is banned.'}
                </p>
              </div>
              <button
                role="switch"
                aria-checked={status.enforce}
                onClick={toggleEnforce}
                disabled={busy}
                className={cn(
                  'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50',
                  status.enforce ? 'bg-accent' : 'bg-bg-tertiary',
                )}
              >
                <span className={cn('inline-block h-4 w-4 rounded-full bg-white transition-transform', status.enforce ? 'translate-x-4' : 'translate-x-0.5')} />
              </button>
            </div>

            {/* ── Allow-list ── */}
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                {t('sshBastion.admin.allowlist') || 'IP allow-list'}
              </p>
              {status.enforce && allow.length === 0 && (
                <p className="text-xs text-amber-300">
                  {t('sshBastion.admin.allowlistEmpty') || 'The allow-list is empty: only IPs authorized through the "SSH" button can connect.'}
                </p>
              )}
              {allow.length > 0 && (
                <div className="space-y-1">
                  {allow.map((a) => (
                    <div key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 rounded bg-bg-tertiary/30 text-xs">
                      <span className="font-mono text-text-primary min-w-[10rem]">{a.cidr}</span>
                      <span className="text-text-secondary flex-1 min-w-0 truncate">{a.label || '—'}</span>
                      <span className="text-text-muted">{a.createdByName || '—'} · {fmt(a.createdAt)}</span>
                      <button
                        onClick={() => removeEntry(a)}
                        className="text-red-400 hover:text-red-300 hover:bg-red-400/10 p-1 rounded"
                        title={t('common.delete') || 'Delete'}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap items-end gap-2">
                <div className="w-52">
                  <Input
                    value={cidr}
                    onChange={(e) => setCidr(e.target.value)}
                    placeholder={t('sshBastion.admin.cidrPlaceholder') || '203.0.113.4 or 10.0.0.0/24'}
                    onKeyDown={(e) => { if (e.key === 'Enter') addEntry(); }}
                  />
                </div>
                <div className="w-64">
                  <Input
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder={t('sshBastion.admin.labelPlaceholder') || 'Label (optional)'}
                    maxLength={120}
                    onKeyDown={(e) => { if (e.key === 'Enter') addEntry(); }}
                  />
                </div>
                <Button size="sm" onClick={() => addEntry()} disabled={busy || !cidr.trim()}>
                  <Plus size={14} className="mr-1" /> {t('sshBastion.admin.add') || 'Add'}
                </Button>
                {myIp && !myIpListed && (
                  <Button size="sm" variant="ghost" onClick={() => addEntry(myIp, t('sshBastion.admin.myIpLabel') || 'Added from my current IP')} disabled={busy}>
                    {t('sshBastion.admin.addMyIp', { ip: myIp }) || `Add my IP (${myIp})`}
                  </Button>
                )}
              </div>
            </div>

            {/* ── Bans ── */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                  {t('sshBastion.admin.bans') || 'Banned IPs'}
                </p>
                <button
                  onClick={load}
                  className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover"
                  title={t('common.refresh') || 'Refresh'}
                >
                  <RotateCcw size={13} />
                </button>
              </div>
              {bans.length === 0 ? (
                <p className="text-xs text-text-muted italic">{t('sshBastion.admin.noBans') || 'No active ban.'}</p>
              ) : (
                <div className="space-y-1">
                  {bans.map((b) => (
                    <div key={b.ip} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 rounded bg-bg-tertiary/30 text-xs">
                      <span className="font-mono text-text-primary min-w-[10rem]">{b.ip}</span>
                      <span className="text-text-secondary flex-1 min-w-0 truncate">{b.reason || '—'}</span>
                      <span className="text-text-muted">
                        {b.expiresAt
                          ? (t('sshBastion.admin.banUntil', { time: fmt(b.expiresAt) }) || `until ${fmt(b.expiresAt)}`)
                          : (t('sshBastion.admin.banPermanent') || 'permanent')}
                      </span>
                      <button
                        onClick={() => unban(b)}
                        className="text-xs text-accent hover:bg-accent/10 px-2 py-0.5 rounded"
                      >
                        {t('sshBastion.admin.unban') || 'Unban'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
