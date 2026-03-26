import React, { useEffect, useState, useCallback } from 'react';
import { Package, AlertCircle, AlertTriangle, Info, RefreshCw, Plus, Edit, Trash2, Shield, X, Monitor, CheckSquare, Square, ChevronRight, Check, Minus, FolderOpen } from 'lucide-react';
import { updateApi } from '@/api/update.api';
import { groupsApi } from '@/api/groups.api';
import type { DeviceGroupTreeNode } from '@obliance/shared';
import type { UpdatePolicy, UpdateSeverity, RebootBehavior, Command } from '@obliance/shared';
import { SocketEvents } from '@obliance/shared';
import { getSocket } from '@/socket/socketClient';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { clsx } from 'clsx';

type Tab = 'updates' | 'policies';

const SEVERITY_CONFIG: Record<UpdateSeverity, { label: string; color: string; icon: typeof AlertCircle }> = {
  critical: { label: 'Critical', color: 'text-red-400 bg-red-400/10 border-red-400/30', icon: AlertCircle },
  important: { label: 'Important', color: 'text-orange-400 bg-orange-400/10 border-orange-400/30', icon: AlertTriangle },
  moderate: { label: 'Moderate', color: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30', icon: AlertTriangle },
  optional: { label: 'Optional', color: 'text-blue-400 bg-blue-400/10 border-blue-400/30', icon: Info },
  unknown: { label: 'Unknown', color: 'text-gray-400 bg-gray-400/10 border-gray-400/30', icon: Info },
};

const REBOOT_OPTIONS: { value: RebootBehavior; label: string }[] = [
  { value: 'never', label: 'Never reboot' },
  { value: 'ask', label: 'Ask user' },
  { value: 'auto_immediate', label: 'Auto reboot immediately' },
  { value: 'auto_delayed', label: 'Auto reboot (delayed)' },
];

interface PolicyFormData {
  name: string;
  description: string;
  targetType: 'group' | 'all';
  targetId: number | null;
  targetIds: number[];
  autoApproveCritical: boolean;
  autoApproveSecurity: boolean;
  autoApproveOptional: boolean;
  approvalRequired: boolean;
  installWindowStart: string;
  installWindowEnd: string;
  rebootBehavior: RebootBehavior;
  rebootDelayMinutes: number;
  timezone: string;
  enabled: boolean;
}

const defaultPolicyForm: PolicyFormData = {
  name: '',
  description: '',
  targetType: 'all',
  targetId: null,
  targetIds: [],
  autoApproveCritical: false,
  autoApproveSecurity: false,
  autoApproveOptional: false,
  approvalRequired: true,
  installWindowStart: '02:00',
  installWindowEnd: '04:00',
  rebootBehavior: 'ask',
  rebootDelayMinutes: 30,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  enabled: true,
};

export function UpdatesPage({ embedded }: { embedded?: boolean } = {}) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<Tab>('updates');
  const [policies, setPolicies] = useState<UpdatePolicy[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showPolicyForm, setShowPolicyForm] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<UpdatePolicy | null>(null);
  const [policyForm, setPolicyForm] = useState<PolicyFormData>(defaultPolicyForm);
  const [isSavingPolicy, setIsSavingPolicy] = useState(false);

  // Aggregated updates state
  const [aggUpdates, setAggUpdates] = useState<import('@/api/update.api').AggregatedUpdate[]>([]);
  const [aggTotal, setAggTotal] = useState(0);
  const [aggPage, setAggPage] = useState(1);
  const [aggPageSize, setAggPageSize] = useState(100);
  const [selectedSeverity, setSelectedSeverity] = useState('');
  const [selectedSource, setSelectedSource] = useState('');
  const [selectedGroupId] = useState<number | undefined>(undefined);
  const [expandedUid, setExpandedUid] = useState<string | null>(null);
  const [expandedDevices, setExpandedDevices] = useState<Array<{ id: number; deviceId: number; deviceName: string; groupId: number | null; status: string }>>([]);
  const [selectedUids, setSelectedUids] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [aggData, policiesData] = await Promise.all([
        updateApi.listAggregated({
          severity: selectedSeverity || undefined,
          source: selectedSource || undefined,
          groupId: selectedGroupId,
          page: aggPage,
          pageSize: aggPageSize,
        }),
        updateApi.listPolicies(),
      ]);
      setAggUpdates(aggData.items);
      setAggTotal(aggData.total);
      setPolicies(policiesData);
    } catch {
      toast.error(t('updates.toast.loadFailed'));
    } finally {
      setIsLoading(false);
    }
  }, [selectedSeverity, selectedSource, selectedGroupId, aggPage, aggPageSize, t]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setAggPage(1); }, [selectedSeverity, selectedSource, selectedGroupId, aggPageSize]);

  // Real-time: reload on scan completion
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onCmd = (cmd: Command) => {
      if (cmd.type === 'scan_updates' && cmd.status === 'success') load();
    };
    socket.on(SocketEvents.COMMAND_RESULT, onCmd);
    return () => { socket.off(SocketEvents.COMMAND_RESULT, onCmd); };
  }, [load]);

  // Expand a row to show affected devices
  const handleExpand = async (uid: string) => {
    if (expandedUid === uid) { setExpandedUid(null); return; }
    setExpandedUid(uid);
    try {
      const devices = await updateApi.getUpdateDevices(uid);
      setExpandedDevices(devices);
    } catch { setExpandedDevices([]); }
  };

  const toggleSelect = (uid: string) => {
    setSelectedUids((prev) => {
      const next = new Set(prev);
      next.has(uid) ? next.delete(uid) : next.add(uid);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedUids.size === aggUpdates.length) {
      setSelectedUids(new Set());
    } else {
      setSelectedUids(new Set(aggUpdates.map((u) => u.updateUid)));
    }
  };

  const handleApproveSelected = async () => {
    if (selectedUids.size === 0) return;
    try {
      const result = await updateApi.bulkApproveTitles([...selectedUids], selectedGroupId);
      toast.success(t('updates.toast.bulkApproved', { count: result.approved }));
      setSelectedUids(new Set());
      await load();
    } catch {
      toast.error(t('updates.toast.approveFailed'));
    }
  };

  // Approve a single title across all devices
  const handleApproveTitle = async (uid: string) => {
    try {
      const result = await updateApi.bulkApproveByTitle(uid, selectedGroupId);
      toast.success(t('updates.toast.bulkApproved', { count: result.approved }));
      await load();
    } catch {
      toast.error(t('updates.toast.approveFailed'));
    }
  };

  const handleDeletePolicy = async (id: number) => {
    if (!confirm(t('updates.policy.confirmDelete'))) return;
    try {
      await updateApi.deletePolicy(id);
      toast.success(t('updates.policy.deleted'));
      await load();
    } catch {
      toast.error(t('updates.policy.deleteFailed'));
    }
  };

  const handleOpenCreatePolicy = () => {
    setPolicyForm(defaultPolicyForm);
    setEditingPolicy(null);
    setShowPolicyForm(true);
  };

  const handleOpenEditPolicy = (policy: UpdatePolicy) => {
    setPolicyForm({
      name: policy.name,
      description: policy.description ?? '',
      targetType: policy.targetType === 'device' ? 'all' : policy.targetType as 'all' | 'group',
      targetId: policy.targetId,
      targetIds: policy.targetId ? [policy.targetId] : [],
      autoApproveCritical: policy.autoApproveCritical,
      autoApproveSecurity: policy.autoApproveSecurity,
      autoApproveOptional: policy.autoApproveOptional,
      approvalRequired: policy.approvalRequired,
      installWindowStart: policy.installWindowStart,
      installWindowEnd: policy.installWindowEnd,
      rebootBehavior: policy.rebootBehavior,
      rebootDelayMinutes: policy.rebootDelayMinutes,
      timezone: policy.timezone,
      enabled: policy.enabled,
    });
    setEditingPolicy(policy);
    setShowPolicyForm(true);
  };

  const handleSavePolicy = async () => {
    if (!policyForm.name.trim()) { toast.error(t('updates.policy.nameRequired')); return; }
    setIsSavingPolicy(true);
    try {
      const payload = {
        name: policyForm.name,
        description: policyForm.description || null,
        targetType: policyForm.targetType,
        targetId: policyForm.targetType === 'group' && policyForm.targetIds.length > 0 ? policyForm.targetIds[0] : null,
        autoApproveCritical: policyForm.autoApproveCritical,
        autoApproveSecurity: policyForm.autoApproveSecurity,
        autoApproveOptional: policyForm.autoApproveOptional,
        approvalRequired: policyForm.approvalRequired,
        installWindowStart: policyForm.installWindowStart,
        installWindowEnd: policyForm.installWindowEnd,
        installWindowDays: [1, 2, 3, 4, 5],
        timezone: policyForm.timezone,
        rebootBehavior: policyForm.rebootBehavior,
        rebootDelayMinutes: policyForm.rebootDelayMinutes,
        excludedUpdateIds: [],
        excludedCategories: [],
        enabled: policyForm.enabled,
        tenantId: 0,
      };
      if (editingPolicy) {
        await updateApi.updatePolicy(editingPolicy.id, payload);
        toast.success(t('updates.policy.updated'));
      } else {
        await updateApi.createPolicy(payload as any);
        toast.success(t('updates.policy.created'));
      }
      setShowPolicyForm(false);
      setEditingPolicy(null);
      await load();
    } catch {
      toast.error(t('updates.policy.saveFailed'));
    } finally {
      setIsSavingPolicy(false);
    }
  };

  return (
    <div className={embedded ? 'space-y-6' : 'p-6 space-y-6'}>
      {!embedded && <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">{t('updates.title')}</h1>
          <p className="text-sm text-text-muted mt-0.5">{t('updates.subtitle')}</p>
        </div>
        <button onClick={load} className="p-2 text-text-muted hover:text-text-primary hover:bg-bg-secondary rounded-lg transition-colors">
          <RefreshCw className={clsx('w-4 h-4', isLoading && 'animate-spin')} />
        </button>
      </div>}

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {(['critical', 'important', 'moderate', 'optional'] as UpdateSeverity[]).map((sev) => {
          const cfg = SEVERITY_CONFIG[sev];
          const Icon = cfg.icon;
          const count = aggUpdates.filter(u => u.severity === sev).reduce((sum, u) => sum + u.deviceCount, 0);
          const colorParts = cfg.color.split(' ');
          return (
            <button
              key={sev}
              onClick={() => setSelectedSeverity(selectedSeverity === sev ? '' : sev)}
              className={clsx(
                'p-4 bg-bg-secondary border rounded-xl flex items-center gap-3 transition-colors text-left',
                selectedSeverity === sev ? 'border-accent' : 'border-border hover:border-border/80',
              )}
            >
              <div className={clsx('p-2 rounded-lg', colorParts[1], colorParts[2])}>
                <Icon className={clsx('w-4 h-4', colorParts[0])} />
              </div>
              <div>
                <p className="text-xl font-bold text-text-primary">{count}</p>
                <p className="text-xs text-text-muted">{cfg.label}</p>
              </div>
              {selectedSeverity === sev && (
                <X className="w-3 h-3 ml-auto text-text-muted" />
              )}
            </button>
          );
        })}
      </div>

      {/* Source filter + bulk actions */}
      {activeTab === 'updates' && (
        <div className="flex items-center gap-3 flex-wrap">
          <select value={selectedSource} onChange={(e) => setSelectedSource(e.target.value)} className="px-3 py-1.5 text-sm bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent">
            <option value="">All sources</option>
            <option value="windows_update">Windows Update</option>
            <option value="winget">Winget</option>
            <option value="chocolatey">Chocolatey</option>
            <option value="apt">APT</option>
            <option value="brew">Brew</option>
          </select>
          {(selectedSeverity || selectedSource) && (
            <button onClick={() => { setSelectedSeverity(''); setSelectedSource(''); }} className="flex items-center gap-1 text-xs text-text-muted hover:text-text-primary">
              <X className="w-3.5 h-3.5" /> {t('updates.actions.clear')}
            </button>
          )}
          <div className="ml-auto flex gap-2 flex-wrap">
            {selectedUids.size > 0 && (
              <>
                <button onClick={handleApproveSelected} className="text-xs px-3 py-1.5 bg-green-500/10 text-green-400 border border-green-500/20 rounded-lg hover:bg-green-500/20 transition-colors font-medium">
                  Approve ({selectedUids.size})
                </button>
                {aggUpdates.some((u) => selectedUids.has(u.updateUid) && u.failedCount > 0) && (
                  <button
                    onClick={async () => {
                      const failedUids = aggUpdates.filter((u) => selectedUids.has(u.updateUid) && u.failedCount > 0).map((u) => u.updateUid);
                      try {
                        const r = await updateApi.bulkRetryTitles(failedUids);
                        toast.success(`${r.retried} update(s) retried`);
                        setSelectedUids(new Set());
                        await load();
                      } catch { toast.error('Retry failed'); }
                    }}
                    className="text-xs px-3 py-1.5 bg-orange-500/10 text-orange-400 border border-orange-500/20 rounded-lg hover:bg-orange-500/20 transition-colors font-medium"
                  >
                    Retry failed
                  </button>
                )}
                <button
                  onClick={async () => {
                    try {
                      const r = await updateApi.bulkApproveAndDeploy([...selectedUids], selectedGroupId);
                      toast.success(`${r.approved} approved, ${r.dispatched} dispatched to ${r.devices} device(s)`);
                      setSelectedUids(new Set());
                      await load();
                    } catch { toast.error(t('updates.toast.approveFailed')); }
                  }}
                  className="text-xs px-3 py-1.5 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-lg hover:bg-blue-500/20 transition-colors font-medium"
                >
                  Approve & Deploy ({selectedUids.size})
                </button>
              </>
            )}
            <button
              onClick={async () => {
                try {
                  const r = await updateApi.bulkDeploy();
                  toast.success(`${r.dispatched} update(s) deployed to ${r.devices} device(s)`);
                  await load();
                } catch { toast.error('Deploy failed'); }
              }}
              className="text-xs px-3 py-1.5 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-lg hover:bg-blue-500/20 transition-colors"
            >
              Deploy all approved
            </button>
            <button onClick={async () => { try { const r = await updateApi.bulkApproveBySeverity(['critical','important']); toast.success(t('updates.toast.bulkApproved',{count:r.approved})); load(); } catch { toast.error(t('updates.toast.approveFailed')); } }} className="text-xs px-3 py-1.5 bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg hover:bg-red-500/20 transition-colors">
              {t('updates.actions.approveAllCritical')}
            </button>
            <button onClick={async () => { try { const r = await updateApi.bulkApproveBySeverity(['critical','important','moderate','optional','unknown']); toast.success(t('updates.toast.bulkApproved',{count:r.approved})); load(); } catch { toast.error(t('updates.toast.approveFailed')); } }} className="text-xs px-3 py-1.5 bg-accent/10 text-accent border border-accent/20 rounded-lg hover:bg-accent/20 transition-colors">
              {t('updates.actions.approveAll')}
            </button>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 rounded-lg bg-bg-secondary p-1 border border-border">
        {(['updates', 'policies'] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={clsx(
              'flex-1 px-4 py-2 text-sm font-medium rounded-md transition-colors',
              activeTab === tab ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary',
            )}
          >
            {tab === 'updates' ? t('updates.tabs.updates') : t('updates.tabs.policies')}
          </button>
        ))}
      </div>

      {activeTab === 'updates' && (
        <div className="space-y-4">
          {isLoading ? (
            <div className="flex items-center justify-center h-48"><RefreshCw className="w-5 h-5 animate-spin text-text-muted" /></div>
          ) : aggUpdates.length === 0 ? (
            <div className="p-12 text-center text-text-muted bg-bg-secondary border border-border rounded-xl">
              <Package className="w-10 h-10 mx-auto mb-3 opacity-50" />
              <p className="font-medium text-text-primary mb-1">{t('updates.noUpdatesFound')}</p>
              <p className="text-sm">{t('updates.allUpToDate')}</p>
            </div>
          ) : (
            <>
              <div className="bg-bg-secondary border border-border rounded-xl overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border bg-bg-tertiary/50">
                      <th className="w-10 px-3 py-3">
                        <button onClick={toggleSelectAll} className="text-text-muted hover:text-text-primary transition-colors">
                          {selectedUids.size === aggUpdates.length && aggUpdates.length > 0
                            ? <CheckSquare className="w-4 h-4 text-accent" />
                            : <Square className="w-4 h-4" />}
                        </button>
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase">{t('updates.table.update')}</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase">{t('updates.table.severity')}</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase hidden md:table-cell">{t('updates.table.source')}</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-text-muted uppercase">{t('updates.table.devices')}</th>
                      <th className="w-28 px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {aggUpdates.map((upd) => {
                      const cfg = SEVERITY_CONFIG[upd.severity as UpdateSeverity] ?? SEVERITY_CONFIG.unknown;
                      const isExpanded = expandedUid === upd.updateUid;
                      return (
                        <React.Fragment key={upd.updateUid}>
                          <tr className="hover:bg-bg-tertiary transition-colors cursor-pointer" onClick={() => handleExpand(upd.updateUid)}>
                            <td className="w-10 px-3 py-3" onClick={(e) => e.stopPropagation()}>
                              <button onClick={() => toggleSelect(upd.updateUid)} className="text-text-muted hover:text-text-primary transition-colors">
                                {selectedUids.has(upd.updateUid)
                                  ? <CheckSquare className="w-4 h-4 text-accent" />
                                  : <Square className="w-4 h-4" />}
                              </button>
                            </td>
                            <td className="px-4 py-3">
                              <p className="text-sm text-text-primary font-medium">{upd.title ?? upd.updateUid}</p>
                              {upd.requiresReboot && <p className="text-xs text-orange-400 mt-0.5">Requires reboot</p>}
                              {upd.category && <p className="text-xs text-text-muted mt-0.5">{upd.category}</p>}
                            </td>
                            <td className="px-4 py-3"><span className={clsx('text-xs px-2 py-0.5 rounded-full border font-medium', cfg.color)}>{cfg.label}</span></td>
                            <td className="px-4 py-3 hidden md:table-cell"><span className="text-xs text-text-muted">{upd.source.replace('_', ' ')}</span></td>
                            <td className="px-4 py-3 text-center"><span className="text-xs font-medium text-text-primary bg-bg-tertiary px-2 py-0.5 rounded-full">{upd.deviceCount}</span></td>
                            <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center justify-end gap-1.5">
                                {upd.deployingCount > 0 && (
                                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-400/10 border border-blue-400/30 text-blue-400">
                                    {upd.deployingCount} deploying
                                  </span>
                                )}
                                {upd.failedCount > 0 && (
                                  <button
                                    onClick={async () => {
                                      try {
                                        const r = await updateApi.bulkRetry(upd.updateUid);
                                        toast.success(`${r.retried} update(s) retried`);
                                        await load();
                                      } catch { toast.error('Retry failed'); }
                                    }}
                                    className="text-[10px] px-2 py-0.5 rounded-full bg-red-400/10 border border-red-400/30 text-red-400 hover:bg-red-400/20 transition-colors"
                                  >
                                    {upd.failedCount} failed — retry
                                  </button>
                                )}
                                {upd.availableCount > 0 && (
                                  <button onClick={() => handleApproveTitle(upd.updateUid)} className="text-xs px-2.5 py-1 bg-green-500/20 text-green-400 border border-green-500/30 rounded hover:bg-green-500/30 transition-colors">
                                    {t('updates.actions.approve')}{upd.approvedCount > 0 ? ` (${upd.availableCount})` : ''}
                                  </button>
                                )}
                                {upd.availableCount === 0 && upd.approvedCount > 0 && (
                                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-400/10 border border-green-400/30 text-green-400">
                                    Approved
                                  </span>
                                )}
                              </div>
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr><td colSpan={6} className="px-8 py-3 bg-bg-tertiary/30">
                              <div className="space-y-1">
                                {expandedDevices.length === 0 ? <p className="text-xs text-text-muted">Loading...</p> : expandedDevices.map((d) => (
                                  <div key={d.id} className="flex items-center gap-3 text-xs">
                                    <Monitor className="w-3 h-3 text-text-muted shrink-0" />
                                    <span className="text-text-primary">{d.deviceName}</span>
                                    <span className="text-text-muted ml-auto">{d.status}</span>
                                  </div>
                                ))}
                              </div>
                            </td></tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-center gap-3 text-sm text-text-muted">
                {Math.ceil(aggTotal / aggPageSize) > 1 && (
                  <>
                    <button onClick={() => setAggPage(p => Math.max(1, p - 1))} disabled={aggPage === 1} className="px-2 py-1 rounded hover:text-text-primary disabled:opacity-30">←</button>
                    <span>{aggPage} / {Math.ceil(aggTotal / aggPageSize)}</span>
                    <button onClick={() => setAggPage(p => p + 1)} disabled={aggPage >= Math.ceil(aggTotal / aggPageSize)} className="px-2 py-1 rounded hover:text-text-primary disabled:opacity-30">→</button>
                  </>
                )}
                <span className="text-xs">({aggTotal} updates)</span>
                <select
                  value={aggPageSize}
                  onChange={(e) => setAggPageSize(parseInt(e.target.value, 10))}
                  className="px-2 py-1 text-xs bg-bg-secondary border border-border rounded text-text-primary focus:outline-none focus:border-accent"
                >
                  {[50, 100, 200, 500].map((n) => <option key={n} value={n}>{n} / page</option>)}
                </select>
              </div>
            </>
          )}
        </div>
      )}


      {activeTab === 'policies' && (
        <div className="space-y-4">
          {/* Policy form */}
          {showPolicyForm && (
            <div className="bg-bg-secondary border border-border rounded-xl p-6 space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-text-primary">{editingPolicy ? t('updates.policy.edit') : t('updates.policy.new')}</h2>
                <div className="flex gap-2">
                  <button
                    onClick={() => { setShowPolicyForm(false); setEditingPolicy(null); }}
                    className="px-4 py-2 text-sm text-text-muted hover:text-text-primary border border-border rounded-lg transition-colors"
                  >
                    {t('updates.policy.cancel')}
                  </button>
                  <button
                    onClick={handleSavePolicy}
                    disabled={isSavingPolicy}
                    className="px-4 py-2 text-sm bg-accent text-white rounded-lg hover:bg-accent/80 disabled:opacity-50 transition-colors"
                  >
                    {isSavingPolicy ? t('updates.policy.saving') : t('updates.policy.save')}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-text-muted uppercase">{t('updates.policy.name')} *</label>
                  <input
                    value={policyForm.name}
                    onChange={(e) => setPolicyForm({ ...policyForm, name: e.target.value })}
                    className="w-full px-3 py-2 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-text-muted uppercase">{t('updates.policy.target')}</label>
                  <div className="flex gap-2">
                    {(['all', 'group'] as const).map((tt) => (
                      <button key={tt} type="button"
                        onClick={() => setPolicyForm({ ...policyForm, targetType: tt, targetIds: [] })}
                        className={clsx('flex-1 py-2 text-sm rounded-lg border transition-colors',
                          policyForm.targetType === tt ? 'bg-accent/10 border-accent text-accent' : 'border-border text-text-muted hover:border-accent/50',
                        )}>
                        {tt === 'all' ? t('updates.policy.allDevices') : t('updates.policy.deviceGroup')}
                      </button>
                    ))}
                  </div>
                </div>
                {policyForm.targetType === 'group' && (
                  <div className="space-y-1 md:col-span-2">
                    <label className="text-xs font-medium text-text-muted uppercase">Groups</label>
                    <UpdatePolicyGroupTree
                      selectedIds={policyForm.targetIds}
                      onChange={(ids) => setPolicyForm({ ...policyForm, targetIds: ids })}
                    />
                  </div>
                )}
                <div className="space-y-1">
                  <label className="text-xs font-medium text-text-muted uppercase">{t('updates.policy.installWindowStart')}</label>
                  <input
                    type="time"
                    value={policyForm.installWindowStart}
                    onChange={(e) => setPolicyForm({ ...policyForm, installWindowStart: e.target.value })}
                    className="w-full px-3 py-2 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-text-muted uppercase">{t('updates.policy.installWindowEnd')}</label>
                  <input
                    type="time"
                    value={policyForm.installWindowEnd}
                    onChange={(e) => setPolicyForm({ ...policyForm, installWindowEnd: e.target.value })}
                    className="w-full px-3 py-2 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-text-muted uppercase">{t('updates.policy.rebootBehavior')}</label>
                  <select
                    value={policyForm.rebootBehavior}
                    onChange={(e) => setPolicyForm({ ...policyForm, rebootBehavior: e.target.value as RebootBehavior })}
                    className="w-full px-3 py-2 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
                  >
                    {REBOOT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-text-muted uppercase">{t('updates.policy.rebootDelay')}</label>
                  <input
                    type="number"
                    min={0}
                    value={policyForm.rebootDelayMinutes}
                    onChange={(e) => setPolicyForm({ ...policyForm, rebootDelayMinutes: parseInt(e.target.value, 10) || 0 })}
                    className="w-full px-3 py-2 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
                  />
                </div>
                <div className="space-y-1 md:col-span-2">
                  <label className="text-xs font-medium text-text-muted uppercase">{t('updates.policy.description')}</label>
                  <input
                    value={policyForm.description}
                    onChange={(e) => setPolicyForm({ ...policyForm, description: e.target.value })}
                    className="w-full px-3 py-2 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-5 pt-2 border-t border-border">
                {([
                  { key: 'autoApproveCritical', label: t('updates.policy.autoApproveCritical') },
                  { key: 'autoApproveSecurity', label: t('updates.policy.autoApproveSecurity') },
                  { key: 'autoApproveOptional', label: t('updates.policy.autoApproveOptional') },
                  { key: 'approvalRequired', label: t('updates.policy.approvalRequired') },
                  { key: 'enabled', label: t('updates.policy.enabled') },
                ] as { key: keyof PolicyFormData; label: string }[]).map(({ key, label }) => (
                  <label key={key} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={policyForm[key] as boolean}
                      onChange={(e) => setPolicyForm({ ...policyForm, [key]: e.target.checked })}
                      className="rounded"
                    />
                    <span className="text-sm text-text-primary">{label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <button
              onClick={handleOpenCreatePolicy}
              className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg hover:bg-accent/80 text-sm transition-colors"
            >
              <Plus className="w-4 h-4" />
              {t('updates.policy.new')}
            </button>
          </div>

          {policies.length === 0 ? (
            <div className="p-12 text-center text-text-muted bg-bg-secondary border border-border rounded-xl">
              <Shield className="w-10 h-10 mx-auto mb-3 opacity-50" />
              <p className="font-medium text-text-primary mb-1">{t('updates.policy.noPolicies')}</p>
              <p className="text-sm">{t('updates.policy.noPoliciesDesc')}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {policies.map((policy) => (
                <div key={policy.id} className="p-4 bg-bg-secondary border border-border rounded-xl">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium text-text-primary">{policy.name}</p>
                        <span className={clsx('text-xs px-2 py-0.5 rounded-full border font-medium', policy.enabled ? 'text-green-400 bg-green-400/10 border-green-400/30' : 'text-gray-400 bg-gray-400/10 border-gray-400/30')}>
                          {policy.enabled ? t('updates.policy.active') : t('updates.policy.inactive')}
                        </span>
                      </div>
                      {policy.description && (
                        <p className="text-xs text-text-muted mt-1">{policy.description}</p>
                      )}
                      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-text-muted">
                        <span>{t('updates.policy.target')}: <span className="text-text-primary">{policy.targetType === 'all' ? t('updates.policy.allDevices') : `${policy.targetType} #${policy.targetId}`}</span></span>
                        <span>{t('updates.policy.reboot')}: <span className="text-text-primary">{REBOOT_OPTIONS.find(o => o.value === policy.rebootBehavior)?.label ?? policy.rebootBehavior}</span></span>
                        <span>{t('updates.policy.window')}: <span className="text-text-primary">{policy.installWindowStart} – {policy.installWindowEnd}</span></span>
                      </div>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {policy.autoApproveCritical && <span className="text-xs px-2 py-0.5 rounded-full bg-red-400/10 border border-red-400/30 text-red-400">{t('updates.policy.autoCritical')}</span>}
                        {policy.autoApproveSecurity && <span className="text-xs px-2 py-0.5 rounded-full bg-orange-400/10 border border-orange-400/30 text-orange-400">{t('updates.policy.autoSecurity')}</span>}
                        {policy.autoApproveOptional && <span className="text-xs px-2 py-0.5 rounded-full bg-blue-400/10 border border-blue-400/30 text-blue-400">{t('updates.policy.autoOptional')}</span>}
                        {policy.approvalRequired && <span className="text-xs px-2 py-0.5 rounded-full bg-bg-tertiary border border-border text-text-muted">{t('updates.policy.approvalRequired')}</span>}
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={() => handleOpenEditPolicy(policy)}
                        className="p-1.5 text-text-muted hover:text-text-primary hover:bg-bg-tertiary rounded transition-colors"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDeletePolicy(policy.id)}
                        className="p-1.5 text-text-muted hover:text-red-400 hover:bg-red-400/10 rounded transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Group Tree Multi-Select for Update Policies ──────────────────────────────

function UpdatePolicyGroupTree({ selectedIds, onChange }: { selectedIds: number[]; onChange: (ids: number[]) => void }) {
  const [tree, setTree] = useState<DeviceGroupTreeNode[]>([]);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  useEffect(() => {
    groupsApi.tree().then((t) => {
      setTree(t);
      const all = new Set<number>();
      const walk = (nodes: DeviceGroupTreeNode[]) => { for (const n of nodes) { all.add(n.id); walk(n.children); } };
      walk(t);
      setExpanded(all);
    }).catch(() => {});
  }, []);

  const getDescendantIds = (node: DeviceGroupTreeNode): number[] => {
    const ids: number[] = [];
    for (const c of node.children) { ids.push(c.id, ...getDescendantIds(c)); }
    return ids;
  };

  const selected = new Set(selectedIds);

  const getCheckState = (node: DeviceGroupTreeNode): 'all' | 'some' | 'none' => {
    const descendants = getDescendantIds(node);
    const selfSelected = selected.has(node.id);
    if (descendants.length === 0) return selfSelected ? 'all' : 'none';
    const allIds = [node.id, ...descendants];
    const selectedCount = allIds.filter(id => selected.has(id)).length;
    if (selectedCount === allIds.length) return 'all';
    if (selectedCount > 0) return 'some';
    return 'none';
  };

  const toggleNode = (node: DeviceGroupTreeNode) => {
    const descendants = getDescendantIds(node);
    const allIds = [node.id, ...descendants];
    const state = getCheckState(node);
    let next: Set<number>;
    if (state === 'all') {
      next = new Set(selectedIds.filter(id => !allIds.includes(id)));
    } else {
      next = new Set([...selectedIds, ...allIds]);
    }
    onChange(Array.from(next));
  };

  const toggleExpand = (id: number) => {
    setExpanded(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  };

  const renderNode = (node: DeviceGroupTreeNode, depth: number): React.ReactNode => {
    const hasChildren = node.children.length > 0;
    const isExpanded = expanded.has(node.id);
    const state = getCheckState(node);
    const count = node.total ?? node.deviceCount ?? 0;

    return (
      <div key={node.id}>
        <div className={clsx('flex items-center gap-1.5 py-1.5 transition-colors rounded hover:bg-bg-hover', state === 'all' && 'bg-accent/5')}
          style={{ paddingLeft: `${8 + depth * 20}px`, paddingRight: 8 }}>
          <button type="button" onClick={() => hasChildren && toggleExpand(node.id)}
            className={clsx('shrink-0 p-0.5 text-text-muted hover:text-text-primary transition-colors', !hasChildren && 'invisible')}>
            <ChevronRight className={clsx('w-3 h-3 transition-transform', isExpanded && 'rotate-90')} />
          </button>
          <button type="button" onClick={() => toggleNode(node)}
            className={clsx('w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors',
              state === 'all' ? 'bg-accent border-accent text-white' :
              state === 'some' ? 'bg-accent/30 border-accent text-white' :
              'border-border hover:border-accent/50')}>
            {state === 'all' && <Check className="w-3 h-3" />}
            {state === 'some' && <Minus className="w-3 h-3" />}
          </button>
          <FolderOpen className={clsx('w-3.5 h-3.5 shrink-0', state !== 'none' ? 'text-accent' : 'text-text-muted')} />
          <span className={clsx('flex-1 text-sm truncate cursor-pointer', state !== 'none' ? 'text-text-primary font-medium' : 'text-text-primary')}
            onClick={() => toggleNode(node)}>{node.name}</span>
          <span className="text-text-muted text-[10px] shrink-0">{count}</span>
        </div>
        {hasChildren && isExpanded && node.children.map((c: DeviceGroupTreeNode) => renderNode(c, depth + 1))}
      </div>
    );
  };

  if (tree.length === 0) return <p className="text-sm text-text-muted py-2">No groups available</p>;

  return (
    <div className="rounded-lg border border-border bg-bg-tertiary max-h-60 overflow-y-auto py-1">
      {tree.map(n => renderNode(n, 0))}
    </div>
  );
}
