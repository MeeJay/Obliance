import { useEffect, useState, useCallback } from 'react';
import { Package, AlertCircle, AlertTriangle, Info, Check, RefreshCw, Plus, Edit, Trash2, Shield, X } from 'lucide-react';
import { updateApi } from '@/api/update.api';
import type { DeviceUpdate, UpdatePolicy, UpdateSeverity, RebootBehavior } from '@obliance/shared';
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
  targetType: 'device' | 'group' | 'all';
  targetId: number | null;
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

function formatBytes(bytes: number | null) {
  if (!bytes) return null;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function UpdatesPage() {
  const [activeTab, setActiveTab] = useState<Tab>('updates');
  const [updates, setUpdates] = useState<DeviceUpdate[]>([]);
  const [policies, setPolicies] = useState<UpdatePolicy[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedSeverity, setSelectedSeverity] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showPolicyForm, setShowPolicyForm] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<UpdatePolicy | null>(null);
  const [policyForm, setPolicyForm] = useState<PolicyFormData>(defaultPolicyForm);
  const [isSavingPolicy, setIsSavingPolicy] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [updatesData, policiesData] = await Promise.all([
        updateApi.listUpdates({ severity: selectedSeverity || undefined }),
        updateApi.listPolicies(),
      ]);
      setUpdates(updatesData.items);
      setPolicies(policiesData);
    } catch {
      toast.error('Failed to load updates');
    } finally {
      setIsLoading(false);
    }
  }, [selectedSeverity]);

  useEffect(() => { load(); }, [load]);

  const handleBulkApprove = async () => {
    if (selectedIds.size === 0) return;
    try {
      // Approve each selected update individually (server approves per device+updateId)
      const selected = updates.filter((u) => selectedIds.has(u.id));
      await Promise.all(selected.map((u) => updateApi.approveUpdate(u.deviceId, u.id)));
      setSelectedIds(new Set());
      toast.success(`${selected.length} updates approved`);
      await load();
    } catch {
      toast.error('Failed to approve updates');
    }
  };

  const handleApprove = async (update: DeviceUpdate) => {
    try {
      await updateApi.approveUpdate(update.deviceId, update.id);
      toast.success('Update approved');
      await load();
    } catch {
      toast.error('Failed to approve update');
    }
  };

  const handleDeletePolicy = async (id: number) => {
    if (!confirm('Delete this update policy?')) return;
    try {
      await updateApi.deletePolicy(id);
      toast.success('Policy deleted');
      await load();
    } catch {
      toast.error('Failed to delete policy');
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
      targetType: policy.targetType,
      targetId: policy.targetId,
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
    if (!policyForm.name.trim()) { toast.error('Policy name is required'); return; }
    setIsSavingPolicy(true);
    try {
      const payload = {
        name: policyForm.name,
        description: policyForm.description || null,
        targetType: policyForm.targetType,
        targetId: policyForm.targetId,
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
        toast.success('Policy updated');
      } else {
        await updateApi.createPolicy(payload as any);
        toast.success('Policy created');
      }
      setShowPolicyForm(false);
      setEditingPolicy(null);
      await load();
    } catch {
      toast.error('Failed to save policy');
    } finally {
      setIsSavingPolicy(false);
    }
  };

  const countBySeverity = (sev: UpdateSeverity) => updates.filter(u => u.severity === sev && u.status === 'available').length;

  const visibleUpdates = selectedSeverity
    ? updates.filter(u => u.severity === selectedSeverity)
    : updates;

  const allChecked = visibleUpdates.length > 0 && visibleUpdates.every(u => selectedIds.has(u.id));

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Updates</h1>
          <p className="text-sm text-text-muted mt-0.5">Manage software updates across your fleet</p>
        </div>
        <button onClick={load} className="p-2 text-text-muted hover:text-text-primary hover:bg-bg-secondary rounded-lg transition-colors">
          <RefreshCw className={clsx('w-4 h-4', isLoading && 'animate-spin')} />
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {(['critical', 'important', 'moderate', 'optional'] as UpdateSeverity[]).map((sev) => {
          const cfg = SEVERITY_CONFIG[sev];
          const Icon = cfg.icon;
          const count = countBySeverity(sev);
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

      {/* Tabs */}
      <div className="border-b border-border">
        <nav className="-mb-px flex gap-1">
          {(['updates', 'policies'] as Tab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={clsx(
                'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
                activeTab === tab ? 'border-accent text-accent' : 'border-transparent text-text-muted hover:text-text-primary hover:border-border',
              )}
            >
              {tab === 'updates' ? 'Available Updates' : 'Update Policies'}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === 'updates' && (
        <div className="space-y-4">
          {/* Bulk action bar */}
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-3 p-3 bg-accent/10 border border-accent/30 rounded-lg">
              <span className="text-sm text-text-primary font-medium">{selectedIds.size} selected</span>
              <button
                onClick={handleBulkApprove}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500/20 text-green-400 border border-green-500/30 rounded text-sm hover:bg-green-500/30 transition-colors"
              >
                <Check className="w-3.5 h-3.5" />
                Approve selected
              </button>
              <button onClick={() => setSelectedIds(new Set())} className="ml-auto text-sm text-text-muted hover:text-text-primary flex items-center gap-1">
                <X className="w-3.5 h-3.5" />
                Clear
              </button>
            </div>
          )}

          {isLoading ? (
            <div className="flex items-center justify-center h-48">
              <RefreshCw className="w-5 h-5 animate-spin text-text-muted" />
            </div>
          ) : visibleUpdates.length === 0 ? (
            <div className="p-12 text-center text-text-muted bg-bg-secondary border border-border rounded-xl">
              <Package className="w-10 h-10 mx-auto mb-3 opacity-50" />
              <p className="font-medium text-text-primary mb-1">No updates found</p>
              <p className="text-sm">{selectedSeverity ? `No ${selectedSeverity} updates available.` : 'All devices are up to date.'}</p>
            </div>
          ) : (
            <div className="bg-bg-secondary border border-border rounded-xl overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-bg-tertiary/50">
                    <th className="w-10 px-4 py-3">
                      <input
                        type="checkbox"
                        checked={allChecked}
                        onChange={(e) => {
                          if (e.target.checked) setSelectedIds(new Set(visibleUpdates.map(u => u.id)));
                          else setSelectedIds(new Set());
                        }}
                        className="rounded"
                      />
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase">Update</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase">Severity</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase hidden md:table-cell">Source</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase hidden lg:table-cell">Size</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase">Status</th>
                    <th className="w-28 px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {visibleUpdates.map((update) => {
                    const cfg = SEVERITY_CONFIG[update.severity];
                    return (
                      <tr key={update.id} className={clsx('transition-colors', selectedIds.has(update.id) ? 'bg-accent/5' : 'hover:bg-bg-tertiary')}>
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(update.id)}
                            onChange={() => {
                              setSelectedIds(prev => {
                                const next = new Set(prev);
                                if (next.has(update.id)) next.delete(update.id);
                                else next.add(update.id);
                                return next;
                              });
                            }}
                            className="rounded"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-sm text-text-primary font-medium">{update.title ?? update.updateUid}</p>
                          {update.requiresReboot && (
                            <p className="text-xs text-orange-400 mt-0.5">Requires reboot</p>
                          )}
                          {update.category && (
                            <p className="text-xs text-text-muted mt-0.5">{update.category}</p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className={clsx('text-xs px-2 py-0.5 rounded-full border font-medium', cfg.color)}>
                            {cfg.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell">
                          <span className="text-xs text-text-muted">{update.source.replace('_', ' ')}</span>
                        </td>
                        <td className="px-4 py-3 hidden lg:table-cell">
                          <span className="text-xs text-text-muted">{formatBytes(update.sizeBytes) ?? '—'}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={clsx('text-xs', update.status === 'available' ? 'text-text-muted' : update.status === 'installed' ? 'text-green-400' : update.status === 'failed' ? 'text-red-400' : 'text-text-muted')}>
                            {update.status.replace('_', ' ')}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {update.status === 'available' && (
                            <button
                              onClick={() => handleApprove(update)}
                              className="text-xs px-2.5 py-1 bg-green-500/20 text-green-400 border border-green-500/30 rounded hover:bg-green-500/30 transition-colors"
                            >
                              Approve
                            </button>
                          )}
                          {update.status === 'approved' && (
                            <span className="text-xs text-green-400 flex items-center gap-1 justify-end">
                              <Check className="w-3 h-3" />
                              Approved
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'policies' && (
        <div className="space-y-4">
          {/* Policy form */}
          {showPolicyForm && (
            <div className="bg-bg-secondary border border-border rounded-xl p-6 space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-text-primary">{editingPolicy ? 'Edit Policy' : 'New Update Policy'}</h2>
                <div className="flex gap-2">
                  <button
                    onClick={() => { setShowPolicyForm(false); setEditingPolicy(null); }}
                    className="px-4 py-2 text-sm text-text-muted hover:text-text-primary border border-border rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSavePolicy}
                    disabled={isSavingPolicy}
                    className="px-4 py-2 text-sm bg-accent text-white rounded-lg hover:bg-accent/80 disabled:opacity-50 transition-colors"
                  >
                    {isSavingPolicy ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-text-muted uppercase">Name *</label>
                  <input
                    value={policyForm.name}
                    onChange={(e) => setPolicyForm({ ...policyForm, name: e.target.value })}
                    className="w-full px-3 py-2 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-text-muted uppercase">Target</label>
                  <select
                    value={policyForm.targetType}
                    onChange={(e) => setPolicyForm({ ...policyForm, targetType: e.target.value as 'device' | 'group' | 'all' })}
                    className="w-full px-3 py-2 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
                  >
                    <option value="all">All devices</option>
                    <option value="group">Device group</option>
                    <option value="device">Specific device</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-text-muted uppercase">Install window start</label>
                  <input
                    type="time"
                    value={policyForm.installWindowStart}
                    onChange={(e) => setPolicyForm({ ...policyForm, installWindowStart: e.target.value })}
                    className="w-full px-3 py-2 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-text-muted uppercase">Install window end</label>
                  <input
                    type="time"
                    value={policyForm.installWindowEnd}
                    onChange={(e) => setPolicyForm({ ...policyForm, installWindowEnd: e.target.value })}
                    className="w-full px-3 py-2 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-text-muted uppercase">Reboot behavior</label>
                  <select
                    value={policyForm.rebootBehavior}
                    onChange={(e) => setPolicyForm({ ...policyForm, rebootBehavior: e.target.value as RebootBehavior })}
                    className="w-full px-3 py-2 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
                  >
                    {REBOOT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-text-muted uppercase">Reboot delay (minutes)</label>
                  <input
                    type="number"
                    min={0}
                    value={policyForm.rebootDelayMinutes}
                    onChange={(e) => setPolicyForm({ ...policyForm, rebootDelayMinutes: parseInt(e.target.value, 10) || 0 })}
                    className="w-full px-3 py-2 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
                  />
                </div>
                <div className="space-y-1 md:col-span-2">
                  <label className="text-xs font-medium text-text-muted uppercase">Description</label>
                  <input
                    value={policyForm.description}
                    onChange={(e) => setPolicyForm({ ...policyForm, description: e.target.value })}
                    className="w-full px-3 py-2 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-5 pt-2 border-t border-border">
                {([
                  { key: 'autoApproveCritical', label: 'Auto-approve critical' },
                  { key: 'autoApproveSecurity', label: 'Auto-approve security' },
                  { key: 'autoApproveOptional', label: 'Auto-approve optional' },
                  { key: 'approvalRequired', label: 'Approval required' },
                  { key: 'enabled', label: 'Enabled' },
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
              New Policy
            </button>
          </div>

          {policies.length === 0 ? (
            <div className="p-12 text-center text-text-muted bg-bg-secondary border border-border rounded-xl">
              <Shield className="w-10 h-10 mx-auto mb-3 opacity-50" />
              <p className="font-medium text-text-primary mb-1">No update policies configured</p>
              <p className="text-sm">Create policies to automate update approval and scheduling.</p>
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
                          {policy.enabled ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      {policy.description && (
                        <p className="text-xs text-text-muted mt-1">{policy.description}</p>
                      )}
                      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-text-muted">
                        <span>Target: <span className="text-text-primary">{policy.targetType === 'all' ? 'All devices' : `${policy.targetType} #${policy.targetId}`}</span></span>
                        <span>Reboot: <span className="text-text-primary">{REBOOT_OPTIONS.find(o => o.value === policy.rebootBehavior)?.label ?? policy.rebootBehavior}</span></span>
                        <span>Window: <span className="text-text-primary">{policy.installWindowStart} – {policy.installWindowEnd}</span></span>
                      </div>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {policy.autoApproveCritical && <span className="text-xs px-2 py-0.5 rounded-full bg-red-400/10 border border-red-400/30 text-red-400">Auto: critical</span>}
                        {policy.autoApproveSecurity && <span className="text-xs px-2 py-0.5 rounded-full bg-orange-400/10 border border-orange-400/30 text-orange-400">Auto: security</span>}
                        {policy.autoApproveOptional && <span className="text-xs px-2 py-0.5 rounded-full bg-blue-400/10 border border-blue-400/30 text-blue-400">Auto: optional</span>}
                        {policy.approvalRequired && <span className="text-xs px-2 py-0.5 rounded-full bg-bg-tertiary border border-border text-text-muted">Approval required</span>}
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
