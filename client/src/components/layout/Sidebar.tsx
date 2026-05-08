import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  LayoutDashboard,
  Settings,
  Users,
  UserCircle,
  LogOut,
  Server,
  ArrowLeftRight,
  CalendarClock,
  Building2,
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Pin,
  PinOff,
  Monitor,
  Laptop,
  ShieldCheck,
  Plus,
  Key,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { anonymize } from '@/utils/anonymize';
import { deviceMatchesSearch } from '@/utils/deviceSearch';
import { cn } from '@/utils/cn';
import { useAuthStore } from '@/store/authStore';
import { useUiStore } from '@/store/uiStore';
import { useTenantStore } from '@/store/tenantStore';
import { deviceApi } from '@/api/device.api';
import { groupsApi } from '@/api/groups.api';
import { getSocket } from '@/socket/socketClient';
import type { Device, DeviceGroupTreeNode, DeviceStatus } from '@obliance/shared';
import { SocketEvents, MASTER_TENANT_ID, isMasterTenant } from '@obliance/shared';
import toast from 'react-hot-toast';

// ── localStorage helpers ─────────────────────────────────────────────────────

function usePersisted<T>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored !== null ? (JSON.parse(stored) as T) : initial;
    } catch {
      return initial;
    }
  });
  const set = useCallback((v: T | ((prev: T) => T)) => {
    setValue(prev => {
      const next = typeof v === 'function' ? (v as (p: T) => T)(prev) : v;
      localStorage.setItem(key, JSON.stringify(next));
      return next;
    });
  }, [key]);
  return [value, set];
}

// ── Device status dot ────────────────────────────────────────────────────────

const STATUS_DOT: Record<DeviceStatus, string> = {
  online:      'bg-green-500',
  offline:     'bg-gray-400',
  warning:     'bg-yellow-500 animate-pulse',
  critical:    'bg-red-500 animate-pulse',
  pending:     'bg-blue-400',
  maintenance:       'bg-rose-400',
  suspended:         'bg-gray-500',
  pending_uninstall: 'bg-orange-400 animate-pulse',
  updating:          'bg-blue-400 animate-pulse',
  update_error:      'bg-orange-400',
};

function DeviceStatusDot({ status }: { status: DeviceStatus }) {
  const dot = STATUS_DOT[status] ?? 'bg-gray-400';
  return <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', dot)} />;
}

// ── Draggable Device Item ────────────────────────────────────────────────────

function DraggableDeviceItem({
  device,
  indent = false,
  depth = 0,
}: {
  device: Device;
  indent?: boolean;
  /** Parent group depth. Device is indented one level deeper than its parent. */
  depth?: number;
}) {
  const location = useLocation();
  const isActive = location.pathname === `/devices/${device.id}`;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `device-${device.id}`,
    data: { type: 'device', device },
  });

  const displayName = anonymize(device.displayName ?? device.hostname);

  // Match the group-row padding formula: each nesting level adds 12px, and
  // devices get an extra 22px so they clearly sit under their parent group
  // header's icon (not level with it).
  // Padding lives on the Link (not the wrapper) so the active background
  // starts flush with the outer container and the status dot has breathing
  // room inside the highlighted pill instead of being glued to its left edge.
  const paddingLeft = indent ? depth * 12 + 22 : 8;

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{ opacity: isDragging ? 0.4 : 1 }}
    >
      <Link
        to={`/devices/${device.id}`}
        style={{ paddingLeft }}
        className={cn(
          'flex items-center gap-2 rounded-md py-1.5 pr-2 transition-colors',
          isActive
            ? 'bg-bg-active text-text-primary'
            : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
        )}
        onClick={e => { if (isDragging) e.preventDefault(); }}
      >
        <DeviceStatusDot status={device.status} />
        <span className="truncate flex-1 text-[13px]">{displayName}</span>
      </Link>
    </div>
  );
}

// ── Droppable Group Header ────────────────────────────────────────────────────

function DroppableGroupHeader({
  groupId,
  children,
}: {
  groupId: number | null;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: groupId === null ? 'drop-device-ungrouped' : `drop-device-group-${groupId}`,
    data: { type: 'device-group', groupId },
  });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'rounded-md transition-colors',
        isOver && 'ring-1 ring-accent bg-accent/10',
      )}
    >
      {children}
    </div>
  );
}

// ── Collapsible Group Row ─────────────────────────────────────────────────────

function GroupRow({
  group,
  devices,
  searchQuery,
  depth = 0,
  hideDeviceRows = false,
}: {
  group: DeviceGroupTreeNode;
  devices: Device[];
  searchQuery: string;
  depth?: number;
  hideDeviceRows?: boolean;
}) {
  const location = useLocation();
  const [collapsed, setCollapsed] = usePersisted<boolean>(`sidebar-group-collapsed-${group.id}`, false);

  const isGroupActive = location.pathname === `/group/${group.id}`;
  const groupDevices = devices.filter(d => d.groupId === group.id);

  // Apply search filter — same field set as the /devices server search
  // (hostname, displayName, IP local/public, MAC, last user, OS, agent
  // version, geo, UUID, tags, group name) so the user can find a device
  // from the sidebar by anything they would type into the main search.
  const filteredDevices = searchQuery
    ? groupDevices.filter(d => deviceMatchesSearch(d, searchQuery))
    : groupDevices;

  const onlineCount = groupDevices.filter(d => d.status === 'online').length;
  const offlineCount = groupDevices.filter(d => d.status === 'offline').length;

  // If searching and no devices match in this group/subtree, hide it
  if (searchQuery && filteredDevices.length === 0 && group.children.length === 0) {
    return null;
  }

  const paddingLeft = depth * 12;

  return (
    <DroppableGroupHeader groupId={group.id}>
      {/* Group header row */}
      <div
        className={cn(
          'flex items-center gap-1 rounded-md transition-colors group',
          isGroupActive
            ? 'bg-bg-active text-text-primary'
            : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
        )}
        style={{ paddingLeft }}
      >
        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(v => !v)}
          className="p-1 rounded hover:bg-bg-hover transition-colors shrink-0"
        >
          {collapsed ? (
            <ChevronRight size={12} className="text-text-muted" />
          ) : (
            <ChevronDown size={12} className="text-text-muted" />
          )}
        </button>

        {/* Group link */}
        <Link
          to={`/group/${group.id}`}
          className="flex items-center gap-2 flex-1 py-1.5 min-w-0"
        >
          <Server size={14} className="shrink-0 text-text-muted" />
          <span className="truncate flex-1 text-[13px] font-medium">{anonymize(group.name)}</span>
          {groupDevices.length > 0 && (
            <span className="flex items-center gap-1.5 shrink-0">
              {onlineCount > 0 && (
                <span className="text-[11px] text-green-400 font-mono font-medium">{onlineCount}</span>
              )}
              {offlineCount > 0 && (
                <span className="text-[11px] text-text-muted font-mono font-medium">{offlineCount}</span>
              )}
            </span>
          )}
        </Link>
      </div>

      {/* Expanded content */}
      {!collapsed && (
        <div>
          {/* Devices in this group — hidden when `hideDeviceRows` is true
              (i.e. user toggled "Devices" off but still wants to see the
              group tree for navigation). */}
          {!hideDeviceRows && filteredDevices.map(device => (
            <DraggableDeviceItem key={device.id} device={device} indent depth={depth} />
          ))}
          {/* Child groups */}
          {group.children.map(child => (
            <GroupRow
              key={child.id}
              group={child}
              devices={devices}
              searchQuery={searchQuery}
              depth={depth + 1}
              hideDeviceRows={hideDeviceRows}
            />
          ))}
        </div>
      )}
    </DroppableGroupHeader>
  );
}

// ── Nav link ──────────────────────────────────────────────────────────────────

interface NavItem {
  label: string;
  path: string;
  icon: React.ReactNode;
  /** Optional red pill showing a pending-work count next to the label. */
  badgeCount?: number;
}

function NavLink({ item }: { item: NavItem }) {
  const location = useLocation();
  const isActive = location.pathname === item.path ||
    (item.path !== '/' && location.pathname.startsWith(item.path));
  return (
    <Link
      to={item.path}
      className={cn(
        'flex items-center gap-3 rounded-md px-3 py-2 text-[14px] transition-colors',
        isActive
          ? 'bg-bg-active text-text-primary'
          : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
      )}
    >
      {item.icon}
      <span className="flex-1">{item.label}</span>
      {item.badgeCount !== undefined && item.badgeCount > 0 && (
        <span className="shrink-0 min-w-[1.25rem] px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/30 text-[10px] font-semibold text-center">
          {item.badgeCount > 99 ? '99+' : item.badgeCount}
        </span>
      )}
    </Link>
  );
}

// ── Main Sidebar ──────────────────────────────────────────────────────────────

export function Sidebar() {
  const { t } = useTranslation();
  const location = useLocation();
  const { user, isAdmin, permissions } = useAuthStore();
  // Tenant capabilities — Capability enum from @obliance/shared.
  // We use them to surface admin-tenant pages to non-admin users who
  // have been granted a specific page-gate capability:
  //   - supervision:read         → Supervision (Reports + History + Remote sessions)
  //   - agent_config:custom_sections / discovery / keys → Agent config tabs
  // Admins implicitly have all capabilities (the sidebar ORs role and
  // cap so the menu still appears for admins regardless of cap state).
  const tenantCaps = new Set(permissions?.tenantCapabilities ?? []);
  const hasSupervisionCap = tenantCaps.has('supervision:read');
  const hasAnyAgentConfigCap =
    tenantCaps.has('agent_config:custom_sections') ||
    tenantCaps.has('agent_config:discovery') ||
    tenantCaps.has('agent_config:keys');
  const { sidebarFloating, toggleSidebarFloating, sidebarCollapsed, toggleSidebarCollapsed, openAddAgentModal } = useUiStore();

  const admin = isAdmin();

  // ── Layout preferences ─────────────────────────────────────────────────────
  const [sidebarLayout, setSidebarLayout] = usePersisted<'stacked' | 'side-by-side'>('sidebar-layout', 'stacked');
  const [showDevices, setShowDevices] = usePersisted<boolean>('sidebar-show-devices', true);
  const [splitPercent, setSplitPercent] = usePersisted<number>('sidebar-split-percent', 50);
  const [adminMenuOpen, setAdminMenuOpen] = usePersisted<boolean>('sidebar:admin-open', true);
  const [navMenuOpen, setNavMenuOpen] = usePersisted<boolean>('sidebar:nav-open', true);
  // Per-tenant collapse state for the master/god view buckets. We share
  // the same localStorage key as the /devices GroupSidePanel + the
  // DeviceTable so collapsing "Pimkie" once folds it everywhere — one
  // mental model for "this tenant is currently not interesting".
  const [collapsedTenants, setCollapsedTenants] = usePersisted<number[]>('obliance:groupPanelCollapsedTenants', []);
  const isTenantCollapsed = (id: number) => collapsedTenants.includes(id);
  const toggleTenantCollapsed = (id: number) => {
    setCollapsedTenants((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };
  const splitContainerRef = useRef<HTMLDivElement>(null);

  // ── Device & group state ────────────────────────────────────────────────────
  const [devices, setDevices] = useState<Device[]>([]);
  const [groupTree, setGroupTree] = useState<DeviceGroupTreeNode[]>([]);
  const [search, setSearch] = useState('');
  const [pendingApprovalsCount, setPendingApprovalsCount] = useState(0);

  const currentTenantId = useTenantStore(s => s.currentTenantId);

  const loadDeviceData = useCallback(async () => {
    try {
      // Fetch ALL approved devices with a large page size. Default is 100
      // which silently truncated sidebar contents on fleets > 100 devices.
      const [paged, tree] = await Promise.all([
        deviceApi.listPaginated({ approvalStatus: 'approved', page: 1, pageSize: 10000 }),
        groupsApi.tree(),
      ]);
      setDevices(paged.items);
      setGroupTree(tree);
    } catch {
      // fail silently — sidebar will just show empty
    }
  }, []);

  useEffect(() => {
    setDevices([]);
    setGroupTree([]);
    loadDeviceData();
    const id = setInterval(loadDeviceData, 30_000);
    return () => clearInterval(id);
  }, [loadDeviceData, currentTenantId]);

  // ── Pending approvals badge (admin only) ────────────────────────────────
  useEffect(() => {
    if (!admin) return;
    let cancelled = false;
    const load = async () => {
      try {
        const { approvalApi } = await import('@/api/approval.api');
        const rows = await approvalApi.list(false);
        if (!cancelled) setPendingApprovalsCount(rows.length);
      } catch { /* ignore */ }
    };
    load();
    const socket = getSocket();
    const handler = () => load();
    if (socket) {
      socket.on('APPROVAL_CREATED', handler);
      socket.on('APPROVAL_UPDATED', handler);
    }
    const tick = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(tick);
      if (socket) {
        socket.off('APPROVAL_CREATED', handler);
        socket.off('APPROVAL_UPDATED', handler);
      }
    };
  }, [admin, currentTenantId]);

  // ── Real-time socket updates ────────────────────────────────────────────────
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const onDeviceUpdated = (data: { deviceId: number; status?: DeviceStatus; groupId?: number | null; hostname?: string; displayName?: string | null; privacyModeEnabled?: boolean; airgapEnabled?: boolean }) => {
      // The server emits DEVICE_UPDATED with PARTIAL payloads from
      // multiple call sites (handlePush, threshold flips, privacy/
      // airgap toggles, etc.). Spreading data into the device row
      // unconditionally overwrites missing fields with `undefined`,
      // which then makes the device fail every later filter
      // (groupId becomes undefined → drops out of every group →
      // the agent visually "disappears" before reappearing on the
      // next full refetch). Patch only the fields actually present
      // so a status-only update doesn't wipe hostname/groupId.
      setDevices(prev => prev.map(d => {
        if (d.id !== data.deviceId) return d;
        const next = { ...d };
        if (data.status !== undefined)              next.status = data.status;
        if (data.groupId !== undefined)             next.groupId = data.groupId;
        if (data.hostname !== undefined)            next.hostname = data.hostname;
        if (data.displayName !== undefined)         next.displayName = data.displayName;
        if (data.privacyModeEnabled !== undefined)  next.privacyModeEnabled = data.privacyModeEnabled;
        if (data.airgapEnabled !== undefined)       next.airgapEnabled = data.airgapEnabled;
        return next;
      }));
    };

    const onDeviceOnline = (data: { deviceId: number }) => {
      setDevices(prev => prev.map(d =>
        d.id === data.deviceId ? { ...d, status: 'online' as DeviceStatus } : d,
      ));
    };

    const onDeviceOffline = (data: { deviceId: number }) => {
      setDevices(prev => prev.map(d =>
        d.id === data.deviceId ? { ...d, status: 'offline' as DeviceStatus } : d,
      ));
    };

    const onDeviceApproved = () => {
      // New device approved — reload to include it
      loadDeviceData();
    };

    const onDeviceDeleted = (data: { deviceId: number }) => {
      setDevices(prev => prev.filter(d => d.id !== data.deviceId));
    };

    const onGroupChanged = () => {
      groupsApi.tree().then(setGroupTree).catch(() => {});
    };

    socket.on(SocketEvents.DEVICE_UPDATED, onDeviceUpdated);
    socket.on(SocketEvents.DEVICE_ONLINE, onDeviceOnline);
    socket.on(SocketEvents.DEVICE_OFFLINE, onDeviceOffline);
    socket.on(SocketEvents.DEVICE_APPROVED, onDeviceApproved);
    socket.on(SocketEvents.DEVICE_DELETED, onDeviceDeleted);
    socket.on(SocketEvents.GROUP_CREATED, onGroupChanged);
    socket.on(SocketEvents.GROUP_UPDATED, onGroupChanged);
    socket.on(SocketEvents.GROUP_DELETED, onGroupChanged);
    socket.on(SocketEvents.GROUP_MOVED, onGroupChanged);

    return () => {
      socket.off(SocketEvents.DEVICE_UPDATED, onDeviceUpdated);
      socket.off(SocketEvents.DEVICE_ONLINE, onDeviceOnline);
      socket.off(SocketEvents.DEVICE_OFFLINE, onDeviceOffline);
      socket.off(SocketEvents.DEVICE_APPROVED, onDeviceApproved);
      socket.off(SocketEvents.DEVICE_DELETED, onDeviceDeleted);
      socket.off(SocketEvents.GROUP_CREATED, onGroupChanged);
      socket.off(SocketEvents.GROUP_UPDATED, onGroupChanged);
      socket.off(SocketEvents.GROUP_DELETED, onGroupChanged);
      socket.off(SocketEvents.GROUP_MOVED, onGroupChanged);
    };
  }, [loadDeviceData]);

  // ── Drag & drop device group reassignment ──────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;

    const dragData = active.data.current;
    const dropData = over.data.current;

    if (dragData?.type !== 'device' || dropData?.type !== 'device-group') return;

    const device = dragData.device as Device;
    const targetGroupId = dropData.groupId as number | null;

    if (device.groupId === targetGroupId) return;

    try {
      await deviceApi.update(device.id, { groupId: targetGroupId });
      setDevices(prev => prev.map(d =>
        d.id === device.id ? { ...d, groupId: targetGroupId } : d,
      ));
      toast.success('Device moved');
    } catch {
      toast.error('Failed to move device');
    }
  }, []);

  // ── Split column resize ────────────────────────────────────────────────────
  const handleSplitMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const handleMouseMove = (ev: MouseEvent) => {
      if (!splitContainerRef.current) return;
      const rect = splitContainerRef.current.getBoundingClientRect();
      const pct = Math.round(((ev.clientX - rect.left) / rect.width) * 100);
      setSplitPercent(Math.max(20, Math.min(80, pct)));
    };
    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [setSplitPercent]);

  // ── Nav items ──────────────────────────────────────────────────────────────
  // The sidebar has two collapsible sections. "Navigation" is the
  // top section everyone sees (gated only by login); "Administration"
  // is the bottom section that surfaces only when at least one item
  // is visible to the user. Each item independently checks whether
  // the user can see it, then we hide the entire section if the
  // resulting list is empty.

  const navItems: NavItem[] = [
    { label: t('nav.dashboard'),                  path: '/',           icon: <LayoutDashboard size={18} /> },
    { label: t('nav.devices'),                    path: '/devices',    icon: <Monitor size={18} /> },
    { label: t('nav.automations', 'Automations'), path: '/automations', icon: <CalendarClock size={18} /> },
    { label: t('nav.policies'),                   path: '/policies',   icon: <ShieldCheck size={18} /> },
  ];

  // Admin-tier section. Each item is conditionally added based on
  // `admin` (platform admin) OR the user's relevant capability. When
  // the resulting list is empty (plain user, no caps) the section
  // header is hidden entirely.
  const adminNavItems: NavItem[] = [
    // Users / Teams / Permissions / Restrictions — admin only.
    ...(admin ? [{ label: t('nav.users'), path: '/admin/users', icon: <Users size={18} /> } as NavItem] : []),
    // Security — audit log + approvals + 2FA, admin only.
    ...(admin ? [{ label: t('nav.security', 'Security'), path: '/admin/security', icon: <ShieldCheck size={18} />, badgeCount: pendingApprovalsCount } as NavItem] : []),
    // Supervision — reports + history + remote sessions. Visible if
    // platform admin OR the user has the `supervision:read`
    // capability on at least one team_permission row.
    ...(admin || hasSupervisionCap
      ? [{ label: t('nav.supervision'), path: '/admin/supervision', icon: <Laptop size={18} /> } as NavItem]
      : []),
    // Agent config — Custom Sections / Discovery / API Keys. The
    // page itself shows only the tabs the user has the matching
    // sub-cap for; we surface the menu entry as soon as ANY of them
    // is granted (or the user is admin).
    ...(admin || hasAnyAgentConfigCap
      ? [{ label: t('nav.agentConfig', 'Agent config'), path: '/admin/devices', icon: <Key size={18} /> } as NavItem]
      : []),
    // Workspace + Settings — platform admin on master tenant only.
    // Master gate happens via component-level visibility (the items
    // are rendered only when `admin && currentTenantId === MASTER`).
    ...(admin && isMasterTenant(currentTenantId)
      ? [{ label: t('nav.workspace', 'Workspace'), path: '/workspace', icon: <Building2 size={18} /> } as NavItem]
      : []),
    ...(admin
      ? [{ label: t('nav.settings'), path: '/settings', icon: <Settings size={18} /> } as NavItem]
      : []),
  ];

  // ── Ungrouped devices ──────────────────────────────────────────────────────
  const ungroupedDevices = devices.filter(d => d.groupId === null);
  const filteredUngrouped = search
    ? ungroupedDevices.filter(d => deviceMatchesSearch(d, search))
    : ungroupedDevices;

  // ── Master/god view: group everything by tenant ───────────────────────────
  // On the master tenant the server returns rows from every tenant. To
  // keep the sidebar legible we add an extra hierarchy level: a "Tenant
  // X" header above each child tenant's group sub-tree, with that
  // tenant's ungrouped devices nested inside. The master tenant's own
  // groups appear under a "Default" header so admins can tell apart
  // platform-internal devices from customer ones.
  const masterMode = isMasterTenant(currentTenantId);
  const tenantBuckets: Array<{
    id: number;
    name: string;
    groupTree: DeviceGroupTreeNode[];
    ungrouped: Device[];
  }> = [];
  if (masterMode) {
    const byTenant = new Map<number, { name: string; groupRoots: DeviceGroupTreeNode[]; ungrouped: Device[] }>();
    const ensureBucket = (id: number, name: string | null | undefined) => {
      if (!byTenant.has(id)) byTenant.set(id, { name: name ?? `Tenant ${id}`, groupRoots: [], ungrouped: [] });
      return byTenant.get(id)!;
    };
    for (const root of groupTree) ensureBucket(root.tenantId, root.tenantName).groupRoots.push(root);
    for (const dev of ungroupedDevices) ensureBucket(dev.tenantId, dev.tenantName).ungrouped.push(dev);
    // Master tenant first, then alpha.
    const ordered = [...byTenant.entries()].sort(([aId, aV], [bId, bV]) => {
      if (aId === MASTER_TENANT_ID) return -1;
      if (bId === MASTER_TENANT_ID) return 1;
      return aV.name.localeCompare(bV.name);
    });
    for (const [id, b] of ordered) {
      tenantBuckets.push({ id, name: b.name, groupTree: b.groupRoots, ungrouped: b.ungrouped });
    }
  }

  // ── Device tree content ────────────────────────────────────────────────────
  // `hideDeviceRows` = render the group tree but not the devices inside.
  // This is what the user sees when they toggle the "Devices" chip off
  // but still want quick navigation to group pages.
  const renderTenantBucket = (
    bucket: { id: number; name: string; groupTree: DeviceGroupTreeNode[]; ungrouped: Device[] },
    hideDeviceRows: boolean,
  ) => {
    const filteredBucketUngrouped = search
      ? bucket.ungrouped.filter(d => deviceMatchesSearch(d, search))
      : bucket.ungrouped;
    const collapsed = isTenantCollapsed(bucket.id);
    // While the user is searching we ignore the per-tenant collapse —
    // otherwise typing a query would silently filter rows out of view
    // because their tenant happens to be folded.
    const showChildren = !collapsed || !!search;
    return (
      <div key={bucket.id} className="mt-2">
        <button
          type="button"
          onClick={() => toggleTenantCollapsed(bucket.id)}
          className="w-full px-2 py-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-accent hover:bg-accent/5 rounded"
          title={collapsed ? `Expand ${bucket.name}` : `Collapse ${bucket.name}`}
        >
          {collapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
          <Building2 size={11} />
          <span className="truncate">{bucket.name}</span>
        </button>
        {showChildren && (
          <>
            {bucket.groupTree.map((group) => (
              <GroupRow
                key={group.id}
                group={group}
                devices={devices}
                searchQuery={search}
                hideDeviceRows={hideDeviceRows}
              />
            ))}
            {!hideDeviceRows && filteredBucketUngrouped.length > 0 && (
              <DroppableGroupHeader groupId={null}>
                <div className="px-2 py-0.5 pl-4 text-[10px] font-medium text-text-muted uppercase tracking-wider mt-1">
                  Ungrouped
                </div>
                {filteredBucketUngrouped.map(device => (
                  <DraggableDeviceItem key={device.id} device={device} />
                ))}
              </DroppableGroupHeader>
            )}
          </>
        )}
      </div>
    );
  };

  const renderDeviceTree = (hideHeader = false, hideDeviceRows = false) => (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className={hideHeader ? '' : 'mt-2 pt-2 border-t border-border'}>
        {!hideHeader && (
          <div className="px-2 py-1.5 flex items-center gap-2 text-[11px] font-mono font-medium text-text-muted uppercase tracking-[0.12em]">
            <Server size={12} />
            {hideDeviceRows ? t('nav.groups', 'Groupes') : t('nav.devices')}
          </div>
        )}

        {masterMode ? (
          tenantBuckets.map((b) => renderTenantBucket(b, hideDeviceRows))
        ) : (
          <>
            {/* Single-tenant flat tree (legacy view) */}
            {groupTree.map(group => (
              <GroupRow
                key={group.id}
                group={group}
                devices={devices}
                searchQuery={search}
                hideDeviceRows={hideDeviceRows}
              />
            ))}
            {!hideDeviceRows && filteredUngrouped.length > 0 && (
              <DroppableGroupHeader groupId={null}>
                <div className="px-2 py-0.5 text-[10px] font-medium text-text-muted uppercase tracking-wider mt-1">
                  Ungrouped
                </div>
                {filteredUngrouped.map(device => (
                  <DraggableDeviceItem key={device.id} device={device} />
                ))}
              </DroppableGroupHeader>
            )}
          </>
        )}
      </div>
    </DndContext>
  );

  // ── Collapsed mode (Obli Design v1) ─────────────────────────────────
  // 64 px icon-only column. Navigation items keep their tooltips, the
  // device tree + search are hidden, the user avatar + logout stay
  // visible at the bottom. Click the panel toggle to expand back.
  if (sidebarCollapsed) {
    // In collapsed mode we don't surface the Administration label;
    // we just stack the icons. adminNavItems is now built up from
    // the role + cap matrix above so it's empty for plain users
    // (they only see navItems).
    const allItems = [...navItems, ...adminNavItems];
    return (
      <aside className="flex h-full w-16 shrink-0 flex-col bg-bg-secondary">
        <div className="flex h-12 shrink-0 items-center justify-center">
          <button
            onClick={toggleSidebarCollapsed}
            title={t('nav.expandSidebar', 'Expand sidebar')}
            className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary"
          >
            <ChevronsRight size={16} />
          </button>
        </div>

        {admin && (
          <div className="px-2 pt-1">
            <button
              onClick={openAddAgentModal}
              title={t('nav.addAgent')}
              className="flex h-10 w-full items-center justify-center rounded-md bg-accent/12 text-accent transition-colors hover:bg-accent/20"
            >
              <Plus size={16} />
            </button>
          </div>
        )}

        <nav className="flex-1 overflow-y-auto px-2 pt-3 space-y-1">
          {allItems.map((item) => {
            const isActive = location.pathname === item.path
              || (item.path !== '/' && location.pathname.startsWith(item.path + '/'));
            return (
              <Link
                key={item.path}
                to={item.path}
                title={item.label}
                className={cn(
                  'relative flex h-10 w-full items-center justify-center rounded-md transition-colors',
                  isActive
                    ? 'bg-accent/12 text-accent'
                    : 'text-text-muted hover:bg-bg-hover hover:text-text-primary',
                )}
              >
                {item.icon}
                {item.badgeCount !== undefined && item.badgeCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[1.1rem] px-1 py-0 rounded-full bg-red-500/20 text-red-400 text-[9px] font-semibold text-center">
                    {item.badgeCount > 99 ? '99+' : item.badgeCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="p-2 space-y-1">
          <Link
            to="/profile"
            title={anonymize(user?.displayName || (user?.username?.startsWith('og_') ? user.username.slice(3) : user?.username))}
            className={cn(
              'flex h-10 w-full items-center justify-center rounded-md transition-colors',
              location.pathname === '/profile'
                ? 'bg-bg-active text-text-primary'
                : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
            )}
          >
            {user?.avatar ? (
              <img src={user.avatar} alt="" className="w-6 h-6 rounded-full object-cover" />
            ) : (
              <UserCircle size={18} />
            )}
          </Link>
          <button
            onClick={() => useAuthStore.getState().logout()}
            title={t('nav.signOut')}
            className="flex h-10 w-full items-center justify-center rounded-md text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary"
          >
            <LogOut size={18} />
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside className="flex h-full w-full flex-col bg-bg-secondary">

      {/* Sidebar head — collapse + float/pin toggles only. The logo and
          tenant selector live in the topbar (Header.tsx) so they remain
          visible when the sidebar is collapsed or floating. */}
      <div className="flex h-9 shrink-0 items-center justify-end px-3 pt-2">
        <div className="flex items-center gap-1">
          {/* Collapse and Float are mutually exclusive: in collapsed mode
              we already hide the Float button, so do the symmetric thing
              and hide Collapse while floating. */}
          {!sidebarFloating && (
            <button
              onClick={toggleSidebarCollapsed}
              title={t('nav.collapseSidebar', 'Collapse sidebar')}
              className="rounded p-1.5 text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary"
            >
              <ChevronsLeft size={15} />
            </button>
          )}
          <button
            onClick={toggleSidebarFloating}
            title={sidebarFloating ? t('nav.pinSidebar', 'Pin sidebar') : t('nav.floatSidebar', 'Float sidebar (auto-hide)')}
            className={cn(
              'p-1.5 rounded transition-colors',
              sidebarFloating
                ? 'text-accent hover:text-accent hover:bg-accent/10'
                : 'text-text-muted hover:text-text-primary hover:bg-bg-hover',
            )}
          >
            {sidebarFloating ? <PinOff size={15} /> : <Pin size={15} />}
          </button>
        </div>
      </div>

      {/* Add agent button — accent pill, matches mockup §4.2. Gated to platform
          admins: enrolling a new agent requires API-key generation, which the
          server gates behind requireRole('admin'). Non-admins see no button. */}
      {admin && (
        <div className="px-3 pt-2">
          <button
            onClick={openAddAgentModal}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-accent/12 hover:bg-accent/20 px-3 py-2 text-[13px] font-medium text-accent transition-colors"
          >
            <Plus size={15} />
            {t('nav.addAgent')}
          </button>
        </div>
      )}

      {/* Search */}
      <div className="px-3 py-2.5">
        <input
          type="text"
          placeholder={t('common.search')}
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full rounded-md bg-bg-tertiary px-3 py-2 text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>

      {/* Layout chips — only shown when device tree is visible */}
      {groupTree.length > 0 && sidebarLayout === 'stacked' && (
        <div className="flex items-center justify-between px-3 pb-1.5 gap-2">
          <button
            onClick={() => setShowDevices(v => !v)}
            className={cn(
              'text-xs px-2 py-0.5 rounded-full border transition-colors',
              showDevices
                ? 'bg-accent/20 border-accent text-accent'
                : 'border-border text-text-muted hover:text-text-secondary',
            )}
          >
            {t('nav.devices')}
          </button>
          <button
            onClick={() => setSidebarLayout('side-by-side')}
            title="Switch to side-by-side"
            className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors shrink-0"
          >
            <ArrowLeftRight size={13} />
          </button>
        </div>
      )}

      {/* Content area — stacked or side-by-side */}
      {sidebarLayout === 'side-by-side' && groupTree.length > 0 ? (
        <div ref={splitContainerRef} className="flex flex-row flex-1 overflow-hidden min-h-0">

          {/* ── Nav column ── */}
          <div className="flex flex-col overflow-hidden min-w-0" style={{ width: `${splitPercent}%` }}>
            <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border shrink-0">
              <span className="text-[10px] font-bold uppercase tracking-widest text-text-muted">{t('nav.navigation')}</span>
            </div>
            <nav className="flex-1 overflow-y-auto px-2 py-1 min-h-0">
              {navItems.map(item => <NavLink key={item.path} item={item} />)}
            </nav>
          </div>

          {/* ── Resize handle ── */}
          <div
            onMouseDown={handleSplitMouseDown}
            className="w-1 shrink-0 cursor-col-resize bg-border hover:bg-accent/50 active:bg-accent/70 transition-colors"
          />

          {/* ── Devices column ── */}
          <div className="flex flex-col flex-1 overflow-hidden min-w-0">
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-border shrink-0">
              <span className="text-[10px] font-bold uppercase tracking-widest text-text-muted">{t('nav.devices')}</span>
              <button
                onClick={() => setSidebarLayout('stacked')}
                title="Switch to stacked"
                className="p-0.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
              >
                <ArrowLeftRight size={12} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-2 min-h-0">
              {renderDeviceTree(true)}
            </div>
          </div>

        </div>
      ) : (
        <div className="flex flex-col flex-1 min-h-0 px-2">
          {/* Primary nav — collapsible. Folding it gives the agents
              tree the full sidebar height for users who manage their
              fleet from this panel and don't need the top items
              visible all the time. State persisted via usePersisted. */}
          <button
            onClick={() => setNavMenuOpen(v => !v)}
            className="flex w-full items-center gap-2 px-1 py-1.5 text-text-muted hover:text-text-secondary transition-colors shrink-0"
            title={navMenuOpen ? t('nav.collapseNav', 'Collapse navigation') : t('nav.expandNav', 'Expand navigation')}
          >
            <ChevronDown size={12} className={cn('transition-transform duration-200', !navMenuOpen && '-rotate-90')} />
            <span className="text-[10px] font-bold uppercase tracking-widest">{t('nav.navigation', 'Navigation')}</span>
            <div className="flex-1 h-px bg-border" />
          </button>
          {navMenuOpen && (
            <nav className="py-1 shrink-0">
              {navItems.map(item => <NavLink key={item.path} item={item} />)}
            </nav>
          )}

          {/* Group tree — always rendered. When `showDevices` is off we
              still render the group tree (without the devices inside)
              so the user can navigate to group pages. */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {renderDeviceTree(false, !showDevices)}
          </div>
        </div>
      )}

      {/* Administration section — visible if at least one admin /
          cap-gated item resolved to an entry. Plain users with no
          capabilities get nothing rendered here. */}
      {adminNavItems.length > 0 && (
        <>
          <button
            onClick={() => setAdminMenuOpen(v => !v)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-text-muted hover:text-text-secondary transition-colors"
            title={adminMenuOpen ? t('nav.collapseAdmin', 'Collapse administration') : t('nav.expandAdmin', 'Expand administration')}
          >
            <div className="flex-1 h-px bg-border" />
            <ChevronDown size={12} className={cn('transition-transform duration-200', !adminMenuOpen && '-rotate-90')} />
            <span className="text-[10px] font-bold uppercase tracking-widest">{t('nav.administration', 'Administration')}</span>
            <div className="flex-1 h-px bg-border" />
          </button>

          {adminMenuOpen && (
            <nav className="px-2 pb-1">
              {adminNavItems.map(item => <NavLink key={item.path} item={item} />)}
            </nav>
          )}
        </>
      )}

      {/* User section */}
      <div className="border-t border-border p-2">
        <Link
          to="/profile"
          className={cn(
            'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
            location.pathname === '/profile'
              ? 'bg-bg-active text-text-primary'
              : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
          )}
        >
          {user?.avatar ? (
            <img src={user.avatar} alt="" className="w-[20px] h-[20px] rounded-full object-cover" />
          ) : (
            <UserCircle size={18} />
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium text-text-primary">
              {anonymize(user?.displayName || (user?.username?.startsWith('og_') ? user.username.slice(3) : user?.username))}
            </div>
            <div className="truncate font-mono text-[10px] text-text-muted">
              {(user?.username?.startsWith('og_') ? user.username.slice(3) : user?.username) ?? ''} · {user?.role ?? ''}
            </div>
          </div>
        </Link>

        <button
          onClick={() => { useAuthStore.getState().logout(); }}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
        >
          <LogOut size={18} />
          {t('nav.signOut')}
        </button>
      </div>
    </aside>
  );
}
