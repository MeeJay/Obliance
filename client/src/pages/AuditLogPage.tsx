import { useEffect, useState, useCallback } from 'react';
import { FileText, RefreshCw, Search, ChevronDown, ChevronRight, Download, Filter } from 'lucide-react';
import { Link } from 'react-router-dom';
import { auditApi, type AuditLogRow, type AuditLogFilters } from '@/api/audit.api';
import toast from 'react-hot-toast';

// Tenant-wide audit log — "who did what when, and from which IP".
// Shown to admins only (route-level guard). Supports basic filters and a
// CSV export. Each row is collapsible to reveal the raw `details` JSON.

const PAGE_SIZE = 50;

function actionCategory(action: string): string {
  const root = action.split('.')[0];
  return root.charAt(0).toUpperCase() + root.slice(1);
}

function actionPill(action: string) {
  const root = action.split('.')[0];
  const isDestructive = /delete|refuse|suspend|denied|deleted/.test(action);
  const isSecurity = /auth|approval|permission|role/.test(action);
  const color =
    isDestructive ? 'bg-red-400/10 text-red-400 border-red-400/30' :
    isSecurity    ? 'bg-accent/10 text-accent border-accent/30' :
                    'bg-bg-tertiary text-text-secondary border-border';
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium border ${color} whitespace-nowrap`}>
      {action}
    </span>
  );
}

function Row({ row }: { row: AuditLogRow }) {
  const [open, setOpen] = useState(false);
  const hasDetails = row.details && Object.keys(row.details).length > 0;
  return (
    <>
      <tr
        className={`border-b border-border/30 hover:bg-bg-tertiary/30 ${hasDetails ? 'cursor-pointer' : ''}`}
        onClick={() => hasDetails && setOpen((v) => !v)}
      >
        <td className="px-2 py-1.5 text-[11px] text-text-muted whitespace-nowrap">
          <div className="flex items-center gap-1">
            {hasDetails ? (open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />) : <span className="w-3" />}
            {new Date(row.createdAt).toLocaleString()}
          </div>
        </td>
        <td className="px-2 py-1.5">{actionPill(row.action)}</td>
        <td className="px-2 py-1.5 text-xs text-text-primary">
          {row.username ? (
            <span>{row.username}</span>
          ) : (
            <span className="text-text-muted italic">system</span>
          )}
        </td>
        <td className="px-2 py-1.5 text-xs text-text-secondary">
          {row.deviceId ? (
            <Link to={`/devices/${row.deviceId}`} onClick={(e) => e.stopPropagation()} className="text-accent hover:underline">
              {row.deviceName || `#${row.deviceId}`}
            </Link>
          ) : (
            <span className="text-text-muted">—</span>
          )}
        </td>
        <td className="px-2 py-1.5 text-[11px] text-text-muted truncate max-w-[200px]" title={row.resourcePath || ''}>
          {row.resourceType ? `${row.resourceType}:${row.resourcePath}` : '—'}
        </td>
        <td className="px-2 py-1.5 text-[11px] text-text-muted font-mono">
          {row.ipAddress || '—'}
        </td>
      </tr>
      {open && hasDetails && (
        <tr className="bg-bg-primary/50 border-b border-border/30">
          <td colSpan={6} className="px-8 py-2">
            <pre className="text-[11px] text-text-secondary font-mono whitespace-pre-wrap break-all max-h-64 overflow-auto">
              {JSON.stringify(row.details, null, 2)}
            </pre>
          </td>
        </tr>
      )}
    </>
  );
}

export function AuditLogPage() {
  const [items, setItems] = useState<AuditLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [filters, setFilters] = useState<AuditLogFilters>({ limit: PAGE_SIZE, offset: 0 });
  const [actions, setActions] = useState<string[]>([]);
  const [search, setSearch] = useState('');

  const load = useCallback(async (spinner = true) => {
    if (spinner) setIsLoading(true);
    try {
      const { items, total } = await auditApi.list(filters);
      setItems(items);
      setTotal(total);
    } catch {
      toast.error('Failed to load audit log');
    } finally {
      if (spinner) setIsLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    // Load distinct action list once for the dropdown.
    auditApi.distinctActions().then(setActions).catch(() => {});
  }, []);

  const applySearch = () => {
    setFilters({ ...filters, search: search.trim() || undefined, offset: 0 });
  };

  const clearFilters = () => {
    setSearch('');
    setFilters({ limit: PAGE_SIZE, offset: 0 });
  };

  const exportCsv = () => {
    const header = ['When', 'Action', 'User', 'Device', 'Resource', 'IP', 'Details'];
    const rows = items.map((r) => [
      new Date(r.createdAt).toISOString(),
      r.action,
      r.username || '',
      r.deviceName || (r.deviceId ? `#${r.deviceId}` : ''),
      r.resourceType ? `${r.resourceType}:${r.resourcePath || ''}` : '',
      r.ipAddress || '',
      r.details ? JSON.stringify(r.details) : '',
    ]);
    const csv = [header, ...rows].map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const page = Math.floor((filters.offset ?? 0) / (filters.limit ?? PAGE_SIZE)) + 1;
  const pages = Math.max(1, Math.ceil(total / (filters.limit ?? PAGE_SIZE)));

  // Group distinct actions by root category for a tidy dropdown.
  const groupedActions: Record<string, string[]> = {};
  for (const a of actions) {
    const root = a.split('.')[0];
    if (!groupedActions[root]) groupedActions[root] = [];
    groupedActions[root].push(a);
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <FileText className="w-6 h-6 text-accent" />
          <div>
            <h1 className="text-xl font-semibold text-text-primary">Audit log</h1>
            <p className="text-sm text-text-muted">Who did what, when, and from where.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={exportCsv}
            disabled={items.length === 0}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded border border-border text-text-muted hover:text-text-primary hover:border-accent/40 transition-colors disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" /> CSV
          </button>
          <button
            onClick={() => load(true)}
            className="p-1.5 rounded border border-border text-text-muted hover:text-text-primary hover:border-accent/40"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-end gap-2 mb-4 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-[10px] uppercase text-text-muted mb-0.5">Search</label>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applySearch()}
              placeholder="path, details, username..."
              className="w-full pl-7 pr-2 py-1.5 text-xs bg-bg-secondary border border-border rounded text-text-primary"
            />
          </div>
        </div>
        <div>
          <label className="block text-[10px] uppercase text-text-muted mb-0.5">Action</label>
          <select
            value={filters.action || ''}
            onChange={(e) => setFilters({ ...filters, action: e.target.value || undefined, offset: 0 })}
            className="py-1.5 px-2 text-xs bg-bg-secondary border border-border rounded text-text-primary min-w-[180px]"
          >
            <option value="">All</option>
            {Object.entries(groupedActions).map(([root, acts]) => (
              <optgroup key={root} label={actionCategory(root)}>
                <option value={`${root}.`}>All {root}.*</option>
                {acts.map((a) => <option key={a} value={a}>{a}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[10px] uppercase text-text-muted mb-0.5">Since</label>
          <input
            type="datetime-local"
            value={filters.since?.slice(0, 16) || ''}
            onChange={(e) => setFilters({ ...filters, since: e.target.value ? new Date(e.target.value).toISOString() : undefined, offset: 0 })}
            className="py-1.5 px-2 text-xs bg-bg-secondary border border-border rounded text-text-primary"
          />
        </div>
        <div>
          <label className="block text-[10px] uppercase text-text-muted mb-0.5">Until</label>
          <input
            type="datetime-local"
            value={filters.until?.slice(0, 16) || ''}
            onChange={(e) => setFilters({ ...filters, until: e.target.value ? new Date(e.target.value).toISOString() : undefined, offset: 0 })}
            className="py-1.5 px-2 text-xs bg-bg-secondary border border-border rounded text-text-primary"
          />
        </div>
        <button
          onClick={applySearch}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-accent/40 bg-accent/10 text-accent hover:bg-accent/20"
        >
          <Filter className="w-3.5 h-3.5" /> Apply
        </button>
        <button
          onClick={clearFilters}
          className="text-xs px-2 py-1.5 rounded border border-border text-text-muted hover:text-text-primary"
        >
          Clear
        </button>
      </div>

      {/* Table */}
      <div className="rounded border border-border bg-bg-secondary overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-text-muted text-sm italic">Loading...</div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center text-text-muted text-sm italic">No audit entries match your filters.</div>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-border bg-bg-primary/40">
                <th className="px-2 py-1.5 text-left text-[10px] uppercase text-text-muted font-medium">When</th>
                <th className="px-2 py-1.5 text-left text-[10px] uppercase text-text-muted font-medium">Action</th>
                <th className="px-2 py-1.5 text-left text-[10px] uppercase text-text-muted font-medium">User</th>
                <th className="px-2 py-1.5 text-left text-[10px] uppercase text-text-muted font-medium">Device</th>
                <th className="px-2 py-1.5 text-left text-[10px] uppercase text-text-muted font-medium">Resource</th>
                <th className="px-2 py-1.5 text-left text-[10px] uppercase text-text-muted font-medium">IP</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => <Row key={row.id} row={row} />)}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {total > (filters.limit ?? PAGE_SIZE) && (
        <div className="flex items-center justify-between mt-3 text-xs text-text-muted">
          <span>{total} entries · page {page} of {pages}</span>
          <div className="flex items-center gap-1">
            <button
              disabled={page <= 1}
              onClick={() => setFilters({ ...filters, offset: Math.max(0, (filters.offset ?? 0) - (filters.limit ?? PAGE_SIZE)) })}
              className="px-2 py-1 rounded border border-border hover:text-text-primary disabled:opacity-30"
            >
              Prev
            </button>
            <button
              disabled={page >= pages}
              onClick={() => setFilters({ ...filters, offset: (filters.offset ?? 0) + (filters.limit ?? PAGE_SIZE) })}
              className="px-2 py-1 rounded border border-border hover:text-text-primary disabled:opacity-30"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
