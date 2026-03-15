import { useState, useEffect, type FormEvent } from 'react';
import { Shield, Server, Plus, Pencil, Trash2, Wifi, Eye, EyeOff, ArrowLeftRight, Copy, RefreshCw } from 'lucide-react';
import { SettingsPanel } from '@/components/settings/SettingsPanel';
import { NotificationTypesPanel } from '@/components/agent/NotificationTypesPanel';
import { useAuthStore } from '@/store/authStore';
import { smtpServerApi, type CreateSmtpServerRequest } from '@/api/smtpServer.api';
import { appConfigApi } from '@/api/appConfig.api';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import type { SmtpServer, AppConfigData, DeviceNotificationTypes, SsoIntegrationConfig } from '@obliance/shared';
import type { AgentGlobalConfig } from '@/api/appConfig.api';

const DEFAULT_AGENT_GLOBAL_CONFIG = {
  checkIntervalSeconds: 30,
  heartbeatMonitoring: true,
  maxMissedPushes: 3,
} as const;
import toast from 'react-hot-toast';
import { cn } from '@/utils/cn';
import { useTranslation } from 'react-i18next';

type SmtpFormMode = 'create' | 'edit' | null;

interface SmtpForm {
  name: string;
  host: string;
  port: string;
  secure: boolean;
  username: string;
  password: string;
  fromAddress: string;
}

const emptySmtpForm = (): SmtpForm => ({
  name: '',
  host: '',
  port: '587',
  secure: false,
  username: '',
  password: '',
  fromAddress: '',
});

export function SettingsPage() {
  const { t } = useTranslation();
  const { isAdmin } = useAuthStore();
  const admin = isAdmin();

  // ── SMTP Servers ──
  const [servers, setServers] = useState<SmtpServer[]>([]);
  const [smtpMode, setSmtpMode] = useState<SmtpFormMode>(null);
  const [editingServer, setEditingServer] = useState<SmtpServer | null>(null);
  const [smtpForm, setSmtpForm] = useState<SmtpForm>(emptySmtpForm());
  const [showPassword, setShowPassword] = useState(false);
  const [smtpSaving, setSmtpSaving] = useState(false);
  const [testingId, setTestingId] = useState<number | null>(null);

  // ── App Config (2FA) ──
  const [appConfig, setAppConfig] = useState<AppConfigData | null>(null);
  const [configSaving, setConfigSaving] = useState(false);

  // ── Agent Global Config ──
  const [agentGlobal, setAgentGlobal] = useState<AgentGlobalConfig | null>(null);
  const [agentSaving, setAgentSaving] = useState(false);
  const [agentInterval, setAgentInterval] = useState('');
  const [agentMaxMissed, setAgentMaxMissed] = useState('');

  // ── SSO Integration Configs ──
  const [obliviewCfg, setObliviewCfg] = useState<SsoIntegrationConfig | null>(null);
  const [obliviewUrl, setObliviewUrl] = useState('');
  const [obliviewApiKey, setObliviewApiKey] = useState('');
  const [showObliviewKey, setShowObliviewKey] = useState(false);

  const [obliguardCfg, setObliguardCfg] = useState<SsoIntegrationConfig | null>(null);
  const [obliguardUrl, setObliguardUrl] = useState('');
  const [obliguardApiKey, setObliguardApiKey] = useState('');
  const [showObliguardKey, setShowObliguardKey] = useState(false);

  const [oblimapCfg, setOblimapCfg] = useState<SsoIntegrationConfig | null>(null);
  const [oblimapUrl, setOblimapUrl] = useState('');
  const [oblimapApiKey, setOblimapApiKey] = useState('');
  const [showOblimapKey, setShowOblimapKey] = useState(false);

  useEffect(() => {
    if (!admin) return;
    smtpServerApi.list().then(setServers).catch(() => {});
    appConfigApi.getConfig().then(setAppConfig).catch(() => {});
    appConfigApi.getAgentGlobal().then((cfg) => {
      setAgentGlobal(cfg);
      setAgentInterval(cfg.checkIntervalSeconds !== null ? String(cfg.checkIntervalSeconds) : '');
      setAgentMaxMissed(cfg.maxMissedPushes !== null ? String(cfg.maxMissedPushes) : '');
    }).catch(() => {});
    appConfigApi.getObliviewConfig().then((cfg) => { setObliviewCfg(cfg); setObliviewUrl(cfg.url ?? ''); }).catch(() => {});
    appConfigApi.getObliguardConfig().then((cfg) => { setObliguardCfg(cfg); setObliguardUrl(cfg.url ?? ''); }).catch(() => {});
    appConfigApi.getOblimapConfig().then((cfg) => { setOblimapCfg(cfg); setOblimapUrl(cfg.url ?? ''); }).catch(() => {});
  }, [admin]);

  function openCreate() {
    setEditingServer(null);
    setSmtpForm(emptySmtpForm());
    setShowPassword(false);
    setSmtpMode('create');
  }

  function openEdit(server: SmtpServer) {
    setEditingServer(server);
    setSmtpForm({
      name: server.name,
      host: server.host,
      port: String(server.port),
      secure: server.secure,
      username: server.username ?? '',
      password: '',
      fromAddress: server.fromAddress ?? '',
    });
    setShowPassword(false);
    setSmtpMode('edit');
  }

  function closeSmtpModal() {
    setSmtpMode(null);
    setEditingServer(null);
  }

  async function handleSmtpSubmit(e: FormEvent) {
    e.preventDefault();
    setSmtpSaving(true);
    try {
      const data: CreateSmtpServerRequest = {
        name: smtpForm.name,
        host: smtpForm.host,
        port: parseInt(smtpForm.port, 10),
        secure: smtpForm.secure,
        username: smtpForm.username,
        password: smtpForm.password,
        fromAddress: smtpForm.fromAddress,
      };
      if (smtpMode === 'create') {
        const created = await smtpServerApi.create(data);
        setServers((prev) => [...prev, created]);
        toast.success(t('settings.smtp.created'));
      } else if (editingServer) {
        const payload = smtpForm.password ? data : { ...data, password: undefined };
        const updated = await smtpServerApi.update(editingServer.id, payload);
        setServers((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
        toast.success(t('settings.smtp.updated'));
      }
      closeSmtpModal();
    } catch {
      toast.error(t('settings.smtp.failedSave'));
    } finally {
      setSmtpSaving(false);
    }
  }

  async function handleDelete(server: SmtpServer) {
    if (!confirm(`Delete SMTP server "${server.name}"?`)) return;
    try {
      await smtpServerApi.delete(server.id);
      setServers((prev) => prev.filter((s) => s.id !== server.id));
      toast.success(t('settings.smtp.deleted'));
    } catch {
      toast.error(t('settings.smtp.failedDelete'));
    }
  }

  async function handleTest(server: SmtpServer) {
    setTestingId(server.id);
    try {
      await smtpServerApi.test(server.id);
      toast.success(t('settings.smtp.testOk', { name: server.name }));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('settings.smtp.testFailed');
      toast.error(msg);
    } finally {
      setTestingId(null);
    }
  }

  async function setConfigKey(key: keyof AppConfigData, value: boolean | number | null) {
    if (!appConfig) return;
    setConfigSaving(true);
    try {
      await appConfigApi.setConfig(key, value);
      setAppConfig((prev) => prev ? { ...prev, [key]: value } : prev);
    } catch {
      toast.error(t('settings.failedUpdate'));
    } finally {
      setConfigSaving(false);
    }
  }

  async function saveAgentMainConfig() {
    if (!agentGlobal) return;
    setAgentSaving(true);
    try {
      const updated = await appConfigApi.patchAgentGlobal({
        checkIntervalSeconds: agentInterval.trim() ? Number(agentInterval) : null,
        heartbeatMonitoring: agentGlobal.heartbeatMonitoring,
        maxMissedPushes: agentMaxMissed.trim() ? Number(agentMaxMissed) : null,
      });
      setAgentGlobal(updated);
      toast.success(t('common.saved'));
    } catch {
      toast.error(t('settings.failedUpdate'));
    } finally {
      setAgentSaving(false);
    }
  }

  async function saveAgentNotifTypes(notifTypes: DeviceNotificationTypes | null) {
    const updated = await appConfigApi.patchAgentGlobal({ notificationTypes: notifTypes });
    setAgentGlobal(updated);
  }

  // Save helpers — always bundle URL + key together so a key-only save never wipes the URL.
  // Pass `explicitApiKey` when generating a key (React state won't have updated yet).
  async function saveObliviewConfig(explicitApiKey?: string) {
    try {
      const key = explicitApiKey !== undefined ? explicitApiKey : obliviewApiKey;
      const patch: { url?: string | null; apiKey?: string | null } = { url: obliviewUrl.trim() || null };
      if (key.trim()) patch.apiKey = key.trim();
      const updated = await appConfigApi.patchObliviewConfig(patch);
      setObliviewCfg(updated);
      setObliviewUrl(updated.url ?? '');
      setObliviewApiKey('');
      toast.success(t('common.saved'));
    } catch {
      toast.error(t('settings.failedUpdate'));
    }
  }

  async function saveObliguardConfig(explicitApiKey?: string) {
    try {
      const key = explicitApiKey !== undefined ? explicitApiKey : obliguardApiKey;
      const patch: { url?: string | null; apiKey?: string | null } = { url: obliguardUrl.trim() || null };
      if (key.trim()) patch.apiKey = key.trim();
      const updated = await appConfigApi.patchObliguardConfig(patch);
      setObliguardCfg(updated);
      setObliguardUrl(updated.url ?? '');
      setObliguardApiKey('');
      toast.success(t('common.saved'));
    } catch {
      toast.error(t('settings.failedUpdate'));
    }
  }

  async function saveOblimapConfig(explicitApiKey?: string) {
    try {
      const key = explicitApiKey !== undefined ? explicitApiKey : oblimapApiKey;
      const patch: { url?: string | null; apiKey?: string | null } = { url: oblimapUrl.trim() || null };
      if (key.trim()) patch.apiKey = key.trim();
      const updated = await appConfigApi.patchOblimapConfig(patch);
      setOblimapCfg(updated);
      setOblimapUrl(updated.url ?? '');
      setOblimapApiKey('');
      toast.success(t('common.saved'));
    } catch {
      toast.error(t('settings.failedUpdate'));
    }
  }

  function generateSecret(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    return Array.from({ length: 48 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  }

  return (
    <div className="p-6 max-w-5xl min-w-0 mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-text-primary mb-2">{t('settings.title')}</h1>
        <p className="text-sm text-text-muted">
          {t('settings.globalDesc')}
        </p>
      </div>

      {/* ── Default Monitor Settings ── */}
      <SettingsPanel scope="global" scopeId={null} title={t('settings.defaultMonitorSettings')} />

      {admin && (
        <>
          {/* ── Default Agent Settings ── */}
          <div>
            <h2 className="text-lg font-semibold text-text-primary mb-4">{t('settings.defaultAgentSettings')}</h2>
            <div className="rounded-lg border border-border bg-bg-secondary p-5 space-y-6">
              <p className="text-xs text-text-muted">{t('settings.agentDefaultsDesc')}</p>

              {/* Check Interval */}
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-medium text-text-primary">{t('settings.agent.checkInterval')}</div>
                  <div className="text-xs text-text-muted">{t('settings.agent.checkIntervalDesc')}</div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number" value={agentInterval} min={5} max={86400}
                    onChange={e => setAgentInterval(e.target.value)}
                    placeholder={String(DEFAULT_AGENT_GLOBAL_CONFIG.checkIntervalSeconds)}
                    className="w-24 rounded-lg border border-border bg-bg-tertiary px-2 py-1.5 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent text-right placeholder:text-text-muted"
                  />
                  <span className="text-xs text-text-muted">{t('groups.detail.seconds')}</span>
                </div>
              </div>

              {/* Heartbeat Monitoring */}
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-text-primary">{t('settings.agent.heartbeatMonitoring')}</div>
                  <div className="text-xs text-text-muted">{t('settings.agent.heartbeatMonitoringDesc')}</div>
                </div>
                <button
                  role="switch"
                  aria-checked={agentGlobal?.heartbeatMonitoring ?? DEFAULT_AGENT_GLOBAL_CONFIG.heartbeatMonitoring}
                  disabled={!agentGlobal}
                  onClick={async () => {
                    if (!agentGlobal) return;
                    const updated = await appConfigApi.patchAgentGlobal({
                      heartbeatMonitoring: !(agentGlobal.heartbeatMonitoring ?? DEFAULT_AGENT_GLOBAL_CONFIG.heartbeatMonitoring),
                    });
                    setAgentGlobal(updated);
                  }}
                  className={cn(
                    'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none disabled:opacity-50',
                    (agentGlobal?.heartbeatMonitoring ?? DEFAULT_AGENT_GLOBAL_CONFIG.heartbeatMonitoring) ? 'bg-accent' : 'bg-bg-tertiary',
                  )}
                >
                  <span className={cn('pointer-events-none inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform',
                    (agentGlobal?.heartbeatMonitoring ?? DEFAULT_AGENT_GLOBAL_CONFIG.heartbeatMonitoring) ? 'translate-x-4' : 'translate-x-0.5')} />
                </button>
              </div>

              {/* Max Missed Pushes */}
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-medium text-text-primary">{t('settings.agent.maxMissedPushes')}</div>
                  <div className="text-xs text-text-muted">{t('settings.agent.maxMissedPushesDesc')}</div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number" value={agentMaxMissed} min={1} max={20}
                    onChange={e => setAgentMaxMissed(e.target.value)}
                    placeholder={String(DEFAULT_AGENT_GLOBAL_CONFIG.maxMissedPushes)}
                    className="w-20 rounded-lg border border-border bg-bg-tertiary px-2 py-1.5 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent text-right placeholder:text-text-muted"
                  />
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  onClick={saveAgentMainConfig}
                  disabled={agentSaving || !agentGlobal}
                  className="px-4 py-2 text-sm rounded-lg bg-accent text-white hover:bg-accent/90 disabled:opacity-60 transition-colors"
                >
                  {agentSaving ? t('common.saving') : t('common.save')}
                </button>
              </div>
            </div>

            {/* Notification Types — global scope, always editable */}
            <div className="mt-4">
              <NotificationTypesPanel
                config={agentGlobal?.notificationTypes ?? {}}
                scope="global"
                onSave={saveAgentNotifTypes}
              />
            </div>
          </div>

          {/* ── SMTP Servers ── */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-text-primary">{t('settings.smtp.title')}</h2>
              <Button size="sm" onClick={openCreate}>
                <Plus size={14} className="mr-1" /> {t('settings.smtp.addServer')}
              </Button>
            </div>
            {servers.length === 0 ? (
              <div className="rounded-lg border border-border bg-bg-secondary p-5 text-sm text-text-muted flex items-center gap-3">
                <Server size={16} className="shrink-0" />
                {t('settings.smtp.noServers')}
              </div>
            ) : (
              <div className="rounded-lg border border-border bg-bg-secondary overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th className="px-4 py-2.5 font-medium text-text-secondary">{t('settings.smtp.colName')}</th>
                      <th className="px-4 py-2.5 font-medium text-text-secondary">{t('settings.smtp.colHost')}</th>
                      <th className="px-4 py-2.5 font-medium text-text-secondary">{t('settings.smtp.colFrom')}</th>
                      <th className="px-4 py-2.5 font-medium text-text-secondary text-right">{t('settings.smtp.colActions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {servers.map((server) => (
                      <tr key={server.id} className="border-b border-border last:border-0 hover:bg-bg-hover transition-colors">
                        <td className="px-4 py-3 text-text-primary font-medium">{server.name}</td>
                        <td className="px-4 py-3 text-text-secondary">
                          {server.host}:{server.port}
                          {server.secure && <span className="ml-1.5 text-xs bg-green-500/10 text-green-400 rounded px-1">{t('settings.smtp.tlsBadge')}</span>}
                        </td>
                        <td className="px-4 py-3 text-text-muted">{server.fromAddress}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => handleTest(server)}
                              disabled={testingId === server.id}
                              className="p-1.5 rounded text-text-muted hover:text-blue-400 hover:bg-blue-400/10 transition-colors disabled:opacity-50"
                              title={t('settings.smtp.testConnection')}
                            >
                              <Wifi size={14} />
                            </button>
                            <button
                              onClick={() => openEdit(server)}
                              className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
                              title={t('common.edit')}
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              onClick={() => handleDelete(server)}
                              className="p-1.5 rounded text-text-muted hover:text-red-400 hover:bg-red-400/10 transition-colors"
                              title={t('common.delete')}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Security / 2FA ── */}
          <div>
            <h2 className="text-lg font-semibold text-text-primary mb-4">{t('settings.security.title')}</h2>
            <div className="rounded-lg border border-border bg-bg-secondary divide-y divide-border">
              <div className="flex items-start justify-between gap-4 p-4">
                <div className="flex items-start gap-3">
                  <Shield size={16} className="text-text-muted mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-text-primary">{t('settings.security.allow2fa')}</p>
                    <p className="text-xs text-text-muted mt-0.5">{t('settings.security.allow2faDesc')}</p>
                  </div>
                </div>
                <button
                  role="switch"
                  aria-checked={(appConfig?.allow_2fa ?? false) as boolean | "true" | "false" | "mixed"}
                  disabled={configSaving || !appConfig}
                  onClick={() => setConfigKey('allow_2fa', !appConfig?.allow_2fa)}
                  className={cn(
                    'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none disabled:opacity-50',
                    appConfig?.allow_2fa ? 'bg-primary' : 'bg-bg-tertiary',
                  )}
                >
                  <span className={cn('pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform', appConfig?.allow_2fa ? 'translate-x-4' : 'translate-x-0')} />
                </button>
              </div>

              <div className={cn('flex items-start justify-between gap-4 p-4', !appConfig?.allow_2fa && 'opacity-50 pointer-events-none')}>
                <div className="flex items-start gap-3">
                  <Shield size={16} className="text-text-muted mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-text-primary">{t('settings.security.force2fa')}</p>
                    <p className="text-xs text-text-muted mt-0.5">
                      {t('settings.security.force2faDesc').split('\n')[0]}
                      {' '}
                      Bypass via <code className="text-xs font-mono">DISABLE_2FA_FORCE=true</code> in .env.
                    </p>
                  </div>
                </div>
                <button
                  role="switch"
                  aria-checked={(appConfig?.force_2fa ?? false) as boolean | "true" | "false" | "mixed"}
                  disabled={configSaving || !appConfig || !appConfig.allow_2fa}
                  onClick={() => setConfigKey('force_2fa', !appConfig?.force_2fa)}
                  className={cn(
                    'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none disabled:opacity-50',
                    appConfig?.force_2fa ? 'bg-primary' : 'bg-bg-tertiary',
                  )}
                >
                  <span className={cn('pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform', appConfig?.force_2fa ? 'translate-x-4' : 'translate-x-0')} />
                </button>
              </div>

              <div className={cn('flex items-start gap-4 p-4', !appConfig?.allow_2fa && 'opacity-50 pointer-events-none')}>
                <Server size={16} className="text-text-muted mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text-primary">{t('settings.security.otpSmtp')}</p>
                  <p className="text-xs text-text-muted mt-0.5">{t('settings.security.otpSmtpDesc')}</p>
                  <select
                    className="mt-2 w-full max-w-xs rounded-md border border-border bg-bg-primary px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
                    value={appConfig?.otp_smtp_server_id ?? ''}
                    disabled={configSaving || !appConfig || !appConfig.allow_2fa}
                    onChange={(e) => setConfigKey('otp_smtp_server_id', e.target.value ? parseInt(e.target.value, 10) : null)}
                  >
                    <option value="">{t('settings.security.noneOption')}</option>
                    {servers.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* ── Obliview Integration ── */}
          <div>
            <h2 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
              <ArrowLeftRight size={18} className="text-text-muted" />
              Obliview Integration
            </h2>
            <div className="rounded-lg border border-border bg-bg-secondary p-5 space-y-5">
              <p className="text-xs text-text-muted">
                Link Obliance to Obliview to enable SSO switching between the two apps. Users can click &ldquo;Go to Obliview&rdquo; in the sidebar to jump directly into Obliview.
              </p>

              <div>
                <div className="flex items-center gap-2 mb-1">
                  <label className="text-sm font-medium text-text-secondary">Obliview URL</label>
                  {obliviewCfg?.url && (
                    <a href={obliviewCfg.url} target="_blank" rel="noopener noreferrer" className="text-xs text-accent hover:underline">Open ↗</a>
                  )}
                </div>
                <input
                  type="url"
                  placeholder="https://obliview.example.com"
                  value={obliviewUrl}
                  onChange={(e) => setObliviewUrl(e.target.value)}
                  onBlur={() => void saveObliviewConfig()}
                  className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/30"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Secret
                  {obliviewCfg?.apiKeySet && (
                    <span className="ml-2 text-[10px] font-semibold rounded px-1.5 py-0.5 bg-green-500/10 text-green-400 border border-green-500/20">SET</span>
                  )}
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      type={showObliviewKey ? 'text' : 'password'}
                      placeholder={obliviewCfg?.apiKeySet ? '••••••••••••••••••••••••••••••••••••' : 'Generate or paste a secret…'}
                      value={obliviewApiKey}
                      onChange={(e) => setObliviewApiKey(e.target.value)}
                      onBlur={() => { if (obliviewApiKey.trim()) void saveObliviewConfig(); }}
                      className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 pr-8 text-sm font-mono text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/30"
                    />
                    <button
                      type="button"
                      onClick={() => setShowObliviewKey((v) => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                    >
                      {showObliviewKey ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => { const s = generateSecret(); setObliviewApiKey(s); void saveObliviewConfig(s); }}
                    title="Generate a new random secret"
                    className="flex items-center gap-1.5 rounded-lg border border-border bg-bg-tertiary px-3 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors shrink-0"
                  >
                    <RefreshCw size={13} />
                    Generate
                  </button>
                  {obliviewApiKey && (
                    <button
                      type="button"
                      onClick={() => { void navigator.clipboard.writeText(obliviewApiKey); toast.success('Copied!'); }}
                      title="Copy to clipboard"
                      className="p-2 rounded-lg border border-border bg-bg-tertiary text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors shrink-0"
                    >
                      <Copy size={14} />
                    </button>
                  )}
                </div>
                <p className="mt-1.5 text-xs text-text-muted">
                  Use the same secret in{' '}
                  <span className="text-text-secondary font-medium">Obliview → Settings → Obliance Integration</span>.
                </p>
              </div>

              {obliviewCfg?.url && obliviewCfg.apiKeySet && (
                <div className="pt-4 border-t border-border mt-2">
                  <p className="text-xs text-green-400 flex items-center gap-1.5">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-400" />
                    Integration active — users can switch between Obliance and Obliview via SSO.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* ── Obliguard Integration ── */}
          <div>
            <h2 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
              <ArrowLeftRight size={18} className="text-text-muted" />
              Obliguard Integration
            </h2>
            <div className="rounded-lg border border-border bg-bg-secondary p-5 space-y-5">
              <p className="text-xs text-text-muted">
                Link Obliance to Obliguard to enable SSO switching between the two apps. Users can click &ldquo;Go to Obliguard&rdquo; in the sidebar to jump directly into Obliguard.
              </p>

              <div>
                <div className="flex items-center gap-2 mb-1">
                  <label className="text-sm font-medium text-text-secondary">Obliguard URL</label>
                  {obliguardCfg?.url && (
                    <a href={obliguardCfg.url} target="_blank" rel="noopener noreferrer" className="text-xs text-accent hover:underline">Open ↗</a>
                  )}
                </div>
                <input
                  type="url"
                  placeholder="https://obliguard.example.com"
                  value={obliguardUrl}
                  onChange={(e) => setObliguardUrl(e.target.value)}
                  onBlur={() => void saveObliguardConfig()}
                  className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/30"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Secret
                  {obliguardCfg?.apiKeySet && (
                    <span className="ml-2 text-[10px] font-semibold rounded px-1.5 py-0.5 bg-green-500/10 text-green-400 border border-green-500/20">SET</span>
                  )}
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      type={showObliguardKey ? 'text' : 'password'}
                      placeholder={obliguardCfg?.apiKeySet ? '••••••••••••••••••••••••••••••••••••' : 'Generate or paste a secret…'}
                      value={obliguardApiKey}
                      onChange={(e) => setObliguardApiKey(e.target.value)}
                      onBlur={() => { if (obliguardApiKey.trim()) void saveObliguardConfig(); }}
                      className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 pr-8 text-sm font-mono text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/30"
                    />
                    <button
                      type="button"
                      onClick={() => setShowObliguardKey((v) => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                    >
                      {showObliguardKey ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => { const s = generateSecret(); setObliguardApiKey(s); void saveObliguardConfig(s); }}
                    title="Generate a new random secret"
                    className="flex items-center gap-1.5 rounded-lg border border-border bg-bg-tertiary px-3 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors shrink-0"
                  >
                    <RefreshCw size={13} />
                    Generate
                  </button>
                  {obliguardApiKey && (
                    <button
                      type="button"
                      onClick={() => { void navigator.clipboard.writeText(obliguardApiKey); toast.success('Copied!'); }}
                      title="Copy to clipboard"
                      className="p-2 rounded-lg border border-border bg-bg-tertiary text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors shrink-0"
                    >
                      <Copy size={14} />
                    </button>
                  )}
                </div>
                <p className="mt-1.5 text-xs text-text-muted">
                  Use the same secret in{' '}
                  <span className="text-text-secondary font-medium">Obliguard → Settings → Obliance Integration</span>.
                </p>
              </div>

              {obliguardCfg?.url && obliguardCfg.apiKeySet && (
                <div className="pt-4 border-t border-border mt-2">
                  <p className="text-xs text-green-400 flex items-center gap-1.5">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-400" />
                    Integration active — users can switch between Obliance and Obliguard via SSO.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* ── Oblimap Integration ── */}
          <div>
            <h2 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
              <ArrowLeftRight size={18} className="text-text-muted" />
              Oblimap Integration
            </h2>
            <div className="rounded-lg border border-border bg-bg-secondary p-5 space-y-5">
              <p className="text-xs text-text-muted">
                Link Obliance to Oblimap to enable SSO switching between the two apps. Users can click &ldquo;Go to Oblimap&rdquo; in the sidebar to jump directly into Oblimap.
              </p>

              <div>
                <div className="flex items-center gap-2 mb-1">
                  <label className="text-sm font-medium text-text-secondary">Oblimap URL</label>
                  {oblimapCfg?.url && (
                    <a href={oblimapCfg.url} target="_blank" rel="noopener noreferrer" className="text-xs text-accent hover:underline">Open ↗</a>
                  )}
                </div>
                <input
                  type="url"
                  placeholder="https://oblimap.example.com"
                  value={oblimapUrl}
                  onChange={(e) => setOblimapUrl(e.target.value)}
                  onBlur={() => void saveOblimapConfig()}
                  className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/30"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Secret
                  {oblimapCfg?.apiKeySet && (
                    <span className="ml-2 text-[10px] font-semibold rounded px-1.5 py-0.5 bg-green-500/10 text-green-400 border border-green-500/20">SET</span>
                  )}
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      type={showOblimapKey ? 'text' : 'password'}
                      placeholder={oblimapCfg?.apiKeySet ? '••••••••••••••••••••••••••••••••••••' : 'Generate or paste a secret…'}
                      value={oblimapApiKey}
                      onChange={(e) => setOblimapApiKey(e.target.value)}
                      onBlur={() => { if (oblimapApiKey.trim()) void saveOblimapConfig(); }}
                      className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 pr-8 text-sm font-mono text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/30"
                    />
                    <button
                      type="button"
                      onClick={() => setShowOblimapKey((v) => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                    >
                      {showOblimapKey ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => { const s = generateSecret(); setOblimapApiKey(s); void saveOblimapConfig(s); }}
                    title="Generate a new random secret"
                    className="flex items-center gap-1.5 rounded-lg border border-border bg-bg-tertiary px-3 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors shrink-0"
                  >
                    <RefreshCw size={13} />
                    Generate
                  </button>
                  {oblimapApiKey && (
                    <button
                      type="button"
                      onClick={() => { void navigator.clipboard.writeText(oblimapApiKey); toast.success('Copied!'); }}
                      title="Copy to clipboard"
                      className="p-2 rounded-lg border border-border bg-bg-tertiary text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors shrink-0"
                    >
                      <Copy size={14} />
                    </button>
                  )}
                </div>
                <p className="mt-1.5 text-xs text-text-muted">
                  Use the same secret in{' '}
                  <span className="text-text-secondary font-medium">Oblimap → Settings → Obliance Integration</span>.
                </p>
              </div>

              {oblimapCfg?.url && oblimapCfg.apiKeySet && (
                <div className="pt-4 border-t border-border mt-2">
                  <p className="text-xs text-green-400 flex items-center gap-1.5">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-400" />
                    Integration active — users can switch between Obliance and Oblimap via SSO.
                  </p>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {smtpMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-bg-secondary rounded-xl shadow-2xl border border-border w-full max-w-md">
            <div className="px-5 py-4 border-b border-border">
              <h3 className="text-base font-semibold text-text-primary">
                {smtpMode === 'create' ? t('settings.smtp.addTitle') : t('settings.smtp.editTitle')}
              </h3>
            </div>
            <form onSubmit={handleSmtpSubmit} className="p-5 space-y-3">
              <Input
                label={t('settings.smtp.nameLabel')}
                value={smtpForm.name}
                onChange={(e) => setSmtpForm((f) => ({ ...f, name: e.target.value }))}
                placeholder={t('settings.smtp.namePlaceholder')}
                required
              />
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <Input
                    label={t('settings.smtp.hostLabel')}
                    value={smtpForm.host}
                    onChange={(e) => setSmtpForm((f) => ({ ...f, host: e.target.value }))}
                    placeholder={t('settings.smtp.hostPlaceholder')}
                    required
                  />
                </div>
                <Input
                  label={t('settings.smtp.portLabel')}
                  type="number"
                  value={smtpForm.port}
                  onChange={(e) => setSmtpForm((f) => ({ ...f, port: e.target.value }))}
                  placeholder={t('settings.smtp.portPlaceholder')}
                  required
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={smtpForm.secure}
                  onChange={(e) => setSmtpForm((f) => ({ ...f, secure: e.target.checked }))}
                  className="rounded border-border"
                />
                {t('settings.smtp.tlsLabel')}
              </label>
              <Input
                label={t('settings.smtp.usernameLabel')}
                value={smtpForm.username}
                onChange={(e) => setSmtpForm((f) => ({ ...f, username: e.target.value }))}
                required
              />
              <div className="relative">
                <Input
                  label={smtpMode === 'edit' ? t('settings.smtp.passwordEditLabel') : t('settings.smtp.passwordLabel')}
                  type={showPassword ? 'text' : 'password'}
                  value={smtpForm.password}
                  onChange={(e) => setSmtpForm((f) => ({ ...f, password: e.target.value }))}
                  required={smtpMode === 'create'}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2.5 bottom-2 text-text-muted hover:text-text-primary"
                >
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <Input
                label={t('settings.smtp.fromLabel')}
                type="email"
                value={smtpForm.fromAddress}
                onChange={(e) => setSmtpForm((f) => ({ ...f, fromAddress: e.target.value }))}
                placeholder={t('settings.smtp.fromPlaceholder')}
                required
              />
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="ghost" onClick={closeSmtpModal}>{t('common.cancel')}</Button>
                <Button type="submit" disabled={smtpSaving}>
                  {smtpSaving ? t('common.saving') : smtpMode === 'create' ? t('common.create') : t('common.save')}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
