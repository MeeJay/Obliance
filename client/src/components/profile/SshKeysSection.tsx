import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyRound, Plus, Trash2, Copy, ShieldAlert, Terminal } from 'lucide-react';
import toast from 'react-hot-toast';
import type { SshPublicKey } from '@obliance/shared';
import { sshBastionApi, apiErrorMessage, type SshBastionInfo } from '@/api/sshBastion.api';
import { useAuthStore } from '@/store/authStore';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { IconButton } from '@/components/common/IconButton';
import { useConfirm } from '@/components/common/ConfirmDialog';
import { copyText as copyToClipboard } from '@/utils/clipboard';
import i18n from '@/i18n';
import { SshConfigGenerator } from './SshConfigGenerator';

// ── SSH bastion keys (ObliJump) ─────────────────────────────────────────────
// The user's SSH public keys: their identity at the bastion door. Rendered
// only when the bastion is enabled server-side. Adding a key requires a fresh
// 2FA code (the api client interceptor prompts and replays the request).
// Anchor #ssh-keys is linked from the header "SSH" button.

export function sshConnectCommand(info: Pick<SshBastionInfo, 'port'>, username?: string | null): string {
  const host = window.location.hostname;
  const port = info.port === 22 ? '' : `-p ${info.port} `;
  return `ssh ${port}${username ? `${username}@` : ''}${host}`;
}

/**
 * Copy + toast. Kept for existing importers; delegates to the shared
 * utils/clipboard helper (Clipboard API -> execCommand -> Android bridge),
 * which also works on plain-http origins and in the WebView.
 */
export async function copyText(text: string, okMsg: string, failMsg?: string): Promise<boolean> {
  const ok = await copyToClipboard(text);
  if (ok) toast.success(okMsg);
  else toast.error(failMsg ?? i18n.t('common.error', 'Error'));
  return ok;
}

export function SshKeysSection() {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const { user } = useAuthStore();
  const [info, setInfo] = useState<SshBastionInfo | null>(null);
  const [keys, setKeys] = useState<SshPublicKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [publicKey, setPublicKey] = useState('');
  const [saving, setSaving] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    try {
      const i = await sshBastionApi.info();
      setInfo(i);
      if (i.enabled) setKeys(await sshBastionApi.listKeys());
    } catch { /* section simply stays hidden */ }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  // Deep link from the header button: /profile#ssh-keys
  useEffect(() => {
    if (!loading && info?.enabled && window.location.hash === '#ssh-keys') {
      rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [loading, info?.enabled]);

  if (loading || !info?.enabled) return null;

  const submit = async () => {
    if (!publicKey.trim()) return;
    setSaving(true);
    try {
      // Default name: the key comment (3rd field of an OpenSSH public key line).
      const fallbackName = publicKey.trim().split(/\s+/)[2] || 'SSH key';
      await sshBastionApi.addKey(name.trim() || fallbackName, publicKey.trim());
      toast.success(t('sshBastion.keys.added') || 'SSH key added');
      setName('');
      setPublicKey('');
      setAdding(false);
      setKeys(await sshBastionApi.listKeys());
    } catch (err) {
      const msg = apiErrorMessage(err, t('sshBastion.keys.addFailed') || 'Failed to add the SSH key');
      if (msg) toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (k: SshPublicKey) => {
    if (!(await confirm({
      message: t('sshBastion.keys.confirmDelete', { name: k.name }) || `Delete the SSH key "${k.name}"? It will no longer open the bastion.`,
      danger: true,
    }))) return;
    try {
      await sshBastionApi.deleteKey(k.id);
      setKeys((prev) => prev.filter((x) => x.id !== k.id));
      toast.success(t('sshBastion.keys.deleted') || 'SSH key deleted');
    } catch (err) {
      const msg = apiErrorMessage(err, t('common.error') || 'Error');
      if (msg) toast.error(msg);
    }
  };

  const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—');
  const command = sshConnectCommand(info, user?.username);
  const jumpCommand = `ssh -J ${user?.username ? `${user.username}@` : ''}${window.location.hostname}${info.port === 22 ? '' : `:${info.port}`} obli@<machine>`;

  return (
    <div id="ssh-keys" ref={rootRef} className="mt-8 bg-bg-secondary rounded-xl p-4 sm:p-6 scroll-mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-text-primary">
            <KeyRound size={18} className="text-accent" />
            {t('sshBastion.keys.title') || 'SSH keys (bastion)'}
          </h2>
          <p className="text-xs text-text-muted mt-0.5">
            {t('sshBastion.keys.desc') || 'Public keys allowed to open the Obliance SSH bastion. Only key authentication is accepted — never passwords.'}
          </p>
        </div>
        {!adding && (
          <Button size="sm" onClick={() => setAdding(true)} disabled={!info.has2fa}>
            <Plus size={14} className="mr-1" /> {t('sshBastion.keys.add') || 'Add a key'}
          </Button>
        )}
      </div>

      {!info.has2fa && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-300">
          <ShieldAlert size={14} className="shrink-0 mt-0.5" />
          {t('sshBastion.keys.need2fa') || 'Two-factor authentication must be enabled on your account to register an SSH key.'}
        </div>
      )}

      {adding && (
        <div className="mb-4 space-y-3 rounded-lg bg-bg-tertiary/40 p-4">
          <Input
            label={t('sshBastion.keys.name') || 'Name'}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('sshBastion.keys.namePlaceholder') || 'e.g. Work laptop'}
            maxLength={120}
          />
          <div className="space-y-1">
            <label className="block text-sm font-medium text-text-secondary">
              {t('sshBastion.keys.publicKey') || 'Public key'}
            </label>
            <textarea
              value={publicKey}
              onChange={(e) => setPublicKey(e.target.value)}
              rows={3}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="off"
              placeholder="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA... user@host"
              className="w-full rounded-md bg-bg-tertiary px-3 py-2 font-mono text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <p className="text-[11px] text-text-muted">
              {t('sshBastion.keys.publicKeyHint') || 'Content of your .pub file (ed25519, ECDSA or RSA ≥ 2048). Never paste the private key.'}
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setName(''); setPublicKey(''); }}>
              {t('common.cancel') || 'Cancel'}
            </Button>
            <Button size="sm" onClick={submit} disabled={saving || !publicKey.trim()}>
              {saving ? (t('common.saving') || 'Saving…') : (t('sshBastion.keys.save') || 'Add the key')}
            </Button>
          </div>
        </div>
      )}

      {keys.length === 0 ? (
        <p className="text-sm text-text-muted italic">
          {t('sshBastion.keys.empty') || 'No SSH key registered.'}
        </p>
      ) : (
        <div className="space-y-1">
          {keys.map((k) => (
            <div key={k.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 rounded bg-bg-tertiary/30 text-xs">
              <span className="font-medium text-text-primary min-w-[8rem]">{k.name}</span>
              <span className="text-text-muted">{k.keyType || '—'}</span>
              {/* Below lg the full fingerprint wraps (no hover tooltip on touch). */}
              <span className="font-mono text-text-secondary flex-1 min-w-0 lg:truncate max-lg:basis-full max-lg:break-all" title={k.fingerprint}>{k.fingerprint}</span>
              <span className="text-text-muted">
                {t('sshBastion.keys.lastUsed') || 'Last used'}: {fmtDate(k.lastUsedAt)}
              </span>
              <IconButton
                label={t('common.delete') || 'Delete'}
                icon={<Trash2 size={13} />}
                size="sm"
                variant="plain"
                onClick={() => remove(k)}
                className="text-red-400 hover:text-red-300 hover:bg-red-400/10 max-lg:ml-auto"
              />
            </div>
          ))}
        </div>
      )}

      {/* ── How to connect ── */}
      <div className="mt-5 rounded-lg bg-bg-tertiary/40 p-4 space-y-2">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
          <Terminal size={12} /> {t('sshBastion.connect.title') || 'Connect'}
        </p>
        <div className="flex items-center gap-2">
          {/* Below sm the command wraps instead of truncating (readable even if copying fails). */}
          <code className="flex-1 min-w-0 sm:truncate max-sm:break-all rounded bg-bg-primary px-3 py-1.5 font-mono text-xs text-text-primary select-all">{command}</code>
          <IconButton
            label={t('common.copy') || 'Copy'}
            icon={<Copy size={13} />}
            onClick={() => copyText(command, t('common.copied') || 'Copied', t('common.error'))}
            className="shrink-0"
          />
        </div>
        <p className="text-[11px] text-text-muted">
          {t('sshBastion.connect.help') || 'Once connected, type "help": "list" shows the machines you can reach, "ssh <machine>" opens a shell on it.'}
        </p>
        <p className="pt-1 text-[11px] font-semibold text-text-secondary">
          {t('sshBastion.connect.proxyJumpTitle') || 'Native ProxyJump (Linux machines — scp, sftp, VS Code Remote…)'}
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 min-w-0 sm:truncate max-sm:break-all rounded bg-bg-primary px-3 py-1.5 font-mono text-xs text-text-primary select-all">{jumpCommand}</code>
          <IconButton
            label={t('common.copy') || 'Copy'}
            icon={<Copy size={13} />}
            onClick={() => copyText(jumpCommand, t('common.copied') || 'Copied', t('common.error'))}
            className="shrink-0"
          />
        </div>
        <p className="text-[11px] text-text-muted">
          {t('sshBastion.connect.proxyJumpHelp') || 'The target account is always "obli" (then "sudo -i" for root). A one-time entry for your key is installed on the machine only while you connect. Requires an up-to-date agent.'}
        </p>
        <SshConfigGenerator port={info.port} username={user?.username} />
        {info.hostKey && (
          <p className="text-[11px] text-text-muted break-all">
            {t('sshBastion.connect.hostKey') || 'Server fingerprint (check it on first connection)'}:{' '}
            <span className="font-mono text-text-secondary select-all break-all">{info.hostKey.fingerprint}</span>
          </p>
        )}
        {info.enforce && (
          <p className="text-[11px] text-text-muted">
            {t('sshBastion.connect.enforceHint') || 'Access is limited to authorized IPs: use the "SSH" button in the header to authorize your current IP.'}
          </p>
        )}
        {!info.running && (
          <p className="text-[11px] text-amber-300">
            {t('sshBastion.connect.notRunning') || 'The bastion is enabled but not running — contact an administrator.'}
          </p>
        )}
      </div>
    </div>
  );
}
