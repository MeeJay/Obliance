import { useState, useEffect, useCallback } from 'react';
import {
  Key, Plus, Trash2, Copy, ChevronRight, RefreshCw, FolderOpen, Edit,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { deviceApi } from '@/api/device.api';
import { groupsApi } from '@/api/groups.api';
import { AddDeviceModal } from '@/components/devices/AddDeviceModal';
import { DevicesPageLayout } from '@/components/devices/DevicesPageLayout';
import { GroupManagePage } from './GroupManagePage';
import type { AgentApiKey, DeviceGroupTreeNode } from '@obliance/shared';
import toast from 'react-hot-toast';
import { clsx } from 'clsx';

type Tab = 'agents' | 'groups' | 'keys';

export function AdminDevicesPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const rawTab = searchParams.get('tab');
  const [tab, setTab] = useState<Tab>(['groups', 'keys'].includes(rawTab ?? '') ? rawTab as Tab : 'agents');
  const [showAddModal, setShowAddModal] = useState(false);

  // ── API Keys state ─────────────────────────────────────────────────────────
  const [keys, setKeys] = useState<AgentApiKey[]>([]);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyGroupId, setNewKeyGroupId] = useState<number | null>(null);
  const [isCreatingKey, setIsCreatingKey] = useState(false);
  const [showNewKey, setShowNewKey] = useState<string | null>(null);
  const [isLoadingKeys, setIsLoadingKeys] = useState(true);
  const [groups, setGroups] = useState<DeviceGroupTreeNode[]>([]);
  const [editingKeyId, setEditingKeyId] = useState<number | null>(null);
  const [editGroupId, setEditGroupId] = useState<number | null>(null);

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

  useEffect(() => {
    if (tab === 'keys') {
      loadKeys();
      groupsApi.tree().then(setGroups).catch(() => {});
    }
  }, [tab, loadKeys]);

  const handleCreateKey = async () => {
    if (!newKeyName.trim()) return;
    setIsCreatingKey(true);
    try {
      const key = await deviceApi.createKey(newKeyName.trim(), newKeyGroupId);
      setShowNewKey(key.key);
      setNewKeyName('');
      setNewKeyGroupId(null);
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

  const handleSaveKeyGroup = async (keyId: number) => {
    try {
      await deviceApi.updateKey(keyId, { defaultGroupId: editGroupId });
      setEditingKeyId(null);
      loadKeys();
      toast.success(t('common.save'));
    } catch {
      toast.error(t('common.error'));
    }
  };

  // Flatten group tree for select options
  const flattenGroups = (nodes: DeviceGroupTreeNode[], depth = 0): Array<{ id: number; name: string; depth: number }> => {
    const result: Array<{ id: number; name: string; depth: number }> = [];
    for (const n of nodes) {
      result.push({ id: n.id, name: n.name, depth });
      result.push(...flattenGroups(n.children, depth + 1));
    }
    return result;
  };
  const flatGroups = flattenGroups(groups);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">{t('agents.title')}</h1>
        <p className="text-sm text-text-muted mt-0.5">{t('agents.subtitle')}</p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 rounded-lg bg-bg-secondary p-1 border border-border">
        {(['agents', 'groups', 'keys'] as Tab[]).map((t2) => (
          <button
            key={t2}
            onClick={() => setTab(t2)}
            className={clsx(
              'flex-1 px-4 py-2 text-sm font-medium rounded-md transition-colors',
              tab === t2 ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary',
            )}
          >
            {t2 === 'agents' ? t('agents.tabAgents') : t2 === 'groups' ? t('agents.tabGroups') : t('devices.tabApiKeys')}
          </button>
        ))}
      </div>

      {/* Tab: Agents */}
      {tab === 'agents' && <DevicesPageLayout mode="admin" />}

      {/* Tab: Groups */}
      {tab === 'groups' && <GroupManagePage embedded />}

      {/* Tab: API Keys */}
      {tab === 'keys' && (
        <div className="space-y-5">
          <p className="text-sm text-text-muted">{t('devices.apiKeys.description')}</p>

          {/* New key alert */}
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
              <button onClick={() => setShowNewKey(null)} className="text-xs text-text-muted hover:text-text-primary">{t('common.close')}</button>
            </div>
          )}

          {/* Create key form */}
          <div className="flex gap-2 flex-wrap">
            <input
              type="text"
              value={newKeyName}
              onChange={e => setNewKeyName(e.target.value)}
              placeholder={t('devices.apiKeys.namePlaceholder')}
              className="flex-1 min-w-[200px] px-3 py-2 bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent text-sm"
              onKeyDown={e => e.key === 'Enter' && handleCreateKey()}
            />
            <select
              value={newKeyGroupId ?? ''}
              onChange={e => setNewKeyGroupId(e.target.value ? parseInt(e.target.value) : null)}
              className="px-3 py-2 bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent text-sm"
            >
              <option value="">{t('apiKeys.noGroup')}</option>
              {flatGroups.map(g => (
                <option key={g.id} value={g.id}>{'  '.repeat(g.depth)}{g.name}</option>
              ))}
            </select>
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
                const isEditing = editingKeyId === key.id;
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
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        <span className="flex items-center gap-1 text-xs text-text-muted">
                          <ChevronRight className="w-3 h-3" />
                          {t('devices.apiKeys.devices', { count: key.deviceCount })}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-text-muted mt-1 flex-wrap">
                        <span>{t('devices.apiKeys.created', { date: new Date(key.createdAt).toLocaleDateString() })}</span>
                        {key.lastUsedAt && (
                          <span>{t('devices.apiKeys.lastUsed', { date: new Date(key.lastUsedAt).toLocaleDateString() })}</span>
                        )}
                        {/* Default group display/edit */}
                        {isEditing ? (
                          <span className="flex items-center gap-1">
                            <FolderOpen className="w-3 h-3" />
                            <select
                              value={editGroupId ?? ''}
                              onChange={e => setEditGroupId(e.target.value ? parseInt(e.target.value) : null)}
                              className="px-1.5 py-0.5 bg-bg-tertiary border border-border rounded text-xs text-text-primary"
                            >
                              <option value="">{t('apiKeys.noGroup')}</option>
                              {flatGroups.map(g => (
                                <option key={g.id} value={g.id}>{'  '.repeat(g.depth)}{g.name}</option>
                              ))}
                            </select>
                            <button onClick={() => handleSaveKeyGroup(key.id)} className="text-accent hover:underline text-xs">{t('common.save')}</button>
                            <button onClick={() => setEditingKeyId(null)} className="text-text-muted hover:text-text-primary text-xs">{t('common.cancel')}</button>
                          </span>
                        ) : (
                          <button
                            onClick={() => { setEditingKeyId(key.id); setEditGroupId(key.defaultGroupId); }}
                            className="flex items-center gap-1 text-text-muted hover:text-accent transition-colors"
                          >
                            <FolderOpen className="w-3 h-3" />
                            {key.defaultGroupName ? (
                              <span>{t('apiKeys.defaultGroup')}: <span className="text-text-primary">{key.defaultGroupName}</span></span>
                            ) : (
                              <span className="italic">{t('apiKeys.noGroup')}</span>
                            )}
                            <Edit className="w-2.5 h-2.5 ml-0.5" />
                          </button>
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

      {showAddModal && <AddDeviceModal onClose={() => setShowAddModal(false)} />}
    </div>
  );
}
