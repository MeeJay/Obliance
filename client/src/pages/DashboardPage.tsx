import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Monitor, Wifi, WifiOff, AlertTriangle, AlertCircle, Clock, RefreshCw,
  ArrowRight, Package, ShieldCheck, CheckCircle2, ArrowUpCircle,
  FolderOpen, Users, Activity,
} from 'lucide-react';
import { useDeviceStore } from '@/store/deviceStore';
import { deviceApi, type GroupStats } from '@/api/device.api';
import { groupsApi } from '@/api/groups.api';
import type { DeviceGroupTreeNode } from '@obliance/shared';
import { useTranslation } from 'react-i18next';
import { anonymize } from '@/utils/anonymize';
import { clsx } from 'clsx';

function StatCard({ icon: Icon, label, value, color, to }: { icon: any; label: string; value: number; color: string; to?: string }) {
  const content = (
    <div className={`p-4 bg-bg-secondary border border-border rounded-xl flex items-center gap-4 hover:border-accent/50 transition-colors ${to ? 'cursor-pointer' : ''}`}>
      <div className={`p-3 rounded-lg ${color}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <p className="text-2xl font-bold text-text-primary">{value}</p>
        <p className="text-sm text-text-muted">{label}</p>
      </div>
    </div>
  );
  return to ? <Link to={to}>{content}</Link> : content;
}

function ComplianceBadge({ score }: { score: number | null }) {
  if (score === null) return <span className="text-xs text-text-muted">—</span>;
  const color = score >= 80 ? 'text-green-400' : score >= 50 ? 'text-yellow-400' : 'text-red-400';
  const bg = score >= 80 ? 'bg-green-400/10' : score >= 50 ? 'bg-yellow-400/10' : 'bg-red-400/10';
  return (
    <span className={clsx('text-xs font-semibold px-1.5 py-0.5 rounded', color, bg)}>
      {score.toFixed(0)}%
    </span>
  );
}

function GroupCard({ stats, wide }: { stats: GroupStats; wide?: boolean }) {
  const { t } = useTranslation();
  const name = anonymize(stats.groupName) || t('dashboard.ungrouped');
  const healthPercent = stats.total > 0 ? Math.round((stats.online / stats.total) * 100) : 0;
  const healthColor = healthPercent >= 80 ? 'text-green-400' : healthPercent >= 50 ? 'text-yellow-400' : 'text-red-400';
  const barColor = healthPercent >= 80 ? 'bg-green-400' : healthPercent >= 50 ? 'bg-yellow-400' : 'bg-red-400';

  if (wide) {
    return (
      <Link
        to={stats.groupId ? `/group/${stats.groupId}` : '/devices'}
        className="p-4 bg-bg-secondary border border-border rounded-xl hover:border-accent/50 transition-colors flex items-center gap-5"
      >
        {/* Name */}
        <div className="flex items-center gap-2 min-w-[160px]">
          <FolderOpen className="w-5 h-5 text-accent shrink-0" />
          <h3 className="text-sm font-semibold text-text-primary truncate">{name}</h3>
        </div>

        {/* Online / Total */}
        <div className="flex items-center gap-2 min-w-[100px]">
          <Wifi className="w-3.5 h-3.5 text-green-400 shrink-0" />
          <span className={clsx('text-sm font-semibold', healthColor)}>{stats.online}</span>
          <span className="text-xs text-text-muted">/ {stats.total}</span>
        </div>

        {/* Health bar */}
        <div className="flex-1 max-w-[200px]">
          <div className="h-2 bg-bg-tertiary rounded-full overflow-hidden">
            <div className={clsx('h-full rounded-full transition-all', barColor)} style={{ width: `${healthPercent}%` }} />
          </div>
        </div>

        {/* Alerts */}
        <div className="flex items-center gap-3 text-xs min-w-[100px]">
          {stats.warning > 0 && <span className="flex items-center gap-1 text-yellow-400"><AlertTriangle className="w-3 h-3" />{stats.warning}</span>}
          {stats.critical > 0 && <span className="flex items-center gap-1 text-red-400"><AlertCircle className="w-3 h-3" />{stats.critical}</span>}
          {stats.warning === 0 && stats.critical === 0 && <span className="text-text-muted">—</span>}
        </div>

        {/* Compliance */}
        <div className="flex items-center gap-1.5 text-xs min-w-[80px]">
          <ShieldCheck className="w-3.5 h-3.5 text-text-muted shrink-0" />
          <ComplianceBadge score={stats.complianceScore} />
          {stats.policyCount > 0 && <span className="text-text-muted">({stats.policyCount})</span>}
        </div>

        {/* Updates */}
        <div className="flex items-center gap-1 text-xs min-w-[50px]">
          {stats.pendingUpdates > 0 ? (
            <span className="flex items-center gap-1 text-orange-400"><Package className="w-3 h-3" />{stats.pendingUpdates}</span>
          ) : (
            <span className="text-text-muted">—</span>
          )}
        </div>
      </Link>
    );
  }

  return (
    <Link
      to={stats.groupId ? `/group/${stats.groupId}` : '/devices'}
      className="p-3 bg-bg-secondary border border-border rounded-lg hover:border-accent/50 transition-colors space-y-2"
    >
      <div className="flex items-center gap-2">
        <FolderOpen className="w-3.5 h-3.5 text-accent shrink-0" />
        <h3 className="text-xs font-semibold text-text-primary truncate flex-1">{name}</h3>
        <span className={clsx('text-xs font-medium', healthColor)}>{stats.online}/{stats.total}</span>
      </div>
      <div className="h-1 bg-bg-tertiary rounded-full overflow-hidden">
        <div className={clsx('h-full rounded-full', barColor)} style={{ width: `${healthPercent}%` }} />
      </div>
      <div className="flex items-center gap-2 text-[10px]">
        {stats.warning > 0 && <span className="text-yellow-400">{stats.warning}w</span>}
        {stats.critical > 0 && <span className="text-red-400">{stats.critical}c</span>}
        <span className="flex-1" />
        <ShieldCheck className="w-2.5 h-2.5 text-text-muted" />
        <ComplianceBadge score={stats.complianceScore} />
        {stats.pendingUpdates > 0 && <span className="text-orange-400"><Package className="w-2.5 h-2.5 inline" /> {stats.pendingUpdates}</span>}
      </div>
    </Link>
  );
}

export function DashboardPage() {
  const { t } = useTranslation();
  const { fetchDevices, summary, fetchSummary } = useDeviceStore();
  const [isLoading, setIsLoading] = useState(true);
  const [groupStats, setGroupStats] = useState<GroupStats[]>([]);
  const [groupTree, setGroupTree] = useState<DeviceGroupTreeNode[]>([]);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      await Promise.all([
        fetchDevices(),
        fetchSummary(),
        deviceApi.getGroupStats().then(setGroupStats).catch(() => {}),
        groupsApi.tree().then(setGroupTree).catch(() => {}),
      ]);
      setIsLoading(false);
    };
    load();
  }, [fetchDevices, fetchSummary]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-6 h-6 animate-spin text-text-muted" />
      </div>
    );
  }

  const s = summary;

  // Build a lookup map groupId → stats (direct devices only)
  const directStatsMap = new Map<number | null, GroupStats>();
  for (const gs of groupStats) directStatsMap.set(gs.groupId, gs);

  // Compute aggregated stats for a group (its own devices + all descendants)
  const emptyStats = (id: number | null, name: string | null): GroupStats => ({
    groupId: id, groupName: name, online: 0, offline: 0, warning: 0, critical: 0,
    total: 0, complianceScore: null, policyCount: 0, pendingUpdates: 0,
  });

  const computeAggregatedStats = (node: DeviceGroupTreeNode): GroupStats => {
    const own = directStatsMap.get(node.id);
    const agg = emptyStats(node.id, node.name);

    // Add own direct devices
    if (own) {
      agg.online += own.online; agg.offline += own.offline;
      agg.warning += own.warning; agg.critical += own.critical;
      agg.total += own.total; agg.pendingUpdates += own.pendingUpdates;
      agg.policyCount += own.policyCount;
    }

    // Recursively add children
    const childAggs: GroupStats[] = [];
    for (const child of node.children) {
      const childAgg = computeAggregatedStats(child);
      childAggs.push(childAgg);
      agg.online += childAgg.online; agg.offline += childAgg.offline;
      agg.warning += childAgg.warning; agg.critical += childAgg.critical;
      agg.total += childAgg.total; agg.pendingUpdates += childAgg.pendingUpdates;
      agg.policyCount = Math.max(agg.policyCount, childAgg.policyCount);
    }

    // Average compliance across all non-null scores
    const scores = [own?.complianceScore, ...childAggs.map(c => c.complianceScore)].filter((s): s is number => s !== null);
    agg.complianceScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length * 10) / 10 : null;

    return agg;
  };

  // Recursive render: groups with children = wide, leaf groups = small grid
  const renderGroupNode = (node: DeviceGroupTreeNode, depth: number): React.ReactNode => {
    const hasChildren = node.children.length > 0;
    const aggStats = computeAggregatedStats(node);

    if (!hasChildren) {
      // Leaf — rendered as small card by parent's grid
      return null; // handled in parent
    }

    // Node with children — wide card + recurse
    const leafChildren = node.children.filter(c => c.children.length === 0);
    const branchChildren = node.children.filter(c => c.children.length > 0);

    return (
      <div key={node.id} className="space-y-2" style={{ marginLeft: depth > 0 ? 16 : 0 }}>
        <GroupCard stats={aggStats} wide />

        {/* Branch children (have sub-groups) — recurse */}
        {branchChildren.map(child => renderGroupNode(child, depth + 1))}

        {/* Leaf children (no sub-groups) — small grid */}
        {leafChildren.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 pl-4 border-l-2 border-accent/20 ml-2">
            {leafChildren.map(child => {
              const childStats = computeAggregatedStats(child);
              return <GroupCard key={child.id} stats={childStats} />;
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-text-primary">{t('dashboard.title')}</h1>
        <Link
          to="/devices"
          className="flex items-center gap-2 text-sm text-accent hover:text-accent/80 transition-colors"
        >
          {t('dashboard.viewAll')}
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatCard icon={Monitor} label="Total" value={s?.total ?? 0} color="bg-blue-500/20 text-blue-400" to="/devices" />
        <StatCard icon={Wifi} label="Online" value={s?.online ?? 0} color="bg-green-500/20 text-green-400" to="/devices?status=online" />
        <StatCard icon={WifiOff} label="Offline" value={s?.offline ?? 0} color="bg-gray-500/20 text-gray-400" to="/devices?status=offline" />
        <StatCard icon={AlertTriangle} label="Warning" value={s?.warning ?? 0} color="bg-yellow-500/20 text-yellow-400" to="/devices?status=warning" />
        <StatCard icon={AlertCircle} label="Critical" value={s?.critical ?? 0} color="bg-red-500/20 text-red-400" to="/devices?status=critical" />
        <StatCard icon={Clock} label="Pending" value={s?.pending ?? 0} color="bg-purple-500/20 text-purple-400" to="/admin/devices" />
      </div>

      {/* Quick stats row */}
      {s && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 bg-bg-secondary border border-border rounded-xl flex items-center gap-4">
            <div className="p-3 rounded-lg bg-orange-500/20 text-orange-400">
              <Package className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xl font-bold text-text-primary">{s.pendingUpdates}</p>
              <p className="text-sm text-text-muted">{t('dashboard.pendingUpdates')}</p>
            </div>
            <Link to="/policies?tab=updates" className="ml-auto text-sm text-accent hover:text-accent/80">{t('dashboard.manage')} →</Link>
          </div>

          <div className="p-4 bg-bg-secondary border border-border rounded-xl flex items-center gap-4">
            <div className={`p-3 rounded-lg ${s.agentOutdated === 0 ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'}`}>
              <ArrowUpCircle className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-green-400 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {s.agentUpToDate}
                </span>
                {s.agentOutdated > 0 && (
                  <span className="text-sm font-medium text-yellow-400 flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    {s.agentOutdated}
                  </span>
                )}
              </div>
              <p className="text-sm text-text-muted">
                Agent v{s.latestAgentVersion}
                {s.agentOutdated > 0 ? ` · ${s.agentOutdated} outdated` : ` · ${t('dashboard.allUpToDate')}`}
              </p>
            </div>
          </div>

          {s.complianceScore !== null && (
            <div className="p-4 bg-bg-secondary border border-border rounded-xl flex items-center gap-4">
              <div className={`p-3 rounded-lg ${s.complianceScore >= 80 ? 'bg-green-500/20 text-green-400' : s.complianceScore >= 50 ? 'bg-yellow-500/20 text-yellow-400' : 'bg-red-500/20 text-red-400'}`}>
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xl font-bold text-text-primary">{s.complianceScore.toFixed(0)}%</p>
                <p className="text-sm text-text-muted">{t('dashboard.complianceScore')}</p>
              </div>
              <Link to="/compliance" className="ml-auto text-sm text-accent hover:text-accent/80">{t('dashboard.view')} →</Link>
            </div>
          )}
        </div>
      )}

      {/* Group overview */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-text-primary flex items-center gap-2">
            <Activity className="w-4 h-4 text-text-muted" />
            {t('dashboard.groupOverview')}
          </h2>
          <Link to="/admin/devices?tab=groups" className="text-sm text-accent hover:text-accent/80">{t('dashboard.manageGroups')} →</Link>
        </div>
        {groupStats.length === 0 ? (
          <div className="p-8 text-center text-text-muted bg-bg-secondary border border-border rounded-xl">
            <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>{t('dashboard.noGroups')}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {groupTree.map((root) => {
              const hasChildren = root.children.length > 0;
              if (hasChildren) {
                return renderGroupNode(root, 0);
              }
              // Root without children — show as wide card
              const aggStats = computeAggregatedStats(root);
              return <GroupCard key={root.id} stats={aggStats} wide />;
            })}

            {/* Ungrouped devices */}
            {directStatsMap.get(null) && <GroupCard stats={directStatsMap.get(null)!} wide />}
          </div>
        )}
      </div>
    </div>
  );
}
