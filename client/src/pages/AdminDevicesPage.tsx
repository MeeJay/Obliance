import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  Key, Plus, Trash2, Check, X, RefreshCw, Copy, Monitor,
  ExternalLink, PauseCircle, PlayCircle, ChevronRight,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { deviceApi } from '@/api/device.api';
import { AddDeviceModal } from '@/components/devices/AddDeviceModal';
import { DeviceStatusBadge } from '@/components/devices/DeviceStatusBadge';
import { OsIcon } from '@/components/devices/OsIcon';
import type { AgentApiKey, Device } from '@obliance/shared';
import toast from 'react-hot-toast';

type Tab = 'devices' | 'keys';
type ApprovalFilter = '' | 'approved' | 'refused' | 'suspended' | 'pending';

export function AdminDevicesPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('devices');
  const [showAddModal, setShowAddModal] = useState(false);

  // ── Devices state ──────────────────────────────────────────────────────────
  const [devices, setDevices] = useState<Device[]>([]);
  const [approvalFilter, setApprovalFilter] = useState<ApprovalFilter>('');
  const [isLoadingDevices, setIsLoadingDevices] = useState(true);
  const [counts, setCounts] = useState<Record<string, number>>({});

  // ── API Keys state ─────────────────────────────────────────────────────────
  const [keys, setKeys] = useState<AgentApiKey[]>([]);
  const [newKeyName, setNewKeyName] = useState('');
  const [isCreatingKey, setIsCreatingKey] = useState(false);
  const [showNewKey, setShowNewKey] = useState<string | null>(null);
  const [isLoadingKeys, setIsLoadingKeys] = useState(true);

  // ── Load data ──────────────────────────────────────────────────────────────
  const loadDevices = useCallback(async () => {
    setIsLoadingDevices(true);
    try {
      const data = await deviceApi.list(approvalFilter ? { approvalStatus: approvalFilter } : undefined);
      setDevices(data);
    } catch {
      toast.error(t('common.error'));
    } finally {
      setIsLoadingDevices(false);
    }
  }, [approvalFilter, t]);

  const loadCounts = useCallback(async () => {
    try {
      const all = await deviceApi.list();
      const c: Record<string, number> = { '': all.length };
      for (const filter of ['approved', 'refused', 'pending'] as const) {
        c[filter] = all.filter(d => d.approvalStatus === filter).length;
      }
      c['suspended'] = all.filter(d => d.status === 'suspended').length;
      setCounts(c);
    } catch { /* silent */ }
  }, []);

  const loadKeys = useCallback(async () => {
    setIsLoadingKeys(true);
    try {
      setKeys(await deviceApi.listKeys());
    } catch {
      toast.error(t('common.error'));
    } finally {
      setIsLoadingKeys(false);
    }
  }, [t]);

  useEffect(() => { loadDevices(); loadCounts(); }, [loadDevices, loadCounts]);
  useEffect(() => { if (tab === 'keys') loadKeys(); }, [tab, loadKeys]);

  // ── Device actions ─────────────────────────────────────────────────────────
  const handleApprove = async (device: Device) => {
    try {
      await deviceApi.approve(device.id);
      toast.success(t('devices.approveSuccess'));
      loadDevices(); loadCounts();
    } catch { toast.error(t('common.error')); }
  };

  const handleRefuse = async (device: Device) => {
    if (!confirm(t('devices.confirmRefuse', { hostname: device.hostname }))) return;
    try {
      await deviceApi.refuse(device.id);
      toast.success(t('devices.refuseSuccess'));
      loadDevices(); loadCounts();
    } catch { toast.error(t('common.error')); }
  };

  const handleSuspend = async (device: Device) => {
    if (!confirm(t('devices.confirmSuspend', { hostname: device.hostname }))) return;
    try {
      await deviceApi.suspend(device.id);
      toast.success(t('devices.suspendSuccess'));
      loadDevices(); loadCounts();
    } catch { toast.error(t('common.error')); }
  };

  const handleUnsuspend = async (device: Device) => {
    try {
      await deviceApi.unsuspend(device.id);
      toast.success(t('devices.unsuspendSuccess'));
      loadDevices(); loadCounts();
    } catch { toast.error(t('common.error')); }
  };

  const handleDelete = async (device: Device) => {
    if (!confirm(t('devices.confirmDelete', { hostname: device.hostname }))) return;
    try {
      await deviceApi.delete(device.id);
      toast.success(t('devices.deleteSuccess'));
      loadDevices(); loadCounts();
    } catch { toast.error(t('common.error')); }
  };

  // ── API Key actions ────────────────────────────────────────────────────────
  const handleCreateKey = async () => {
    if (!newKeyName.trim()) return;
    setIsCreatingKey(true);
    try {
      const key = await deviceApi.createKey(newKeyName.trim());
      setShowNewKey(key.key);
      setNewKeyName('');
      loadKeys();
      toast.success(t('devices.apiKeys.createSuccess'));
    } catch {
      toast.error(t('devices.apiKeys.failedCreate'));
    } finally {
      setIsCreatingKey(false);
    }
  };

  const handleDeleteKey = async (key: AgentApiKey) => {
    if (!confirm(t('devices.apiKeys.confirmDelete'))) return;
    try {
      await deviceApi.deleteKey(key.id);
      loadKeys();
      toast.success(t('devices.apiKeys.deleteSuccess'));
    } catch {
      toast.error(t('devices.apiKeys.failedDelete'));
    }
  };

  const FILTERS: Array<{ value: ApprovalFilter; label: string }> = [
    { value: '', label: t('devices.filterAll') },
    { value: 'approved', label: t('devices.filterApproved') },
    { value: 'refused', label: t('devices.filterRefused') },
    { value: 'suspended', label: t('devices.filterSuspended') },
    { value: 'pending', label: t('devices.filterPending') },
  ];

  return (
    <div className="p-6">
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
          <Monitor className="w-6 h-6" />
          {t('devices.title')}
        </h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { loadDevices(); loadCounts(); if (tab === 'keys') loadKeys(); }}
            className="p-2 rounded-lg hover:bg-bg-secondary transition-colors text-text-muted hover:text-text-primary"
            title={t('common.refresh')}
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg hover:bg-accent/80 transition-colors text-sm font-medium"
          >
            <Plus className="w-4 h-4" />
            {t('devices.addDevice')}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-6 rounded-lg bg-bg-secondary p-1 border border-border">
        <button
          onClick={() => setTab('devices')}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-colors ${
            tab === 'devices'
              ? 'bg-accent text-white'
              : 'text-text-muted hover:text-text-primary'
          }`}
        >
          <Monitor className="w-4 h-4" />
          {t('devices.tabDevices')}
        </button>
        <button
          onClick={() => setTab('keys')}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-colors ${
            tab === 'keys'
              ? 'bg-accent text-white'
              : 'text-text-muted hover:text-text-primary'
          }`}
        >
          <Key className="w-4 h-4" />
          {t('devices.tabApiKeys')}
        </button>
      </div>

      {/* ── Tab: Devices ── */}
      {tab === 'devices' && (
        <div className="space-y-4">
          {/* Filter buttons */}
          <div className="flex flex-wrap gap-2">
            {FILTERS.map(f => (
              <button
                key={f.value}
                onClick={() => setApprovalFilter(f.value)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  approvalFilter === f.value
                    ? 'bg-accent text-white'
                    : 'bg-bg-secondary text-text-muted hover:text-text-primary hover:bg-bg-tertiary'
                }`}
              >
                {f.label}
                {counts[f.value] !== undefined && (
                  <span className="ml-1.5 opacity-70">({counts[f.value]})</span>
                )}
              </button>
            ))}
          </div>

          {/* Table */}
          {isLoadingDevices ? (
            <div className="flex items-center justify-center py-16">
              <RefreshCw className="w-6 h-6 animate-spin text-text-muted" />
            </div>
          ) : devices.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-text-muted">
              <Monitor className="w-10 h-10 mb-3 opacity-30" />
              <p className="text-sm">{t('devices.noDevices')}</p>
            </div>
          ) : (
            <div className="border border-border rounded-lg overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-bg-secondary">
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-text-muted">{t('devices.colHostname')}</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-text-muted">{t('devices.colIp')}</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-text-muted hidden md:table-cell">{t('devices.colOs')}</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-text-muted hidden lg:table-cell">{t('devices.colAgent')}</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-text-muted">{t('devices.colStatus')}</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-text-muted hidden xl:table-cell">{t('devices.colRegistered')}</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider text-text-muted">{t('devices.colActions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {devices.map(device => (
                    <tr key={device.id} className="hover:bg-bg-secondary/50 transition-colors">
                      {/* Hostname */}
                      <td className="px-4 py-3">
                        <div className="font-medium text-text-primary">{device.displayName || device.hostname}</div>
                        {device.displayName && device.displayName !== device.hostname && (
                          <div className="text-xs text-text-muted">{device.hostname}</div>
                        )}
                        <div className="text-xs text-text-muted font-mono">{device.uuid?.slice(0, 8)}...</div>
                      </td>

                      {/* IP */}
                      <td className="px-4 py-3 text-text-secondary text-xs font-mono">
                        {device.ipLocal ?? device.ipPublic ?? '—'}
                      </td>

                      {/* OS */}
                      <td className="px-4 py-3 hidden md:table-cell">
                        <div className="flex items-center gap-1.5">
                          <OsIcon osType={device.osType} className="w-4 h-4 flex-shrink-0" />
                          <span className="text-xs text-text-secondary truncate max-w-[140px]" title={device.osName ?? undefined}>
                            {device.osName ?? '—'}
                          </span>
                        </div>
                      </td>

                      {/* Agent version */}
                      <td className="px-4 py-3 hidden lg:table-cell">
                        <span className="text-xs text-text-muted">{device.agentVersion ?? '—'}</span>
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3">
                        <DeviceStatusBadge status={device.status} approvalStatus={device.approvalStatus} />
                      </td>

                      {/* Registered */}
                      <td className="px-4 py-3 hidden xl:table-cell">
                        <span className="text-xs text-text-muted">
                          {new Date(device.createdAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {/* View */}
                          <Link
                            to={`/devices/${device.id}`}
                            className="p-1.5 rounded hover:bg-bg-tertiary transition-colors text-text-muted hover:text-text-primary"
                            title={t('devices.actionView')}
                          >
                            <ExternalLink className="w-4 h-4" />
                          </Link>

                          {/* Approve (pending only) */}
                          {device.approvalStatus === 'pending' && (
                            <button
                              onClick={() => handleApprove(device)}
                              className="p-1.5 rounded hover:bg-green-500/10 transition-colors text-green-400"
                              title={t('devices.actionApprove')}
                            >
                              <Check className="w-4 h-4" />
                            </button>
                          )}

                          {/* Suspend / Unsuspend */}
                          {device.status === 'suspended' ? (
                            <button
                              onClick={() => handleUnsuspend(device)}
                              className="p-1.5 rounded hover:bg-blue-500/10 transition-colors text-blue-400"
                              title={t('devices.actionUnsuspend')}
                            >
                              <PlayCircle className="w-4 h-4" />
                            </button>
                          ) : device.approvalStatus === 'approved' ? (
                            <button
                              onClick={() => handleSuspend(device)}
                              className="p-1.5 rounded hover:bg-yellow-500/10 transition-colors text-text-muted hover:text-yellow-400"
                              title={t('devices.actionSuspend')}
                            >
                              <PauseCircle className="w-4 h-4" />
                            </button>
                          ) : null}

                          {/* Refuse */}
                          {device.approvalStatus !== 'refused' && (
                            <button
                              onClick={() => handleRefuse(device)}
                              className="p-1.5 rounded hover:bg-orange-500/10 transition-colors text-text-muted hover:text-orange-400"
                              title={t('devices.actionRefuse')}
                            >
                              <X className="w-4 h-4" />
                            </button>
                          )}

                          {/* Delete */}
                          <button
                            onClick={() => handleDelete(device)}
                            className="p-1.5 rounded hover:bg-red-500/10 transition-colors text-text-muted hover:text-red-400"
                            title={t('devices.actionDelete')}
                          >
                            <Trash2 className="w-4 h-4" />
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
      )}

      {/* ── Tab: API Keys ── */}
      {tab === 'keys' && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <p className="text-sm text-text-muted">{t('devices.apiKeys.description')}</p>
          </div>

          {/* New key created alert */}
          {showNewKey && (
            <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-lg space-y-2">
              <p className="text-sm font-medium text-green-400">{t('devices.apiKeys.newKeyAlert')}</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-sm font-mono bg-bg-tertiary p-2 rounded text-text-primary break-all">{showNewKey}</code>
                <button
                  onClick={() => { navigator.clipboard.writeText(showNewKey); toast.success(t('common.copied')); }}
                  className="p-2 hover:bg-bg-tertiary rounded transition-colors flex-shrink-0"
                >
                  <Copy className="w-4 h-4" />
                </button>
              </div>
              <button onClick={() => setShowNewKey(null)} className="text-xs text-text-muted hover:text-text-primary">
                {t('common.close')}
              </button>
            </div>
          )}

          {/* Create key form */}
          <div className="flex gap-2">
            <input
              type="text"
              value={newKeyName}
              onChange={e => setNewKeyName(e.target.value)}
              placeholder={t('devices.apiKeys.namePlaceholder')}
              className="flex-1 px-3 py-2 bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent text-sm"
              onKeyDown={e => e.key === 'Enter' && handleCreateKey()}
            />
            <button
              onClick={handleCreateKey}
              disabled={isCreatingKey || !newKeyName.trim()}
              className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg hover:bg-accent/80 disabled:opacity-50 transition-colors text-sm font-medium"
            >
              <Plus className="w-4 h-4" />
              {t('devices.apiKeys.newKey')}
            </button>
          </div>

          {/* Keys list */}
          {isLoadingKeys ? (
            <div className="flex items-center justify-center py-10">
              <RefreshCw className="w-5 h-5 animate-spin text-text-muted" />
            </div>
          ) : keys.length === 0 ? (
            <p className="text-sm text-text-muted py-6 text-center">{t('devices.apiKeys.noKeys')}</p>
          ) : (
            <div className="space-y-2">
              {keys.map(key => {
                const truncatedKey = `${key.key.slice(0, 8)}...${key.key.slice(-4)}`;
                return (
                  <div key={key.id} className="flex items-center gap-3 p-4 bg-bg-secondary border border-border rounded-lg">
                    <Key className="w-4 h-4 text-accent flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-text-primary text-sm">{key.name || t('common.unknown')}</span>
                        <code className="text-xs text-text-muted font-mono">{truncatedKey}</code>
                        <button
                          onClick={() => { navigator.clipboard.writeText(key.key); toast.success(t('common.copied')); }}
                          className="p-0.5 rounded hover:bg-bg-tertiary transition-colors text-text-muted hover:text-text-primary"
                          title={t('common.copy')}
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        <span className="flex items-center gap-1 text-xs text-text-muted">
                          <ChevronRight className="w-3 h-3" />
                          {t('devices.apiKeys.devices', { count: key.deviceCount })}
                        </span>
                      </div>
                      <div className="text-xs text-text-muted mt-0.5 space-x-3">
                        <span>{t('devices.apiKeys.created', { date: new Date(key.createdAt).toLocaleDateString() })}</span>
                        {key.lastUsedAt && (
                          <span>{t('devices.apiKeys.lastUsed', { date: new Date(key.lastUsedAt).toLocaleDateString() })}</span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => handleDeleteKey(key)}
                      className="p-2 text-text-muted hover:text-red-400 hover:bg-red-400/10 rounded transition-colors flex-shrink-0"
                      title={t('common.delete')}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Add Device Modal */}
      {showAddModal && <AddDeviceModal onClose={() => setShowAddModal(false)} />}
    </div>
  );
}
