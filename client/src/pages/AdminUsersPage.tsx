import { useState, useEffect, type FormEvent } from 'react';
import {
  Plus,
  Pencil,
  Trash2,
  Key,
  Shield,
  ShieldOff,
  UserIcon,
  UserX,
  Users,
  FolderOpen,
  Monitor,
  Check,
  ChevronRight,
  ChevronDown,
  Eye,
  Building2,
  X,
} from 'lucide-react';
import type {
  User,
  UserTeam,
  TeamPermission,
  DeviceGroupTreeNode,
  Device,
  UserTenantAssignment,
} from '@obliance/shared';
import { usersApi } from '@/api/users.api';
import { teamsApi } from '@/api/teams.api';
import { groupsApi } from '@/api/groups.api';
import { deviceApi } from '@/api/device.api';
import { useAuthStore } from '@/store/authStore';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { NotificationsPage } from './NotificationsPage';

type PermissionLevel = 'ro' | 'rw';
type PermissionScope = 'group' | 'device';

type Tab = 'users' | 'teams' | 'notifications';
type UserFormMode = 'create' | 'edit' | 'password' | null;
type TeamFormMode = 'create' | 'edit' | null;
type TenantDraft = Record<number, { isMember: boolean; role: 'admin' | 'member' }>;

export function AdminUsersPage() {
  const { t } = useTranslation();
  const { user: currentUser } = useAuthStore();
  const isPlatformAdmin = currentUser?.role === 'admin';
  const [tab, setTab] = useState<Tab>('users');

  // Data
  const [users, setUsers] = useState<User[]>([]);
  const [teams, setTeams] = useState<UserTeam[]>([]);
  const [tree, setTree] = useState<DeviceGroupTreeNode[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);

  // User form
  const [userFormMode, setUserFormMode] = useState<UserFormMode>(null);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [formUsername, setFormUsername] = useState('');
  const [formDisplayName, setFormDisplayName] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formRole, setFormRole] = useState<'admin' | 'user'>('user');
  const [saving, setSaving] = useState(false);

  // Team form
  const [teamFormMode, setTeamFormMode] = useState<TeamFormMode>(null);
  const [editingTeam, setEditingTeam] = useState<UserTeam | null>(null);
  const [formTeamName, setFormTeamName] = useState('');
  const [formTeamDesc, setFormTeamDesc] = useState('');
  const [formCanCreate, setFormCanCreate] = useState(false);
  const [formTeamTenantId, setFormTeamTenantId] = useState<number | ''>('');

  // Selected team for right panel
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);
  const [teamMembers, setTeamMembers] = useState<number[]>([]);
  const [teamPermissions, setTeamPermissions] = useState<TeamPermission[]>([]);
  const [rightTab, setRightTab] = useState<'members' | 'permissions'>('members');

  // Team tenant filter (platform admin only)
  const [teamTenantFilter, setTeamTenantFilter] = useState<number | 'all'>('all');

  // Tenant assignment panel
  const [tenantPanelUser, setTenantPanelUser] = useState<User | null>(null);
  const [tenantAssignments, setTenantAssignments] = useState<UserTenantAssignment[]>([]);
  const [tenantDraft, setTenantDraft] = useState<TenantDraft>({});
  const [tenantPanelLoading, setTenantPanelLoading] = useState(false);
  const [tenantSaving, setTenantSaving] = useState(false);

  const load = async () => {
    try {
      const [u, t, tr, d] = await Promise.all([
        usersApi.list(),
        isPlatformAdmin ? teamsApi.listAll() : teamsApi.list(),
        groupsApi.tree(),
        deviceApi.list(),
      ]);
      setUsers(u);
      setTeams(t);
      setTree(tr);
      setDevices(d);
    } catch {
      toast.error('Failed to load data');
    }
  };

  useEffect(() => { load(); }, []);

  const loadTeamDetails = async (teamId: number) => {
    try {
      const detail = await teamsApi.getById(teamId);
      setTeamMembers(detail.memberIds);
      setTeamPermissions(detail.permissions);
    } catch {
      toast.error(t('users.teams.failedMembers'));
    }
  };

  const selectTeam = (teamId: number) => {
    setSelectedTeamId(teamId);
    loadTeamDetails(teamId);
  };

  // ── Derived: unique tenants from teams list ──
  const teamTenants: { id: number; name: string }[] = [];
  const seenTenantIds = new Set<number>();
  for (const team of teams) {
    if (team.tenantId && !seenTenantIds.has(team.tenantId)) {
      seenTenantIds.add(team.tenantId);
      teamTenants.push({ id: team.tenantId, name: team.tenantName ?? `Tenant ${team.tenantId}` });
    }
  }
  teamTenants.sort((a, b) => a.name.localeCompare(b.name));

  const filteredTeams = (isPlatformAdmin && teamTenantFilter !== 'all')
    ? teams.filter((t) => t.tenantId === teamTenantFilter)
    : teams;

  // ── User form handlers ──

  const resetUserForm = () => {
    setUserFormMode(null);
    setEditingUser(null);
    setFormUsername('');
    setFormDisplayName('');
    setFormPassword('');
    setFormRole('user');
  };

  const handleCreateUser = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await usersApi.create({
        username: formUsername,
        password: formPassword,
        displayName: formDisplayName || undefined,
        role: formRole,
      });
      toast.success(t('users.created'));
      resetUserForm();
      load();
    } catch {
      toast.error(t('users.failedCreate'));
    } finally {
      setSaving(false);
    }
  };

  const handleEditUser = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setSaving(true);
    try {
      await usersApi.update(editingUser.id, {
        username: formUsername,
        displayName: formDisplayName || null,
        role: formRole,
      });
      toast.success(t('users.updated'));
      resetUserForm();
      load();
    } catch {
      toast.error(t('users.failedUpdate'));
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordChange = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setSaving(true);
    try {
      await usersApi.changePassword(editingUser.id, formPassword);
      toast.success('Password changed');
      resetUserForm();
    } catch {
      toast.error('Failed to change password');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteUser = async (user: User) => {
    if (!confirm(t('users.confirmDelete', { username: user.username }))) return;
    try {
      await usersApi.delete(user.id);
      toast.success(t('users.deleted'));
      load();
    } catch {
      toast.error(t('users.failedDelete'));
    }
  };

  const handleResetMfa = async (user: User) => {
    if (!confirm(t('users.confirmResetMfa', { username: user.username }))) return;
    try {
      await usersApi.resetMfa(user.id);
      toast.success(t('users.mfaReset', { username: user.username }));
      load();
    } catch {
      toast.error(t('users.failedResetMfa'));
    }
  };

  const handleToggleActive = async (user: User) => {
    try {
      await usersApi.update(user.id, { isActive: !user.isActive });
      toast.success(user.isActive ? t('users.disabled') : t('users.enabled'));
      load();
    } catch {
      toast.error(t('users.failedUpdate'));
    }
  };

  // ── Team form handlers ──

  const resetTeamForm = () => {
    setTeamFormMode(null);
    setEditingTeam(null);
    setFormTeamName('');
    setFormTeamDesc('');
    setFormCanCreate(false);
    setFormTeamTenantId('');
  };

  const handleCreateTeam = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const baseData = {
        name: formTeamName,
        description: formTeamDesc || null,
        canCreate: formCanCreate,
      };
      const createPayload = (isPlatformAdmin && formTeamTenantId !== '')
        ? { ...baseData, tenantId: Number(formTeamTenantId) }
        : baseData;
      const team = await teamsApi.create(createPayload as unknown as Parameters<typeof teamsApi.create>[0]);
      toast.success(t('users.teams.created'));
      resetTeamForm();
      load();
      selectTeam(team.id);
    } catch {
      toast.error(t('users.teams.failedCreate'));
    } finally {
      setSaving(false);
    }
  };

  const handleEditTeam = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingTeam) return;
    setSaving(true);
    try {
      await teamsApi.update(editingTeam.id, {
        name: formTeamName,
        description: formTeamDesc || null,
        canCreate: formCanCreate,
      });
      toast.success(t('users.teams.updated'));
      resetTeamForm();
      load();
    } catch {
      toast.error(t('users.teams.failedUpdate'));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteTeam = async (team: UserTeam) => {
    if (!confirm(t('users.teams.confirmDelete', { name: team.name }))) return;
    try {
      await teamsApi.delete(team.id);
      toast.success(t('users.teams.deleted'));
      if (selectedTeamId === team.id) setSelectedTeamId(null);
      load();
    } catch {
      toast.error(t('users.teams.failedDelete'));
    }
  };

  // ── Tenant panel handlers ──

  const openTenantPanel = async (user: User) => {
    setTenantPanelUser(user);
    setTenantPanelLoading(true);
    try {
      const assignments = await usersApi.getTenants(user.id);
      setTenantAssignments(assignments);
      const draft: TenantDraft = {};
      for (const a of assignments) {
        draft[a.tenantId] = { isMember: a.isMember, role: a.role };
      }
      setTenantDraft(draft);
    } catch {
      toast.error('Failed to load tenant assignments');
      setTenantPanelUser(null);
    } finally {
      setTenantPanelLoading(false);
    }
  };

  const closeTenantPanel = () => {
    setTenantPanelUser(null);
    setTenantAssignments([]);
    setTenantDraft({});
  };

  const toggleTenantMember = (tenantId: number) => {
    setTenantDraft((prev) => {
      const current = prev[tenantId] ?? { isMember: false, role: 'member' as const };
      return { ...prev, [tenantId]: { ...current, isMember: !current.isMember } };
    });
  };

  const setTenantRole = (tenantId: number, role: 'admin' | 'member') => {
    setTenantDraft((prev) => {
      const current = prev[tenantId] ?? { isMember: true, role };
      return { ...prev, [tenantId]: { ...current, role } };
    });
  };

  const saveTenantAssignments = async () => {
    if (!tenantPanelUser) return;
    setTenantSaving(true);
    try {
      const assignments = Object.entries(tenantDraft)
        .filter(([, v]) => v.isMember)
        .map(([tenantId, v]) => ({ tenantId: Number(tenantId), role: v.role }));
      await usersApi.setTenants(tenantPanelUser.id, assignments);
      toast.success('Tenant assignments saved');
      closeTenantPanel();
    } catch {
      toast.error('Failed to save tenant assignments');
    } finally {
      setTenantSaving(false);
    }
  };

  // ── Members management ──

  const toggleMember = async (userId: number) => {
    if (!selectedTeamId) return;
    const newMembers = teamMembers.includes(userId)
      ? teamMembers.filter((id) => id !== userId)
      : [...teamMembers, userId];
    try {
      await teamsApi.setMembers(selectedTeamId, { memberIds: newMembers });
      setTeamMembers(newMembers);
    } catch {
      toast.error(t('users.teams.failedUpdateMembers'));
    }
  };

  // ── Permissions management ──

  const addPermission = async (scope: PermissionScope, scopeId: number, level: PermissionLevel) => {
    if (!selectedTeamId) return;
    const existing = teamPermissions.find((p) => p.scope === scope && p.scopeId === scopeId);
    if (existing) {
      const newPerms = teamPermissions.map((p) =>
        p.id === existing.id ? { ...p, level } : p,
      );
      try {
        await teamsApi.setPermissions(selectedTeamId, {
          permissions: newPerms.map((p) => ({ scope: p.scope, scopeId: p.scopeId, level: p.level })),
        });
        await loadTeamDetails(selectedTeamId);
      } catch {
        toast.error(t('users.teams.failedUpdatePermission'));
      }
    } else {
      const newPerms = [
        ...teamPermissions.map((p) => ({ scope: p.scope, scopeId: p.scopeId, level: p.level })),
        { scope, scopeId, level },
      ];
      try {
        await teamsApi.setPermissions(selectedTeamId, { permissions: newPerms });
        await loadTeamDetails(selectedTeamId);
      } catch {
        toast.error(t('users.teams.failedAddPermission'));
      }
    }
  };

  const removePermission = async (permId: number) => {
    if (!selectedTeamId) return;
    try {
      await teamsApi.removePermission(selectedTeamId, permId);
      setTeamPermissions((prev) => prev.filter((p) => p.id !== permId));
    } catch {
      toast.error(t('users.teams.failedRemovePermission'));
    }
  };

  const togglePermissionLevel = async (perm: TeamPermission) => {
    const newLevel: PermissionLevel = perm.level === 'ro' ? 'rw' : 'ro';
    await addPermission(perm.scope, perm.scopeId, newLevel);
  };

  const selectedTeam = teams.find((t) => t.id === selectedTeamId);

  // Build sets for quick lookup
  const assignedGroupIds = new Set(teamPermissions.filter((p) => p.scope === 'group').map((p) => p.scopeId));
  const assignedDeviceIds = new Set(teamPermissions.filter((p) => p.scope === 'device').map((p) => p.scopeId));

  // Collect all descendant group IDs covered by a group permission (implicit coverage)
  const coveredGroupIds = new Set<number>();
  const coveredByGroupId = new Map<number, number>(); // descendant → assigned ancestor
  const collectDescendants = (nodes: DeviceGroupTreeNode[], coveredBy: number | null) => {
    for (const node of nodes) {
      const directlyAssigned = assignedGroupIds.has(node.id);
      const effectiveCover = directlyAssigned ? node.id : coveredBy;
      if (coveredBy && !directlyAssigned) {
        coveredGroupIds.add(node.id);
        coveredByGroupId.set(node.id, coveredBy);
      }
      collectDescendants(node.children, effectiveCover);
      if (effectiveCover) {
        for (const device of devices.filter((d) => d.groupId === node.id)) {
          if (!assignedDeviceIds.has(device.id)) {
            coveredByGroupId.set(-device.id, effectiveCover);
          }
        }
      }
    }
  };
  collectDescendants(tree, null);

  // Merge devices into tree nodes for display
  const devicesByGroup = new Map<number, Device[]>();
  const ungroupedDevices: Device[] = [];
  for (const device of devices) {
    if (device.groupId) {
      if (!devicesByGroup.has(device.groupId)) devicesByGroup.set(device.groupId, []);
      devicesByGroup.get(device.groupId)!.push(device);
    } else {
      ungroupedDevices.push(device);
    }
  }

  // Get permission for a group/device
  const getGroupPerm = (groupId: number) => teamPermissions.find((p) => p.scope === 'group' && p.scopeId === groupId);
  const getDevicePerm = (deviceId: number) => teamPermissions.find((p) => p.scope === 'device' && p.scopeId === deviceId);

  return (
    <>
      <div className="flex gap-6 p-6 h-full min-w-0 w-full">
        {/* Left panel */}
        <div className="flex-1 min-w-0 max-w-xl">
          {/* Tab switcher */}
          <div className="flex items-center gap-1 mb-4 rounded-lg bg-bg-secondary p-1 border border-border">
            <button
              onClick={() => setTab('users')}
              className={`flex-1 px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                tab === 'users'
                  ? 'bg-accent text-white'
                  : 'text-text-muted hover:text-text-primary'
              }`}
            >
              <UserIcon size={14} className="inline mr-1.5" />
              {t('users.tabUsers')}
            </button>
            <button
              onClick={() => setTab('teams')}
              className={`flex-1 px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                tab === 'teams'
                  ? 'bg-accent text-white'
                  : 'text-text-muted hover:text-text-primary'
              }`}
            >
              <Users size={14} className="inline mr-1.5" />
              {t('users.tabTeams')}
            </button>
            <button
              onClick={() => setTab('notifications')}
              className={`flex-1 px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                tab === 'notifications'
                  ? 'bg-accent text-white'
                  : 'text-text-muted hover:text-text-primary'
              }`}
            >
              {t('users.tabNotifications')}
            </button>
          </div>

          {/* ── Notifications Tab ── */}
          {tab === 'notifications' && <NotificationsPage embedded />}

          {/* ── Users Tab ── */}
          {tab === 'users' && (
            <>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-text-primary">{t('users.tabUsers')}</h2>
                <Button size="sm" onClick={() => { resetUserForm(); setUserFormMode('create'); }}>
                  <Plus size={14} className="mr-1" />{t('common.new')}
                </Button>
              </div>

              {/* User form */}
              {(userFormMode === 'create' || userFormMode === 'edit') && (
                <div className="mb-4 rounded-lg border border-border bg-bg-secondary p-4">
                  <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-3">
                    {userFormMode === 'create' ? t('users.newUser') : t('users.editUser', { username: editingUser?.username })}
                  </h3>
                  <form onSubmit={userFormMode === 'create' ? handleCreateUser : handleEditUser} className="space-y-3">
                    <Input label={t('users.usernameLabel')} value={formUsername} onChange={(e) => setFormUsername(e.target.value)} required pattern="[a-zA-Z0-9_.\-]+" />
                    <Input label={t('users.displayNameLabel')} value={formDisplayName} onChange={(e) => setFormDisplayName(e.target.value)} />
                    {userFormMode === 'create' && (
                      <Input label={t('users.passwordLabel')} type="password" value={formPassword} onChange={(e) => setFormPassword(e.target.value)} required minLength={6} />
                    )}
                    <div className="space-y-1">
                      <label className="block text-sm font-medium text-text-secondary">{t('users.roleLabel')}</label>
                      <select value={formRole} onChange={(e) => setFormRole(e.target.value as 'admin' | 'user')}
                        className="w-full rounded-md border border-border bg-bg-tertiary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent">
                        <option value="user">{t('users.roleUser')}</option>
                        <option value="admin">{t('users.roleAdmin')}</option>
                      </select>
                    </div>
                    <div className="flex gap-2">
                      <Button type="submit" size="sm" loading={saving}>{userFormMode === 'create' ? t('common.create') : t('common.save')}</Button>
                      <Button type="button" size="sm" variant="secondary" onClick={resetUserForm}>{t('common.cancel')}</Button>
                    </div>
                  </form>
                </div>
              )}

              {userFormMode === 'password' && editingUser && (
                <div className="mb-4 rounded-lg border border-border bg-bg-secondary p-4">
                  <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-3">
                    {t('users.changePasswordTitle', { username: editingUser.username })}
                  </h3>
                  <form onSubmit={handlePasswordChange} className="space-y-3">
                    <Input label={t('users.newPassword')} type="password" value={formPassword} onChange={(e) => setFormPassword(e.target.value)} required minLength={6} />
                    <div className="flex gap-2">
                      <Button type="submit" size="sm" loading={saving}>{t('users.changePassword')}</Button>
                      <Button type="button" size="sm" variant="secondary" onClick={resetUserForm}>{t('common.cancel')}</Button>
                    </div>
                  </form>
                </div>
              )}

              {/* User list */}
              <div className="rounded-lg border border-border bg-bg-secondary divide-y divide-border">
                {users.map((user) => (
                  <div key={user.id} className="flex items-center gap-2 px-3 py-2.5 group">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-text-primary truncate">{user.username.startsWith('og_') ? user.username.slice(3) : user.username}</span>
                        {user.displayName && <span className="text-xs text-text-muted">({user.displayName})</span>}
                        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                          user.role === 'admin' ? 'bg-accent/10 text-accent' : 'bg-bg-tertiary text-text-muted'
                        }`}>
                          {user.role === 'admin' ? <><Shield size={10} className="inline mr-0.5" />{t('users.roleAdmin')}</> : t('users.roleUser')}
                        </span>
                        {user.foreignSource === 'obligate' && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-[#1e1b4b]/60 border border-[#4338ca]/40 px-1.5 py-0.5 text-[10px] font-medium text-[#a5b4fc]">
                            SSO
                          </span>
                        )}
                        {!user.isActive && (
                          <span className="rounded-full bg-status-down/10 px-1.5 py-0.5 text-[10px] font-medium text-status-down">Off</span>
                        )}
                        {(user.totpEnabled || user.emailOtpEnabled) && (
                          <span className="rounded-full bg-green-500/10 px-1.5 py-0.5 text-[10px] font-medium text-green-400">
                            <Shield size={10} className="inline mr-0.5" />MFA
                          </span>
                        )}
                      </div>
                    </div>
                    {(user.totpEnabled || user.emailOtpEnabled) && (
                      <button
                        onClick={() => handleResetMfa(user)}
                        className="shrink-0 p-1 text-status-down hover:text-status-down/80 opacity-0 group-hover:opacity-100"
                        title={t('users.resetMfa')}
                      >
                        <ShieldOff size={13} />
                      </button>
                    )}
                    {user.id !== currentUser?.id && (
                      <>
                        <button onClick={() => { setEditingUser(user); setFormPassword(''); setUserFormMode('password'); }}
                          className="shrink-0 p-1 text-text-muted hover:text-accent opacity-0 group-hover:opacity-100" title="Password">
                          <Key size={13} />
                        </button>
                        <button onClick={() => handleToggleActive(user)}
                          className="shrink-0 p-1 text-text-muted hover:text-text-primary opacity-0 group-hover:opacity-100" title={user.isActive ? t('common.disable') : t('common.enable')}>
                          {user.isActive ? <UserX size={13} /> : <UserIcon size={13} />}
                        </button>
                      </>
                    )}
                    <button onClick={() => { setEditingUser(user); setFormUsername(user.username); setFormDisplayName(user.displayName || ''); setFormRole(user.role); setUserFormMode('edit'); }}
                      className="shrink-0 p-1 text-text-muted hover:text-text-primary opacity-0 group-hover:opacity-100" title={t('common.edit')}>
                      <Pencil size={13} />
                    </button>
                    {/* Tenant assignment button */}
                    <button
                      onClick={() => openTenantPanel(user)}
                      className="shrink-0 p-1 text-text-muted hover:text-accent opacity-0 group-hover:opacity-100"
                      title="Manage tenant access"
                    >
                      <Building2 size={13} />
                    </button>
                    {user.id !== currentUser?.id && (
                      <button onClick={() => handleDeleteUser(user)}
                        className="shrink-0 p-1 text-text-muted hover:text-status-down opacity-0 group-hover:opacity-100" title={t('common.delete')}>
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {/* ── Teams Tab ── */}
          {tab === 'teams' && (
            <>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-text-primary">{t('users.tabTeams')}</h2>
                <Button size="sm" onClick={() => {
                  resetTeamForm();
                  // Default tenant to current filter if set
                  if (isPlatformAdmin && teamTenantFilter !== 'all') {
                    setFormTeamTenantId(teamTenantFilter as number);
                  } else if (isPlatformAdmin && teamTenants.length > 0) {
                    setFormTeamTenantId(teamTenants[0].id);
                  }
                  setTeamFormMode('create');
                }}>
                  <Plus size={14} className="mr-1" />{t('common.new')}
                </Button>
              </div>

              {/* Tenant filter tabs (platform admin only, when multiple tenants) */}
              {isPlatformAdmin && teamTenants.length > 1 && (
                <div className="flex items-center gap-1 mb-3 overflow-x-auto pb-1">
                  <button
                    onClick={() => setTeamTenantFilter('all')}
                    className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                      teamTenantFilter === 'all'
                        ? 'bg-accent text-white'
                        : 'bg-bg-secondary border border-border text-text-muted hover:text-text-primary'
                    }`}
                  >
                    All
                  </button>
                  {teamTenants.map((tenant) => (
                    <button
                      key={tenant.id}
                      onClick={() => setTeamTenantFilter(tenant.id)}
                      className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                        teamTenantFilter === tenant.id
                          ? 'bg-accent text-white'
                          : 'bg-bg-secondary border border-border text-text-muted hover:text-text-primary'
                      }`}
                    >
                      <Building2 size={10} className="inline mr-1" />
                      {tenant.name}
                    </button>
                  ))}
                </div>
              )}

              {/* Team form */}
              {(teamFormMode === 'create' || teamFormMode === 'edit') && (
                <div className="mb-4 rounded-lg border border-border bg-bg-secondary p-4">
                  <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-3">
                    {teamFormMode === 'create' ? t('users.teams.newTeam') : t('users.teams.editTeam', { name: editingTeam?.name })}
                  </h3>
                  <form onSubmit={teamFormMode === 'create' ? handleCreateTeam : handleEditTeam} className="space-y-3">
                    <Input label={t('users.teams.nameLabel')} value={formTeamName} onChange={(e) => setFormTeamName(e.target.value)} required />
                    <Input label={t('users.teams.descLabel')} value={formTeamDesc} onChange={(e) => setFormTeamDesc(e.target.value)} />
                    <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
                      <input type="checkbox" checked={formCanCreate} onChange={(e) => setFormCanCreate(e.target.checked)}
                        className="rounded border-border text-accent focus:ring-accent" />
                      {t('users.teams.canCreate')}
                    </label>
                    {/* Tenant selector — platform admin only, create mode only */}
                    {isPlatformAdmin && teamFormMode === 'create' && teamTenants.length > 0 && (
                      <div className="space-y-1">
                        <label className="block text-sm font-medium text-text-secondary">
                          <Building2 size={12} className="inline mr-1" />Tenant
                        </label>
                        <select
                          value={formTeamTenantId}
                          onChange={(e) => setFormTeamTenantId(e.target.value ? Number(e.target.value) : '')}
                          className="w-full rounded-md border border-border bg-bg-tertiary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                          required
                        >
                          <option value="">— Select tenant —</option>
                          {teamTenants.map((tenant) => (
                            <option key={tenant.id} value={tenant.id}>{tenant.name}</option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <Button type="submit" size="sm" loading={saving}>{teamFormMode === 'create' ? t('common.create') : t('common.save')}</Button>
                      <Button type="button" size="sm" variant="secondary" onClick={resetTeamForm}>{t('common.cancel')}</Button>
                    </div>
                  </form>
                </div>
              )}

              {/* Team list */}
              <div className="rounded-lg border border-border bg-bg-secondary divide-y divide-border">
                {filteredTeams.length === 0 ? (
                  <div className="py-8 text-center">
                    <Users size={28} className="mx-auto mb-2 text-text-muted" />
                    <p className="text-sm text-text-muted">{t('users.teams.noTeams')}</p>
                  </div>
                ) : (
                  filteredTeams.map((team) => (
                    <div
                      key={team.id}
                      onClick={() => selectTeam(team.id)}
                      className={`flex items-center gap-2 px-3 py-2.5 cursor-pointer group transition-colors ${
                        selectedTeamId === team.id ? 'bg-accent/5 border-l-2 border-l-accent' : 'hover:bg-bg-hover'
                      }`}
                    >
                      <Users size={14} className="shrink-0 text-text-muted" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-sm font-medium text-text-primary">{team.name}</span>
                          {team.canCreate && (
                            <span className="rounded-full bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                              {t('users.teams.createBadge')}
                            </span>
                          )}
                          {/* Tenant badge */}
                          {team.tenantName && isPlatformAdmin && (
                            <span className="rounded bg-bg-tertiary border border-border px-1.5 py-0.5 text-[10px] text-text-muted flex items-center gap-0.5">
                              <Building2 size={9} />
                              {team.tenantName}
                            </span>
                          )}
                        </div>
                        {team.description && (
                          <p className="text-xs text-text-muted truncate">{team.description}</p>
                        )}
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditingTeam(team); setFormTeamName(team.name); setFormTeamDesc(team.description || ''); setFormCanCreate(team.canCreate); setTeamFormMode('edit'); }}
                        className="shrink-0 p-1 text-text-muted hover:text-text-primary opacity-0 group-hover:opacity-100">
                        <Pencil size={13} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteTeam(team); }}
                        className="shrink-0 p-1 text-text-muted hover:text-status-down opacity-0 group-hover:opacity-100">
                        <Trash2 size={13} />
                      </button>
                      <ChevronRight size={14} className="shrink-0 text-text-muted" />
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>

        {/* Right panel — Team details */}
        {selectedTeam && tab === 'teams' && (
          <div className="flex-1 min-w-0 max-w-2xl">
            <div className="sticky top-6">
              <h2 className="text-lg font-semibold text-text-primary mb-1">{selectedTeam.name}</h2>
              {selectedTeam.description && (
                <p className="text-sm text-text-muted mb-4">{selectedTeam.description}</p>
              )}

              {/* Right panel tabs */}
              <div className="flex gap-1 mb-4 rounded-lg bg-bg-secondary p-1 border border-border">
                <button
                  onClick={() => setRightTab('members')}
                  className={`flex-1 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                    rightTab === 'members' ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary'
                  }`}
                >
                  {t('users.teams.tabMembers')}
                </button>
                <button
                  onClick={() => setRightTab('permissions')}
                  className={`flex-1 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                    rightTab === 'permissions' ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary'
                  }`}
                >
                  {t('users.teams.tabPermissions')}
                </button>
              </div>

              {/* Members panel */}
              {rightTab === 'members' && (
                <div className="rounded-lg border border-border bg-bg-secondary divide-y divide-border max-h-[60vh] overflow-y-auto">
                  {users.filter((u) => u.role !== 'admin').length === 0 ? (
                    <p className="p-4 text-sm text-text-muted text-center">{t('users.teams.noUsers')}</p>
                  ) : (
                    users.filter((u) => u.role !== 'admin').map((user) => {
                      const isMember = teamMembers.includes(user.id);
                      return (
                        <label key={user.id} className="flex items-center gap-3 px-3 py-2 hover:bg-bg-hover cursor-pointer">
                          <div
                            className={`flex h-4 w-4 items-center justify-center rounded border shrink-0 ${
                              isMember ? 'border-accent bg-accent' : 'border-border bg-bg-tertiary'
                            }`}
                            onClick={(e) => { e.preventDefault(); toggleMember(user.id); }}
                          >
                            {isMember && <Check size={12} className="text-white" />}
                          </div>
                          <span className="text-sm text-text-primary">{user.username}</span>
                          {user.displayName && <span className="text-xs text-text-muted">({user.displayName})</span>}
                          {!user.isActive && <span className="text-[10px] text-status-down">{t('users.disabled')}</span>}
                        </label>
                      );
                    })
                  )}
                </div>
              )}

              {/* Permissions panel — Hierarchical tree */}
              {rightTab === 'permissions' && (
                <div className="rounded-lg border border-border bg-bg-secondary max-h-[70vh] overflow-y-auto">
                  {tree.length === 0 && ungroupedDevices.length === 0 ? (
                    <p className="p-4 text-sm text-text-muted text-center">{t('users.teams.noResources')}</p>
                  ) : (
                    <div className="py-1">
                      {tree.map((node) => (
                        <PermTreeNode
                          key={node.id}
                          node={node}
                          depth={0}
                          devicesByGroup={devicesByGroup}
                          getGroupPerm={getGroupPerm}
                          getDevicePerm={getDevicePerm}
                          assignedGroupIds={assignedGroupIds}
                          coveredGroupIds={coveredGroupIds}
                          coveredByGroupId={coveredByGroupId}
                          addPermission={addPermission}
                          removePermission={removePermission}
                          togglePermissionLevel={togglePermissionLevel}
                        />
                      ))}
                      {/* Ungrouped devices */}
                      {ungroupedDevices.map((device) => {
                        const perm = getDevicePerm(device.id);
                        return (
                          <PermDeviceRow
                            key={device.id}
                            device={device}
                            depth={0}
                            perm={perm}
                            isCovered={false}
                            addPermission={addPermission}
                            removePermission={removePermission}
                            togglePermissionLevel={togglePermissionLevel}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Tenant Assignment Panel ── */}
      {tenantPanelUser && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/40 z-40"
            onClick={closeTenantPanel}
          />
          {/* Slide-in panel */}
          <div className="fixed right-0 top-0 bottom-0 w-96 bg-bg-primary border-l border-border shadow-xl z-50 flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
              <div className="flex items-center gap-2">
                <Building2 size={16} className="text-accent" />
                <div>
                  <h3 className="text-sm font-semibold text-text-primary">Tenants</h3>
                  <p className="text-xs text-text-muted">{tenantPanelUser.username}</p>
                </div>
              </div>
              <button
                onClick={closeTenantPanel}
                className="p-1 text-text-muted hover:text-text-primary rounded"
              >
                <X size={16} />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {tenantPanelLoading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="text-sm text-text-muted">Loading…</div>
                </div>
              ) : tenantPanelUser.role === 'admin' ? (
                /* Platform admin notice */
                <div className="rounded-lg border border-accent/20 bg-accent/5 p-3">
                  <div className="flex items-start gap-2">
                    <Shield size={14} className="text-accent mt-0.5 shrink-0" />
                    <p className="text-xs text-text-secondary">
                      Platform admins automatically access all tenants. No per-tenant assignment is needed.
                    </p>
                  </div>
                </div>
              ) : tenantAssignments.length === 0 ? (
                <p className="text-sm text-text-muted text-center py-8">No tenants available</p>
              ) : (
                tenantAssignments.map((assignment) => {
                  const draft = tenantDraft[assignment.tenantId] ?? { isMember: assignment.isMember, role: assignment.role };
                  return (
                    <div
                      key={assignment.tenantId}
                      className={`rounded-lg border p-3 transition-colors ${
                        draft.isMember ? 'border-accent/30 bg-accent/5' : 'border-border bg-bg-secondary'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <Building2 size={14} className={draft.isMember ? 'text-accent shrink-0' : 'text-text-muted shrink-0'} />
                          <span className="text-sm font-medium text-text-primary truncate">{assignment.tenantName}</span>
                        </div>
                        {/* Toggle switch */}
                        <button
                          onClick={() => toggleTenantMember(assignment.tenantId)}
                          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 transition-colors ${
                            draft.isMember
                              ? 'border-accent bg-accent'
                              : 'border-border bg-bg-tertiary'
                          }`}
                          role="switch"
                          aria-checked={draft.isMember}
                        >
                          <span
                            className={`pointer-events-none inline-block h-3.5 w-3.5 rounded-full bg-white shadow transform transition-transform mt-px ${
                              draft.isMember ? 'translate-x-4' : 'translate-x-0.5'
                            }`}
                          />
                        </button>
                      </div>
                      {/* Role buttons — only when assigned */}
                      {draft.isMember && (
                        <div className="flex items-center gap-1 mt-2">
                          <span className="text-[10px] text-text-muted mr-1">Role:</span>
                          <button
                            onClick={() => setTenantRole(assignment.tenantId, 'member')}
                            className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                              draft.role === 'member'
                                ? 'bg-bg-tertiary text-text-primary border border-border'
                                : 'text-text-muted hover:bg-bg-hover'
                            }`}
                          >
                            Member
                          </button>
                          <button
                            onClick={() => setTenantRole(assignment.tenantId, 'admin')}
                            className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                              draft.role === 'admin'
                                ? 'bg-accent/10 text-accent border border-accent/20'
                                : 'text-text-muted hover:bg-bg-hover'
                            }`}
                          >
                            <Shield size={10} className="inline mr-0.5" />Admin
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer */}
            {tenantPanelUser.role !== 'admin' && (
              <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border shrink-0">
                <Button size="sm" variant="secondary" onClick={closeTenantPanel}>{t('common.cancel')}</Button>
                <Button size="sm" loading={tenantSaving} onClick={saveTenantAssignments}>{t('common.save')}</Button>
              </div>
            )}
            {tenantPanelUser.role === 'admin' && (
              <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border shrink-0">
                <Button size="sm" variant="secondary" onClick={closeTenantPanel}>{t('common.close')}</Button>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}

// ── Permission Tree Sub-Components ──

interface PermTreeNodeProps {
  node: DeviceGroupTreeNode;
  depth: number;
  devicesByGroup: Map<number, Device[]>;
  getGroupPerm: (groupId: number) => TeamPermission | undefined;
  getDevicePerm: (deviceId: number) => TeamPermission | undefined;
  assignedGroupIds: Set<number>;
  coveredGroupIds: Set<number>;
  coveredByGroupId: Map<number, number>;
  addPermission: (scope: PermissionScope, scopeId: number, level: PermissionLevel) => Promise<void>;
  removePermission: (permId: number) => Promise<void>;
  togglePermissionLevel: (perm: TeamPermission) => Promise<void>;
}

function PermTreeNode({
  node,
  depth,
  devicesByGroup,
  getGroupPerm,
  getDevicePerm,
  assignedGroupIds,
  coveredGroupIds,
  coveredByGroupId,
  addPermission,
  removePermission,
  togglePermissionLevel,
}: PermTreeNodeProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);
  const perm = getGroupPerm(node.id);
  const isCovered = coveredGroupIds.has(node.id);
  const hasChildren = node.children.length > 0 || (devicesByGroup.get(node.id)?.length ?? 0) > 0;

  return (
    <div>
      {/* Group row */}
      <div
        className={`flex items-center gap-1.5 px-2 py-1.5 hover:bg-bg-hover transition-colors ${
          perm ? 'bg-accent/5' : isCovered ? 'bg-accent/[0.02]' : ''
        }`}
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
      >
        {/* Expand toggle */}
        <button
          onClick={() => setExpanded(!expanded)}
          className={`shrink-0 p-0.5 text-text-muted hover:text-text-primary transition-colors ${!hasChildren ? 'invisible' : ''}`}
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>

        <FolderOpen size={13} className={`shrink-0 ${perm ? 'text-accent' : isCovered ? 'text-accent/40' : 'text-text-muted'}`} />
        <span className={`flex-1 text-sm truncate ${perm ? 'text-text-primary font-medium' : isCovered ? 'text-text-muted' : 'text-text-primary'}`}>
          {node.name}
        </span>

        {/* Permission controls */}
        {perm ? (
          <>
            <button
              onClick={() => togglePermissionLevel(perm)}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors shrink-0 ${
                perm.level === 'rw'
                  ? 'bg-accent/10 text-accent hover:bg-accent/20'
                  : 'bg-bg-tertiary text-text-muted hover:bg-bg-hover'
              }`}
              title="Click to toggle RO/RW"
            >
              {perm.level === 'rw' ? <><Pencil size={10} className="inline mr-0.5" />{t('users.teams.rwLabel')}</> : <><Eye size={10} className="inline mr-0.5" />{t('users.teams.roLabel')}</>}
            </button>
            <button onClick={() => removePermission(perm.id)} className="p-0.5 text-text-muted hover:text-status-down shrink-0">
              <Trash2 size={11} />
            </button>
          </>
        ) : isCovered ? (
          <span className="text-[10px] text-text-muted italic shrink-0">{t('users.teams.inherited')}</span>
        ) : (
          <>
            <button onClick={() => addPermission('group', node.id, 'ro')}
              className="px-1.5 py-0.5 text-[10px] rounded bg-bg-tertiary text-text-muted hover:bg-bg-hover shrink-0" title="Read Only">
              {t('users.teams.roLabel')}
            </button>
            <button onClick={() => addPermission('group', node.id, 'rw')}
              className="px-1.5 py-0.5 text-[10px] rounded bg-accent/10 text-accent hover:bg-accent/20 shrink-0" title="Read/Write">
              {t('users.teams.rwLabel')}
            </button>
          </>
        )}
      </div>

      {/* Children (groups + monitors) */}
      {expanded && (
        <>
          {node.children.map((child) => (
            <PermTreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              devicesByGroup={devicesByGroup}
              getGroupPerm={getGroupPerm}
              getDevicePerm={getDevicePerm}
              assignedGroupIds={assignedGroupIds}
              coveredGroupIds={coveredGroupIds}
              coveredByGroupId={coveredByGroupId}
              addPermission={addPermission}
              removePermission={removePermission}
              togglePermissionLevel={togglePermissionLevel}
            />
          ))}
          {(devicesByGroup.get(node.id) ?? []).map((device) => {
            const dPerm = getDevicePerm(device.id);
            const dCovered = !dPerm && (assignedGroupIds.has(node.id) || coveredGroupIds.has(node.id));
            return (
              <PermDeviceRow
                key={device.id}
                device={device}
                depth={depth + 1}
                perm={dPerm}
                isCovered={dCovered}
                addPermission={addPermission}
                removePermission={removePermission}
                togglePermissionLevel={togglePermissionLevel}
              />
            );
          })}
        </>
      )}
    </div>
  );
}

interface PermDeviceRowProps {
  device: Device;
  depth: number;
  perm: TeamPermission | undefined;
  isCovered: boolean;
  addPermission: (scope: PermissionScope, scopeId: number, level: PermissionLevel) => Promise<void>;
  removePermission: (permId: number) => Promise<void>;
  togglePermissionLevel: (perm: TeamPermission) => Promise<void>;
}

function PermDeviceRow({
  device,
  depth,
  perm,
  isCovered,
  addPermission,
  removePermission,
  togglePermissionLevel,
}: PermDeviceRowProps) {
  const { t } = useTranslation();
  return (
    <div
      className={`flex items-center gap-1.5 px-2 py-1.5 hover:bg-bg-hover transition-colors ${
        perm ? 'bg-accent/5' : ''
      }`}
      style={{ paddingLeft: `${depth * 20 + 28}px` }}
    >
      <Monitor size={13} className={`shrink-0 ${perm ? 'text-accent' : isCovered ? 'text-accent/40' : 'text-text-muted'}`} />
      <span className={`flex-1 text-sm truncate ${perm ? 'text-text-primary font-medium' : isCovered ? 'text-text-muted' : 'text-text-primary'}`}>
        {device.displayName ?? device.hostname}
      </span>

      {perm ? (
        <>
          <button
            onClick={() => togglePermissionLevel(perm)}
            className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors shrink-0 ${
              perm.level === 'rw'
                ? 'bg-accent/10 text-accent hover:bg-accent/20'
                : 'bg-bg-tertiary text-text-muted hover:bg-bg-hover'
            }`}
            title="Click to toggle RO/RW"
          >
            {perm.level === 'rw' ? <><Pencil size={10} className="inline mr-0.5" />{t('users.teams.rwLabel')}</> : <><Eye size={10} className="inline mr-0.5" />{t('users.teams.roLabel')}</>}
          </button>
          <button onClick={() => removePermission(perm.id)} className="p-0.5 text-text-muted hover:text-status-down shrink-0">
            <Trash2 size={11} />
          </button>
        </>
      ) : isCovered ? (
        <span className="text-[10px] text-text-muted italic shrink-0">{t('users.teams.inherited')}</span>
      ) : (
        <>
          <button onClick={() => addPermission('device', device.id, 'ro')}
            className="px-1.5 py-0.5 text-[10px] rounded bg-bg-tertiary text-text-muted hover:bg-bg-hover shrink-0" title="Read Only">
            {t('users.teams.roLabel')}
          </button>
          <button onClick={() => addPermission('device', device.id, 'rw')}
            className="px-1.5 py-0.5 text-[10px] rounded bg-accent/10 text-accent hover:bg-accent/20 shrink-0" title="Read/Write">
            {t('users.teams.rwLabel')}
          </button>
        </>
      )}
    </div>
  );
}
