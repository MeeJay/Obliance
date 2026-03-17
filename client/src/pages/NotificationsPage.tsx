import { useState, useEffect, useRef, type FormEvent } from 'react';
import {
  Plus,
  Pencil,
  Trash2,
  Bell,
  TestTube2,
  Zap,
  Loader2,
  Building2,
  ChevronDown,
  ChevronRight,
  X,
} from 'lucide-react';
import type {
  NotificationChannel,
  NotificationPluginMeta,
  NotificationBinding,
  SmtpServer,
} from '@obliance/shared';
import { notificationsApi } from '@/api/notifications.api';
import { smtpServerApi } from '@/api/smtpServer.api';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { useTenantStore } from '@/store/tenantStore';

// ── Tenant sharing panel (per channel) ──────────────────────────────────────

interface TenantSharingPanelProps {
  channelId: number;
  currentTenantId: number | null;
}

function TenantSharingPanel({ channelId, currentTenantId }: TenantSharingPanelProps) {
  const { t } = useTranslation();
  const { tenants } = useTenantStore();
  const [sharedTenantIds, setSharedTenantIds] = useState<number[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [addingId, setAddingId] = useState<number | ''>('');
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    setLoading(true);
    notificationsApi.getChannelTenants(channelId)
      .then((ids) => {
        if (isMounted.current) {
          setSharedTenantIds(ids);
          setLoading(false);
        }
      })
      .catch(() => {
        if (isMounted.current) setLoading(false);
      });
    return () => { isMounted.current = false; };
  }, [channelId]);

  const applyChange = async (newIds: number[]) => {
    setSaving(true);
    try {
      await notificationsApi.setChannelTenants(channelId, newIds);
      setSharedTenantIds(newIds);
    } catch {
      toast.error(t('notifications.failedTenantAssign'));
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = (tenantId: number) => {
    if (!sharedTenantIds) return;
    applyChange(sharedTenantIds.filter((id) => id !== tenantId));
  };

  const handleAdd = () => {
    if (!addingId || !sharedTenantIds) return;
    const id = Number(addingId);
    if (sharedTenantIds.includes(id)) return;
    applyChange([...sharedTenantIds, id]);
    setAddingId('');
  };

  // Available: exclude the channel's owner tenant (current) and already-shared ones
  const availableTenants = tenants.filter(
    (t) => t.id !== currentTenantId && !(sharedTenantIds ?? []).includes(t.id),
  );

  if (loading) {
    return (
      <div className="mt-2 flex items-center gap-1.5 px-3 py-2 text-xs text-text-muted">
        <Loader2 size={12} className="animate-spin" />
        {t('common.loading')}…
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-lg border border-border bg-bg-primary px-3 py-2.5 space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
        {t('notifications.sharedWith')}
      </p>

      {/* Current shared tenants */}
      <div className="flex flex-wrap gap-1.5 min-h-[22px]">
        {sharedTenantIds && sharedTenantIds.length === 0 && (
          <span className="text-xs text-text-muted italic">{t('notifications.notShared')}</span>
        )}
        {sharedTenantIds?.map((tid) => {
          const tenant = tenants.find((t) => t.id === tid);
          return (
            <span
              key={tid}
              className="inline-flex items-center gap-1 rounded-md bg-bg-tertiary border border-border px-2 py-0.5 text-xs text-text-primary"
            >
              <Building2 size={10} className="text-text-muted shrink-0" />
              {tenant?.name ?? `Tenant #${tid}`}
              <button
                onClick={() => handleRemove(tid)}
                disabled={saving}
                className="ml-0.5 text-text-muted hover:text-status-down transition-colors"
                title={t('notifications.removeTenantAccess')}
              >
                <X size={10} />
              </button>
            </span>
          );
        })}
        {saving && <Loader2 size={12} className="animate-spin text-text-muted self-center" />}
      </div>

      {/* Add tenant */}
      {availableTenants.length > 0 && (
        <div className="flex items-center gap-2">
          <select
            value={addingId}
            onChange={(e) => setAddingId(e.target.value ? Number(e.target.value) : '')}
            className="rounded-md border border-border bg-bg-tertiary px-2 py-1 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option value="">{t('notifications.selectTenant')}</option>
            {availableTenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <button
            onClick={handleAdd}
            disabled={!addingId || saving}
            className="inline-flex items-center gap-1 rounded-md bg-accent/10 px-2 py-1 text-xs font-medium text-accent hover:bg-accent/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Plus size={11} />
            {t('notifications.grantAccess')}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export function NotificationsPage() {
  const { t } = useTranslation();
  const { currentTenantId, tenants } = useTenantStore();
  const isMultiTenant = tenants.length > 1;

  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [plugins, setPlugins] = useState<NotificationPluginMeta[]>([]);
  const [globalBindings, setGlobalBindings] = useState<NotificationBinding[]>([]);
  const [smtpServers, setSmtpServers] = useState<SmtpServer[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [selectedType, setSelectedType] = useState('');
  const [formName, setFormName] = useState('');
  const [formConfig, setFormConfig] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<number | null>(null);

  // Which channel IDs have their tenant sharing panel expanded
  const [expandedTenants, setExpandedTenants] = useState<Set<number>>(new Set());

  const load = async () => {
    try {
      const [ch, pl, gb] = await Promise.all([
        notificationsApi.listChannels(),
        notificationsApi.getPlugins(),
        notificationsApi.getBindings('global', null),
      ]);
      setChannels(ch);
      setPlugins(pl);
      setGlobalBindings(gb);
    } catch {
      toast.error('Failed to load notifications');
    }
  };

  useEffect(() => {
    load();
    smtpServerApi.list().then(setSmtpServers).catch(() => {});
  }, []);

  const selectedPlugin = plugins.find((p) => p.type === selectedType);

  const openCreate = () => {
    setEditingId(null);
    setSelectedType(plugins[0]?.type || '');
    setFormName('');
    setFormConfig({});
    setShowForm(true);
  };

  const openEdit = (ch: NotificationChannel) => {
    setEditingId(ch.id);
    setSelectedType(ch.type);
    setFormName(ch.name);
    setFormConfig({ ...ch.config });
    setShowForm(true);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editingId) {
        await notificationsApi.updateChannel(editingId, {
          name: formName,
          config: formConfig,
        });
        toast.success(t('notifications.updated'));
      } else {
        await notificationsApi.createChannel({
          name: formName,
          type: selectedType as import('@obliance/shared').NotificationChannelType,
          config: formConfig,
        });
        toast.success(t('notifications.created'));
      }
      setShowForm(false);
      load();
    } catch {
      toast.error(t('notifications.failedSave'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(t('notifications.confirmDelete', { name }))) return;
    try {
      await notificationsApi.deleteChannel(id);
      toast.success(t('notifications.deleted'));
      setExpandedTenants((prev) => {
        const s = new Set(prev);
        s.delete(id);
        return s;
      });
      load();
    } catch {
      toast.error(t('notifications.failedDelete'));
    }
  };

  const handleTest = async (id: number) => {
    setTesting(id);
    try {
      await notificationsApi.testChannel(id);
      toast.success(t('notifications.testSent'));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('notifications.testFailed');
      toast.error(msg);
    } finally {
      setTesting(null);
    }
  };

  const toggleGlobalBinding = async (channelId: number) => {
    const existing = globalBindings.find((b) => b.channelId === channelId);
    try {
      if (existing) {
        await notificationsApi.removeBinding(channelId, 'global', null);
        toast.success(t('notifications.removedFromGlobal'));
      } else {
        await notificationsApi.addBinding(channelId, 'global', null);
        toast.success(t('notifications.addedToGlobal'));
      }
      load();
    } catch {
      toast.error(t('notifications.failedBinding'));
    }
  };

  const isGloballyBound = (channelId: number) =>
    globalBindings.some((b) => b.channelId === channelId);

  const toggleTenantPanel = (channelId: number) => {
    setExpandedTenants((prev) => {
      const next = new Set(prev);
      if (next.has(channelId)) next.delete(channelId);
      else next.add(channelId);
      return next;
    });
  };

  return (
    <div className="p-6 min-w-0">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-text-primary">{t('notifications.title')}</h1>
        <Button size="sm" onClick={openCreate}>
          <Plus size={16} className="mr-1.5" />
          {t('notifications.newChannel')}
        </Button>
      </div>

      {/* Create/Edit Form */}
      {showForm && (
        <div className="mb-6 rounded-lg border border-border bg-bg-secondary p-5">
          <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-4">
            {editingId ? t('notifications.editChannel') : t('notifications.newChannel')}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label={t('notifications.channelName')}
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder={t('notifications.channelNamePlaceholder')}
              required
            />

            {!editingId && (
              <div className="space-y-1">
                <label className="block text-sm font-medium text-text-secondary">{t('common.type')}</label>
                <select
                  value={selectedType}
                  onChange={(e) => {
                    setSelectedType(e.target.value);
                    setFormConfig({});
                  }}
                  className="w-full rounded-md border border-border bg-bg-tertiary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                >
                  {plugins.map((p) => (
                    <option key={p.type} value={p.type}>
                      {p.name}
                    </option>
                  ))}
                </select>
                {selectedPlugin && (
                  <p className="text-xs text-text-muted mt-1">{selectedPlugin.description}</p>
                )}
              </div>
            )}

            {/* Dynamic config fields */}
            {(selectedPlugin || plugins.find((p) => p.type === selectedType))?.configFields.map((field) => {
              if (field.type === 'boolean') {
                return (
                  <div key={field.key} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id={`cfg-${field.key}`}
                      checked={Boolean(formConfig[field.key])}
                      onChange={(e) =>
                        setFormConfig({ ...formConfig, [field.key]: e.target.checked })
                      }
                      className="h-4 w-4 rounded border-border bg-bg-tertiary text-accent focus:ring-accent"
                    />
                    <label htmlFor={`cfg-${field.key}`} className="text-sm text-text-secondary">
                      {field.label}
                    </label>
                  </div>
                );
              }
              if ((field.type as string) === 'smtp_server_select') {
                return (
                  <div key={field.key} className="space-y-1">
                    <label className="block text-sm font-medium text-text-secondary">
                      {field.label}{field.required && <span className="text-status-down ml-1">*</span>}
                    </label>
                    <select
                      value={String(formConfig[field.key] ?? '')}
                      onChange={(e) => setFormConfig({ ...formConfig, [field.key]: e.target.value ? Number(e.target.value) : '' })}
                      required={field.required}
                      className="w-full rounded-md border border-border bg-bg-tertiary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                    >
                      <option value="">{t('notifications.selectSmtp')}</option>
                      {smtpServers.map((s) => (
                        <option key={s.id} value={s.id}>{s.name} ({s.host}:{s.port})</option>
                      ))}
                    </select>
                    {smtpServers.length === 0 && (
                      <p className="text-xs text-amber-400">{t('notifications.noSmtp')}</p>
                    )}
                  </div>
                );
              }
              return (
                <Input
                  key={field.key}
                  label={field.label}
                  type={field.type === 'password' ? 'password' : field.type === 'number' ? 'number' : 'text'}
                  value={String(formConfig[field.key] ?? '')}
                  onChange={(e) =>
                    setFormConfig({
                      ...formConfig,
                      [field.key]: field.type === 'number' ? Number(e.target.value) : e.target.value,
                    })
                  }
                  placeholder={field.placeholder}
                  required={field.required}
                />
              );
            })}

            <div className="flex items-center gap-3">
              <Button type="submit" loading={saving}>
                {editingId ? t('common.save') : t('common.create')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setShowForm(false);
                  setEditingId(null);
                }}
              >
                {t('common.cancel')}
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Channel list */}
      <div className="rounded-lg border border-border bg-bg-secondary">
        {channels.length === 0 ? (
          <div className="py-12 text-center">
            <Bell size={32} className="mx-auto mb-3 text-text-muted" />
            <p className="text-text-muted">{t('notifications.noChannels')}</p>
            <p className="text-sm text-text-muted mt-1">
              {t('notifications.noChannelsDesc')}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {channels.map((ch) => {
              const plugin = plugins.find((p) => p.type === ch.type);
              const isShared = (ch as any).isShared === true;
              const isExpanded = expandedTenants.has(ch.id);

              return (
                <div key={ch.id} className="px-4 py-3 group">
                  {/* Main row */}
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-text-primary">{ch.name}</span>
                        <span className="rounded-full bg-bg-tertiary px-2 py-0.5 text-[10px] font-medium text-text-muted">
                          {plugin?.name || ch.type}
                        </span>
                        {!(ch as any).isEnabled && (
                          <span className="rounded-full bg-status-down/10 px-2 py-0.5 text-[10px] font-medium text-status-down">
                            {t('status.disabled')}
                          </span>
                        )}
                        {/* Badge for shared channels showing the source tenant */}
                        {isShared && ch.tenantId && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">
                            <Building2 size={9} className="shrink-0" />
                            {tenants.find((t) => t.id === ch.tenantId)?.name ?? `Tenant #${ch.tenantId}`}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Global binding toggle */}
                    <button
                      onClick={() => toggleGlobalBinding(ch.id)}
                      className={`shrink-0 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                        isGloballyBound(ch.id)
                          ? 'bg-accent/10 text-accent'
                          : 'text-text-muted hover:bg-bg-hover'
                      }`}
                      title={isGloballyBound(ch.id) ? 'Remove from global' : 'Add to global notifications'}
                    >
                      <Zap size={12} className="inline mr-1" />
                      {isGloballyBound(ch.id) ? t('remediations.globalActive') : t('common.enable')}
                    </button>

                    {/* Tenant sharing toggle — own channels only, multi-tenant mode only */}
                    {isMultiTenant && !isShared && (
                      <button
                        onClick={() => toggleTenantPanel(ch.id)}
                        className={`shrink-0 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                          isExpanded
                            ? 'bg-bg-tertiary text-text-primary'
                            : 'text-text-muted hover:bg-bg-hover'
                        }`}
                        title={t('notifications.manageTenantAccess')}
                      >
                        <Building2 size={12} />
                        {t('notifications.workspaces')}
                        {isExpanded
                          ? <ChevronDown size={11} />
                          : <ChevronRight size={11} />}
                      </button>
                    )}

                    {/* Test / Edit / Delete — hidden for shared channels */}
                    {!isShared && (
                      <>
                        <button
                          onClick={() => handleTest(ch.id)}
                          disabled={testing === ch.id}
                          className="shrink-0 p-1.5 text-text-muted hover:text-accent opacity-0 group-hover:opacity-100 transition-opacity"
                          title={t('notifications.sendTest')}
                        >
                          {testing === ch.id
                            ? <Loader2 size={14} className="animate-spin" />
                            : <TestTube2 size={14} />}
                        </button>
                        <button
                          onClick={() => openEdit(ch)}
                          className="shrink-0 p-1.5 text-text-muted hover:text-text-primary opacity-0 group-hover:opacity-100 transition-opacity"
                          title={t('common.edit')}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => handleDelete(ch.id, ch.name)}
                          className="shrink-0 p-1.5 text-text-muted hover:text-status-down opacity-0 group-hover:opacity-100 transition-opacity"
                          title={t('common.delete')}
                        >
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
                  </div>

                  {/* Tenant sharing panel (expandable, own channels only) */}
                  {isExpanded && !isShared && (
                    <TenantSharingPanel channelId={ch.id} currentTenantId={currentTenantId} />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
