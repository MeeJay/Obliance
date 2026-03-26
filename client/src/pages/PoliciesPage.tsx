import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Package, ShieldCheck, BarChart3, Loader2 } from 'lucide-react';
import { UpdatesPage } from './UpdatesPage';
import { CompliancePage } from './CompliancePage';
import { updateApi } from '@/api/update.api';
import type { PatchComplianceReport } from '@obliance/shared';
import { clsx } from 'clsx';

type Tab = 'updates' | 'compliance' | 'patchReport';

// ─── Patch Report Tab ────────────────────────────────────────────────────────

function PatchReportTab() {
  const [report, setReport] = useState<PatchComplianceReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    updateApi.getComplianceReport().then(r => { setReport(r); setIsLoading(false); }).catch(() => setIsLoading(false));
  }, []);

  if (isLoading) return (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="w-6 h-6 animate-spin text-text-muted" />
    </div>
  );
  if (!report) return <div className="text-center text-text-muted py-12">No data available</div>;

  return (
    <div className="space-y-6">
      {/* Big number */}
      <div className="flex items-center gap-6">
        <div className="text-center">
          <div className={clsx('text-4xl font-bold tabular-nums', report.fullyPatchedPercent >= 80 ? 'text-green-400' : report.fullyPatchedPercent >= 50 ? 'text-yellow-400' : 'text-red-400')}>
            {report.fullyPatchedPercent.toFixed(0)}%
          </div>
          <div className="text-xs text-text-muted mt-1">Fleet Patch Compliance</div>
        </div>
        <div className="text-sm text-text-muted">
          {report.fullyPatchedDevices} / {report.totalDevices} devices fully patched
        </div>
      </div>

      {/* Severity bars */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {report.bySeverity.map(s => (
          <div key={s.severity} className="p-3 bg-bg-secondary border border-border rounded-xl">
            <div className="flex justify-between text-xs mb-1">
              <span className="text-text-muted capitalize">{s.severity}</span>
              <span className="font-medium">{s.percent.toFixed(0)}%</span>
            </div>
            <div className="h-2 bg-bg-tertiary rounded-full overflow-hidden">
              <div className={clsx('h-full rounded-full', s.percent >= 80 ? 'bg-green-400' : s.percent >= 50 ? 'bg-yellow-400' : 'bg-red-400')} style={{ width: `${s.percent}%` }} />
            </div>
            <div className="text-[10px] text-text-muted mt-1">{s.patched}/{s.total} devices</div>
          </div>
        ))}
      </div>

      {/* Per-group table */}
      {report.byGroup.length > 0 && (
        <div className="bg-bg-secondary border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border bg-bg-tertiary/50">
              <th className="text-left px-4 py-2 text-xs text-text-muted uppercase">Group</th>
              <th className="text-left px-4 py-2 text-xs text-text-muted uppercase">Devices</th>
              <th className="text-left px-4 py-2 text-xs text-text-muted uppercase">Patched</th>
              <th className="text-left px-4 py-2 text-xs text-text-muted uppercase">Compliance</th>
            </tr></thead>
            <tbody>{report.byGroup.map(g => (
              <tr key={g.groupId ?? 'ungrouped'} className="border-b border-border">
                <td className="px-4 py-2 text-text-primary">{g.groupName ?? 'Ungrouped'}</td>
                <td className="px-4 py-2 text-text-muted">{g.total}</td>
                <td className="px-4 py-2 text-text-muted">{g.patched}</td>
                <td className="px-4 py-2">
                  <div className="flex items-center gap-2">
                    <div className="w-20 h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
                      <div className={clsx('h-full rounded-full', g.percent >= 80 ? 'bg-green-400' : g.percent >= 50 ? 'bg-yellow-400' : 'bg-red-400')} style={{ width: `${g.percent}%` }} />
                    </div>
                    <span className="text-xs font-medium">{g.percent.toFixed(0)}%</span>
                  </div>
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {/* Per-update table (top 50) */}
      {report.byUpdate.length > 0 && (
        <div className="bg-bg-secondary border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border bg-bg-tertiary/50">
              <th className="text-left px-4 py-2 text-xs text-text-muted uppercase">Update</th>
              <th className="text-left px-4 py-2 text-xs text-text-muted uppercase">Severity</th>
              <th className="text-left px-4 py-2 text-xs text-text-muted uppercase">Devices</th>
              <th className="text-left px-4 py-2 text-xs text-text-muted uppercase">Patched</th>
            </tr></thead>
            <tbody>{report.byUpdate.map(u => (
              <tr key={u.updateUid} className="border-b border-border">
                <td className="px-4 py-2 text-text-primary truncate max-w-[300px]">{u.title}</td>
                <td className="px-4 py-2"><span className={clsx('text-xs capitalize', u.severity === 'critical' ? 'text-red-400' : u.severity === 'important' ? 'text-orange-400' : 'text-text-muted')}>{u.severity}</span></td>
                <td className="px-4 py-2 text-text-muted">{u.totalDevices}</td>
                <td className="px-4 py-2">
                  <span className={clsx('text-xs font-medium', u.percent >= 80 ? 'text-green-400' : u.percent >= 50 ? 'text-yellow-400' : 'text-red-400')}>
                    {u.patchedDevices}/{u.totalDevices} ({u.percent.toFixed(0)}%)
                  </span>
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Policies Page ───────────────────────────────────────────────────────────

export function PoliciesPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('updates');

  const tabs: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
    { id: 'updates', label: t('policies.tabUpdates'), icon: <Package size={16} /> },
    { id: 'compliance', label: t('policies.tabCompliance'), icon: <ShieldCheck size={16} /> },
    { id: 'patchReport', label: 'Patch Report', icon: <BarChart3 size={16} /> },
  ];

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold text-text-primary">{t('policies.title')}</h1>
      <div className="flex items-center gap-1 rounded-lg bg-bg-secondary p-1 border border-border">
        {tabs.map((t2) => (
          <button
            key={t2.id}
            onClick={() => setTab(t2.id)}
            className={clsx(
              'flex items-center gap-2 flex-1 px-4 py-2 text-sm font-medium rounded-md transition-colors justify-center',
              tab === t2.id ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary',
            )}
          >
            {t2.icon}
            {t2.label}
          </button>
        ))}
      </div>
      {tab === 'updates' && <UpdatesPage embedded />}
      {tab === 'compliance' && <CompliancePage embedded />}
      {tab === 'patchReport' && <PatchReportTab />}
    </div>
  );
}
