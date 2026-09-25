import { useEffect, useState, useCallback, useRef, useMemo, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useSessionState } from '@/hooks/useSessionState';
import {
 Search, RefreshCw, ChevronRight, ChevronDown, X, RotateCcw, PowerOff, Trash2, Download,
 ShieldCheck, Loader2, MoreHorizontal, UserX, SortAsc, SortDesc, FolderOpen, MousePointerClick, Check, ArrowRightLeft, FolderX, Tag, Terminal, Building2,
 SlidersHorizontal, Columns3, FolderTree,
} from 'lucide-react';
import { deviceApi } from '@/api/device.api';
import { scriptApi } from '@/api/script.api';
import type { Script } from '@obliance/shared';
import { MASTER_TENANT_ID } from '@obliance/shared';
import { useTenantStore } from '@/store/tenantStore';
import { groupsApi } from '@/api/groups.api';
import { DeviceRow } from '@/components/devices/DeviceRow';
import { StyledCheckbox } from '@/components/devices/StyledCheckbox';
import { GroupTreePicker } from '@/components/devices/GroupTreePicker';
import type { Device, DeviceGroupTreeNode, CommandType } from '@obliance/shared';
import { useAuthStore } from '@/store/authStore';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { clsx } from 'clsx';
import { anonymize } from '@/utils/anonymize';
import { shortenOsName } from '@/utils/osLabel';
import { isCommandSupported, unsupportedTooltip } from '@/utils/capabilities';
import { cn } from '@/utils/cn';
import { saveBlob } from '@/utils/download';
import { useIsCoarsePointer, useLayoutMode, useMediaQuery } from '@/hooks/useMediaQuery';
import { useNativeBack } from '@/hooks/useNativeBack';
import { useAnchoredPosition } from '@/native/overlay';
import { Modal } from '@/components/common/Modal';
import { Drawer } from '@/components/common/Drawer';
import { ActionMenu } from '@/components/common/ActionMenu';
import { IconButton } from '@/components/common/IconButton';
import { useConfirm } from '@/components/common/ConfirmDialog';
import {
 LINE2_FIELDS,
 loadVisibleFields,
 saveVisibleFields,
 defaultVisibleFields,
} from '@/utils/deviceLine2Fields';

interface OsFacet { osType: string; osName: string | null; osVersion: string | null; count: number }

type ApprovalFilter = '' | 'approved' | 'pending' | 'refused' | 'suspended';
// Empty string = "no explicit sort" → server falls back to enrolment order
// (devices.id ASC) and the table renders in tree-view mode (grouped).
type SortField = '' | 'name' | 'status' | 'os' | 'lastSeen' | 'version' | 'group' | 'cpu' | 'ram' | 'disk';

interface DeviceTableProps {
 mode: 'monitoring' | 'admin';
 initialStatusFilter?: string;
 initialOsFilter?: string;
 /** Initial "stale since N hours" filter — seeded from the URL by dashboard
 * click-throughs (e.g. /devices?stale=72 from the "Injoignables 72h" hero). */
 initialStaleHours?: number;
 /** Initial "only devices with pending updates" filter — from the URL
 * ?pendingUpdates=1 dashboard click-through. */
 initialPendingUpdates?: boolean;
 /** Initial approval filter — admin sidebar deep-links here with
 * ?approvalStatus=pending so the page lands on the approval queue. */
 initialApprovalFilter?: string;
 groupId?: number | null;
 onGroupChange?: (id: number | null) => void;
 /** Below lg the groups column of /devices is an off-canvas drawer:
 * when set, the toolbar shows a "Groups" button that opens it. */
 onOpenGroups?: () => void;
 /** The host page already pads the content (GroupDetailPage): drop the
 * table's own padding below lg. Desktop (lg+) is unchanged. */
 embedded?: boolean;
}

export function DeviceTable({
 mode, initialStatusFilter, initialOsFilter, initialStaleHours, initialPendingUpdates,
 initialApprovalFilter,
 groupId: externalGroupId, onGroupChange, onOpenGroups, embedded = false,
}: DeviceTableProps) {
 const { t } = useTranslation();
 const navigate = useNavigate();
 // docs/obli-mobile.md §4: phone < 768 ≤ tablet < 1024 ≤ desktop. The
 // desktop rendering is the historic one; phone / tablet adapt below.
 const layout = useLayoutMode();
 const isPhone = layout === 'phone';
 const isDesktop = layout === 'desktop';
 // The 10px click-to-sort header labels are desktop-mouse only; a touch
 // screen at desktop width (landscape tablet) gets the sort select too.
 const isCoarse = useIsCoarsePointer();
 const headerSortLabels = isDesktop && !isCoarse;
 // Compact toolbar (search + "Filters" sheet + "⋯" menu) on phones AND on a
 // landscape phone / short touch screen, where the full chip band would
 // cover the whole ~300px-high list pane. Mouse screens never match.
 const isShortTouch = useMediaQuery('(pointer: coarse) and (max-height: 520px)');
 const compactToolbar = isPhone || isShortTouch;
 const confirm = useConfirm();
 // Phone: the filter chips live in a bottom sheet opened from a
 // "Filters (n)" button instead of a tall sticky band.
 const [filtersOpen, setFiltersOpen] = useState(false);
 // Anchors of the toolbar popovers (viewport-clamped, portal-rendered).
 const exportBtnRef = useRef<HTMLButtonElement>(null);
 const columnsBtnRef = useRef<HTMLButtonElement>(null);
 const osNameBtnRef = useRef<HTMLButtonElement>(null);
 const osVersionBtnRef = useRef<HTMLButtonElement>(null);
 const tagsBtnRef = useRef<HTMLButtonElement>(null);
 const batchBtnRef = useRef<HTMLButtonElement>(null);
 const { isAdmin, permissions } = useAuthStore();
 // Unlocked when admin OR the user has a team_permission row carrying
 // `agent_config:approval`. Drives both the approval-status chip row
 // (Approuvés / En attente / Refusés / Suspendus) and the per-row
 // Approve / Refuse / Bulk-approve buttons that are gated below.
 // Server-side enforcement is in device.routes.ts approve/refuse/bulk.
 const canManageApproval = useMemo(
 () => isAdmin() || (permissions?.tenantCapabilities ?? []).includes('agent_config:approval'),
 [isAdmin, permissions?.tenantCapabilities],
 );

 // Filters
 //
 // Persisted to sessionStorage via useSessionState so navigating to a
 // device detail and hitting browser-back (or the page's own back button)
 // restores the user's search + chip filters + sort exactly as they left
 // them. sessionStorage is scoped per browser tab, so the state doesn't
 // leak across tabs or browser restarts.
 //
 // URL params (initialStatusFilter / initialOsFilter / etc.) seed the
 // values only when sessionStorage is empty. Once the user has touched
 // the filters, sessionStorage wins on subsequent mounts — otherwise the
 // user's manual chip toggles would be reverted by a stale URL after a
 // back-navigation.
 const [search, setSearch] = useSessionState<string>('obliance:devices:search', '');
 const [debouncedSearch, setDebouncedSearch] = useState('');
 const [statusFilters, setStatusFilters] = useSessionState<Set<string>>(
 'obliance:devices:statusFilters',
 () => (initialStatusFilter ? new Set([initialStatusFilter]) : new Set<string>()),
 );
 // Tag filter — set of selected tags. Populated by the popover from
 // /devices/tags so admins pick from existing tags only. Filter is
 // applied server-side via deviceApi.listPaginated({ tags }) so the
 // restriction spans the whole fleet, not just the visible page.
 const [tagFilters, setTagFilters] = useSessionState<Set<string>>('obliance:devices:tagFilters', new Set<string>());
 const [tagFacets, setTagFacets] = useState<Array<{ tag: string; count: number }>>([]);
 const [tagsMenuOpen, setTagsMenuOpen] = useState(false);
 const toggleTagFilter = (tag: string) => {
 setTagFilters((prev) => {
 const next = new Set(prev);
 if (next.has(tag)) next.delete(tag); else next.add(tag);
 return next;
 });
 };
 const [osFilters, setOsFilters] = useSessionState<Set<string>>(
 'obliance:devices:osFilters',
 () => (initialOsFilter ? new Set([initialOsFilter]) : new Set<string>()),
 );
 // URL-driven filters from dashboard click-throughs. They flow straight to
 // the server query — no toggle UI here yet, the user clears them by
 // navigating away or removing the query param.
 const [staleHours, setStaleHours] = useSessionState<number | undefined>('obliance:devices:staleHours', initialStaleHours);
 const [pendingUpdatesOnly, setPendingUpdatesOnly] = useSessionState<boolean>('obliance:devices:pendingUpdatesOnly', !!initialPendingUpdates);
 // Lot C 3-tier OS filter: osType (existing chip) → osName → osVersion.
 // Each sub-filter is a Set<string> backing a multi-select popover so
 // admins can OR together several Windows versions or Linux distros in
 // one go. The sets reset when the parent (osType / osName) changes so
 // the user never lands on a combination that matches nothing.
 // Key suffix `:multi` distinguishes the new Set-backed state from old
 // single-string session values that were stored under the unsuffixed
 // key — without it, a returning admin would deserialise `""` as a
 // string and the next `.size` access would crash.
 const [osNameFilter, setOsNameFilter] = useSessionState<Set<string>>('obliance:devices:osNameFilter:multi', new Set<string>());
 const [osVersionFilter, setOsVersionFilter] = useSessionState<Set<string>>('obliance:devices:osVersionFilter:multi', new Set<string>());
 const [osNameMenuOpen, setOsNameMenuOpen] = useState(false);
 const [osVersionMenuOpen, setOsVersionMenuOpen] = useState(false);
 const toggleOsNameFilter = (name: string) => {
 setOsNameFilter((prev) => {
 const next = new Set(prev);
 if (next.has(name)) next.delete(name); else next.add(name);
 return next;
 });
 };
 const toggleOsVersionFilter = (v: string) => {
 setOsVersionFilter((prev) => {
 const next = new Set(prev);
 if (next.has(v)) next.delete(v); else next.add(v);
 return next;
 });
 };
 const [osFacets, setOsFacets] = useState<OsFacet[]>([]);
 // Lot D.1 — user-configurable line-2 fields. Persisted in localStorage so
 // the choice survives reloads. Toggling a checkbox in the popover writes
 // through immediately (no Save button).
 const [visibleFields, setVisibleFields] = useState<Set<string>>(() => loadVisibleFields());
 const [columnsMenuOpen, setColumnsMenuOpen] = useState(false);
 const toggleColumn = (key: string) => {
 setVisibleFields((prev) => {
 const next = new Set(prev);
 if (next.has(key)) next.delete(key); else next.add(key);
 saveVisibleFields(next);
 return next;
 });
 };
 const resetColumns = () => {
 const def = defaultVisibleFields();
 saveVisibleFields(def);
 setVisibleFields(def);
 };
 // Approval filter — admins land on the unfiltered list (so they see
 // pending/refused/suspended at a glance), regular users are pinned to
 // the approved subset. Role-based, not mode-based, since /devices is
 // now the single canonical page for both audiences. The URL param
 // ?approvalStatus=pending overrides the default — used by the
 // sidebar admin deep-link "Agents".
 const [approvalFilter, setApprovalFilter] = useSessionState<ApprovalFilter>(
 'obliance:devices:approvalFilter',
 (initialApprovalFilter as ApprovalFilter | undefined) ?? (canManageApproval ? '' : 'approved'),
 );
 // Default = no explicit sort → enrolment order, tree-grouped. Clicking a
 // column cycles asc → desc → back to default (empty).
 const [sortBy, setSortBy] = useSessionState<SortField>('obliance:devices:sortBy', '');
 const [sortOrder, setSortOrder] = useSessionState<'asc' | 'desc'>('obliance:devices:sortOrder', 'asc');

 // Data — `devices` is the accumulated list across infinite-scroll
 // fetches in flat mode, and the whole scope in tree mode.
 const [devices, setDevices] = useState<Device[]>([]);
 const [total, setTotal] = useState(0);
 const [isLoading, setIsLoading] = useState(true);

 // Group tree — drives the hierarchical render when no search is active.
 // Fetched once on mount; cheap enough that we refetch on every
 // page/filter change if it ever grows stale (rare — groups don't
 // change often).
 const [tree, setTree] = useState<DeviceGroupTreeNode[]>([]);
 const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<number>>(() => {
 try {
 const raw = localStorage.getItem('obliance:deviceTableCollapsed');
 return new Set<number>(raw ? JSON.parse(raw) : []);
 } catch {
 return new Set<number>();
 }
 });
 const toggleGroupCollapsed = useCallback((gId: number) => {
 setCollapsedGroupIds((prev) => {
 const next = new Set(prev);
 if (next.has(gId)) next.delete(gId); else next.add(gId);
 try { localStorage.setItem('obliance:deviceTableCollapsed', JSON.stringify([...next])); } catch {}
 return next;
 });
 }, []);

 // Selection
 const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
 const [selectAllGroup, setSelectAllGroup] = useState(false);
 // When enabled, a dark checkbox is shown on every row AND the whole row
 // becomes a selection toggle (no navigation). Lets the user pick devices
 // without having to aim a tiny checkbox target.
 const [selectionMode, setSelectionMode] = useState(false);
 // Change-group + transfer-tenant modal state
 const [changeGroupOpen, setChangeGroupOpen] = useState(false);
 const [transferOpen, setTransferOpen] = useState(false);
 const [runScriptOpen, setRunScriptOpen] = useState(false);
 const [tenantFilters, setTenantFilters] = useSessionState<Set<number>>('obliance:devices:tenantFilters', new Set<number>());
 const toggleTenantFilter = (tid: number) => {
 setTenantFilters((prev) => {
 const next = new Set(prev);
 if (next.has(tid)) next.delete(tid); else next.add(tid);
 return next;
 });
 };
 // Master/god view: tenants are folded by default so the table doesn't
 // explode into N tenants × M groups × P devices on first paint. The
 // user expands the ones they need; state persists across the session.
 const currentTenantId = useTenantStore((s) => s.currentTenantId);
 const isMaster = currentTenantId === MASTER_TENANT_ID;
 // Master view forces the `tenant` column visible so a flat-paginated
 // list of "all devices" stays decipherable — without it, every row
 // would just say "PC-…", and an admin couldn't tell which child
 // tenant owns the row at a glance. Non-master views respect the
 // user's persisted choice (tenant column is irrelevant there).
 // NOTE: must live AFTER `isMaster` is declared above; previously
 // sat next to `visibleFields` but referenced `isMaster` which wasn't
 // in scope yet (TS2448 / TS2454 build break).
 const visibleFieldsForMaster = useMemo(() => {
 if (!isMaster) return visibleFields;
 if (visibleFields.has('tenant')) return visibleFields;
 const next = new Set(visibleFields);
 next.add('tenant');
 return next;
 }, [visibleFields, isMaster]);
 // Persist tenant collapse state across reloads — same key used by
 // the GroupSidePanel so the two views stay in sync. (Collapsing
 // "Contoso" in the sidebar should also fold its bucket in the table.)
 const [collapsedTenantIds, setCollapsedTenantIds] = useState<Set<number>>(() => {
 try {
 const raw = localStorage.getItem('obliance:groupPanelCollapsedTenants');
 return new Set(raw ? (JSON.parse(raw) as number[]) : []);
 } catch { return new Set(); }
 });
 useEffect(() => {
 try { localStorage.setItem('obliance:groupPanelCollapsedTenants', JSON.stringify([...collapsedTenantIds])); } catch {}
 }, [collapsedTenantIds]);
 const toggleTenantCollapsed = (id: number) => {
 setCollapsedTenantIds((prev) => {
 const next = new Set(prev);
 if (next.has(id)) next.delete(id); else next.add(id);
 return next;
 });
 };

 // Approval counts (admin mode)
 const [counts, setCounts] = useState({ all: 0, approved: 0, pending: 0, refused: 0, suspended: 0 });

 // Batch actions
 const [batchMenuOpen, setBatchMenuOpen] = useState(false);
 const [isBatchRunning, setIsBatchRunning] = useState(false);

 // Export
 const [exportMenuOpen, setExportMenuOpen] = useState(false);
 const [isExporting, setIsExporting] = useState(false);
 const handleExport = async (format: 'csv' | 'xlsx' | 'pdf') => {
 setExportMenuOpen(false);
 setIsExporting(true);
 try {
 const { blob, filename } = await deviceApi.export(format, {
 search: debouncedSearch || undefined,
 status: statusFilters.size === 1 ? [...statusFilters][0] : undefined,
 osType: osFilters.size === 1 ? [...osFilters][0] : undefined,
 groupId: groupId === -1 ? undefined : (groupId ?? undefined),
 includeSubgroups: groupId === -1 ? undefined : (groupId ? true : undefined),
 ungrouped: groupId === -1 ? true : undefined,
 approvalStatus: approvalFilter || undefined,
 sortBy,
 sortOrder,
 });
 // Shared saver: Android shell → native Downloads, browser → anchor
 // download with deferred revoke (docs/obli-mobile.md §3).
 if (!(await saveBlob(blob, filename))) toast.error(t('common.error'));
 } catch {
 toast.error(t('common.error'));
 } finally {
 setIsExporting(false);
 }
 };

 // Debounce search
 const searchTimer = useRef<ReturnType<typeof setTimeout>>();
 useEffect(() => {
 searchTimer.current = setTimeout(() => setDebouncedSearch(search), 300);
 return () => clearTimeout(searchTimer.current);
 }, [search]);

 const groupId = externalGroupId ?? null;
 // -1 is the sentinel the GroupSidePanel emits for "Ungrouped" — devices
 // with NULL group_id. We translate it into the dedicated `ungrouped`
 // query flag and skip the normal group / sub-group filter.
 const ungroupedOnly = groupId === -1;

 // Tree view is active when the admin is in the "default landing" shape:
 // no search, no ungrouped filter, and no explicit sort. Any explicit
 // sort (Name asc/desc, CPU, RAM, Status, …) breaks the drawer metaphor
 // because devices end up ordered across groups — we switch to the flat
 // list with infinite scroll so the ordering holds across the whole fleet.
 //
 // Master-tenant exception: when the admin is on the master tenant AND
 // hasn't picked a group, tree mode would have to fetch every device
 // of every child tenant in one shot (TREE_MAX=2000) and render an
 // unvirtualised tree of thousands of rows — locks the browser. We
 // fall back to flat pagination (100/page, infinite scroll) at the
 // root level; selecting a specific group / tenant chip / etc.
 // narrows the scope and unlocks the tree view again.
 const treeViewActive =
 !debouncedSearch.trim() &&
 !ungroupedOnly &&
 sortBy === '' &&
 !(isMaster && groupId == null && tenantFilters.size === 0);
 const TREE_MAX = 2000;

 // Flat mode uses cumulative fetches: every scroll-triggered append
 // tacks on the next page of results to `devices`. We track the highest
 // loaded page in a ref so re-renders don't re-create `load` and don't
 // fire duplicate fetches.
 const loadedPagesRef = useRef(1);
 const [hasMore, setHasMore] = useState(false);
 const [appending, setAppending] = useState(false);
 const FLAT_PAGE_SIZE = 100;

 const load = useCallback(async (reset: boolean) => {
 const pageToFetch = reset ? 1 : loadedPagesRef.current + 1;
 const size = treeViewActive ? TREE_MAX : FLAT_PAGE_SIZE;
 if (reset) { setIsLoading(true); loadedPagesRef.current = 1; }
 else { setAppending(true); }
 try {
 const result = await deviceApi.listPaginated({
 search: debouncedSearch || undefined,
 status: statusFilters.size === 1 ? [...statusFilters][0] : undefined,
 osType: osFilters.size === 1 ? [...osFilters][0] : undefined,
 osName: osNameFilter.size > 0 ? [...osNameFilter] : undefined,
 osVersion: osVersionFilter.size > 0 ? [...osVersionFilter] : undefined,
 groupId: ungroupedOnly ? undefined : (groupId ?? undefined),
 includeSubgroups: ungroupedOnly ? undefined : (groupId ? true : undefined),
 ungrouped: ungroupedOnly ? true : undefined,
 approvalStatus: approvalFilter || undefined,
 staleHours: staleHours,
 pendingUpdates: pendingUpdatesOnly || undefined,
 tags: tagFilters.size > 0 ? [...tagFilters] : undefined,
 // Master-only: narrow the god view to a tenant subset. Server
 // drops the param for non-master callers, so it's safe to send
 // unconditionally — but keeping it inside the master gate
 // avoids a stray query string in non-master cases.
 tenantIds: (isMaster && tenantFilters.size > 0) ? [...tenantFilters] : undefined,
 page: pageToFetch,
 pageSize: size,
 sortBy,
 sortOrder,
 });
 setDevices((prev) => reset ? result.items : [...prev, ...result.items]);
 setTotal(result.total);
 loadedPagesRef.current = pageToFetch;
 // Tree mode eats the whole scope in one shot → no more pages.
 // Flat mode keeps scrolling as long as we haven't loaded all rows.
 if (treeViewActive) {
 setHasMore(false);
 } else {
 setHasMore(pageToFetch * size < result.total);
 }
 } catch {
 toast.error(t('common.error'));
 } finally {
 if (reset) setIsLoading(false);
 else setAppending(false);
 }
 }, [debouncedSearch, statusFilters, osFilters, osNameFilter, osVersionFilter, groupId, ungroupedOnly, approvalFilter, treeViewActive, sortBy, sortOrder, staleHours, pendingUpdatesOnly, tagFilters, tenantFilters, isMaster, t]);

 // Sync URL-driven filters when the parent prop changes (e.g. user clicks
 // a different dashboard hero card while /devices is already mounted —
 // react-router keeps the page but the search params change).
 useEffect(() => { setStaleHours(initialStaleHours); }, [initialStaleHours]);
 useEffect(() => { setPendingUpdatesOnly(!!initialPendingUpdates); }, [initialPendingUpdates]);
 useEffect(() => {
 setOsFilters(initialOsFilter ? new Set([initialOsFilter]) : new Set());
 }, [initialOsFilter]);

 // Refetch from scratch whenever any filter/sort input changes. The
 // dep is `load` itself, which rebuilds every time its inputs change,
 // so this effectively tracks them all.
 useEffect(() => { load(true); }, [load]);

 // Fetch the group tree once so the main table can render a nested
 // hierarchy (parents → children → devices). Silent failure: the flat
 // fallback still works if the endpoint is unreachable.
 useEffect(() => {
 groupsApi.tree().then(setTree).catch(() => setTree([]));
 }, []);

 // Fetch OS facets once. Drives the dynamic 3-tier OS filter — only
 // values that have devices are shown, so an empty Win 2003 bucket is
 // simply hidden instead of cluttering the UI.
 useEffect(() => {
 deviceApi.getOsFacets().then(setOsFacets).catch(() => setOsFacets([]));
 }, []);

 // Reset osName when osType changes; reset osVersion when osName changes.
 // Otherwise a stale "Win 11 build X" sub-filter would survive a switch to
 // Linux and result in zero rows.
 useEffect(() => {
 setOsNameFilter(new Set());
 setOsVersionFilter(new Set());
 }, [osFilters]);
 useEffect(() => { setOsVersionFilter(new Set()); }, [osNameFilter]);

 // Infinite-scroll sentinel — a 1 px div below the flat list. When it
 // enters the viewport (± 200 px early-load margin), we append the
 // next page. Disabled in tree mode since the whole scope loads in
 // one request.
 const sentinelRef = useRef<HTMLDivElement | null>(null);
 useEffect(() => {
 if (treeViewActive || !hasMore || !sentinelRef.current) return;
 const node = sentinelRef.current;
 const io = new IntersectionObserver((entries) => {
 if (entries[0]?.isIntersecting && !appending && !isLoading) {
 load(false);
 }
 }, { rootMargin: '200px' });
 io.observe(node);
 return () => io.disconnect();
 }, [treeViewActive, hasMore, appending, isLoading, load]);

 // Load counts for admin mode
 useEffect(() => {
 if (mode !== 'admin') return;
 deviceApi.getSummary().then((s) => {
 // Use the server's authoritative `total` rather than summing a
 // hand-picked subset of statuses — the old formula missed
 // `maintenance`, `updating`, `pending_uninstall` and
 // `update_error`, so both "All" and "Approved" under-reported
 // (visible as e.g. 395 instead of 444 on fleets with devices in
 // those transitional states).
 const total = s.total ?? 0;
 const pending = s.pending ?? 0;
 const suspended = s.suspended ?? 0;
 setCounts({
 all: total,
 approved: Math.max(0, total - pending - suspended),
 pending,
 refused: 0,
 suspended,
 });
 }).catch(() => {});
 }, [mode, devices]);

 // Clear selection when the filter set changes — selected IDs usually
 // aren't in the new view anyway and bulk actions against unseen rows
 // confuse the admin.
 useEffect(() => {
 setSelectedIds(new Set());
 setSelectAllGroup(false);
 }, [debouncedSearch, statusFilters, osFilters, groupId, approvalFilter, sortBy, sortOrder, tagFilters]);

 // Toggle filter chips
 const toggleStatus = (s: string) => {
 setStatusFilters(prev => {
 const next = new Set(prev);
 next.has(s) ? next.delete(s) : (next.clear(), next.add(s)); // single-select for now (server supports one)
 return next;
 });
 };
 const toggleOs = (os: string) => {
 setOsFilters(prev => {
 const next = new Set(prev);
 next.has(os) ? next.delete(os) : (next.clear(), next.add(os));
 return next;
 });
 };

 const toggleSelect = (id: number) => {
 setSelectedIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
 setSelectAllGroup(false);
 };
 const toggleAll = () => {
 if (selectedIds.size === devices.length) setSelectedIds(new Set());
 else setSelectedIds(new Set(devices.map(d => d.id)));
 setSelectAllGroup(false);
 };
 const handleSelectAllGroup = () => { setSelectAllGroup(true); setSelectedIds(new Set(devices.map(d => d.id))); };

 const handleBatchAction = async (action: string) => {
 setBatchMenuOpen(false);
 // Confirmations come first: the shared dialog is async (window.confirm is
 // a no-op in the Android WebView — docs §5.6) and the batch button must
 // not show its spinner while the question is still open.
 if (action === 'delete') {
 if (!(await confirm({ message: t('devices.batch.confirmDelete'), danger: true }))) return;
 } else if (action === 'update_agent') {
 const count = selectAllGroup && groupId ? total : selectedIds.size;
 if (!(await confirm((t('devices.action.updateAgentConfirm', { count }) as string) || `Update the agent on ${count} device(s)?`))) return;
 }
 setIsBatchRunning(true);
 try {
 if (action === 'approve') {
 const ids = selectAllGroup && groupId ? undefined : Array.from(selectedIds);
 if (ids) { await Promise.all(ids.map(id => deviceApi.approve(id))); toast.success(t('devices.batch.approved', { count: ids.length })); }
 } else if (action === 'delete') {
 const ids = Array.from(selectedIds);
 await Promise.all(ids.map(id => deviceApi.delete(id)));
 toast.success(t('devices.batch.deleted', { count: ids.length }));
 } else {
 // Agents no longer self-update — pushing 'update_agent' force-applies
 // the latest MSI. The batch menu item is greyed unless every selected
 // device supports it, and the server additionally skips legacy agents
 // (they can't self-update), so the action is safe to fan out across a
 // whole group selection; the toast reports the real dispatched count
 // (update_agent is confirmed above).
 const result = await deviceApi.batch({
 groupId: selectAllGroup && groupId ? groupId : undefined,
 deviceIds: selectAllGroup && groupId ? undefined : Array.from(selectedIds),
 action,
 });
 toast.success(t('devices.batch.dispatched', { count: result.dispatched }));
 }
 setSelectedIds(new Set()); setSelectAllGroup(false); await load(true);
 } catch { toast.error(t('common.error')); } finally { setIsBatchRunning(false); }
 };

 const hasSelection = selectedIds.size > 0;
 const allChecked = devices.length > 0 && devices.every(d => selectedIds.has(d.id));
 const someChecked = selectedIds.size > 0 && !allChecked;

 // A batch command is only offered when EVERY selected device's agent can
 // run it. Legacy (Go 1.20) agents support a reduced command set; mixing
 // one into the selection greys out the unsupported actions so the admin
 // can't dispatch a command that would silently no-op on part of the fleet.
 // Devices not in the loaded set (whole-group "select all") resolve to
 // permissive — the server no-ops anything the agent can't honour.
 const everySupports = useCallback((cmd: CommandType): boolean =>
 Array.from(selectedIds).every((id) => {
 const d = devices.find((x) => x.id === id);
 return !d || isCommandSupported(d, cmd);
 }), [selectedIds, devices]);

 const hasFilters = debouncedSearch || statusFilters.size > 0 || osFilters.size > 0 || osNameFilter.size > 0 || osVersionFilter.size > 0 || tagFilters.size > 0;

 const handleSort = (field: SortField) => {
 if (field === '') return;
 if (sortBy === field) {
 // Cycle: asc → desc → no sort (back to enrolment order, tree view).
 if (sortOrder === 'asc') setSortOrder('desc');
 else { setSortBy(''); setSortOrder('asc'); }
 } else {
 setSortBy(field);
 // Metric sorts default to desc (highest first) — that's the useful
 // direction (see which machines are busiest). Alpha fields default asc.
 setSortOrder(['cpu', 'ram', 'disk', 'lastSeen', 'status'].includes(field) ? 'desc' : 'asc');
 }
 };

 const STATUS_CHIPS = [
 { key: 'online', label: t('deviceStatus.online'), color: 'bg-green-400' },
 { key: 'offline', label: t('deviceStatus.offline'), color: 'bg-gray-400' },
 { key: 'warning', label: t('deviceStatus.warning'), color: 'bg-yellow-400' },
 { key: 'critical', label: t('deviceStatus.critical'), color: 'bg-red-400' },
 { key: 'updating', label: t('deviceStatus.updating', 'Updating'), color: 'bg-blue-400' },
 { key: 'update_error', label: t('deviceStatus.update_error', 'Update error'), color: 'bg-orange-500' },
 ];
 // Dynamic OS chips: hide families with zero devices in the tenant. The
 // facet API drives this — no facet = no chip. Counts shown next to the
 // label so admins immediately see the fleet shape.
 const osTypesPresent = useMemo(() => {
 const m = new Map<string, number>();
 for (const f of osFacets) m.set(f.osType, (m.get(f.osType) ?? 0) + f.count);
 return m;
 }, [osFacets]);
 const OS_CHIPS_ALL = [
 { key: 'windows', label: 'Windows' },
 { key: 'linux', label: 'Linux' },
 { key: 'macos', label: 'macOS' },
 { key: 'other', label: t('os.other', 'Autres') },
 ];
 const OS_CHIPS = OS_CHIPS_ALL.filter(c => (osTypesPresent.get(c.key) ?? 0) > 0);

 // OS sub-filter dropdowns: derived from facets, scoped to the currently
 // selected family (for osName) and the selected name (for osVersion).
 const selectedOsType = osFilters.size === 1 ? [...osFilters][0] : '';
 const osNameOptions = useMemo(() => {
 if (!selectedOsType) return [];
 const m = new Map<string, number>();
 for (const f of osFacets) {
 if (f.osType !== selectedOsType) continue;
 const key = f.osName ?? '';
 m.set(key, (m.get(key) ?? 0) + f.count);
 }
 return [...m.entries()]
 .filter(([k]) => k !== '')
 .sort((a, b) => a[0].localeCompare(b[0]))
 .map(([osName, count]) => ({ osName, count }));
 }, [osFacets, selectedOsType]);
 const osVersionOptions = useMemo(() => {
 if (!selectedOsType) return [];
 // When osName filter is set, only show versions belonging to those
 // names. When unset, show every version under the OS family so the
 // admin can drill straight to a build without picking a name first.
 const m = new Map<string, number>();
 for (const f of osFacets) {
 if (f.osType !== selectedOsType) continue;
 if (osNameFilter.size > 0 && !osNameFilter.has(f.osName ?? '')) continue;
 if (!f.osVersion) continue;
 m.set(f.osVersion, (m.get(f.osVersion) ?? 0) + f.count);
 }
 return [...m.entries()]
 .map(([osVersion, count]) => ({ osVersion, count }))
 .sort((a, b) => a.osVersion.localeCompare(b.osVersion, undefined, { numeric: true }));
 }, [osFacets, selectedOsType, osNameFilter]);

 // ── Toolbar building blocks ─────────────────────────────────────────
 // Rendered inline in the sticky band on tablet / desktop (the historic
 // markup) and inside the "Filters" bottom sheet on phone.
 const clearAllFilters = () => {
 setSearch('');
 setStatusFilters(new Set());
 setOsFilters(new Set());
 setOsNameFilter(new Set());
 setOsVersionFilter(new Set());
 };
 const activeFilterCount =
 statusFilters.size + osFilters.size + osNameFilter.size + osVersionFilter.size + tagFilters.size
 + (isMaster ? tenantFilters.size : 0)
 + (canManageApproval && approvalFilter !== '' ? 1 : 0);

 const openTagsMenu = async () => {
 const next = !tagsMenuOpen;
 setTagsMenuOpen(next);
 if (next && tagFacets.length === 0) {
 // Lazy fetch: avoid a request on every page mount.
 try {
 const list = await deviceApi.listTags();
 setTagFacets(list);
 } catch { /* silent */ }
 }
 };

 // Approval quick filters — visible to admin OR any user with the
 // `agent_config:approval` capability. Regular users without it are
 // pinned to the "approved" subset so the UI doesn't tease access to
 // pending / refused / suspended devices they can't act on.
 const approvalChips = canManageApproval ? (
 <div className="flex items-center gap-2 flex-wrap mb-3">
 {([
 { key: '' as ApprovalFilter, label: t('devices.filters.all'), count: counts.all },
 { key: 'approved' as ApprovalFilter, label: t('devices.filters.approved'), count: counts.approved },
 { key: 'pending' as ApprovalFilter, label: t('devices.filters.pending'), count: counts.pending },
 { key: 'refused' as ApprovalFilter, label: t('devices.filters.refused'), count: counts.refused },
 { key: 'suspended' as ApprovalFilter, label: t('devices.filters.suspended'), count: counts.suspended },
 ]).map(({ key, label, count }) => (
 <button key={key} onClick={() => setApprovalFilter(key)}
 className={clsx('px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors coarse:min-h-10',
 approvalFilter === key ? 'bg-accent text-white border-accent' : 'bg-bg-secondary text-text-muted border-transparent hover:text-text-primary hover:border-accent/50',
 )}>
 {label} <span className="opacity-60">({count})</span>
 </button>
 ))}
 </div>
 ) : null;

 // Master-only: tenant filter chips. Drop-down list of every
 // tenant present in the loaded device set (devices already
 // carry tenantName via the god-view join). The filter is
 // client-side over the already-loaded master result set.
 const tenantChips = isMaster ? (() => {
 const tenants = new Map<number, string>();
 for (const d of devices) if (d.tenantName) tenants.set(d.tenantId, d.tenantName);
 for (const g of tree) if (g.tenantName) tenants.set(g.tenantId, g.tenantName);
 if (tenants.size <= 1) return null;
 const ordered = [...tenants.entries()].sort(([aId, aName], [bId, bName]) => {
 if (aId === MASTER_TENANT_ID) return -1;
 if (bId === MASTER_TENANT_ID) return 1;
 return aName.localeCompare(bName);
 });
 return (
 <div className="flex items-center gap-1.5 flex-wrap mb-2">
 <span className="text-[10px] uppercase tracking-wider text-text-muted mr-1">
 <Building2 size={10} className="inline mr-1" />{t('devices.filters.tenant', 'Tenant')}
 </span>
 {ordered.map(([id, name]) => (
 <button key={id} onClick={() => toggleTenantFilter(id)}
 className={clsx('px-2.5 py-1 text-xs font-medium rounded-full border transition-colors coarse:py-2',
 tenantFilters.has(id) ? 'bg-accent/10 border-accent text-accent' : 'border-transparent text-text-muted hover:border-accent/30',
 )}>
 <Building2 size={10} className="inline mr-1" />
 {id === MASTER_TENANT_ID ? `${name} ${t('devices.filters.masterSuffix', '(master)')}` : name}
 </button>
 ))}
 {tenantFilters.size > 0 && (
 <button onClick={() => setTenantFilters(new Set())}
 className="text-[10px] text-accent hover:underline ml-1 coarse:text-xs coarse:min-h-10 coarse:px-2">
 {t('common.clear', 'Clear')}
 </button>
 )}
 </div>
 );
 })() : null;

 const statusOsChips = (
 <div className="flex items-center gap-1.5 flex-wrap">
 {STATUS_CHIPS.map(({ key, label, color }) => (
 <button key={key} onClick={() => toggleStatus(key)}
 className={clsx('flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full border transition-colors coarse:py-2',
 statusFilters.has(key) ? 'bg-accent/10 border-accent text-accent' : 'border-transparent text-text-muted hover:border-accent/30',
 )}>
 <div className={clsx('w-2 h-2 rounded-full', color)} />
 {label}
 </button>
 ))}
 {OS_CHIPS.length > 0 && <div className="w-px h-4 bg-border mx-1" />}
 {OS_CHIPS.map(({ key, label }) => (
 <button key={key} onClick={() => toggleOs(key)}
 className={clsx('px-2.5 py-1 text-xs font-medium rounded-full border transition-colors coarse:py-2',
 osFilters.has(key) ? 'bg-accent/10 border-accent text-accent' : 'border-transparent text-text-muted hover:border-accent/30',
 )}>
 {label} <span className="text-text-muted/70 ml-0.5">{osTypesPresent.get(key) ?? 0}</span>
 </button>
 ))}

 {/* Lot C cascading sub-filters: osName once a family is picked,
 then osVersion. Each is a multi-select popover (same UX as the
 tag picker just below): checkbox per option, live count, OR
 semantics on the server. Lets admins narrow to e.g.
 (Windows 10 + Windows 11) in one shot. The popovers are
 viewport-clamped (bottom sheet on phone) — see ToolbarPopover. */}
 {osNameOptions.length > 0 && (
 <div className="relative ml-1">
 <button
 ref={osNameBtnRef}
 onClick={() => setOsNameMenuOpen((v) => !v)}
 className={clsx(
 'flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full border transition-colors max-w-[260px] truncate coarse:py-2',
 osNameFilter.size > 0
 ? 'bg-accent/10 border-accent text-accent'
 : 'border-transparent text-text-muted hover:border-accent/30',
 )}
 title={t('devices.filters.osNames', 'Filtrer par version')}
 >
 {osNameFilter.size > 0
 ? (osNameFilter.size === 1
 ? shortenOsName([...osNameFilter][0])
 : t('devices.filters.osNamesCount', '{{count}} versions', { count: osNameFilter.size }))
 : t('devices.filters.allOsNames', 'Toutes les versions')}
 {osNameFilter.size > 0 && (
 <span className="text-[10px] text-accent/80 ml-0.5">{osNameFilter.size}</span>
 )}
 </button>
 </div>
 )}
 {osVersionOptions.length > 0 && (
 <div className="relative">
 <button
 ref={osVersionBtnRef}
 onClick={() => setOsVersionMenuOpen((v) => !v)}
 className={clsx(
 'flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full border transition-colors max-w-[200px] truncate coarse:py-2',
 osVersionFilter.size > 0
 ? 'bg-accent/10 border-accent text-accent'
 : 'border-transparent text-text-muted hover:border-accent/30',
 )}
 title={t('devices.filters.builds', 'Filtrer par build')}
 >
 {osVersionFilter.size > 0
 ? (osVersionFilter.size === 1
 ? [...osVersionFilter][0]
 : t('devices.filters.buildsCount', '{{count}} builds', { count: osVersionFilter.size }))
 : t('devices.filters.allBuilds', 'Tous les builds')}
 {osVersionFilter.size > 0 && (
 <span className="text-[10px] text-accent/80 ml-0.5">{osVersionFilter.size}</span>
 )}
 </button>
 </div>
 )}

 {/* Tag filter — popover listing every tag currently applied
 to a device, with per-tag counts. Selecting one or more
 tags filters server-side via the JSONB ?| operator
 (OR-semantics: device matches if it has ANY selected
 tag). Mirrors the columns popover's UX. */}
 <div className="relative">
 <button
 ref={tagsBtnRef}
 onClick={openTagsMenu}
 className={clsx(
 'flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full border transition-colors coarse:py-2',
 tagFilters.size > 0
 ? 'bg-accent/10 border-accent text-accent'
 : 'border-transparent text-text-muted hover:border-accent/30',
 )}
 title={t('devices.filters.tags', 'Filtrer par tag')}
 >
 <Tag className="w-3 h-3" />
 {t('devices.filters.tagsLabel', 'Tags')}
 {tagFilters.size > 0 && (
 <span className="text-[10px] text-accent/80">{tagFilters.size}</span>
 )}
 </button>
 </div>

 <span className="ml-auto text-xs text-text-muted">{t('devices.list.count', '{{count}} devices', { count: total, defaultValue_one: '{{count}} device' })}</span>
 </div>
 );

 // Popover bodies (shared by the floating popover and the phone sheet).
 const popRowCls = 'flex items-center gap-2 px-3 py-1.5 text-sm text-text-primary hover:bg-bg-tertiary cursor-pointer coarse:py-2.5';
 const exportContent = (
 <>
 <button onClick={() => handleExport('csv')} className="w-full text-left px-3 py-2 text-sm text-text-primary hover:bg-bg-tertiary coarse:py-3">CSV</button>
 <button onClick={() => handleExport('xlsx')} className="w-full text-left px-3 py-2 text-sm text-text-primary hover:bg-bg-tertiary coarse:py-3">Excel (xlsx)</button>
 <button onClick={() => handleExport('pdf')} className="w-full text-left px-3 py-2 text-sm text-text-primary hover:bg-bg-tertiary coarse:py-3">PDF</button>
 </>
 );
 const columnsContent = (
 <>
 <div className="px-3 py-2 flex items-center justify-between shrink-0">
 <span className="text-[11px] font-mono uppercase tracking-wider text-text-muted">
 {t('devices.columns.title', 'Colonnes affichées')}
 </span>
 <button onClick={resetColumns} className="text-[11px] text-accent hover:underline coarse:text-xs coarse:min-h-10 coarse:px-2">
 {t('common.reset', 'Réinit.')}
 </button>
 </div>
 <div className="min-h-0 overflow-y-auto">
 {LINE2_FIELDS.map(f => (
 <label key={f.key} className={popRowCls}>
 <input
 type="checkbox"
 checked={visibleFields.has(f.key)}
 onChange={() => toggleColumn(f.key)}
 className="accent-accent"
 />
 <span>{f.label}</span>
 </label>
 ))}
 </div>
 </>
 );
 const osNameContent = (
 <>
 <div className="px-3 py-2 flex items-center justify-between shrink-0">
 <span className="text-[11px] font-mono uppercase tracking-wider text-text-muted">
 {t('devices.filters.osNamesTitle', 'Versions')}
 </span>
 {osNameFilter.size > 0 && (
 <button
 onClick={() => setOsNameFilter(new Set())}
 className="text-[11px] text-accent hover:underline coarse:text-xs coarse:min-h-10 coarse:px-2"
 >
 {t('common.clear', 'Effacer')}
 </button>
 )}
 </div>
 <div className="min-h-0 overflow-y-auto">
 {osNameOptions.map(({ osName, count }) => (
 <label key={osName} className={popRowCls}>
 <input
 type="checkbox"
 checked={osNameFilter.has(osName)}
 onChange={() => toggleOsNameFilter(osName)}
 className="accent-accent"
 />
 <span className="flex-1 truncate" title={osName}>{shortenOsName(osName)}</span>
 <span className="text-[10px] text-text-muted">{count}</span>
 </label>
 ))}
 </div>
 </>
 );
 const osVersionContent = (
 <>
 <div className="px-3 py-2 flex items-center justify-between shrink-0">
 <span className="text-[11px] font-mono uppercase tracking-wider text-text-muted">
 {t('devices.filters.buildsTitle', 'Builds')}
 </span>
 {osVersionFilter.size > 0 && (
 <button
 onClick={() => setOsVersionFilter(new Set())}
 className="text-[11px] text-accent hover:underline coarse:text-xs coarse:min-h-10 coarse:px-2"
 >
 {t('common.clear', 'Effacer')}
 </button>
 )}
 </div>
 <div className="min-h-0 overflow-y-auto">
 {osVersionOptions.map(({ osVersion, count }) => (
 <label key={osVersion} className={popRowCls}>
 <input
 type="checkbox"
 checked={osVersionFilter.has(osVersion)}
 onChange={() => toggleOsVersionFilter(osVersion)}
 className="accent-accent"
 />
 <span className="flex-1 truncate font-mono" title={osVersion}>{osVersion}</span>
 <span className="text-[10px] text-text-muted">{count}</span>
 </label>
 ))}
 </div>
 </>
 );
 const tagsContent = (
 <>
 <div className="px-3 py-2 flex items-center justify-between shrink-0">
 <span className="text-[11px] font-mono uppercase tracking-wider text-text-muted">
 {t('devices.filters.tagsTitle', 'Tags appliqués')}
 </span>
 {tagFilters.size > 0 && (
 <button
 onClick={() => setTagFilters(new Set())}
 className="text-[11px] text-accent hover:underline coarse:text-xs coarse:min-h-10 coarse:px-2"
 >
 {t('common.clear', 'Effacer')}
 </button>
 )}
 </div>
 <div className="min-h-0 overflow-y-auto">
 {tagFacets.length === 0 ? (
 <div className="px-3 py-3 text-[12px] text-text-muted italic">
 {t('devices.filters.noTags', 'Aucun tag dans la flotte')}
 </div>
 ) : tagFacets.map((f) => (
 <label key={f.tag} className={popRowCls}>
 <input
 type="checkbox"
 checked={tagFilters.has(f.tag)}
 onChange={() => toggleTagFilter(f.tag)}
 className="accent-accent"
 />
 <span className="flex-1 truncate">{f.tag}</span>
 <span className="text-[10px] text-text-muted">{f.count}</span>
 </label>
 ))}
 </div>
 </>
 );

 // Batch actions — one data list, rendered with the historic markup in
 // the popover (desktop) or a bottom sheet (phone). A disabled action
 // explains itself: title= with a mouse, a visible line on touch.
 const closeBatchMenuThen = (fn: () => void) => () => { setBatchMenuOpen(false); fn(); };
 const batchItems: Array<{ key: string; icon: ReactNode; label: string; onClick: () => void; cmd?: CommandType; danger?: boolean; show?: boolean }> = [
 { key: 'approve', show: canManageApproval && approvalFilter === 'pending', icon: <ShieldCheck className="w-3.5 h-3.5 text-green-400" />, label: t('devices.batch.approve'), onClick: () => handleBatchAction('approve') },
 { key: 'restart_agent', cmd: 'restart_agent', icon: <RotateCcw className="w-3.5 h-3.5 text-blue-400" />, label: t('devices.batch.restartAgent'), onClick: () => handleBatchAction('restart_agent') },
 { key: 'reboot', cmd: 'reboot', icon: <RotateCcw className="w-3.5 h-3.5 text-orange-400" />, label: t('devices.batch.reboot'), onClick: () => handleBatchAction('reboot') },
 { key: 'shutdown', cmd: 'shutdown', icon: <PowerOff className="w-3.5 h-3.5 text-red-400" />, label: t('devices.batch.shutdown'), onClick: () => handleBatchAction('shutdown') },
 { key: 'scan_inventory', cmd: 'scan_inventory', icon: <Search className="w-3.5 h-3.5 text-text-muted" />, label: t('devices.batch.scanInventory'), onClick: () => handleBatchAction('scan_inventory') },
 { key: 'update_agent', cmd: 'update_agent', icon: <Download className="w-3.5 h-3.5 text-blue-400" />, label: t('devices.action.updateAgent') || 'Update agent', onClick: () => handleBatchAction('update_agent') },
 { key: 'run_script', cmd: 'run_script', icon: <Terminal className="w-3.5 h-3.5 text-accent" />, label: t('devices.batch.runScript') || 'Run script…', onClick: closeBatchMenuThen(() => setRunScriptOpen(true)) },
 { key: 'change_group', icon: <FolderOpen className="w-3.5 h-3.5 text-accent" />, label: t('devices.batch.changeGroup', 'Change group'), onClick: closeBatchMenuThen(() => setChangeGroupOpen(true)) },
 // Tenant transfer is structurally an admin action: it
 // moves a device row's tenant_id, which only the
 // master-tenant god view can resolve cross-tenant
 // references for. Users never see the foreign tenant
 // they'd transfer TO, so leave this admin-only.
 { key: 'transfer', show: isAdmin(), icon: <ArrowRightLeft className="w-3.5 h-3.5 text-accent" />, label: t('devices.batch.transferTenant', 'Transfer to another tenant'), onClick: closeBatchMenuThen(() => setTransferOpen(true)) },
 { key: 'delete', show: isAdmin(), danger: true, icon: <Trash2 className="w-3.5 h-3.5" />, label: t('devices.batch.delete'), onClick: () => handleBatchAction('delete') },
 { key: 'uninstall_agent', show: isAdmin(), danger: true, cmd: 'uninstall_agent', icon: <UserX className="w-3.5 h-3.5" />, label: t('devices.batch.uninstall'), onClick: () => handleBatchAction('uninstall_agent') },
 ];
 const batchContent = (
 <>
 {batchItems.filter((i) => i.show !== false).map((i) => {
 const unsupported = i.cmd ? !everySupports(i.cmd) : false;
 return (
 <button
 key={i.key}
 onClick={i.onClick}
 disabled={unsupported}
 title={unsupported ? unsupportedTooltip(t) : undefined}
 className={clsx(
 'w-full flex items-center gap-2 px-3 py-2 text-xs text-left coarse:py-3 coarse:text-sm',
 i.danger ? 'text-red-400 hover:bg-red-400/10' : 'text-text-primary hover:bg-bg-tertiary',
 i.cmd && 'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent',
 )}
 >
 {i.icon}
 <span className="min-w-0 flex-1">
 {i.label}
 {unsupported && (
 <span className="block can-hover:hidden text-[11px] text-text-muted">{unsupportedTooltip(t)}</span>
 )}
 </span>
 </button>
 );
 })}
 </>
 );

 // Phone overflow menu (export / columns / refresh / clear).
 const phoneMenuItems = [
 { key: 'csv', icon: <Download className="w-4 h-4" />, label: t('devices.export.csv', 'Export CSV'), onClick: () => handleExport('csv'), disabled: isExporting },
 { key: 'xlsx', icon: <Download className="w-4 h-4" />, label: t('devices.export.xlsx', 'Export Excel (xlsx)'), onClick: () => handleExport('xlsx'), disabled: isExporting },
 { key: 'pdf', icon: <Download className="w-4 h-4" />, label: t('devices.export.pdf', 'Export PDF'), onClick: () => handleExport('pdf'), disabled: isExporting },
 { key: 'columns', icon: <Columns3 className="w-4 h-4" />, label: t('devices.columns.button', 'Colonnes'), onClick: () => setColumnsMenuOpen(true), separator: true },
 { key: 'refresh', icon: <RefreshCw className="w-4 h-4" />, label: t('common.refresh', 'Refresh'), onClick: () => load(true) },
 { key: 'clear', icon: <X className="w-4 h-4" />, label: t('devices.filters.clearAll', 'Clear filters'), onClick: clearAllFilters, hidden: !hasFilters },
 ];

 // Name of the scope shown on the "Groups" drawer button.
 const scopeLabel = (() => {
 if (groupId === -1) return t('groupPanel.ungrouped', 'Ungrouped');
 if (groupId == null) return t('groupPanel.allDevices');
 const find = (nodes: DeviceGroupTreeNode[]): string | null => {
 for (const n of nodes) {
 if (n.id === groupId) return n.name;
 const f = find(n.children);
 if (f) return f;
 }
 return null;
 };
 return anonymize(find(tree)) || t('groupPanel.title');
 })();
 const groupsButton = onOpenGroups ? (
 <button
 type="button"
 onClick={onOpenGroups}
 className="flex min-w-0 items-center gap-1.5 px-2.5 py-2 text-xs rounded-lg bg-bg-secondary text-text-primary hover:bg-bg-tertiary transition-colors coarse:min-h-10"
 aria-label={`${t('groupPanel.title')}: ${scopeLabel}`}
 >
 <FolderTree className="w-3.5 h-3.5 shrink-0 text-accent" />
 <span className="truncate">{scopeLabel}</span>
 </button>
 ) : null;

 const selectToggle = (
 <button
 onClick={() => {
 const next = !selectionMode;
 setSelectionMode(next);
 if (!next) { setSelectedIds(new Set()); setSelectAllGroup(false); }
 }}
 className={clsx(
 'flex items-center gap-1.5 px-2.5 py-2 text-xs rounded-lg border transition-colors coarse:min-h-10',
 selectionMode
 ? 'bg-accent text-white border-accent'
 : 'bg-bg-secondary border-transparent text-text-muted hover:text-text-primary hover:border-accent/40',
 )}
 title={selectionMode ? t('devices.selection.exit', 'Exit selection mode') : t('devices.selection.enter', 'Enter selection mode — click any row to select')}
 aria-pressed={selectionMode}
 >
 {selectionMode ? <Check className="w-3.5 h-3.5" /> : <MousePointerClick className="w-3.5 h-3.5" />}
 <span className={compactToolbar ? undefined : 'hidden sm:inline'}>{selectionMode ? t('devices.selection.active', 'Selecting') : t('devices.selection.select', 'Select')}</span>
 </button>
 );

 const SORT_OPTIONS: Array<{ field: Exclude<SortField, ''>; label: string }> = [
 { field: 'name', label: t('sort.name', 'Name') },
 { field: 'status', label: t('sort.status', 'Status') },
 { field: 'lastSeen', label: t('sort.lastSeen', 'Last seen') },
 { field: 'os', label: t('sort.os', 'OS') },
 { field: 'version', label: t('sort.version', 'Agent version') },
 { field: 'group', label: t('sort.group', 'Group') },
 { field: 'cpu', label: 'CPU' },
 { field: 'ram', label: 'RAM' },
 { field: 'disk', label: t('sort.disk', 'Disk') },
 ];

 return (
 <div className={clsx('flex flex-col space-y-3', embedded ? 'lg:p-6' : 'p-3 sm:p-4 lg:p-6')}>
 {/* Sticky toolbar — keeps approval chips + filters + search +
 Select/Columns visible while the user scrolls through the
 device list. The right pane in DevicesPageLayout is the
 scroll container; sticky-top-0 pins this band there.
 Background must be opaque (bg-bg-primary) or the list
 beneath bleeds through the bar at scroll.
 Phone: only the search + a compact action row stay sticky; the
 chips move to the "Filters" sheet (the full band would cover
 most of a portrait screen and all of a landscape one). */}
 <div
 className={clsx(
 'sticky top-0 z-20 pb-3 bg-bg-primary space-y-3',
 embedded
 ? 'lg:-mx-6 lg:-mt-6 lg:px-6 lg:pt-6'
 : '-mx-3 -mt-3 px-3 pt-3 sm:-mx-4 sm:-mt-4 sm:px-4 sm:pt-4 lg:-mx-6 lg:-mt-6 lg:px-6 lg:pt-6',
 )}
 >
 {!compactToolbar && approvalChips}

 {/* Filter bar */}
 <div className={clsx('space-y-2', !compactToolbar && 'mb-3')}>
 {compactToolbar ? (
 <>
 <div className="relative">
 <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
 <input type="search" value={search} onChange={e => setSearch(e.target.value)}
 placeholder={t('devices.filters.search')}
 autoCapitalize="off" autoCorrect="off" spellCheck={false} enterKeyHint="search"
 className="w-full pl-9 pr-3 py-2 text-sm bg-bg-secondary rounded-lg text-text-primary focus:outline-none focus:border-accent" />
 </div>
 <div className="flex items-center gap-2">
 {groupsButton
 ? <div className="min-w-0 flex-1 [&>button]:w-full">{groupsButton}</div>
 : <div className="flex-1" />}
 <button
 type="button"
 onClick={() => setFiltersOpen(true)}
 className={clsx(
 'flex shrink-0 items-center gap-1.5 px-2.5 py-2 text-xs rounded-lg border transition-colors coarse:min-h-10',
 activeFilterCount > 0
 ? 'bg-accent/10 border-accent text-accent'
 : 'bg-bg-secondary border-transparent text-text-muted hover:text-text-primary',
 )}
 >
 <SlidersHorizontal className="w-3.5 h-3.5" />
 {t('devices.filters.button', 'Filters')}
 {activeFilterCount > 0 && <span className="font-semibold">({activeFilterCount})</span>}
 </button>
 <span className="shrink-0">{selectToggle}</span>
 <ActionMenu
 items={phoneMenuItems}
 trigger={(p) => (
 <button
 {...p}
 type="button"
 aria-label={t('ui.moreActions', 'More actions')}
 className="flex shrink-0 items-center justify-center rounded-lg bg-bg-secondary p-2 text-text-muted hover:text-text-primary coarse:min-h-10 coarse:min-w-10"
 >
 {isExporting || isLoading
 ? <Loader2 className="w-4 h-4 animate-spin" />
 : <MoreHorizontal className="w-4 h-4" />}
 </button>
 )}
 />
 </div>
 </>
 ) : (
 /* Search + sort + pagesize + refresh */
 <div className="flex items-center gap-2">
 {groupsButton && <div className="shrink-0 max-w-[40%]">{groupsButton}</div>}
 <div className="relative flex-1">
 <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
 <input type="text" value={search} onChange={e => setSearch(e.target.value)}
 placeholder={t('devices.filters.search')}
 title={t('devices.filters.searchHint', 'Searches hostname, display name, IP, MAC, last user, OS, agent version, location, tags, notes, UUID')}
 autoCapitalize="off" autoCorrect="off" spellCheck={false}
 className="w-full pl-9 pr-3 py-2 text-sm bg-bg-secondary rounded-lg text-text-primary focus:outline-none focus:border-accent" />
 </div>
 {hasFilters && (
 <button onClick={clearAllFilters}
 aria-label={t('devices.filters.clearAll', 'Clear filters')}
 className="p-2 text-text-muted hover:text-text-primary coarse:min-h-10 coarse:min-w-10"><X className="w-3.5 h-3.5" /></button>
 )}
 <div className="relative">
 <button
 ref={exportBtnRef}
 onClick={() => setExportMenuOpen((v) => !v)}
 disabled={isExporting}
 className="p-2 text-text-muted hover:text-text-primary rounded-lg hover:bg-bg-secondary transition-colors disabled:opacity-50 coarse:min-h-10 coarse:min-w-10"
 title={t('devices.export.title', 'Export filtered devices')}
 aria-label={t('devices.export.title', 'Export filtered devices')}
 >
 <Download className={clsx('w-4 h-4', isExporting && 'animate-pulse')} />
 </button>
 </div>
 {selectToggle}
 {/* Lot D.1 — column toggle popover. Lets the user opt-in to extra
 fields on each row (IP WAN, MAC, geo, lifecycle, warranty, …).
 Choices are persisted in localStorage. */}
 <div className="relative">
 <button
 ref={columnsBtnRef}
 onClick={() => setColumnsMenuOpen(v => !v)}
 className={clsx(
 'flex items-center gap-1.5 px-2.5 py-2 text-xs rounded-lg border transition-colors coarse:min-h-10',
 columnsMenuOpen
 ? 'bg-accent text-white border-accent'
 : 'bg-bg-secondary border-transparent text-text-muted hover:text-text-primary hover:border-accent/40',
 )}
 title={t('devices.columns.title', 'Colonnes affichées')}
 >
 <SortAsc className="w-3.5 h-3.5" />
 <span className="hidden sm:inline">{t('devices.columns.button', 'Colonnes')}</span>
 </button>
 </div>
 <button onClick={() => load(true)}
 aria-label={t('common.refresh', 'Refresh')}
 className="p-2 text-text-muted hover:text-text-primary rounded-lg hover:bg-bg-secondary transition-colors coarse:min-h-10 coarse:min-w-10">
 <RefreshCw className={clsx('w-4 h-4', isLoading && 'animate-spin')} />
 </button>
 </div>
 )}

 {!compactToolbar && tenantChips}

 {/* Status + OS chips */}
 {!compactToolbar && statusOsChips}
 </div>

 {/* Batch action bar */}
 {hasSelection && (
 <div className="flex items-center gap-3 p-2.5 mb-3 bg-accent/5 border border-accent/20 rounded-lg max-md:flex-wrap max-md:gap-2">
 <StyledCheckbox checked={allChecked} indeterminate={someChecked} onChange={toggleAll} />
 <span className="text-sm font-medium text-text-primary">
 {selectAllGroup ? t('devices.batch.allGroupSelected', { count: total }) : t('devices.batch.selected', { count: selectedIds.size })}
 </span>
 {!selectAllGroup && groupId && total > devices.length && (
 <button onClick={handleSelectAllGroup} className="text-xs text-accent hover:underline coarse:min-h-10 max-md:order-last max-md:basis-full max-md:text-left">
 {t('devices.batch.selectAllGroup', { count: total })}
 </button>
 )}
 <div className="relative ml-auto">
 <button ref={batchBtnRef} onClick={() => setBatchMenuOpen(!batchMenuOpen)} disabled={isBatchRunning}
 aria-haspopup="menu" aria-expanded={batchMenuOpen}
 className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-accent text-white rounded-lg hover:bg-accent/80 disabled:opacity-50 transition-colors coarse:min-h-10">
 {isBatchRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MoreHorizontal className="w-3.5 h-3.5" />}
 {t('devices.batch.actions')}
 </button>
 </div>
 <button onClick={() => { setSelectedIds(new Set()); setSelectAllGroup(false); }}
 aria-label={t('devices.batch.clearSelection', 'Clear selection')}
 className="text-xs text-text-muted hover:text-text-primary flex items-center gap-1 coarse:min-h-10 coarse:min-w-10 coarse:justify-center">
 <X className="w-3.5 h-3.5" />
 </button>
 </div>
 )}
 </div>{/* /sticky toolbar */}

 {/* Toolbar popovers — portal-rendered, clamped to the viewport,
 bottom sheets on phone (docs/obli-mobile.md §5). */}
 <ToolbarPopover open={exportMenuOpen && !compactToolbar} onClose={() => setExportMenuOpen(false)} anchorRef={exportBtnRef} align="end"
 sheetLabel={t('devices.export.title', 'Export filtered devices')}
 className="w-32 bg-bg-secondary rounded-lg shadow-xl overflow-hidden overflow-y-auto">
 {exportContent}
 </ToolbarPopover>
 <ToolbarPopover open={columnsMenuOpen} onClose={() => setColumnsMenuOpen(false)} anchorRef={columnsBtnRef} align="end" sheet={compactToolbar}
 sheetLabel={t('devices.columns.title', 'Colonnes affichées')}
 className="w-56 flex flex-col bg-bg-secondary rounded-lg shadow-xl overflow-hidden">
 {columnsContent}
 </ToolbarPopover>
 <ToolbarPopover open={osNameMenuOpen} onClose={() => setOsNameMenuOpen(false)} anchorRef={osNameBtnRef} align="start" maxHeight={320} sheet={compactToolbar}
 sheetLabel={t('devices.filters.osNamesTitle', 'Versions')}
 className="w-72 flex flex-col bg-bg-secondary rounded-lg shadow-xl overflow-hidden">
 {osNameContent}
 </ToolbarPopover>
 <ToolbarPopover open={osVersionMenuOpen} onClose={() => setOsVersionMenuOpen(false)} anchorRef={osVersionBtnRef} align="start" maxHeight={320} sheet={compactToolbar}
 sheetLabel={t('devices.filters.buildsTitle', 'Builds')}
 className="w-64 flex flex-col bg-bg-secondary rounded-lg shadow-xl overflow-hidden">
 {osVersionContent}
 </ToolbarPopover>
 <ToolbarPopover open={tagsMenuOpen} onClose={() => setTagsMenuOpen(false)} anchorRef={tagsBtnRef} align="start" maxHeight={320} sheet={compactToolbar}
 sheetLabel={t('devices.filters.tagsTitle', 'Tags appliqués')}
 className="w-64 flex flex-col bg-bg-secondary rounded-lg shadow-xl overflow-hidden">
 {tagsContent}
 </ToolbarPopover>
 <ToolbarPopover open={batchMenuOpen && hasSelection} onClose={() => setBatchMenuOpen(false)} anchorRef={batchBtnRef} align="end" sheet={compactToolbar}
 sheetLabel={t('devices.batch.actions')}
 className="bg-bg-secondary rounded-lg shadow-lg overflow-hidden overflow-y-auto min-w-[180px]">
 {batchContent}
 </ToolbarPopover>

 {/* Phone / short touch screen: filter chips in a bottom sheet. */}
 {compactToolbar && (
 <Drawer
 open={filtersOpen}
 onClose={() => setFiltersOpen(false)}
 side="bottom"
 size="lg"
 title={t('devices.filters.button', 'Filters')}
 headerExtra={hasFilters || activeFilterCount > 0 ? (
 <button
 type="button"
 onClick={() => {
 clearAllFilters();
 setTagFilters(new Set());
 setTenantFilters(new Set());
 if (canManageApproval) setApprovalFilter('');
 }}
 className="text-xs text-accent hover:underline min-h-10 px-2"
 >
 {t('devices.filters.clearAll', 'Clear filters')}
 </button>
 ) : undefined}
 bodyClassName="px-4 pb-4 pt-1 space-y-3"
 footer={
 <button
 type="button"
 onClick={() => setFiltersOpen(false)}
 className="w-full min-h-11 rounded-lg bg-accent text-sm font-medium text-white"
 >
 {t('devices.filters.showResults', 'Show {{count}} devices', { count: total, defaultValue_one: 'Show {{count}} device' })}
 </button>
 }
 >
 {approvalChips}
 {tenantChips}
 {statusOsChips}
 </Drawer>
 )}

 {/* Device list */}
 {isLoading ? (
 <div className="flex items-center justify-center h-48">
 <RefreshCw className="w-5 h-5 animate-spin text-text-muted" />
 </div>
 ) : devices.length === 0 ? (
 <div className="p-12 text-center text-text-muted bg-bg-secondary rounded-xl">
 <p className="font-medium text-text-primary mb-1">{t('devices.noDevices')}</p>
 </div>
 ) : (
 <div className="bg-bg-secondary rounded-xl overflow-hidden">
 {headerSortLabels ? (
 /* Column header row with click-to-sort. The layout isn't a true
 HTML table — DeviceRow is a "rich row" with 2 lines per device —
 but this header approximates the column positions so the user
 can click the label closest to the data they want to sort by. */
 <div className="flex items-center gap-3 px-4 py-2 bg-bg-tertiary/50 text-[10px] uppercase tracking-wider font-medium text-text-muted">
 {(isAdmin() || selectionMode) && (
 <StyledCheckbox checked={allChecked} indeterminate={someChecked} onChange={toggleAll} />
 )}
 <SortLabel label={t('sort.name', 'Name')} field="name" sortBy={sortBy} sortOrder={sortOrder} onClick={handleSort} />
 <div className="flex-1" />
 {mode === 'monitoring' && (
 <>
 <SortLabel label="CPU" field="cpu" sortBy={sortBy} sortOrder={sortOrder} onClick={handleSort} className="w-14 justify-center" />
 <SortLabel label="RAM" field="ram" sortBy={sortBy} sortOrder={sortOrder} onClick={handleSort} className="w-14 justify-center" />
 <SortLabel label={t('sort.disk', 'Disk')} field="disk" sortBy={sortBy} sortOrder={sortOrder} onClick={handleSort} className="w-14 justify-center" />
 </>
 )}
 <SortLabel label={t('sort.status', 'Status')} field="status" sortBy={sortBy} sortOrder={sortOrder} onClick={handleSort} className="w-20 justify-center" />
 <SortLabel label={t('sort.lastSeen', 'Last seen')} field="lastSeen" sortBy={sortBy} sortOrder={sortOrder} onClick={handleSort} className="w-12 justify-end" />
 <span className="w-6" />
 {selectionMode && (
 <span className="ml-2 text-accent">
 {t('devices.selection.modeLabel', 'Selection mode')}
 </span>
 )}
 </div>
 ) : (
 /* Phone / tablet: the 10px header labels are no touch target
 (and CPU / RAM / Disk were unreachable in admin mode) — a
 native select lists every sort field + a direction toggle. */
 <div className="flex items-center gap-2 px-3 py-2 bg-bg-tertiary/50 text-xs text-text-muted">
 {(isAdmin() || selectionMode) && (
 <StyledCheckbox checked={allChecked} indeterminate={someChecked} onChange={toggleAll} className="mr-1" />
 )}
 <label className="flex min-w-0 flex-1 items-center gap-2">
 <span className="shrink-0 text-[10px] uppercase tracking-wider font-medium">{t('devices.sort.label', 'Sort')}</span>
 <select
 value={sortBy}
 onChange={(e) => {
 const f = e.target.value as SortField;
 if (!f) { setSortBy(''); setSortOrder('asc'); return; }
 setSortBy(f);
 setSortOrder(defaultSortOrder(f));
 }}
 className="min-w-0 flex-1 rounded-md bg-bg-secondary px-2 py-1.5 text-sm text-text-primary focus:outline-none coarse:min-h-10"
 >
 <option value="">{t('devices.sort.default', 'Default (by group)')}</option>
 {SORT_OPTIONS.map((o) => <option key={o.field} value={o.field}>{o.label}</option>)}
 </select>
 </label>
 <IconButton
 label={sortOrder === 'asc' ? t('devices.sort.ascending', 'Ascending') : t('devices.sort.descending', 'Descending')}
 icon={sortOrder === 'asc' ? <SortAsc className="w-4 h-4" /> : <SortDesc className="w-4 h-4" />}
 disabled={sortBy === ''}
 active={sortBy !== ''}
 variant="ghost"
 onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
 />
 {selectionMode && (
 <span className="shrink-0 text-[10px] uppercase tracking-wider text-accent">
 {t('devices.selection.modeLabel', 'Selection mode')}
 </span>
 )}
 </div>
 )}
 <div>
 <DeviceListBody
 devices={(isMaster && tenantFilters.size > 0)
 ? devices.filter((d) => tenantFilters.has(d.tenantId))
 : devices}
 tree={(isMaster && tenantFilters.size > 0)
 ? tree.filter((g) => tenantFilters.has(g.tenantId))
 : tree}
 groupId={groupId}
 searchActive={!!debouncedSearch.trim()}
 collapsedGroupIds={collapsedGroupIds}
 onToggleGroup={toggleGroupCollapsed}
 mode={mode}
 selectedIds={selectedIds}
 toggleSelect={toggleSelect}
 onNavigate={id => navigate(`/devices/${id}`)}
 onGroupChange={onGroupChange}
 selectionMode={selectionMode}
 visibleFields={visibleFieldsForMaster}
 isMaster={isMaster}
 collapsedTenantIds={collapsedTenantIds}
 onToggleTenant={toggleTenantCollapsed}
 indentStep={isPhone ? 8 : 16}
 />
 </div>
 </div>
 )}

 {/* Footer: total + load-more fallback. In tree mode the whole
 scope is already loaded; in flat mode the IntersectionObserver
 sentinel below handles progressive loading, with a manual
 "Load more" button as a fallback for browsers that don't fire
 the observer (or zero-height containers). */}
 {total > 0 && (
 <div className="flex items-center justify-between mt-3 text-xs text-text-muted max-md:flex-wrap max-md:gap-2">
 <span>
 {treeViewActive
 ? t('devices.list.count', '{{count}} devices', { count: total, defaultValue_one: '{{count}} device' })
 : `${devices.length} / ${total}`}
 </span>
 {treeViewActive && total > TREE_MAX && (
 <span className="text-amber-400">
 {t('devices.pagination.treeCapped', { shown: TREE_MAX, total }) ||
 `Showing first ${TREE_MAX} of ${total} — use search or pick a sub-group to narrow.`}
 </span>
 )}
 {!treeViewActive && hasMore && (
 <button
 onClick={() => load(false)}
 disabled={appending}
 className="px-2 py-1 rounded hover:bg-bg-secondary disabled:opacity-50 transition-colors coarse:min-h-10 coarse:px-3"
 >
 {appending
 ? (t('common.loading') || 'Loading…')
 : (t('devices.pagination.loadMore') || 'Load more')}
 </button>
 )}
 </div>
 )}

 {/* Infinite-scroll sentinel — watched by the IntersectionObserver
 set up in the effect above. Only rendered in flat mode when
 more rows are available. */}
 {!treeViewActive && hasMore && (
 <div ref={sentinelRef} className="h-px" aria-hidden />
 )}

 {/* ── Bulk change-group modal ──────────────────────────────────── */}
 {changeGroupOpen && (
 <ChangeGroupModal
 count={selectedIds.size}
 onCancel={() => setChangeGroupOpen(false)}
 onConfirm={async (newGroupId) => {
 setChangeGroupOpen(false);
 setIsBatchRunning(true);
 try {
 const ids = Array.from(selectedIds);
 const r = await deviceApi.batchChangeGroup(ids, newGroupId);
 toast.success(t('devices.batch.groupChanged', { count: r.changed, defaultValue: `Moved ${r.changed} device${r.changed > 1 ? 's' : ''}` }));
 setSelectedIds(new Set());
 setSelectAllGroup(false);
 await load(true);
 } catch {
 toast.error(t('common.error'));
 } finally {
 setIsBatchRunning(false);
 }
 }}
 />
 )}

 {runScriptOpen && (
 <RunScriptModal
 count={selectedIds.size}
 onCancel={() => setRunScriptOpen(false)}
 onConfirm={async (scriptId) => {
 setRunScriptOpen(false);
 setIsBatchRunning(true);
 try {
 const ids = Array.from(selectedIds);
 const execs = await scriptApi.executeNow(scriptId, { deviceIds: ids });
 toast.success(t('devices.batch.runScriptDispatched', { count: execs.length, defaultValue: `Script dispatched to ${execs.length} device${execs.length > 1 ? 's' : ''}` }));
 setSelectedIds(new Set());
 setSelectAllGroup(false);
 } catch {
 toast.error(t('common.error'));
 } finally {
 setIsBatchRunning(false);
 }
 }}
 />
 )}

 {transferOpen && (
 <BulkTransferTenantModal
 count={selectedIds.size}
 onCancel={() => setTransferOpen(false)}
 onConfirm={async (targetTenantId, targetApiKeyId) => {
 setTransferOpen(false);
 setIsBatchRunning(true);
 try {
 const ids = Array.from(selectedIds);
 const r = await deviceApi.bulkTransfer(ids, targetTenantId, targetApiKeyId);
 if (r.transferred > 0) toast.success(t('devices.transfer.bulkDone', 'Transferred {{n}} device(s)', { n: r.transferred }));
 if (r.failed > 0) toast.error(t('devices.transfer.bulkFailed', '{{n}} transfer(s) failed — see audit log', { n: r.failed }));
 setSelectedIds(new Set());
 setSelectAllGroup(false);
 await load(true);
 } catch (err: any) {
 if (err?.response?.status !== 202) {
 toast.error(err?.response?.data?.error || t('common.error'));
 }
 } finally {
 setIsBatchRunning(false);
 }
 }}
 />
 )}
 </div>
 );
}

// Metric / recency sorts default to desc (highest / most recent first) —
// that's the useful direction. Alpha fields default asc.
function defaultSortOrder(field: SortField): 'asc' | 'desc' {
 return ['cpu', 'ram', 'disk', 'lastSeen', 'status'].includes(field) ? 'desc' : 'asc';
}

// ── Toolbar popover ─────────────────────────────────────────────────────────
//
// Desktop / tablet: the historic dropdown look, but rendered in a portal with
// position: fixed and clamped to the viewport (flips above the anchor when
// there is no room below, never overflows the right edge on a narrow screen),
// with a transparent click-catcher so an outside click only closes it — as
// before. Escape / Android back close it too. Phone: a bottom sheet.

function ToolbarPopover({
 open, onClose, anchorRef, align = 'start', maxHeight, className, sheetLabel, sheet, children,
}: {
 open: boolean;
 onClose: () => void;
 anchorRef: RefObject<HTMLElement>;
 align?: 'start' | 'end';
 /** Cap in px (e.g. the historic max-h-[320px]); the viewport may cap it lower. */
 maxHeight?: number;
 /** Classes of the floating panel (not used for the phone sheet). */
 className?: string;
 sheetLabel?: string;
 /** Force the bottom-sheet rendering (default: phone layout only). */
 sheet?: boolean;
 children: ReactNode;
}) {
 const layout = useLayoutMode();
 const asSheet = sheet || layout === 'phone';
 const popRef = useRef<HTMLDivElement>(null);
 const floating = open && !asSheet;
 const pos = useAnchoredPosition(anchorRef, popRef, floating, { placement: 'bottom', align, offset: 4 });
 useNativeBack(() => onClose(), floating, { escape: true });

 if (!open) return null;
 if (asSheet) {
 return (
 <Drawer
 open
 onClose={onClose}
 side="bottom"
 size="md"
 ariaLabel={sheetLabel}
 overlayClassName="z-[260]"
 bodyClassName="px-0 pt-0 pb-3"
 >
 {children}
 </Drawer>
 );
 }
 const cap = pos ? (maxHeight ? Math.min(maxHeight, pos.maxHeight) : pos.maxHeight) : maxHeight;
 return createPortal(
 <>
 <div className="fixed inset-0 z-[259]" onClick={onClose} aria-hidden />
 <div
 ref={popRef}
 style={{
 position: 'fixed',
 top: pos?.top ?? 0,
 left: pos?.left ?? 0,
 maxHeight: cap,
 visibility: pos ? 'visible' : 'hidden',
 }}
 className={cn('z-[260] max-w-[calc(100vw-1rem)]', className)}
 >
 {children}
 </div>
 </>,
 document.body,
 );
}

// ── Change-group modal ─────────────────────────────────────────────────────
function ChangeGroupModal({
 count, onCancel, onConfirm,
}: {
 count: number;
 onCancel: () => void;
 onConfirm: (groupId: number | null) => void;
}) {
 const { t } = useTranslation();
 const [groupId, setGroupId] = useState<number | null>(null);
 return (
 <Modal
 open
 onClose={onCancel}
 size="sm"
 icon={<FolderOpen className="w-4 h-4 text-accent" />}
 title={t('devices.batch.changeGroupTitle', { count, defaultValue: `Change group for ${count} device${count > 1 ? 's' : ''}` })}
 bodyClassName="px-4 py-4 space-y-3"
 footer={
 <>
 <button
 onClick={onCancel}
 className="px-3 py-1.5 text-xs rounded text-text-muted hover:text-text-primary coarse:min-h-10"
 >
 {t('common.cancel', 'Cancel')}
 </button>
 <button
 onClick={() => onConfirm(groupId)}
 className="px-3 py-1.5 text-xs bg-accent text-white rounded hover:bg-accent/90 coarse:min-h-10"
 >
 {t('devices.batch.moveHere', 'Move')}
 </button>
 </>
 }
 >
 <p className="text-xs text-text-muted">
 {t('devices.batch.changeGroupHint', 'Pick a target group, or leave blank to move to "Ungrouped".')}
 </p>
 <GroupTreePicker value={groupId} onChange={(id) => setGroupId(id)} />
 </Modal>
 );
}

// ── Bulk transfer-tenant modal ────────────────────────────────────────────
function BulkTransferTenantModal({
 count, onCancel, onConfirm,
}: {
 count: number;
 onCancel: () => void;
 onConfirm: (targetTenantId: number, targetApiKeyId: number) => void;
}) {
 const { t } = useTranslation();
 const [candidates, setCandidates] = useState<Array<{ tenantId: number; tenantName: string; tenantSlug: string; apiKeys: Array<{ id: number; label: string; defaultGroupId: number | null }> }>>([]);
 const [loading, setLoading] = useState(true);
 const [tenantId, setTenantId] = useState<number | null>(null);
 const [keyId, setKeyId] = useState<number | null>(null);

 useEffect(() => {
 deviceApi.listTransferCandidatesForBatch()
 .then((rows) => {
 setCandidates(rows);
 if (rows.length === 1) {
 setTenantId(rows[0].tenantId);
 if (rows[0].apiKeys.length > 0) setKeyId(rows[0].apiKeys[0].id);
 }
 })
 .catch(() => toast.error(t('devices.transfer.loadFailed', 'Failed to load target tenants')))
 .finally(() => setLoading(false));
 }, [t]);

 const selectedTenant = candidates.find((c) => c.tenantId === tenantId);

 return (
 <Modal
 open
 onClose={onCancel}
 size="md"
 icon={<ArrowRightLeft className="w-4 h-4 text-accent" />}
 title={t('devices.transfer.bulkTitle', 'Transfer {{n}} device(s) to another tenant', { n: count })}
 bodyClassName="px-4 py-4 space-y-4"
 footer={
 <>
 <button onClick={onCancel} className="px-3 py-1.5 text-xs rounded text-text-muted hover:text-text-primary coarse:min-h-10">
 {t('common.cancel', 'Cancel')}
 </button>
 <button
 disabled={!tenantId || !keyId}
 onClick={() => { if (tenantId && keyId) onConfirm(tenantId, keyId); }}
 className="px-3 py-1.5 text-xs bg-accent text-white rounded hover:bg-accent/90 disabled:opacity-50 coarse:min-h-10"
 >
 {t('devices.transfer.submit', 'Transfer')}
 </button>
 </>
 }
 >
 <div className="flex items-start gap-2 p-2.5 rounded bg-orange-400/5 border border-orange-400/20 text-[11px] text-orange-400/90">
 {t('devices.transfer.bulkWarning', "Group assignment, custom metrics and compliance results in the current tenant will be cleared for every selected device. Each agent is reconfigured with the target tenant's API key on its next check-in.")}
 </div>
 {loading ? (
 <div className="py-8 flex justify-center text-text-muted"><Loader2 className="w-5 h-5 animate-spin" /></div>
 ) : candidates.length === 0 ? (
 <p className="text-sm text-text-muted italic">{t('devices.transfer.noCandidatesShort', 'You are not admin in any other tenant.')}</p>
 ) : (
 <>
 <div>
 <label className="block text-[10px] uppercase font-semibold text-text-muted mb-1.5">{t('devices.transfer.targetTenant', 'Target tenant')}</label>
 <select
 value={tenantId ?? ''}
 onChange={(e) => {
 const id = e.target.value ? parseInt(e.target.value) : null;
 setTenantId(id);
 const tc = candidates.find((c) => c.tenantId === id);
 setKeyId(tc && tc.apiKeys.length > 0 ? tc.apiKeys[0].id : null);
 }}
 className="w-full px-3 py-2 text-sm bg-bg-tertiary rounded text-text-primary focus:outline-none focus:border-accent"
 >
 <option value="">{t('devices.transfer.selectShort', '— Select —')}</option>
 {candidates.map((c) => (
 <option key={c.tenantId} value={c.tenantId}>
 {c.tenantName} ({c.tenantSlug}){c.apiKeys.length === 0 ? ` — ${t('devices.transfer.noApiKeys', 'no API keys')}` : ''}
 </option>
 ))}
 </select>
 </div>
 {selectedTenant && selectedTenant.apiKeys.length > 0 && (
 <div>
 <label className="block text-[10px] uppercase font-semibold text-text-muted mb-1.5">{t('devices.transfer.targetKey', 'Target API key')}</label>
 <select
 value={keyId ?? ''}
 onChange={(e) => setKeyId(e.target.value ? parseInt(e.target.value) : null)}
 className="w-full px-3 py-2 text-sm bg-bg-tertiary rounded text-text-primary focus:outline-none focus:border-accent"
 >
 {selectedTenant.apiKeys.map((k) => (
 <option key={k.id} value={k.id}>{k.label || t('devices.transfer.keyFallback', 'Key #{{id}}', { id: k.id })}</option>
 ))}
 </select>
 </div>
 )}
 </>
 )}
 </Modal>
 );
}

// ── Hierarchical list body ────────────────────────────────────────────────
//
// Two rendering modes, chosen based on whether the user is searching:
//
// 1. Tree mode (no search) — devices are bucketed by groupId, then
// rendered under a nested group header tree. Each group header has a
// chevron to collapse/expand; state is persisted in localStorage so
// the admin's view shape survives reloads. Empty branches of the
// tree (no device in the current page) are hidden so the listing
// stays tight.
//
// 2. Flat mode (active search) — every group header is dropped and the
// devices render in a single flat list. When the admin is looking
// for a specific machine, group membership is noise.

type GroupRenderContext = {
 devicesByGroupId: Map<number | null, Device[]>;
 collapsedGroupIds: Set<number>;
 onToggleGroup: (id: number) => void;
 mode: 'monitoring' | 'admin';
 selectedIds: Set<number>;
 toggleSelect: (id: number) => void;
 onNavigate: (id: number) => void;
 onGroupChange?: (id: number | null) => void;
 selectionMode: boolean;
 /** Lot D.1 — which optional line-2 fields the user has enabled. Threaded
 * through to every DeviceRow render. */
 visibleFields: Set<string>;
 /** Indentation per tree level in px (16 on tablet / desktop, 8 on phone
 * where every pixel of row width counts). */
 indentStep: number;
};

function hasDevicesRecursive(
 node: DeviceGroupTreeNode,
 byId: Map<number | null, Device[]>,
): boolean {
 if ((byId.get(node.id) ?? []).length > 0) return true;
 return node.children.some((c) => hasDevicesRecursive(c, byId));
}

function countDevicesRecursive(
 node: DeviceGroupTreeNode,
 byId: Map<number | null, Device[]>,
): number {
 let n = (byId.get(node.id) ?? []).length;
 for (const c of node.children) n += countDevicesRecursive(c, byId);
 return n;
}

function renderTreeNode(
 node: DeviceGroupTreeNode,
 depth: number,
 ctx: GroupRenderContext,
): JSX.Element[] {
 if (!hasDevicesRecursive(node, ctx.devicesByGroupId)) return [];

 const own = ctx.devicesByGroupId.get(node.id) ?? [];
 const isCollapsed = ctx.collapsedGroupIds.has(node.id);
 const totalBelow = countDevicesRecursive(node, ctx.devicesByGroupId);
 // Nested groups shift right by 16 px per level so the hierarchy reads
 // at a glance. Cap at depth 6 to avoid tiny device rows on pathological
 // trees.
 const indent = Math.min(depth, 6) * ctx.indentStep;

 const out: JSX.Element[] = [
 <button
 key={`g-${node.id}`}
 onClick={() => ctx.onToggleGroup(node.id)}
 aria-expanded={!isCollapsed}
 className="w-full flex items-center gap-2 px-4 py-1.5 bg-bg-tertiary/70 hover:bg-bg-tertiary transition-colors text-left coarse:min-h-10"
 style={{ paddingLeft: `${(ctx.indentStep === 16 ? 16 : 12) + indent}px` }}
 >
 {isCollapsed
 ? <ChevronRight className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
 : <ChevronDown className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />}
 <FolderOpen className="w-3.5 h-3.5 text-accent flex-shrink-0" />
 <span className="text-xs font-semibold text-text-primary truncate">{anonymize(node.name)}</span>
 <span className="text-[10px] text-text-muted">({totalBelow})</span>
 </button>,
 ];

 if (!isCollapsed) {
 // Render sub-groups first, then devices directly attached to this node.
 const children = [...node.children].sort((a, b) => a.name.localeCompare(b.name));
 for (const c of children) out.push(...renderTreeNode(c, depth + 1, ctx));
 for (const d of own) {
 out.push(
 <div key={`d-${d.id}`} style={{ paddingLeft: `${indent}px` }}>
 <DeviceRow
 device={d}
 mode={ctx.mode}
 isSelected={ctx.selectedIds.has(d.id)}
 onSelect={ctx.toggleSelect}
 onNavigate={ctx.onNavigate}
 onGroupClick={ctx.onGroupChange}
 selectionMode={ctx.selectionMode}
 visibleFields={ctx.visibleFields}
 />
 </div>,
 );
 }
 }
 return out;
}

function DeviceListBody({
 devices, tree, groupId, searchActive,
 collapsedGroupIds, onToggleGroup,
 mode, selectedIds, toggleSelect, onNavigate, onGroupChange, selectionMode,
 visibleFields, isMaster, collapsedTenantIds, onToggleTenant, indentStep = 16,
}: {
 devices: Device[];
 tree: DeviceGroupTreeNode[];
 groupId: number | null;
 searchActive: boolean;
 collapsedGroupIds: Set<number>;
 onToggleGroup: (id: number) => void;
 mode: 'monitoring' | 'admin';
 selectedIds: Set<number>;
 toggleSelect: (id: number) => void;
 onNavigate: (id: number) => void;
 onGroupChange?: (id: number | null) => void;
 selectionMode: boolean;
 visibleFields: Set<string>;
 /** True when the caller is on the master tenant — adds an extra
 * tenant-grouping level above the regular group tree so admins can
 * scan "what's in Default vs what's in Contoso" at a glance. */
 isMaster: boolean;
 collapsedTenantIds: Set<number>;
 onToggleTenant: (tenantId: number) => void;
 indentStep?: number;
}) {
 const { t } = useTranslation();
 // Hooks MUST run unconditionally (Rules of Hooks), so build the maps and
 // roots before any early-return branches below.
 const devicesByGroupId = useMemo(() => {
 const map = new Map<number | null, Device[]>();
 for (const d of devices) {
 const key = d.groupId ?? null;
 if (!map.has(key)) map.set(key, []);
 map.get(key)!.push(d);
 }
 return map;
 }, [devices]);

 // Pick the roots of the rendered tree:
 // - All devices view (groupId === null) → render from every tree root
 // - Specific group selected → render only that subtree
 const roots: DeviceGroupTreeNode[] = useMemo(() => {
 if (groupId === null) return tree;
 const find = (nodes: DeviceGroupTreeNode[]): DeviceGroupTreeNode | null => {
 for (const n of nodes) {
 if (n.id === groupId) return n;
 const f = find(n.children);
 if (f) return f;
 }
 return null;
 };
 const node = find(tree);
 return node ? [node] : [];
 }, [tree, groupId]);

 // Flat mode: search is active OR "Ungrouped" sentinel is selected.
 if (searchActive || groupId === -1) {
 return (
 <>
 {devices.map((device) => (
 <DeviceRow
 key={device.id} device={device} mode={mode}
 isSelected={selectedIds.has(device.id)} onSelect={toggleSelect}
 onNavigate={onNavigate} onGroupClick={onGroupChange}
 selectionMode={selectionMode}
 visibleFields={visibleFields}
 />
 ))}
 </>
 );
 }

 const ctx: GroupRenderContext = {
 devicesByGroupId, collapsedGroupIds, onToggleGroup,
 mode, selectedIds, toggleSelect, onNavigate, onGroupChange, selectionMode,
 visibleFields, indentStep,
 };

 // Fallback when the tree is empty or hasn't loaded yet — behave like the
 // old flat listing with a single sticky group-name header per bucket,
 // so the table isn't blank on first paint.
 if (roots.length === 0 && tree.length === 0 && devices.length > 0) {
 return (
 <>
 {devices.map((device) => (
 <DeviceRow
 key={device.id} device={device} mode={mode}
 isSelected={selectedIds.has(device.id)} onSelect={toggleSelect}
 onNavigate={onNavigate} onGroupClick={onGroupChange}
 selectionMode={selectionMode}
 visibleFields={visibleFields}
 />
 ))}
 </>
 );
 }

 const sortedRoots = [...roots].sort((a, b) => a.name.localeCompare(b.name));
 const ungrouped = devicesByGroupId.get(null) ?? [];

 // ── Master view: bucket roots + ungrouped by tenant ───────────────────
 // Adds an extra hierarchy level: a "Tenant: Default", "Tenant: Contoso"
 // header above each tenant's group sub-tree. Default is forced to the
 // top so platform-internal devices stay grouped together; the rest is
 // alpha. When the user has picked a specific group (groupId != null)
 // the bucket layer is skipped — the tenant context is implicit from
 // the group itself.
 if (isMaster && groupId === null) {
 type Bucket = { id: number; name: string; roots: DeviceGroupTreeNode[]; ungrouped: Device[] };
 const buckets = new Map<number, Bucket>();
 const ensure = (id: number, name: string | null | undefined): Bucket => {
 if (!buckets.has(id)) buckets.set(id, { id, name: name ?? `Tenant ${id}`, roots: [], ungrouped: [] });
 return buckets.get(id)!;
 };
 for (const r of sortedRoots) ensure(r.tenantId, r.tenantName).roots.push(r);
 for (const d of ungrouped) ensure(d.tenantId, d.tenantName).ungrouped.push(d);
 const ordered = [...buckets.values()].sort((a, b) => {
 if (a.id === MASTER_TENANT_ID) return -1;
 if (b.id === MASTER_TENANT_ID) return 1;
 return a.name.localeCompare(b.name);
 });

 return (
 <>
 {ordered.map((b) => {
 const collapsed = collapsedTenantIds.has(b.id);
 const total = b.ungrouped.length + b.roots.reduce((acc, r) => acc + (r.total ?? 0), 0);
 return (
 <div key={`tenant-${b.id}`} className="mb-2">
 <button
 type="button"
 onClick={() => onToggleTenant(b.id)}
 aria-expanded={!collapsed}
 className="w-full flex items-center gap-2 px-3 py-2 bg-accent/5 border-y border-accent/20 text-left hover:bg-accent/10 transition-colors coarse:min-h-10"
 >
 {collapsed
 ? <ChevronRight className="w-3.5 h-3.5 text-accent" />
 : <ChevronDown className="w-3.5 h-3.5 text-accent" />}
 <Building2 className="w-3.5 h-3.5 text-accent flex-shrink-0" />
 <span className="text-xs font-semibold uppercase tracking-[0.12em] text-accent flex-1">
 {b.id === MASTER_TENANT_ID ? `${b.name} ${t('devices.filters.masterSuffix', '(master)')}` : b.name}
 </span>
 <span className="text-[10px] text-text-muted">{t('devices.list.count', '{{count}} devices', { count: total, defaultValue_one: '{{count}} device' })}</span>
 </button>
 {!collapsed && (
 <>
 {b.roots.flatMap((r) => renderTreeNode(r, 0, ctx))}
 {b.ungrouped.length > 0 && (
 <div>
 <div className="flex items-center gap-2 px-4 py-1.5 bg-bg-tertiary/70 pl-8">
 <FolderX className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
 <span className="text-xs font-semibold text-text-muted">
 {t('groupPanel.ungrouped', 'Ungrouped')}
 </span>
 <span className="text-[10px] text-text-muted">({b.ungrouped.length})</span>
 </div>
 {b.ungrouped.map((device) => (
 <DeviceRow
 key={device.id} device={device} mode={mode}
 isSelected={selectedIds.has(device.id)} onSelect={toggleSelect}
 onNavigate={onNavigate} onGroupClick={onGroupChange}
 selectionMode={selectionMode}
 visibleFields={visibleFields}
 />
 ))}
 </div>
 )}
 </>
 )}
 </div>
 );
 })}
 </>
 );
 }

 return (
 <>
 {sortedRoots.flatMap((r) => renderTreeNode(r, 0, ctx))}
 {ungrouped.length > 0 && groupId === null && (
 <div>
 <div className="flex items-center gap-2 px-4 py-1.5 bg-bg-tertiary/70 ">
 <FolderX className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
 <span className="text-xs font-semibold text-text-muted">
 {t('groupPanel.ungrouped', 'Ungrouped')}
 </span>
 <span className="text-[10px] text-text-muted">({ungrouped.length})</span>
 </div>
 {ungrouped.map((device) => (
 <DeviceRow
 key={device.id} device={device} mode={mode}
 isSelected={selectedIds.has(device.id)} onSelect={toggleSelect}
 onNavigate={onNavigate} onGroupClick={onGroupChange}
 selectionMode={selectionMode}
 visibleFields={visibleFields}
 />
 ))}
 </div>
 )}
 </>
 );
}

// ── Column header sort label ──────────────────────────────────────────────
function SortLabel({
 label, field, sortBy, sortOrder, onClick, className,
}: {
 label: string;
 field: SortField;
 sortBy: SortField;
 sortOrder: 'asc' | 'desc';
 onClick: (f: SortField) => void;
 className?: string;
}) {
 const active = sortBy === field;
 return (
 <button
 onClick={(e) => { e.stopPropagation(); onClick(field); }}
 className={clsx(
 'flex items-center gap-0.5 transition-colors shrink-0',
 active ? 'text-accent' : 'hover:text-text-primary',
 className,
 )}
 title={`Sort by ${label}`}
 >
 <span>{label}</span>
 {active ? (
 sortOrder === 'asc'
 ? <SortAsc className="w-3 h-3" />
 : <SortDesc className="w-3 h-3" />
 ) : (
 <span className="w-3 h-3 opacity-30">↕</span>
 )}
 </button>
 );
}

// ── Bulk run-script modal ─────────────────────────────────────────────────
//
// First-cut: picker only, no parameter editing. Scripts that declare
// required parameters surface a warning + link to /scripts/run, where
// the dedicated run page already handles full parameter forms.
function RunScriptModal({
 count, onCancel, onConfirm,
}: {
 count: number;
 onCancel: () => void;
 onConfirm: (scriptId: number) => void;
}) {
 const { t } = useTranslation();
 const navigate = useNavigate();
 const [scripts, setScripts] = useState<Script[]>([]);
 const [search, setSearch] = useState('');
 const [scriptId, setScriptId] = useState<number | null>(null);
 const [isLoading, setIsLoading] = useState(true);

 useEffect(() => {
 let cancelled = false;
 scriptApi.list()
 .then((rows) => { if (!cancelled) setScripts(rows); })
 .catch(() => { if (!cancelled) toast.error(t('common.error')); })
 .finally(() => { if (!cancelled) setIsLoading(false); });
 return () => { cancelled = true; };
 }, [t]);

 const q = search.trim().toLowerCase();
 const filtered = q
 ? scripts.filter((s) =>
 s.name.toLowerCase().includes(q)
 || (s.description ?? '').toLowerCase().includes(q)
 || (s.tags ?? []).some((tag) => tag.toLowerCase().includes(q)),
 )
 : scripts;

 const selected = scriptId != null ? scripts.find((s) => s.id === scriptId) ?? null : null;
 const hasRequiredParam = !!selected?.parameters?.some((p) => (p as any).required);

 // Shared Modal (docs/obli-mobile.md §5.5): full-screen on phone, backdrop
 // tap / Escape / Android back close it, z-[200] like the sibling modals.
 // The body is a column: header + search stay put, only the list scrolls.
 // The header is rendered in the body (not Modal's px-4 py-3 header) so the
 // desktop dialog keeps its historic px-5 py-4 title + hint block, without
 // a × (Cancel closes); phones get a × since the sheet is full-screen.
 const title = t('devices.batch.runScriptTitle', { count, defaultValue: `Run script on ${count} device${count > 1 ? 's' : ''}` });
 return (
 <Modal
 open
 onClose={onCancel}
 size="md"
 showCloseButton={false}
 ariaLabel={title}
 className="sm:max-h-[80dvh] sm:supports-[not(height:100dvh)]:max-h-[80vh]"
 bodyClassName="flex flex-col p-0 overflow-hidden"
 footer={
 <>
 <button
 onClick={onCancel}
 className="px-3 py-1.5 text-xs text-text-muted hover:text-text-primary coarse:min-h-10"
 >
 {t('common.cancel') || 'Cancel'}
 </button>
 <button
 onClick={() => scriptId != null && onConfirm(scriptId)}
 disabled={scriptId == null || hasRequiredParam}
 className="px-3 py-1.5 text-xs bg-accent text-white rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-accent/80 transition-colors coarse:min-h-10"
 >
 {t('devices.batch.runScriptConfirm') || 'Run'}
 </button>
 </>
 }
 footerClassName="px-5"
 >
 <div className="relative shrink-0 px-5 py-4 max-sm:pr-12">
 <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
 <Terminal className="w-4 h-4 text-accent" />
 {title}
 </h3>
 <p className="text-xs text-text-muted mt-1">
 {t('devices.batch.runScriptHint') || 'Pick a script from the library. Each device runs the script independently — failures on one don\'t block the others.'}
 </p>
 <IconButton
 label={t('common.close', 'Close')}
 icon={<X className="w-4 h-4" />}
 size="sm"
 variant="plain"
 onClick={onCancel}
 className="absolute right-3 top-3 sm:hidden"
 />
 </div>

 <div className="shrink-0 px-5 pt-3">
 <div className="relative">
 <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
 <input
 type="text"
 enterKeyHint="search"
 value={search}
 onChange={(e) => setSearch(e.target.value)}
 placeholder={t('devices.batch.runScriptSearch') || 'Search by name, tag, description…'}
 autoCapitalize="off"
 autoCorrect="off"
 spellCheck={false}
 className="w-full pl-7 pr-2 py-1.5 text-sm bg-bg-primary rounded text-text-primary focus:outline-none focus:border-accent"
 />
 </div>
 </div>

 <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-3">
 {isLoading ? (
 <div className="flex items-center justify-center py-8 text-text-muted">
 <Loader2 className="w-4 h-4 animate-spin" />
 </div>
 ) : filtered.length === 0 ? (
 <p className="py-8 text-center text-xs text-text-muted">
 {t('devices.batch.runScriptEmpty') || 'No scripts match.'}
 </p>
 ) : (
 <ul className="space-y-1">
 {filtered.map((s) => {
 const isSel = s.id === scriptId;
 return (
 <li key={s.id}>
 <button
 type="button"
 onClick={() => setScriptId(s.id)}
 className={clsx(
 'w-full text-left px-3 py-2 rounded border transition-colors coarse:py-3',
 isSel
 ? 'border-accent bg-accent/10'
 : 'border-transparent hover:border-accent/40 hover:bg-bg-tertiary',
 )}
 >
 <div className="flex items-center gap-2">
 <span className="text-sm font-medium text-text-primary truncate flex-1">{s.name}</span>
 <span className="text-[10px] uppercase tracking-wider text-text-muted shrink-0">{s.runtime}</span>
 </div>
 {s.description && (
 <p className="text-[11px] text-text-muted mt-0.5 truncate">{s.description}</p>
 )}
 </button>
 </li>
 );
 })}
 </ul>
 )}
 </div>

 {hasRequiredParam && (
 <div className="shrink-0 px-5 py-2 bg-amber-400/10 border-t border-amber-400/30">
 <p className="text-[11px] text-amber-300">
 {t('devices.batch.runScriptParamWarn') || 'This script declares required parameters. Use the dedicated run page to fill them in.'}
 <button
 type="button"
 onClick={() => navigate(`/scripts/run?scriptId=${scriptId}`)}
 className="ml-2 underline hover:no-underline coarse:min-h-10"
 >
 {t('devices.batch.runScriptOpenRunPage') || 'Open run page →'}
 </button>
 </p>
 </div>
 )}
 </Modal>
 );
}

