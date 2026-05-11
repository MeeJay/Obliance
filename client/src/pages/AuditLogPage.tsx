import { useEffect, useState, useCallback, useRef } from 'react';
import { FileText, RefreshCw, Search, ChevronDown, ChevronRight, Download, Filter, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { clsx } from 'clsx';
import { auditApi, type AuditLogRow, type AuditLogFilters } from '@/api/audit.api';
import { usersApi } from '@/api/users.api';
import type { User } from '@obliance/shared';
import { TenantBadge } from '@/components/common/TenantBadge';
import { TenantFilterChips } from '@/components/common/TenantFilterChips';
import { useTenantFilter } from '@/hooks/useTenantFilter';
import { useIsMasterTenant } from '@/hooks/useIsMasterTenant';
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
 const isDestructive = /delete|refuse|suspend|denied|deleted/.test(action);
 const isSecurity = /auth|approval|permission|role/.test(action);
 const color =
 isDestructive ? 'bg-red-400/10 text-red-400 border-red-400/30' :
 isSecurity ? 'bg-accent/10 text-accent border-accent/30' :
 'bg-bg-tertiary text-text-secondary border-transparent';
 return (
 <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium border ${color} whitespace-nowrap`}>
 {action}
 </span>
 );
}

function Row({ row, isMaster }: { row: AuditLogRow; isMaster: boolean }) {
 const [open, setOpen] = useState(false);
 const hasDetails = row.details && Object.keys(row.details).length > 0;
 // Tenant column adds a 7th td when present, so keep colSpan in sync.
 const colSpan = isMaster ? 7 : 6;
 return (
 <>
 <tr
 className={`/30 hover:bg-bg-tertiary/30 ${hasDetails ? 'cursor-pointer' : ''}`}
 onClick={() => hasDetails && setOpen((v) => !v)}
 >
 <td className="px-2 py-1.5 text-[11px] text-text-muted whitespace-nowrap">
 <div className="flex items-center gap-1">
 {hasDetails ? (open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />) : <span className="w-3" />}
 {new Date(row.createdAt).toLocaleString()}
 </div>
 </td>
 {isMaster && (
 <td className="px-2 py-1.5">
 <TenantBadge tenantId={row.tenantId} tenantName={row.tenantName} />
 </td>
 )}
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
 <td className="px-2 py-1.5 text-[11px] truncate max-w-[260px]" title={row.resourceType ? `${row.resourceType}:${row.resourcePath}` : ''}>
 {row.resourceType ? (
 <span className="inline-flex items-baseline gap-1">
 {row.resourceName ? (
 <>
 <span className="text-text-primary">{row.resourceName}</span>
 <span className="text-[10px] text-text-muted font-mono">{row.resourceType}#{row.resourcePath}</span>
 </>
 ) : (
 <span className="text-text-muted font-mono">{row.resourceType}:{row.resourcePath}</span>
 )}
 </span>
 ) : (
 <span className="text-text-muted">—</span>
 )}
 </td>
 <td className="px-2 py-1.5 text-[11px] text-text-muted font-mono">
 {row.ipAddress || '—'}
 </td>
 </tr>
 {open && hasDetails && (
 <tr className="bg-bg-primary/50 /30">
 <td colSpan={colSpan} className="px-8 py-2">
 <pre className="text-[11px] text-text-secondary font-mono whitespace-pre-wrap break-all max-h-64 overflow-auto">
 {JSON.stringify(row.details, null, 2)}
 </pre>
 </td>
 </tr>
 )}
 </>
 );
}

export function AuditLogPage({ embedded = false }: { embedded?: boolean } = {}) {
 const isMaster = useIsMasterTenant();
 // Master narrow filter — single-select via the chip row. The
 // querystring keeps the selection across reloads / colleague-shared
 // links ("here's the Pimkie audit feed for the past 24h").
 const tenantFilter = useTenantFilter();
 const filterTenantId = tenantFilter.value.size === 1 ? [...tenantFilter.value][0] : undefined;

 const [items, setItems] = useState<AuditLogRow[]>([]);
 const [total, setTotal] = useState(0);
 const [isLoading, setIsLoading] = useState(true);
 const [filters, setFilters] = useState<AuditLogFilters>({ limit: PAGE_SIZE, offset: 0 });
 const [actions, setActions] = useState<string[]>([]);
 const [users, setUsers] = useState<User[]>([]);
 const [search, setSearch] = useState('');

 const load = useCallback(async (spinner = true) => {
 if (spinner) setIsLoading(true);
 try {
 const { items, total } = await auditApi.list({ ...filters, filterTenantId });
 setItems(items);
 setTotal(total);
 } catch {
 toast.error('Failed to load audit log');
 } finally {
 if (spinner) setIsLoading(false);
 }
 }, [filters, filterTenantId]);

 useEffect(() => {
 load();
 }, [load]);

 useEffect(() => {
 // Load distinct action list — narrow it to the tenant filter so the
 // dropdown only surfaces actions actually present in that tenant.
 auditApi.distinctActions(filterTenantId).then(setActions).catch(() => {});
 // Load tenant users for the "By user" filter.
 usersApi.list().then(setUsers).catch(() => {});
 }, [filterTenantId]);

 const applySearch = () => {
 setFilters({ ...filters, search: search.trim() || undefined, offset: 0 });
 };

 const clearFilters = () => {
 setSearch('');
 setFilters({ limit: PAGE_SIZE, offset: 0 });
 };

 const exportCsv = () => {
 const header = ['When', 'Action', 'User', 'Device', 'Resource', 'Resource Name', 'IP', 'Details'];
 const rows = items.map((r) => [
 new Date(r.createdAt).toISOString(),
 r.action,
 r.username || '',
 r.deviceName || (r.deviceId ? `#${r.deviceId}` : ''),
 r.resourceType ? `${r.resourceType}:${r.resourcePath || ''}` : '',
 r.resourceName || '',
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
 <div className={embedded ? '' : 'p-6'}>
 <div className="flex items-center justify-between mb-6">
 {!embedded && (
 <div className="flex items-center gap-3">
 <FileText className="w-6 h-6 text-accent" />
 <div>
 <h1 className="text-xl font-semibold text-text-primary">Audit log</h1>
 <p className="text-sm text-text-muted">Who did what, when, and from where.</p>
 </div>
 </div>
 )}
 {embedded && <div />}
 <div className="flex items-center gap-2">
 <button
 onClick={exportCsv}
 disabled={items.length === 0}
 className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded text-text-muted hover:text-text-primary hover:border-accent/40 transition-colors disabled:opacity-50"
 >
 <Download className="w-3.5 h-3.5" /> CSV
 </button>
 <button
 onClick={async () => {
 if (!confirm('Clear the ENTIRE audit log for this tenant?\n\nThis typically requires a second-admin approval (default: Restricted). A single "audit.cleared" entry is kept so investigators can still see who wiped it.')) return;
 try {
 const r = await auditApi.clear();
 toast.success(`Cleared ${r.deleted} entries`);
 load(true);
 } catch (err: any) {
 const msg = err?.response?.data?.error;
 const status = err?.response?.status;
 if (status === 202) {
 toast('Clear request submitted — awaiting second-admin approval.', { icon: '⏳' });
 } else {
 toast.error(msg || 'Clear failed');
 }
 }
 }}
 className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded border border-red-400/30 text-red-400 hover:bg-red-400/10 transition-colors"
 title="Clear all audit entries (requires second-admin approval by default)"
 >
 <Trash2 className="w-3.5 h-3.5" /> Clear
 </button>
 <button
 onClick={() => load(true)}
 className="p-1.5 rounded text-text-muted hover:text-text-primary hover:border-accent/40"
 title="Refresh"
 >
 <RefreshCw className="w-4 h-4" />
 </button>
 </div>
 </div>

 {/* Master tenant chip row (single-select to keep the audit
 feed focused — multi-select would defeat the purpose of
 drilling into one customer). */}
 {isMaster && (
 <div className="mb-3">
 <TenantFilterChips
 value={tenantFilter.value}
 onChange={(next) => {
 // Single-select semantics: keep only the most recently
 // toggled-on chip. UX-wise the audit log makes more sense
 // as a "look at one tenant at a time" tool than a union.
 if (next.size <= 1) tenantFilter.setValue(next);
 else {
 const previous = tenantFilter.value;
 const added = [...next].find((id) => !previous.has(id));
 tenantFilter.setValue(added ? new Set([added]) : new Set());
 }
 }}
 />
 </div>
 )}

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
 className="w-full pl-7 pr-2 py-1.5 text-xs bg-bg-secondary rounded text-text-primary"
 />
 </div>
 </div>
 <div>
 <label className="block text-[10px] uppercase text-text-muted mb-0.5">Action</label>
 <select
 value={filters.action || ''}
 onChange={(e) => setFilters({ ...filters, action: e.target.value || undefined, offset: 0 })}
 className="py-1.5 px-2 text-xs bg-bg-secondary rounded text-text-primary min-w-[180px]"
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
 <label className="block text-[10px] uppercase text-text-muted mb-0.5">User</label>
 <UserCombobox
 users={users}
 value={filters.userId ?? null}
 onChange={(id) => setFilters({ ...filters, userId: id ?? undefined, offset: 0 })}
 />
 </div>
 <div>
 <label className="block text-[10px] uppercase text-text-muted mb-0.5">Since</label>
 <input
 type="datetime-local"
 value={filters.since?.slice(0, 16) || ''}
 onChange={(e) => setFilters({ ...filters, since: e.target.value ? new Date(e.target.value).toISOString() : undefined, offset: 0 })}
 className="py-1.5 px-2 text-xs bg-bg-secondary rounded text-text-primary"
 />
 </div>
 <div>
 <label className="block text-[10px] uppercase text-text-muted mb-0.5">Until</label>
 <input
 type="datetime-local"
 value={filters.until?.slice(0, 16) || ''}
 onChange={(e) => setFilters({ ...filters, until: e.target.value ? new Date(e.target.value).toISOString() : undefined, offset: 0 })}
 className="py-1.5 px-2 text-xs bg-bg-secondary rounded text-text-primary"
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
 className="text-xs px-2 py-1.5 rounded text-text-muted hover:text-text-primary"
 >
 Clear
 </button>
 </div>

 {/* Table */}
 <div className="rounded bg-bg-secondary overflow-hidden">
 {isLoading ? (
 <div className="p-8 text-center text-text-muted text-sm italic">Loading...</div>
 ) : items.length === 0 ? (
 <div className="p-8 text-center text-text-muted text-sm italic">No audit entries match your filters.</div>
 ) : (
 <table className="w-full border-collapse">
 <thead>
 <tr className=" bg-bg-primary/40">
 <th className="px-2 py-1.5 text-left text-[10px] uppercase text-text-muted font-medium">When</th>
 {isMaster && (
 <th className="px-2 py-1.5 text-left text-[10px] uppercase text-text-muted font-medium">Tenant</th>
 )}
 <th className="px-2 py-1.5 text-left text-[10px] uppercase text-text-muted font-medium">Action</th>
 <th className="px-2 py-1.5 text-left text-[10px] uppercase text-text-muted font-medium">User</th>
 <th className="px-2 py-1.5 text-left text-[10px] uppercase text-text-muted font-medium">Device</th>
 <th className="px-2 py-1.5 text-left text-[10px] uppercase text-text-muted font-medium">Resource</th>
 <th className="px-2 py-1.5 text-left text-[10px] uppercase text-text-muted font-medium">IP</th>
 </tr>
 </thead>
 <tbody>
 {items.map((row) => <Row key={row.id} row={row} isMaster={isMaster} />)}
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
 className="px-2 py-1 rounded hover:text-text-primary disabled:opacity-30"
 >
 Prev
 </button>
 <button
 disabled={page >= pages}
 onClick={() => setFilters({ ...filters, offset: (filters.offset ?? 0) + (filters.limit ?? PAGE_SIZE) })}
 className="px-2 py-1 rounded hover:text-text-primary disabled:opacity-30"
 >
 Next
 </button>
 </div>
 </div>
 )}
 </div>
 );
}

// ── Dark-theme searchable user combobox ─────────────────────────────────
// The native <select> element picks up the OS chrome when focused on some
// browsers (Chrome on Linux renders a white dropdown even in dark mode).
// This tiny custom combobox keeps the whole popover inside our theme and
// lets the admin type to filter — useful when a tenant has many users.

function UserCombobox({
 users,
 value,
 onChange,
}: {
 users: User[];
 value: number | null;
 onChange: (id: number | null) => void;
}) {
 const [open, setOpen] = useState(false);
 const [query, setQuery] = useState('');
 const ref = useRef<HTMLDivElement>(null);
 const selected = users.find((u) => u.id === value) ?? null;

 useEffect(() => {
 if (!open) return;
 const onDocClick = (e: MouseEvent) => {
 if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
 };
 document.addEventListener('mousedown', onDocClick);
 return () => document.removeEventListener('mousedown', onDocClick);
 }, [open]);

 const q = query.trim().toLowerCase();
 const filtered = users.filter((u) => !q || u.username.toLowerCase().includes(q) || (u.displayName ?? '').toLowerCase().includes(q));

 return (
 <div ref={ref} className="relative min-w-[160px]">
 <button
 type="button"
 onClick={() => setOpen((v) => !v)}
 className="w-full flex items-center justify-between gap-2 py-1.5 px-2 text-xs bg-bg-secondary rounded text-text-primary hover:border-accent/40"
 >
 <span className="truncate">{selected ? selected.username : 'Any user'}</span>
 <span className="text-text-muted shrink-0">▾</span>
 </button>
 {open && (
 <div className="absolute left-0 top-full mt-1 z-20 w-full max-h-64 overflow-y-auto bg-bg-secondary rounded shadow-xl">
 <div className="p-1.5 /50 sticky top-0 bg-bg-secondary">
 <input
 autoFocus
 type="text"
 value={query}
 onChange={(e) => setQuery(e.target.value)}
 placeholder="Search…"
 className="w-full px-2 py-1 text-xs bg-bg-tertiary rounded text-text-primary focus:outline-none focus:border-accent"
 />
 </div>
 <button
 type="button"
 onClick={() => { onChange(null); setOpen(false); setQuery(''); }}
 className={clsx(
 'w-full text-left px-2.5 py-1.5 text-xs hover:bg-bg-tertiary',
 value === null ? 'text-accent' : 'text-text-muted',
 )}
 >
 Any user
 </button>
 {filtered.length === 0 ? (
 <div className="px-2.5 py-2 text-xs text-text-muted italic">No match</div>
 ) : filtered.map((u) => (
 <button
 key={u.id}
 type="button"
 onClick={() => { onChange(u.id); setOpen(false); setQuery(''); }}
 className={clsx(
 'w-full text-left px-2.5 py-1.5 text-xs hover:bg-bg-tertiary flex items-center gap-1.5',
 value === u.id ? 'text-accent' : 'text-text-primary',
 )}
 >
 <span className="truncate">{u.username}</span>
 {u.displayName && <span className="text-[10px] text-text-muted truncate">({u.displayName})</span>}
 </button>
 ))}
 </div>
 )}
 </div>
 );
}
