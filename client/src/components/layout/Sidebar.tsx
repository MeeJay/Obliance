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
  Bell,
  Users,
  FolderTree,
  UserCircle,
  LogOut,
  Server,
  ArrowLeftRight,
  PackageOpen,
  CalendarClock,
  Building2,
  PanelLeft,
  PanelLeftClose,
  ChevronDown,
  ChevronRight,
  Monitor,
  Terminal,
  Laptop,
  Code2,
  RefreshCw,
  ShieldCheck,
  FileBarChart2,
  Download,
  History,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/utils/cn';
import { useAuthStore } from '@/store/authStore';
import { useUiStore } from '@/store/uiStore';
import { useTenantStore } from '@/store/tenantStore';
import { deviceApi } from '@/api/device.api';
import { groupsApi } from '@/api/groups.api';
import { getSocket } from '@/socket/socketClient';
import type { Device, DeviceGroupTreeNode, DeviceStatus } from '@obliance/shared';
import { SocketEvents } from '@obliance/shared';
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
  maintenance:       'bg-purple-400',
  suspended:         'bg-gray-500',
  pending_uninstall: 'bg-orange-400 animate-pulse',
};

function DeviceStatusDot({ status }: { status: DeviceStatus }) {
  const dot = STATUS_DOT[status] ?? 'bg-gray-400';
  return <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', dot)} />;
}

// ── Draggable Device Item ────────────────────────────────────────────────────

function DraggableDeviceItem({
  device,
  indent = false,
}: {
  device: Device;
  indent?: boolean;
}) {
  const location = useLocation();
  const isActive = location.pathname === `/devices/${device.id}`;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `device-${device.id}`,
    data: { type: 'device', device },
  });

  const displayName = device.displayName ?? device.hostname;

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{ opacity: isDragging ? 0.4 : 1 }}
    >
      <Link
        to={`/devices/${device.id}`}
        className={cn(
          'flex items-center gap-2 rounded-md py-1 text-sm transition-colors',
          indent ? 'pl-6 pr-2' : 'px-2',
          isActive
            ? 'bg-bg-active text-text-primary'
            : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
        )}
        onClick={e => { if (isDragging) e.preventDefault(); }}
      >
        <DeviceStatusDot status={device.status} />
        <span className="truncate flex-1 text-xs">{displayName}</span>
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
}: {
  group: DeviceGroupTreeNode;
  devices: Device[];
  searchQuery: string;
  depth?: number;
}) {
  const location = useLocation();
  const [collapsed, setCollapsed] = usePersisted<boolean>(`sidebar-group-collapsed-${group.id}`, false);

  const isGroupActive = location.pathname === `/group/${group.id}`;
  const groupDevices = devices.filter(d => d.groupId === group.id);

  // Apply search filter
  const filteredDevices = searchQuery
    ? groupDevices.filter(d =>
        (d.displayName ?? d.hostname).toLowerCase().includes(searchQuery.toLowerCase()),
      )
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
          className="flex items-center gap-1.5 flex-1 py-1 min-w-0"
        >
          <Server size={13} className="shrink-0 text-text-muted" />
          <span className="truncate flex-1 text-xs font-medium">{group.name}</span>
          {groupDevices.length > 0 && (
            <span className="flex items-center gap-1 shrink-0">
              {onlineCount > 0 && (
                <span className="text-[10px] text-green-400 font-medium">{onlineCount}</span>
              )}
              {offlineCount > 0 && (
                <span className="text-[10px] text-gray-400 font-medium">{offlineCount}</span>
              )}
            </span>
          )}
        </Link>
      </div>

      {/* Expanded content */}
      {!collapsed && (
        <div>
          {/* Devices in this group */}
          {filteredDevices.map(device => (
            <DraggableDeviceItem key={device.id} device={device} indent />
          ))}
          {/* Child groups */}
          {group.children.map(child => (
            <GroupRow
              key={child.id}
              group={child}
              devices={devices}
              searchQuery={searchQuery}
              depth={depth + 1}
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
}

function NavLink({ item }: { item: NavItem }) {
  const location = useLocation();
  const isActive = location.pathname === item.path ||
    (item.path !== '/' && location.pathname.startsWith(item.path));
  return (
    <Link
      to={item.path}
      className={cn(
        'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
        isActive
          ? 'bg-bg-active text-text-primary'
          : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
      )}
    >
      {item.icon}
      {item.label}
    </Link>
  );
}

// ── Main Sidebar ──────────────────────────────────────────────────────────────

export function Sidebar() {
  const { t } = useTranslation();
  const location = useLocation();
  const { user, isAdmin } = useAuthStore();
  const { sidebarFloating, toggleSidebarFloating } = useUiStore();
  const { tenants, currentTenantId, setCurrentTenant } = useTenantStore();

  const admin = isAdmin();

  // ── Layout preferences ─────────────────────────────────────────────────────
  const [sidebarLayout, setSidebarLayout] = usePersisted<'stacked' | 'side-by-side'>('sidebar-layout', 'stacked');
  const [showDevices, setShowDevices] = usePersisted<boolean>('sidebar-show-devices', true);
  const [splitPercent, setSplitPercent] = usePersisted<number>('sidebar-split-percent', 50);
  const [adminMenuOpen, setAdminMenuOpen] = usePersisted<boolean>('sidebar:admin-open', true);
  const splitContainerRef = useRef<HTMLDivElement>(null);

  // ── Device & group state ────────────────────────────────────────────────────
  const [devices, setDevices] = useState<Device[]>([]);
  const [groupTree, setGroupTree] = useState<DeviceGroupTreeNode[]>([]);
  const [search, setSearch] = useState('');

  const loadDeviceData = useCallback(async () => {
    try {
      const [devList, tree] = await Promise.all([
        deviceApi.list({ approvalStatus: 'approved' }),
        groupsApi.tree(),
      ]);
      setDevices(devList);
      setGroupTree(tree);
    } catch {
      // fail silently — sidebar will just show empty
    }
  }, []);

  useEffect(() => {
    loadDeviceData();
    const id = setInterval(loadDeviceData, 30_000);
    return () => clearInterval(id);
  }, [loadDeviceData]);

  // ── Real-time socket updates ────────────────────────────────────────────────
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const onDeviceUpdated = (data: { deviceId: number; status: DeviceStatus; groupId: number | null; hostname: string; displayName: string | null }) => {
      setDevices(prev => prev.map(d =>
        d.id === data.deviceId
          ? { ...d, status: data.status, groupId: data.groupId, hostname: data.hostname, displayName: data.displayName }
          : d,
      ));
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
  const mainNavItems: NavItem[] = [
    { label: t('nav.dashboard'),  path: '/',           icon: <LayoutDashboard size={18} /> },
    { label: t('nav.devices'),    path: '/devices',    icon: <Monitor size={18} /> },
    { label: t('nav.scripts'),    path: '/scripts',    icon: <Code2 size={18} /> },
    { label: t('nav.schedules'),  path: '/schedules',  icon: <CalendarClock size={18} /> },
    { label: t('nav.updates'),    path: '/updates',    icon: <RefreshCw size={18} /> },
    { label: t('nav.compliance'), path: '/compliance', icon: <ShieldCheck size={18} /> },
    { label: t('nav.remote'),     path: '/remote',     icon: <Laptop size={18} /> },
    { label: t('nav.reports'),    path: '/reports',    icon: <FileBarChart2 size={18} /> },
    { label: t('nav.history'),    path: '/history',    icon: <History size={18} /> },
    { label: t('nav.download'),   path: '/download',   icon: <Download size={18} /> },
  ];

  const adminNavItems: NavItem[] = [
    { label: t('nav.groups'),       path: '/groups',              icon: <FolderTree size={18} /> },
    { label: t('nav.notifications'), path: '/notifications',      icon: <Bell size={18} /> },
    { label: t('nav.users'),        path: '/admin/users',         icon: <Users size={18} /> },
    { label: t('nav.agents'),       path: '/admin/devices',       icon: <Terminal size={18} /> },
    { label: t('nav.maintenance'),  path: '/admin/maintenance',   icon: <CalendarClock size={18} /> },
    { label: t('tenant.pageTitle'), path: '/admin/tenants',       icon: <Building2 size={18} /> },
    { label: t('nav.importExport'), path: '/admin/import-export', icon: <PackageOpen size={18} /> },
    { label: t('nav.settings'),     path: '/settings',            icon: <Settings size={18} /> },
  ];

  // ── Ungrouped devices ──────────────────────────────────────────────────────
  const ungroupedDevices = devices.filter(d => d.groupId === null);
  const filteredUngrouped = search
    ? ungroupedDevices.filter(d =>
        (d.displayName ?? d.hostname).toLowerCase().includes(search.toLowerCase()),
      )
    : ungroupedDevices;

  // ── Device tree content ────────────────────────────────────────────────────
  const renderDeviceTree = (hideHeader = false) => (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className={hideHeader ? '' : 'mt-2 pt-2 border-t border-border'}>
        {!hideHeader && (
          <div className="px-2 py-1 flex items-center gap-1.5 text-xs font-medium text-text-muted uppercase tracking-wider">
            <Server size={12} />
            {t('nav.devices')}
          </div>
        )}

        {/* Device groups tree */}
        {groupTree.map(group => (
          <GroupRow
            key={group.id}
            group={group}
            devices={devices}
            searchQuery={search}
          />
        ))}

        {/* Ungrouped devices */}
        {filteredUngrouped.length > 0 && (
          <DroppableGroupHeader groupId={null}>
            <div className="px-2 py-0.5 text-[10px] font-medium text-text-muted uppercase tracking-wider mt-1">
              Ungrouped
            </div>
            {filteredUngrouped.map(device => (
              <DraggableDeviceItem key={device.id} device={device} />
            ))}
          </DroppableGroupHeader>
        )}
      </div>
    </DndContext>
  );

  return (
    <aside className="flex h-full w-full flex-col border-r border-border bg-bg-secondary">

      {/* Logo + float/pin toggle */}
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
        <Link to="/" className="flex items-center gap-2">
          <img src="/logo.webp" alt="Obliance" className="h-8 w-8 rounded-lg" />
          <span className="text-lg font-semibold text-text-primary">Obliance</span>
        </Link>
        <button
          onClick={toggleSidebarFloating}
          title={sidebarFloating ? t('nav.pinSidebar') : t('nav.floatSidebar')}
          className={cn(
            'p-1.5 rounded transition-colors',
            sidebarFloating
              ? 'text-accent hover:text-accent hover:bg-accent/10'
              : 'text-text-muted hover:text-text-primary hover:bg-bg-hover',
          )}
        >
          {sidebarFloating ? <PanelLeft size={15} /> : <PanelLeftClose size={15} />}
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-3">
        <input
          type="text"
          placeholder={t('common.search')}
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full rounded-md border border-border bg-bg-tertiary px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
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
              {mainNavItems.map(item => <NavLink key={item.path} item={item} />)}
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
        <div className="flex-1 overflow-y-auto px-2">
          {/* Primary nav */}
          <nav className="py-1">
            {mainNavItems.map(item => <NavLink key={item.path} item={item} />)}
          </nav>

          {/* Device group tree */}
          {showDevices && renderDeviceTree(false)}
        </div>
      )}

      {/* Admin section */}
      {admin && (
        <>
          <button
            onClick={() => setAdminMenuOpen(v => !v)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-text-muted hover:text-text-secondary transition-colors"
          >
            <div className="flex-1 h-px bg-border" />
            <ChevronDown size={12} className={cn('transition-transform duration-200', !adminMenuOpen && '-rotate-90')} />
            <div className="flex-1 h-px bg-border" />
          </button>

          {adminMenuOpen && (
            <nav className="px-2 pb-1">
              {adminNavItems.map(item => <NavLink key={item.path} item={item} />)}
            </nav>
          )}
        </>
      )}

      {/* Tenant switcher (multi-tenant) */}
      {tenants.length > 1 && (
        <div className="border-t border-border px-3 py-2">
          <label className="text-[10px] font-medium text-text-muted uppercase tracking-wider mb-1 block">
            Tenant
          </label>
          <select
            value={currentTenantId ?? ''}
            onChange={e => setCurrentTenant(Number(e.target.value))}
            className="w-full rounded-md border border-border bg-bg-tertiary px-2 py-1 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
          >
            {tenants.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
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
          <UserCircle size={18} />
          <span className="truncate flex-1">{user?.displayName || user?.username}</span>
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
