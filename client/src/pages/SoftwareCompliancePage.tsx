import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Plus, RefreshCw, Edit, Trash2, ChevronDown, ChevronUp,
  CheckCircle, XCircle, AlertTriangle, Activity, X,
  Monitor, Wrench, ShieldCheck, ShieldX, ShieldAlert,
  ToggleLeft, ToggleRight, ChevronRight, Check, Minus, FolderOpen,
  ArrowUp, ArrowDown, Search, Package,
} from 'lucide-react';
import { softwareComplianceApi } from '@/api/softwareCompliance.api';
import { groupsApi } from '@/api/groups.api';
import { useAuthStore } from '@/store/authStore';
import { useDeviceStore } from '@/store/deviceStore';
import type {
  SoftwareComplianceList, SoftwareComplianceEntry,
  SoftwareComplianceResult, SoftwareComplianceEntryResult,
  SoftwareMatchType, SoftwareInstallSource, SoftwareListType,
  DeviceGroupTreeNode, KnownSoftwareApp,
} from '@obliance/shared';
import toast from 'react-hot-toast';
import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';

type Tab = 'results' | 'lists';

const MATCH_TYPES: SoftwareMatchType[] = ['exact', 'contains', 'regex'];
const INSTALL_SOURCES: SoftwareInstallSource[] = ['winget', 'choco', 'apt', 'dnf', 'brew', 'pkg', 'msi', 'custom'];
const PLATFORMS = ['all', 'windows', 'linux', 'macos', 'freebsd'] as const;

function scoreColor(score: number): string {
  if (score >= 80) return 'text-green-400';
  if (score >= 50) return 'text-yellow-400';
  return 'text-red-400';
}
function scoreBg(score: number): string {
  if (score >= 80) return 'bg-green-400';
  if (score >= 50) return 'bg-yellow-400';
  return 'bg-red-400';
}
function scoreIcon(score: number) {
  if (score >= 80) return ShieldCheck;
  if (score >= 50) return ShieldAlert;
  return ShieldX;
}

function entryStatusIcon(status: SoftwareComplianceEntryResult['status']) {
  switch (status) {
    case 'compliant': return <CheckCircle className="w-4 h-4 text-green-400 shrink-0" />;
    case 'non_compliant': return <XCircle className="w-4 h-4 text-red-400 shrink-0" />;
    case 'remediated': return <RefreshCw className="w-4 h-4 text-yellow-400 shrink-0" />;
    case 'remediation_failed': return <AlertTriangle className="w-4 h-4 text-orange-400 shrink-0" />;
    default: return <AlertTriangle className="w-4 h-4 text-text-muted shrink-0" />;
  }
}

function entryStatusColor(status: SoftwareComplianceEntryResult['status']) {
  switch (status) {
    case 'compliant': return 'text-green-400';
    case 'non_compliant': return 'text-red-400';
    case 'remediated': return 'text-yellow-400';
    case 'remediation_failed': return 'text-orange-400';
    default: return 'text-text-muted';
  }
}

// ── Entry editor card ────────────────────────────────────────────────────────

interface EntryFormData {
  name: string;
  matchType: SoftwareMatchType;
  publisher: string;
  minVersion: string;
  maxVersion: string;
  installSource: SoftwareInstallSource | '';
  installId: string;
  installScript: string;
  fromInventory?: boolean;
}

function makeEmptyEntry(): EntryFormData {
  return {
    name: '',
    matchType: 'contains',
    publisher: '',
    minVersion: '',
    maxVersion: '',
    installSource: '',
    installId: '',
    installScript: '',
  };
}

function makeEntryFromKnownApp(app: KnownSoftwareApp): EntryFormData {
  let installSource: SoftwareInstallSource | '' = '';
  let installId = '';
  const src = (app.source ?? '').toLowerCase();
  if (src === 'winget') { installSource = 'winget'; installId = app.packageId ?? ''; }
  else if (src === 'chocolatey' || src === 'choco') { installSource = 'choco'; installId = app.packageId ?? ''; }
  else if (src === 'dpkg' || src === 'apt') { installSource = 'apt'; installId = app.packageId ?? ''; }
  else if (src === 'rpm' || src === 'dnf') { installSource = 'dnf'; installId = app.packageId ?? ''; }
  else if (src === 'brew' || src === 'homebrew') { installSource = 'brew'; installId = app.packageId ?? ''; }
  else if (src === 'pkg') { installSource = 'pkg'; installId = app.packageId ?? ''; }

  return {
    name: app.name,
    matchType: 'contains',
    publisher: app.publisher ?? '',
    minVersion: '',
    maxVersion: '',
    installSource,
    installId,
    installScript: '',
    fromInventory: true,
  };
}

function EntryEditorCard({
  entry, index, total, onChange, onDelete, onMoveUp, onMoveDown, isBlacklist,
}: {
  entry: EntryFormData;
  index: number;
  total: number;
  onChange: (e: EntryFormData) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  isBlacklist: boolean;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(!entry.name);
  const set = (patch: Partial<EntryFormData>) => onChange({ ...entry, ...patch });

  const installLabel = isBlacklist
    ? t('softwareCompliance.uninstallMethod')
    : t('softwareCompliance.installSource');

  return (
    <div className="border border-border rounded-lg bg-bg-tertiary/40 overflow-hidden">
      {/* Card header */}
      <div
        className="flex items-center gap-2 px-3 py-2.5 cursor-pointer hover:bg-bg-tertiary transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="text-xs text-text-muted shrink-0 w-5 text-center">{index + 1}</span>
        {expanded
          ? <ChevronUp className="w-3.5 h-3.5 text-text-muted shrink-0" />
          : <ChevronDown className="w-3.5 h-3.5 text-text-muted shrink-0" />
        }
        <input
          value={entry.name}
          onChange={e => { e.stopPropagation(); set({ name: e.target.value }); }}
          onClick={e => e.stopPropagation()}
          placeholder="e.g. Google Chrome"
          className="flex-1 px-2 py-1 text-sm bg-bg-secondary border border-border rounded text-text-primary focus:outline-none focus:border-accent min-w-0"
        />
        {entry.fromInventory && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-400/10 text-blue-400 border border-blue-400/20 shrink-0 whitespace-nowrap">
            {t('softwareCompliance.fromInventoryBadge')}
          </span>
        )}
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={e => { e.stopPropagation(); onMoveUp(); }}
            disabled={index === 0}
            className="p-1 text-text-muted hover:text-text-primary hover:bg-bg-secondary rounded transition-colors disabled:opacity-30"
            title={t('softwareCompliance.moveUp')}
          >
            <ArrowUp className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={e => { e.stopPropagation(); onMoveDown(); }}
            disabled={index === total - 1}
            className="p-1 text-text-muted hover:text-text-primary hover:bg-bg-secondary rounded transition-colors disabled:opacity-30"
            title={t('softwareCompliance.moveDown')}
          >
            <ArrowDown className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={e => { e.stopPropagation(); onDelete(); }}
            className="p-1 text-text-muted hover:text-red-400 hover:bg-red-400/10 rounded transition-colors"
            title={t('common.delete')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Card body — collapsible */}
      {expanded && (
        <div className="px-3 pb-3 pt-1 border-t border-border space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {/* Match Type */}
            <div className="space-y-0.5">
              <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                {t('softwareCompliance.matchType')}
              </label>
              <select
                value={entry.matchType}
                onChange={e => set({ matchType: e.target.value as SoftwareMatchType })}
                className="w-full px-2 py-1.5 text-sm bg-bg-secondary border border-border rounded text-text-primary focus:outline-none focus:border-accent"
              >
                {MATCH_TYPES.map(m => (
                  <option key={m} value={m}>{t(`softwareCompliance.matchTypes.${m}`)}</option>
                ))}
              </select>
            </div>
            {/* Publisher */}
            <div className="space-y-0.5">
              <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                {t('softwareCompliance.publisher')}
              </label>
              <input
                value={entry.publisher}
                onChange={e => set({ publisher: e.target.value })}
                placeholder="Optional"
                className="w-full px-2 py-1.5 text-sm bg-bg-secondary border border-border rounded text-text-primary focus:outline-none focus:border-accent"
              />
            </div>
            {/* Min / Max Version side by side */}
            <div className="flex gap-2">
              <div className="flex-1 space-y-0.5">
                <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                  {t('softwareCompliance.minVersion')}
                </label>
                <input
                  value={entry.minVersion}
                  onChange={e => set({ minVersion: e.target.value })}
                  placeholder="e.g. 100.0"
                  className="w-full px-2 py-1.5 text-sm bg-bg-secondary border border-border rounded text-text-primary focus:outline-none focus:border-accent"
                />
              </div>
              <div className="flex-1 space-y-0.5">
                <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                  {t('softwareCompliance.maxVersion')}
                </label>
                <input
                  value={entry.maxVersion}
                  onChange={e => set({ maxVersion: e.target.value })}
                  placeholder="e.g. 120.0"
                  className="w-full px-2 py-1.5 text-sm bg-bg-secondary border border-border rounded text-text-primary focus:outline-none focus:border-accent"
                />
              </div>
            </div>
          </div>

          {/* Install / Uninstall section */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {/* Install Source */}
            <div className="space-y-0.5">
              <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                {installLabel}
              </label>
              <select
                value={entry.installSource}
                onChange={e => set({ installSource: e.target.value as SoftwareInstallSource | '', installId: '', installScript: '' })}
                className="w-full px-2 py-1.5 text-sm bg-bg-secondary border border-border rounded text-text-primary focus:outline-none focus:border-accent"
              >
                <option value="">{t('softwareCompliance.noSource')}</option>
                {INSTALL_SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            {/* Package ID — for winget/choco/apt/dnf/brew/pkg */}
            {entry.installSource && entry.installSource !== 'custom' && entry.installSource !== 'msi' && (
              <div className="space-y-0.5">
                <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                  {t('softwareCompliance.packageId')}
                </label>
                <input
                  value={entry.installId}
                  onChange={e => set({ installId: e.target.value })}
                  placeholder="e.g. Google.Chrome"
                  className="w-full px-2 py-1.5 text-sm bg-bg-secondary border border-border rounded font-mono text-text-primary focus:outline-none focus:border-accent"
                />
              </div>
            )}
            {/* MSI fields */}
            {entry.installSource === 'msi' && (
              <>
                <div className="space-y-0.5">
                  <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                    {t('softwareCompliance.msiUrl')}
                  </label>
                  <input
                    value={entry.installId}
                    onChange={e => set({ installId: e.target.value })}
                    placeholder="https://... or \\\\server\\share\\app.msi"
                    className="w-full px-2 py-1.5 text-sm bg-bg-secondary border border-border rounded font-mono text-text-primary focus:outline-none focus:border-accent"
                  />
                </div>
                <div className="space-y-0.5">
                  <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                    {t('softwareCompliance.msiParams')}
                  </label>
                  <input
                    value={entry.installScript || '/quiet /norestart'}
                    onChange={e => set({ installScript: e.target.value })}
                    placeholder="/quiet /norestart"
                    className="w-full px-2 py-1.5 text-sm bg-bg-secondary border border-border rounded font-mono text-text-primary focus:outline-none focus:border-accent"
                  />
                </div>
              </>
            )}
          </div>
          {/* Custom Script — shown when source is custom */}
          {entry.installSource === 'custom' && (
            <div className="space-y-0.5">
              <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                {t('softwareCompliance.customScript')}
              </label>
              <textarea
                value={entry.installScript}
                onChange={e => set({ installScript: e.target.value })}
                placeholder="PowerShell or Bash script..."
                rows={2}
                className="w-full px-2 py-1.5 text-sm bg-bg-secondary border border-border rounded font-mono text-text-primary focus:outline-none focus:border-accent resize-y"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Known Apps Modal ──────────────────────────────────────────────────────────

function KnownAppsModal({
  open,
  onClose,
  onSelect,
  platform,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (app: KnownSoftwareApp) => void;
  platform: string;
}) {
  const { t } = useTranslation();
  const [apps, setApps] = useState<KnownSoftwareApp[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setSearch('');
    const osType = platform === 'all' ? undefined : platform === 'macos' ? 'macos' : platform;
    softwareComplianceApi.getKnownApps(osType).then(setApps).catch(() => setApps([])).finally(() => setLoading(false));
  }, [open, platform]);

  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 100);
  }, [open]);

  if (!open) return null;

  const filtered = search.trim()
    ? apps.filter(a => a.name.toLowerCase().includes(search.toLowerCase()) || (a.publisher ?? '').toLowerCase().includes(search.toLowerCase()))
    : apps;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-bg-primary border border-border rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Modal header */}
        <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
          <h3 className="text-sm font-semibold text-text-primary">{t('softwareCompliance.fromInventory')}</h3>
          <button onClick={onClose} className="p-1 text-text-muted hover:text-text-primary rounded transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2 px-3 py-2 bg-bg-secondary border border-border rounded-lg">
            <Search className="w-3.5 h-3.5 text-text-muted shrink-0" />
            <input
              ref={searchRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('softwareCompliance.searchApps')}
              className="flex-1 text-sm bg-transparent text-text-primary focus:outline-none"
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-2 min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="w-5 h-5 animate-spin text-text-muted" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-text-muted">
              <Package className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">{t('softwareCompliance.noKnownApps')}</p>
            </div>
          ) : (
            <div className="space-y-1">
              {filtered.map((app, i) => (
                <button
                  key={`${app.name}-${app.source}-${i}`}
                  onClick={() => { onSelect(app); onClose(); }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-bg-secondary transition-colors text-left group"
                >
                  <Package className="w-4 h-4 text-text-muted shrink-0 group-hover:text-accent transition-colors" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-text-primary truncate">{app.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {app.publisher && (
                        <span className="text-xs text-text-muted truncate">{app.publisher}</span>
                      )}
                      {app.source && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-tertiary border border-border text-text-muted shrink-0">
                          {app.source}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="text-xs text-text-muted shrink-0">
                    {t('softwareCompliance.installedOn', { count: app.deviceCount })}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── List form ─────────────────────────────────────────────────────────────────

interface ListFormData {
  name: string;
  description: string;
  listType: SoftwareListType;
  targetType: 'group' | 'all';
  targetIds: number[];
  targetPlatform: typeof PLATFORMS[number];
  autoRemediate: boolean;
  enabled: boolean;
  entries: EntryFormData[];
}

const defaultListForm: ListFormData = {
  name: '', description: '', listType: 'whitelist', targetType: 'all', targetIds: [],
  targetPlatform: 'all', autoRemediate: false, enabled: true, entries: [],
};

// ── GroupTreeMultiSelect (reused from CompliancePage pattern) ────────────────

function ListGroupTreeMultiSelect({ selectedIds, onChange }: { selectedIds: number[]; onChange: (ids: number[]) => void }) {
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
    const selectedCount = allIds.filter((id) => selected.has(id)).length;
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
      next = new Set(selectedIds.filter((id) => !allIds.includes(id)));
    } else {
      next = new Set([...selectedIds, ...allIds]);
    }
    onChange(Array.from(next));
  };

  const toggleExpand = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const renderNode = (node: DeviceGroupTreeNode, depth: number) => {
    const hasChildren = node.children.length > 0;
    const isExpanded = expanded.has(node.id);
    const state = getCheckState(node);
    const count = node.total ?? node.deviceCount ?? 0;

    return (
      <div key={node.id}>
        <div
          className={clsx(
            'flex items-center gap-1.5 py-1.5 transition-colors rounded hover:bg-bg-hover',
            state === 'all' && 'bg-accent/5',
          )}
          style={{ paddingLeft: `${8 + depth * 20}px`, paddingRight: 8 }}
        >
          <button
            type="button"
            onClick={() => hasChildren && toggleExpand(node.id)}
            className={clsx('shrink-0 p-0.5 text-text-muted hover:text-text-primary transition-colors', !hasChildren && 'invisible')}
          >
            <ChevronRight className={clsx('w-3 h-3 transition-transform', isExpanded && 'rotate-90')} />
          </button>
          <button
            type="button"
            onClick={() => toggleNode(node)}
            className={clsx(
              'w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors',
              state === 'all' ? 'bg-accent border-accent text-white' :
              state === 'some' ? 'bg-accent/30 border-accent text-white' :
              'border-border hover:border-accent/50',
            )}
          >
            {state === 'all' && <Check className="w-3 h-3" />}
            {state === 'some' && <Minus className="w-3 h-3" />}
          </button>
          <FolderOpen className={clsx('w-3.5 h-3.5 shrink-0', state !== 'none' ? 'text-accent' : 'text-text-muted')} />
          <span
            className={clsx(
              'flex-1 text-sm truncate cursor-pointer',
              state !== 'none' ? 'text-text-primary font-medium' : 'text-text-primary',
            )}
            onClick={() => toggleNode(node)}
          >
            {node.name}
          </span>
          <span className="text-text-muted text-[10px] shrink-0">{count}</span>
        </div>
        {hasChildren && isExpanded && node.children.map((c: DeviceGroupTreeNode) => renderNode(c, depth + 1))}
      </div>
    );
  };

  return (
    <div className="max-h-48 overflow-y-auto border border-border rounded-lg bg-bg-tertiary p-1">
      {tree.length === 0 ? (
        <p className="text-xs text-text-muted p-2">No groups</p>
      ) : tree.map((n) => renderNode(n, 0))}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function SoftwareCompliancePage({ embedded }: { embedded?: boolean } = {}) {
  const { t } = useTranslation();
  const { isAdmin } = useAuthStore();
  const deviceMap = useDeviceStore(s => s.devices);
  const devices = Array.from(deviceMap.values());
  const [activeTab, setActiveTab] = useState<Tab>('results');
  const [lists, setLists] = useState<SoftwareComplianceList[]>([]);
  const [results, setResults] = useState<SoftwareComplianceResult[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterDeviceId, setFilterDeviceId] = useState<number | ''>('');
  const [showForm, setShowForm] = useState(false);
  const [editingList, setEditingList] = useState<SoftwareComplianceList | null>(null);
  const [form, setForm] = useState<ListFormData>(defaultListForm);
  const [isSaving, setIsSaving] = useState(false);
  const [expandedResultId, setExpandedResultId] = useState<number | null>(null);
  const [remediatingEntries, setRemediatingEntries] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [listsData, resultsData] = await Promise.all([
        softwareComplianceApi.listLists(),
        softwareComplianceApi.listResults({ page: 1 }),
      ]);
      setLists(listsData);
      setResults(resultsData.items);
    } catch {
      toast.error(t('softwareCompliance.failedLoad'));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  const loadResults = useCallback(async (deviceId?: number) => {
    setIsLoading(true);
    try {
      const resultsData = await softwareComplianceApi.listResults({ page: 1, deviceId });
      setResults(resultsData.items);
    } catch {
      toast.error(t('softwareCompliance.failedLoad'));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    loadResults(filterDeviceId !== '' ? filterDeviceId : undefined);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterDeviceId]);

  // ── List CRUD ─────────────────────────────────────────────────────────────

  const handleOpenCreate = () => {
    setForm(defaultListForm);
    setEditingList(null);
    setShowForm(true);
  };

  const handleOpenEdit = (list: SoftwareComplianceList) => {
    setForm({
      name: list.name,
      description: list.description ?? '',
      listType: list.listType,
      targetType: list.targetType,
      targetIds: list.targetIds ?? [],
      targetPlatform: list.targetPlatform ?? 'all',
      autoRemediate: list.autoRemediate,
      enabled: list.enabled,
      entries: (list.entries ?? []).map(e => ({
        name: e.name,
        matchType: e.matchType,
        publisher: e.publisher ?? '',
        minVersion: e.minVersion ?? '',
        maxVersion: e.maxVersion ?? '',
        installSource: e.installSource ?? '',
        installId: e.installId ?? '',
        installScript: e.installScript ?? '',
      })),
    });
    setEditingList(list);
    setShowForm(true);
    setActiveTab('lists');
  };

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error(t('softwareCompliance.nameRequired')); return; }
    setIsSaving(true);
    try {
      const entries: Omit<SoftwareComplianceEntry, 'id' | 'listId'>[] = form.entries.map((e, i) => ({
        name: e.name,
        matchType: e.matchType,
        publisher: e.publisher || null,
        minVersion: e.minVersion || null,
        maxVersion: e.maxVersion || null,
        installSource: (e.installSource || null) as SoftwareInstallSource | null,
        installId: e.installId || null,
        installScript: e.installScript || null,
        sortOrder: i,
      }));
      const payload = {
        name: form.name,
        description: form.description || null,
        listType: form.listType,
        targetType: form.targetType,
        targetIds: form.targetIds,
        targetPlatform: form.targetPlatform,
        autoRemediate: form.autoRemediate,
        enabled: form.enabled,
        entries,
      };
      if (editingList) {
        await softwareComplianceApi.updateList(editingList.id, payload as any);
        toast.success(t('softwareCompliance.listUpdated'));
      } else {
        await softwareComplianceApi.createList(payload as any);
        toast.success(t('softwareCompliance.listCreated'));
      }
      setShowForm(false);
      setEditingList(null);
      await load();
    } catch {
      toast.error(t('softwareCompliance.failedSave'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm(t('softwareCompliance.confirmDelete'))) return;
    try {
      await softwareComplianceApi.deleteList(id);
      toast.success(t('softwareCompliance.listDeleted'));
      await load();
    } catch {
      toast.error(t('softwareCompliance.failedDelete'));
    }
  };

  const handleToggleEnabled = async (list: SoftwareComplianceList) => {
    try {
      await softwareComplianceApi.updateList(list.id, { enabled: !list.enabled });
      toast.success(list.enabled ? t('softwareCompliance.listDisabled') : t('softwareCompliance.listEnabled'));
      await load();
    } catch {
      toast.error(t('softwareCompliance.failedSave'));
    }
  };

  // ── Remediation ────────────────────────────────────────────────────────────

  const handleRemediate = async (deviceId: number, listId: number, entryIds: number[]) => {
    const keys = entryIds.map(id => `${deviceId}:${listId}:${id}`);
    setRemediatingEntries(prev => { const s = new Set(prev); keys.forEach(k => s.add(k)); return s; });
    try {
      await softwareComplianceApi.remediate(deviceId, listId, entryIds);
      toast.success(t('softwareCompliance.remediationSent', { count: entryIds.length }));
    } catch {
      toast.error(t('softwareCompliance.remediationFailed'));
    } finally {
      setRemediatingEntries(prev => { const s = new Set(prev); keys.forEach(k => s.delete(k)); return s; });
    }
  };

  const handleRemediateAll = async (result: SoftwareComplianceResult) => {
    const failingEntryIds = result.results
      .filter(er => er.status === 'non_compliant')
      .map(er => er.entryId);
    if (failingEntryIds.length === 0) { toast.error(t('softwareCompliance.noRemediable')); return; }
    await handleRemediate(result.deviceId, result.listId, failingEntryIds);
  };

  const handleTriggerCheck = async (deviceId: number, listId?: number) => {
    try {
      await softwareComplianceApi.triggerCheck(deviceId, listId);
      toast.success(t('softwareCompliance.checkTriggered'));
    } catch {
      toast.error(t('softwareCompliance.checkFailed'));
    }
  };

  // ── Entry CRUD ────────────────────────────────────────────────────────────

  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showKnownApps, setShowKnownApps] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!showAddMenu) return;
    const handler = (e: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) setShowAddMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showAddMenu]);

  const addEntry = () => setForm(f => ({ ...f, entries: [...f.entries, makeEmptyEntry()] }));
  const addEntryFromApp = (app: KnownSoftwareApp) => {
    setForm(f => ({ ...f, entries: [...f.entries, makeEntryFromKnownApp(app)] }));
  };
  const updateEntry = (index: number, entry: EntryFormData) =>
    setForm(f => ({ ...f, entries: f.entries.map((e, i) => i === index ? entry : e) }));
  const deleteEntry = (index: number) =>
    setForm(f => ({ ...f, entries: f.entries.filter((_, i) => i !== index) }));
  const moveEntry = (index: number, direction: -1 | 1) => {
    setForm(f => {
      const entries = [...f.entries];
      const target = index + direction;
      if (target < 0 || target >= entries.length) return f;
      [entries[index], entries[target]] = [entries[target], entries[index]];
      return { ...f, entries };
    });
  };

  // ── Summary ────────────────────────────────────────────────────────────────

  const avgScore = results.length > 0
    ? results.reduce((sum, r) => sum + r.complianceScore, 0) / results.length
    : null;
  const passingCount = results.filter(r => r.complianceScore >= 80).length;
  const warningCount = results.filter(r => r.complianceScore >= 50 && r.complianceScore < 80).length;
  const failingCount = results.filter(r => r.complianceScore < 50).length;

  return (
    <div className={embedded ? 'space-y-6' : 'p-6 space-y-6'}>
      {/* Header */}
      {!embedded && <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">{t('softwareCompliance.title')}</h1>
          <p className="text-sm text-text-muted mt-0.5">{t('softwareCompliance.description')}</p>
        </div>
        <button onClick={load} className="p-2 text-text-muted hover:text-text-primary hover:bg-bg-secondary rounded-lg transition-colors">
          <RefreshCw className={clsx('w-4 h-4', isLoading && 'animate-spin')} />
        </button>
      </div>}

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-4 bg-bg-secondary border border-border rounded-xl">
          <div className="flex items-center gap-3">
            <div className={clsx('p-2 rounded-lg', avgScore !== null ? (avgScore >= 80 ? 'bg-green-400/10' : avgScore >= 50 ? 'bg-yellow-400/10' : 'bg-red-400/10') : 'bg-bg-tertiary')}>
              <Activity className={clsx('w-4 h-4', avgScore !== null ? scoreColor(avgScore) : 'text-text-muted')} />
            </div>
            <div>
              <p className={clsx('text-xl font-bold', avgScore !== null ? scoreColor(avgScore) : 'text-text-muted')}>
                {avgScore !== null ? `${avgScore.toFixed(0)}%` : '\u2014'}
              </p>
              <p className="text-xs text-text-muted">{t('softwareCompliance.avgScore')}</p>
            </div>
          </div>
        </div>
        <div className="p-4 bg-bg-secondary border border-border rounded-xl flex items-center gap-3">
          <div className="p-2 rounded-lg bg-green-400/10"><CheckCircle className="w-4 h-4 text-green-400" /></div>
          <div>
            <p className="text-xl font-bold text-text-primary">{passingCount}</p>
            <p className="text-xs text-text-muted">{t('softwareCompliance.passing')}</p>
          </div>
        </div>
        <div className="p-4 bg-bg-secondary border border-border rounded-xl flex items-center gap-3">
          <div className="p-2 rounded-lg bg-yellow-400/10"><AlertTriangle className="w-4 h-4 text-yellow-400" /></div>
          <div>
            <p className="text-xl font-bold text-text-primary">{warningCount}</p>
            <p className="text-xs text-text-muted">{t('softwareCompliance.warning')}</p>
          </div>
        </div>
        <div className="p-4 bg-bg-secondary border border-border rounded-xl flex items-center gap-3">
          <div className="p-2 rounded-lg bg-red-400/10"><XCircle className="w-4 h-4 text-red-400" /></div>
          <div>
            <p className="text-xl font-bold text-text-primary">{failingCount}</p>
            <p className="text-xs text-text-muted">{t('softwareCompliance.failing')}</p>
          </div>
        </div>
      </div>

      {/* Tabs + filter */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-1 rounded-lg bg-bg-secondary p-1 border border-border">
          {(['results', 'lists'] as Tab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={clsx(
                'flex-1 px-4 py-2 text-sm font-medium rounded-md transition-colors',
                activeTab === tab ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary',
              )}
            >
              {tab === 'results' ? t('softwareCompliance.tabResults') : t('softwareCompliance.tabLists')}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {activeTab === 'results' && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-secondary border border-border rounded-lg">
              <Monitor className="w-3.5 h-3.5 text-text-muted shrink-0" />
              <select
                value={filterDeviceId}
                onChange={(e) => setFilterDeviceId(e.target.value === '' ? '' : parseInt(e.target.value))}
                className="text-sm bg-transparent text-text-primary focus:outline-none min-w-[120px]"
              >
                <option value="">{t('softwareCompliance.allDevices')}</option>
                {devices.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.displayName || d.hostname}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* ── Results tab ── */}
      {activeTab === 'results' && (
        <div className="space-y-3">
          {isLoading ? (
            <div className="flex items-center justify-center h-48">
              <RefreshCw className="w-5 h-5 animate-spin text-text-muted" />
            </div>
          ) : results.length === 0 ? (
            <div className="p-12 text-center text-text-muted bg-bg-secondary border border-border rounded-xl">
              <ShieldCheck className="w-10 h-10 mx-auto mb-3 opacity-50" />
              <p className="font-medium text-text-primary mb-1">{t('softwareCompliance.noResults')}</p>
              <p className="text-sm">{t('softwareCompliance.noResultsDesc')}</p>
            </div>
          ) : results.map((result) => {
            const expanded = expandedResultId === result.id;
            const ScoreIcon = scoreIcon(result.complianceScore);
            const compliantCount = result.results.filter(r => r.status === 'compliant').length;
            const nonCompliantCount = result.results.filter(r => r.status === 'non_compliant').length;
            const total = result.results.length;

            return (
              <div key={result.id} className="bg-bg-secondary border border-border rounded-xl overflow-hidden">
                <div
                  className="flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-bg-tertiary transition-colors"
                  onClick={() => setExpandedResultId(expanded ? null : result.id)}
                >
                  <div className={clsx('p-2 rounded-lg', result.complianceScore >= 80 ? 'bg-green-400/10' : result.complianceScore >= 50 ? 'bg-yellow-400/10' : 'bg-red-400/10')}>
                    <ScoreIcon className={clsx('w-4 h-4', scoreColor(result.complianceScore))} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="flex items-center gap-1.5">
                        <Monitor className="w-3.5 h-3.5 text-text-muted shrink-0" />
                        <span className="text-sm font-medium text-text-primary">
                          {result.deviceName ?? t('softwareCompliance.deviceId', { id: result.deviceId })}
                        </span>
                      </div>
                      {result.list && (
                        <>
                          <span className={clsx(
                            'text-xs px-2 py-0.5 rounded-full border font-medium',
                            result.list.listType === 'whitelist'
                              ? 'text-green-400 bg-green-400/10 border-green-400/30'
                              : 'text-red-400 bg-red-400/10 border-red-400/30',
                          )}>
                            {result.list.listType}
                          </span>
                          <span className="text-xs px-2 py-0.5 bg-bg-tertiary border border-border rounded-full text-text-muted">
                            {result.list.name}
                          </span>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      <div className="flex-1 max-w-48 h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
                        <div
                          className={clsx('h-full rounded-full transition-all', scoreBg(result.complianceScore))}
                          style={{ width: `${result.complianceScore}%` }}
                        />
                      </div>
                      <span className={clsx('text-sm font-bold', scoreColor(result.complianceScore))}>
                        {result.complianceScore.toFixed(0)}%
                      </span>
                      <span className="text-xs text-text-muted">
                        {compliantCount}/{total} compliant
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-text-muted hidden sm:block">
                      {new Date(result.checkedAt).toLocaleDateString()}
                    </span>
                    {nonCompliantCount > 0 && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleRemediateAll(result); }}
                        className="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-lg bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 transition-colors"
                        title={t('softwareCompliance.fixAll')}
                      >
                        <Wrench className="w-3 h-3" />
                        {t('softwareCompliance.fixAll')}
                      </button>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleTriggerCheck(result.deviceId, result.listId); }}
                      className="p-1.5 text-text-muted hover:text-accent hover:bg-bg-tertiary rounded transition-colors"
                      title={t('softwareCompliance.rerun')}
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                    {expanded ? <ChevronUp className="w-4 h-4 text-text-muted" /> : <ChevronDown className="w-4 h-4 text-text-muted" />}
                  </div>
                </div>

                {expanded && result.results.length > 0 && (() => {
                  const nonCompliant = result.results.filter(er => er.status === 'non_compliant');
                  return (
                    <div className="border-t border-border bg-bg-tertiary/50">
                      {nonCompliant.length > 0 && (
                        <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-bg-tertiary/80">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleRemediateAll(result); }}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 transition-colors"
                          >
                            <Wrench className="w-3.5 h-3.5" />
                            {t('softwareCompliance.remediateAllCount', { count: nonCompliant.length })}
                          </button>
                        </div>
                      )}
                      <div className="divide-y divide-border">
                        {result.results.map((er) => {
                          const isRemediating = remediatingEntries.has(`${result.deviceId}:${result.listId}:${er.entryId}`);
                          return (
                            <div key={er.entryId} className="flex items-start gap-3 px-4 py-2.5">
                              <div className="shrink-0 mt-0.5">
                                {entryStatusIcon(er.status)}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium text-text-primary">
                                  {er.entryName}
                                </p>
                                {er.matchedSoftware && (
                                  <p className="text-xs text-text-muted mt-0.5">
                                    {t('softwareCompliance.matched')}: <span className="font-mono">{er.matchedSoftware}</span>
                                    {er.matchedVersion && <span className="ml-1">v{er.matchedVersion}</span>}
                                  </p>
                                )}
                                {er.detail && (
                                  <p className="text-xs text-text-muted/60 mt-0.5">{er.detail}</p>
                                )}
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                {er.remediationTriggered && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                                    {t('softwareCompliance.remediatedBadge')}
                                  </span>
                                )}
                                <span className={clsx('text-xs font-medium', entryStatusColor(er.status))}>
                                  {er.status.replace('_', ' ')}
                                </span>
                                {er.status === 'non_compliant' && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleRemediate(result.deviceId, result.listId, [er.entryId]); }}
                                    disabled={isRemediating}
                                    className="p-1 text-accent hover:bg-accent/10 rounded transition-colors disabled:opacity-50"
                                    title={t('softwareCompliance.remediate')}
                                  >
                                    <Wrench className={clsx('w-3.5 h-3.5', isRemediating && 'animate-spin')} />
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Lists tab ── */}
      {activeTab === 'lists' && (
        <div className="space-y-4">
          {/* List form */}
          {showForm && (
            <div className="bg-bg-secondary border border-border rounded-xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-text-primary">
                  {editingList ? t('softwareCompliance.editList') : t('softwareCompliance.newList')}
                </h2>
                <div className="flex gap-2">
                  <button
                    onClick={() => { setShowForm(false); setEditingList(null); }}
                    className="px-4 py-2 text-sm text-text-muted hover:text-text-primary border border-border rounded-lg transition-colors"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={isSaving}
                    className="px-4 py-2 text-sm bg-accent text-white rounded-lg hover:bg-accent/80 disabled:opacity-50 transition-colors"
                  >
                    {isSaving ? t('common.saving') : t('common.save')}
                  </button>
                </div>
              </div>

              {/* Basic fields */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-text-muted uppercase">{t('softwareCompliance.listName')} *</label>
                  <input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder={t('softwareCompliance.listNamePlaceholder')}
                    className="w-full px-3 py-2 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-text-muted uppercase">{t('softwareCompliance.listTypeLabel')}</label>
                  <div className="flex gap-2">
                    {(['whitelist', 'blacklist'] as SoftwareListType[]).map((lt) => (
                      <button
                        key={lt}
                        type="button"
                        onClick={() => setForm({ ...form, listType: lt })}
                        className={clsx(
                          'flex-1 py-2 text-sm rounded-lg border transition-colors',
                          form.listType === lt
                            ? lt === 'whitelist' ? 'bg-green-400/10 border-green-400 text-green-400' : 'bg-red-400/10 border-red-400 text-red-400'
                            : 'border-border text-text-muted hover:border-accent/50',
                        )}
                      >
                        {t(`softwareCompliance.types.${lt}`)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-text-muted uppercase">{t('softwareCompliance.targetLabel')}</label>
                  <div className="flex gap-2">
                    {(['all', 'group'] as const).map((tt) => (
                      <button
                        key={tt}
                        type="button"
                        onClick={() => setForm({ ...form, targetType: tt, targetIds: [] })}
                        className={clsx(
                          'flex-1 py-2 text-sm rounded-lg border transition-colors',
                          form.targetType === tt ? 'bg-accent/10 border-accent text-accent' : 'border-border text-text-muted hover:border-accent/50',
                        )}
                      >
                        {tt === 'all' ? t('softwareCompliance.allDevices') : t('softwareCompliance.deviceGroup')}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-text-muted uppercase">{t('softwareCompliance.platform')}</label>
                  <div className="flex gap-1">
                    {PLATFORMS.map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setForm({ ...form, targetPlatform: p })}
                        className={clsx(
                          'flex-1 py-2 text-xs rounded-lg border transition-colors',
                          form.targetPlatform === p ? 'bg-accent/10 border-accent text-accent' : 'border-border text-text-muted hover:border-accent/50',
                        )}
                      >
                        {p === 'all' ? 'All' : p === 'macos' ? 'macOS' : p === 'freebsd' ? 'FreeBSD' : p.charAt(0).toUpperCase() + p.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1 md:col-span-2">
                  <label className="text-xs font-medium text-text-muted uppercase">{t('softwareCompliance.descriptionLabel')}</label>
                  <textarea
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    rows={2}
                    className="w-full px-3 py-2 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent resize-y"
                  />
                </div>
                {form.targetType === 'group' && (
                  <div className="space-y-1 md:col-span-2">
                    <label className="text-xs font-medium text-text-muted uppercase">{t('softwareCompliance.groups')}</label>
                    <ListGroupTreeMultiSelect
                      selectedIds={form.targetIds}
                      onChange={(ids) => setForm({ ...form, targetIds: ids })}
                    />
                  </div>
                )}
              </div>

              {/* Entries builder — card-based */}
              <div className="border-t border-border pt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-text-primary">
                    {t('softwareCompliance.entries')} <span className="text-text-muted font-normal">({form.entries.length})</span>
                  </h3>
                  <div className="relative" ref={addMenuRef}>
                    <button
                      onClick={() => setShowAddMenu(!showAddMenu)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-accent text-white rounded-lg hover:bg-accent/80 transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      {t('softwareCompliance.addApp')}
                      <ChevronDown className="w-3 h-3" />
                    </button>
                    {showAddMenu && (
                      <div className="absolute right-0 mt-1 w-48 bg-bg-primary border border-border rounded-lg shadow-xl z-30 overflow-hidden">
                        <button
                          onClick={() => { addEntry(); setShowAddMenu(false); }}
                          className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-text-primary hover:bg-bg-secondary transition-colors text-left"
                        >
                          <Plus className="w-3.5 h-3.5 text-text-muted" />
                          {t('softwareCompliance.customApp')}
                        </button>
                        <button
                          onClick={() => { setShowKnownApps(true); setShowAddMenu(false); }}
                          className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-text-primary hover:bg-bg-secondary transition-colors text-left border-t border-border"
                        >
                          <Package className="w-3.5 h-3.5 text-text-muted" />
                          {t('softwareCompliance.fromInventory')}
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {form.entries.length === 0 ? (
                  <p className="text-sm text-text-muted text-center py-8 bg-bg-tertiary/30 rounded-lg border border-dashed border-border">
                    {t('softwareCompliance.noEntries')}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {form.entries.map((entry, i) => (
                      <EntryEditorCard
                        key={i}
                        entry={entry}
                        index={i}
                        total={form.entries.length}
                        onChange={e => updateEntry(i, e)}
                        onDelete={() => deleteEntry(i)}
                        onMoveUp={() => moveEntry(i, -1)}
                        onMoveDown={() => moveEntry(i, 1)}
                        isBlacklist={form.listType === 'blacklist'}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Known Apps Modal */}
              <KnownAppsModal
                open={showKnownApps}
                onClose={() => setShowKnownApps(false)}
                onSelect={addEntryFromApp}
                platform={form.targetPlatform}
              />

              <div className="flex gap-4 pt-2 border-t border-border">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.enabled}
                    onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                    className="rounded"
                  />
                  <span className="text-sm text-text-primary">{t('softwareCompliance.listEnabledLabel')}</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.autoRemediate}
                    onChange={(e) => setForm({ ...form, autoRemediate: e.target.checked })}
                    className="rounded"
                  />
                  <span className="text-sm text-text-primary">{t('softwareCompliance.autoRemediateLabel')}</span>
                </label>
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <button
              onClick={handleOpenCreate}
              className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg hover:bg-accent/80 text-sm transition-colors"
            >
              <Plus className="w-4 h-4" />
              {t('softwareCompliance.newList')}
            </button>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center h-48">
              <RefreshCw className="w-5 h-5 animate-spin text-text-muted" />
            </div>
          ) : lists.length === 0 ? (
            <div className="p-12 text-center text-text-muted bg-bg-secondary border border-border rounded-xl">
              <ShieldCheck className="w-10 h-10 mx-auto mb-3 opacity-50" />
              <p className="font-medium text-text-primary mb-1">{t('softwareCompliance.noLists')}</p>
              <p className="text-sm">{t('softwareCompliance.noListsDesc')}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {lists.map((list) => (
                <div key={list.id} className="p-4 bg-bg-secondary border border-border rounded-xl">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-text-primary">{list.name}</span>
                        <span className={clsx(
                          'text-xs px-2 py-0.5 rounded-full border font-medium',
                          list.listType === 'whitelist'
                            ? 'text-green-400 bg-green-400/10 border-green-400/30'
                            : 'text-red-400 bg-red-400/10 border-red-400/30',
                        )}>
                          {list.listType}
                        </span>
                        {list.targetPlatform !== 'all' && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-bg-tertiary border border-border capitalize">
                            {list.targetPlatform === 'macos' ? 'macOS' : list.targetPlatform === 'freebsd' ? 'FreeBSD' : list.targetPlatform}
                          </span>
                        )}
                        <span className={clsx('text-xs px-2 py-0.5 rounded-full border font-medium',
                          list.enabled ? 'text-green-400 bg-green-400/10 border-green-400/30' : 'text-gray-400 bg-gray-400/10 border-gray-400/30')}>
                          {list.enabled ? t('softwareCompliance.enabled') : t('softwareCompliance.disabled')}
                        </span>
                        {list.autoRemediate && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-400/10 text-blue-400 border border-blue-400/30 font-medium">
                            {t('softwareCompliance.autoRemediate')}
                          </span>
                        )}
                      </div>
                      {list.description && (
                        <p className="text-xs text-text-muted mt-1">{list.description}</p>
                      )}
                      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-xs text-text-muted">
                        <span>{t('softwareCompliance.target')}: <span className="text-text-primary">
                          {list.targetType === 'all' ? t('softwareCompliance.allDevices') : `${list.targetIds?.length ?? 0} group(s)`}
                        </span></span>
                        <span>{t('softwareCompliance.entries')}: <span className="text-text-primary">{list.entries?.length ?? 0}</span></span>
                        <span>{t('softwareCompliance.created')}: <span className="text-text-primary">{new Date(list.createdAt).toLocaleDateString()}</span></span>
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button
                        onClick={() => handleToggleEnabled(list)}
                        className="p-1.5 text-text-muted hover:text-text-primary hover:bg-bg-tertiary rounded transition-colors"
                        title={list.enabled ? t('softwareCompliance.disable') : t('softwareCompliance.enable')}
                      >
                        {list.enabled
                          ? <ToggleRight className="w-5 h-5 text-accent" />
                          : <ToggleLeft className="w-5 h-5 text-text-muted" />
                        }
                      </button>
                      <button
                        onClick={() => handleOpenEdit(list)}
                        className="p-1.5 text-text-muted hover:text-text-primary hover:bg-bg-tertiary rounded transition-colors"
                        title={t('common.edit')}
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(list.id)}
                        className="p-1.5 text-text-muted hover:text-red-400 hover:bg-red-400/10 rounded transition-colors"
                        title={t('common.delete')}
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
