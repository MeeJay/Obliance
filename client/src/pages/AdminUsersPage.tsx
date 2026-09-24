import { useState, useEffect, type FormEvent } from 'react';
import {
 Plus,
 Pencil,
 Trash2,
 Key,
 Shield,
 ShieldAlert,
 ShieldOff,
 UserIcon,
 UserX,
 Users,
 FolderOpen,
 FolderX,
 Monitor,
 Check,
 ChevronRight,
 ChevronDown,
 Eye,
 Building2,
} from 'lucide-react';
import type {
 User,
 UserTeam,
 TeamPermission,
 Capability,
 DeviceGroupTreeNode,
 Device,
 UserTenantAssignment,
} from '@obliance/shared';
import { isMasterTenant } from '@obliance/shared';
import { usersApi } from '@/api/users.api';
import { teamsApi } from '@/api/teams.api';
import { groupsApi } from '@/api/groups.api';
import { deviceApi } from '@/api/device.api';
import { restrictionApi, type RestrictionLevel, type RestrictionMap, type RestrictableAction, type ScopeMode } from '@/api/restriction.api';
import { useAuthStore } from '@/store/authStore';
import { useTenantStore } from '@/store/tenantStore';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { ToggleSwitch as SharedToggleSwitch } from '@/components/common/ToggleSwitch';
import { IconButton } from '@/components/common/IconButton';
import { ActionMenu, type ActionMenuItem } from '@/components/common/ActionMenu';
import { MasterDetail } from '@/components/common/MasterDetail';
import { Drawer } from '@/components/common/Drawer';
import { Modal } from '@/components/common/Modal';
import { SegmentedTabs, type SegmentedTab } from '@/components/common/SegmentedTabs';
import { Tip } from '@/components/common/Tip';
import { useConfirm } from '@/components/common/ConfirmDialog';
import { MEDIA, useIsCoarsePointer, useMediaQuery } from '@/hooks/useMediaQuery';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
// `NotificationsPage` is now rendered from /policies (see PoliciesPage).
import { PermissionSetsTab } from '@/components/PermissionSetsTab';

type PermissionLevel = 'ro' | 'rw';
type PermissionScope = 'group' | 'device' | 'ungrouped';

// "notifications" was here but moved to /policies → onglet Notifications
// (it's an operational concern, not a permission-management one). The
// Notifications page itself stays in `pages/NotificationsPage.tsx`,
// it's just rendered from a different host now.
type Tab = 'users' | 'teams' | 'permissionSets' | 'restrictions';
type UserFormMode = 'create' | 'edit' | 'password' | null;
type TeamFormMode = 'create' | 'edit' | null;
type TenantDraft = Record<number, { isMember: boolean; role: 'admin' | 'member' }>;

// Row actions: inline icons from md (hover-revealed with a mouse, always
// visible on touch), everything in a "⋯" menu below md.
const ROW_ACTION_CLS = 'hidden md:inline-flex shrink-0 can-hover:opacity-0 can-hover:group-hover:opacity-100';

export function AdminUsersPage() {
 const { t } = useTranslation();
 const confirm = useConfirm();
 const isWide = useMediaQuery(MEDIA.lg);
 const { user: currentUser } = useAuthStore();
 const isPlatformAdmin = currentUser?.role === 'admin';
 const currentTenantId = useTenantStore((s) => s.currentTenantId);
 const allTenants = useTenantStore((s) => s.tenants);
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

 // Team tenant filter (platform admin only). Defaults to the current tenant
 // selected in the topbar so switching tenants narrows the team list as
 // expected; the user can manually switch to 'all' for the cross-tenant view.
 const [teamTenantFilter, setTeamTenantFilter] = useState<number | 'all'>(currentTenantId ?? 'all');

 // Tenant assignment panel
 const [tenantPanelUser, setTenantPanelUser] = useState<User | null>(null);
 const [tenantAssignments, setTenantAssignments] = useState<UserTenantAssignment[]>([]);
 const [tenantDraft, setTenantDraft] = useState<TenantDraft>({});
 const [tenantPanelLoading, setTenantPanelLoading] = useState(false);
 const [tenantSaving, setTenantSaving] = useState(false);

 const load = async () => {
 try {
 // Platform admin global view is reserved for the default tenant
 // (id=1). On any other tenant we only fetch teams scoped to it,
 // which mirrors the behaviour the customer-tenant admin expects:
 // /admin/users → "who has access to *this* tenant?". Users follow
 // the same rule (the server does the filtering by tenant).
 const isGlobalView = isPlatformAdmin && currentTenantId === 1;
 const [u, t, tr, d] = await Promise.all([
 usersApi.list(),
 isGlobalView ? teamsApi.listAll() : teamsApi.list(),
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

 // Reload whenever the active tenant changes — the user-list and team-list
 // shape both depend on it (server-side scoping). Without this dep the
 // page kept showing the boot-time tenant's data after a topbar switch.
 useEffect(() => { load(); }, [currentTenantId]);

 // Follow the topbar TenantSwitcher: when the user changes the active tenant,
 // narrow the team list to that tenant. Doesn't fire if the user has manually
 // chosen 'all' on this page (we only override when a real tenant is active).
 useEffect(() => {
 if (isPlatformAdmin && currentTenantId != null) {
 setTeamTenantFilter(currentTenantId);
 }
 }, [currentTenantId, isPlatformAdmin]);

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

 // Tenants the platform admin can act on. Master tenant (id=1) is the
 // ONLY context where cross-tenant management is allowed — on any
 // child tenant we restrict the picker to the current tenant only,
 // even if the admin happens to be a member of others. (Otherwise an
 // admin connected to Pimkie could create a team scoped to BA&SH, which
 // breaks the per-tenant isolation rule.) Built from `allTenants` (the
 // full list /api/tenants returns to admins) so a tenant with zero
 // existing teams isn't missing from the picker. Names come from the
 // tenants table so we never fall back to "Tenant N".
 const isMaster = isMasterTenant(currentTenantId);
 const teamTenants = (isMaster
 ? allTenants
 : allTenants.filter((t) => t.id === currentTenantId)
 )
 .map((t) => ({ id: t.id, name: t.name }))
 .sort((a, b) => a.name.localeCompare(b.name));

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
 if (!(await confirm({ message: t('users.confirmDelete', { username: user.username }), danger: true }))) return;
 try {
 await usersApi.delete(user.id);
 toast.success(t('users.deleted'));
 load();
 } catch {
 toast.error(t('users.failedDelete'));
 }
 };

 const handleResetMfa = async (user: User) => {
 if (!(await confirm({ message: t('users.confirmResetMfa', { username: user.username }), danger: true, confirmLabel: t('users.resetMfa') }))) return;
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
 } catch (err: any) {
 const msg = err?.response?.data?.error ?? err?.message ?? t('users.teams.failedCreate');
 toast.error(msg);
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
 if (!(await confirm({ message: t('users.teams.confirmDelete', { name: team.name }), danger: true }))) return;
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

 const addPermission = async (scope: PermissionScope, scopeId: number, level: PermissionLevel, capabilities?: Capability[]) => {
 if (!selectedTeamId) return;
 const existing = teamPermissions.find((p) => p.scope === scope && p.scopeId === scopeId);
 const defaultCaps: Capability[] = level === 'rw' ? ['monitor', 'execute'] : ['monitor'];
 if (existing) {
 const newPerms = teamPermissions.map((p) =>
 p.id === existing.id ? { ...p, level, capabilities: capabilities ?? p.capabilities ?? defaultCaps } : p,
 );
 try {
 await teamsApi.setPermissions(selectedTeamId, {
 permissions: newPerms.map((p) => ({ scope: p.scope, scopeId: p.scopeId, level: p.level, capabilities: p.capabilities ?? defaultCaps })),
 });
 await loadTeamDetails(selectedTeamId);
 } catch (err: any) {
 // Surface the server's actual message when present — the generic
 // "Échec de la mise à jour de la permission" toast hid useful
 // details (validation errors, restriction gates, missing tenant
 // membership) so admins couldn't self-diagnose.
 const msg = err?.response?.data?.error || err?.message;
 toast.error(msg ? `${t('users.teams.failedUpdatePermission')}: ${msg}` : t('users.teams.failedUpdatePermission'));
 }
 } else {
 const newPerms = [
 ...teamPermissions.map((p) => ({ scope: p.scope, scopeId: p.scopeId, level: p.level, capabilities: p.capabilities ?? defaultCaps })),
 { scope, scopeId, level, capabilities: capabilities ?? defaultCaps },
 ];
 try {
 await teamsApi.setPermissions(selectedTeamId, { permissions: newPerms });
 await loadTeamDetails(selectedTeamId);
 } catch (err: any) {
 const msg = err?.response?.data?.error || err?.message;
 toast.error(msg ? `${t('users.teams.failedAddPermission')}: ${msg}` : t('users.teams.failedAddPermission'));
 }
 }
 };

 const toggleCapability = async (perm: TeamPermission, cap: Capability) => {
 const caps: Capability[] = [...(perm.capabilities ?? [])];
 const idx = caps.indexOf(cap);
 if (idx >= 0) caps.splice(idx, 1); else caps.push(cap);
 await addPermission(perm.scope, perm.scopeId, perm.level, caps);
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
 const teamDetailOpen = !!selectedTeam && tab === 'teams';

 // The inline create/edit forms render above the list: on narrow screens
 // (one pane, long list) bring them into view after a row action.
 const revealForm = () => {
 if (isWide) return;
 requestAnimationFrame(() => {
 document.getElementById('admin-users-form')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
 });
 };

 const startEditUser = (user: User) => {
 setEditingUser(user); setFormUsername(user.username); setFormDisplayName(user.displayName || ''); setFormRole(user.role); setUserFormMode('edit');
 revealForm();
 };
 const startPasswordUser = (user: User) => {
 setEditingUser(user); setFormPassword(''); setUserFormMode('password');
 revealForm();
 };
 const startEditTeam = (team: UserTeam) => {
 setEditingTeam(team); setFormTeamName(team.name); setFormTeamDesc(team.description || ''); setFormCanCreate(team.canCreate); setTeamFormMode('edit');
 revealForm();
 };

 const userMenuItems = (user: User): ActionMenuItem[] => {
 const hasMfa = !!(user.totpEnabled || user.emailOtpEnabled);
 const isLocal = user.foreignSource !== 'obligate';
 const canManage = user.id !== currentUser?.id && isLocal;
 return [
 { key: 'edit', icon: <Pencil size={16} />, label: t('common.edit'), onClick: () => startEditUser(user), hidden: !isLocal },
 { key: 'password', icon: <Key size={16} />, label: t('users.actions.password', 'Change password'), onClick: () => startPasswordUser(user), hidden: !canManage },
 { key: 'tenants', icon: <Building2 size={16} />, label: t('users.actions.tenants', 'Manage tenant access'), onClick: () => openTenantPanel(user), hidden: !isLocal },
 { key: 'active', icon: user.isActive ? <UserX size={16} /> : <UserIcon size={16} />, label: user.isActive ? t('common.disable') : t('common.enable'), onClick: () => handleToggleActive(user), hidden: !canManage },
 { key: 'mfa', icon: <ShieldOff size={16} />, label: t('users.resetMfa'), onClick: () => handleResetMfa(user), hidden: !hasMfa, danger: true, separator: true },
 { key: 'delete', icon: <Trash2 size={16} />, label: t('common.delete'), onClick: () => handleDeleteUser(user), hidden: !canManage, danger: true, separator: !hasMfa },
 ];
 };

 const mainTabs: SegmentedTab<Tab>[] = [
 { id: 'users', label: t('users.tabUsers'), icon: <UserIcon size={14} /> },
 { id: 'teams', label: t('users.tabTeams'), icon: <Users size={14} /> },
 { id: 'permissionSets', label: t('users.tabPermissionSets', 'Permissions'), icon: <Shield size={14} /> },
 { id: 'restrictions', label: t('users.tabRestrictions', 'Restrictions'), icon: <ShieldAlert size={14} /> },
 ];

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
 // Look up the (single) ungrouped permission row, if any. scope_id is
 // 0 by convention since "ungrouped" isn't a real entity; the type
 // discriminator lives in `scope`.
 const ungroupedPerm = teamPermissions.find((p) => p.scope === ('ungrouped' as any));

 return (
 <>
 {/* Users/Teams list (master) + team detail. Side by side from lg
     (unchanged desktop layout: gap-6, 1:2 ratio, sticky detail);
     one pane at a time below lg, with a back button. */}
 <MasterDetail
 className="w-full h-full p-3 sm:p-4 lg:p-6 lg:gap-6 lg:items-stretch"
 masterClassName="lg:flex-1"
 detailClassName={teamDetailOpen ? 'lg:flex-[2]' : 'lg:flex-[2] lg:hidden'}
 hasDetail={teamDetailOpen}
 onBack={() => setSelectedTeamId(null)}
 detailTitle={selectedTeam?.name}
 master={
 <>
 {/* Tab switcher */}
 <SegmentedTabs tabs={mainTabs} value={tab} onChange={setTab} className="mb-4" tabClassName="gap-1.5" />

 {tab === 'restrictions' && <RestrictionsTab />}

 {/* Notifications tab moved to /policies → "Notifications". */}

 {/* ── Permission Sets Tab ── */}
 {tab === 'permissionSets' && <PermissionSetsTab />}

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
 <div id="admin-users-form" className="mb-4 rounded-lg bg-bg-secondary p-4 scroll-mt-4">
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
 className="w-full rounded-md bg-bg-tertiary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent">
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
 <div id="admin-users-form" className="mb-4 rounded-lg bg-bg-secondary p-4 scroll-mt-4">
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
 <div className="rounded-lg bg-bg-secondary divide-y divide-border">
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
 <span className="inline-flex items-center gap-1 rounded-full bg-[#D3AB52]/15 border border-[#D3AB52]/40 px-1.5 py-0.5 text-[10px] font-medium text-[#D3AB52]">
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
 <IconButton
 label={t('users.resetMfa')}
 icon={<ShieldOff size={13} />}
 size="sm"
 variant="plain"
 onClick={() => handleResetMfa(user)}
 className={`${ROW_ACTION_CLS} text-status-down hover:text-status-down/80`}
 />
 )}
 {user.id !== currentUser?.id && user.foreignSource !== 'obligate' && (
 <>
 <IconButton
 label={t('users.actions.password', 'Change password')}
 icon={<Key size={13} />}
 size="sm"
 variant="plain"
 onClick={() => startPasswordUser(user)}
 className={`${ROW_ACTION_CLS} hover:text-accent`}
 />
 <IconButton
 label={user.isActive ? t('common.disable') : t('common.enable')}
 icon={user.isActive ? <UserX size={13} /> : <UserIcon size={13} />}
 size="sm"
 variant="plain"
 onClick={() => handleToggleActive(user)}
 className={ROW_ACTION_CLS}
 />
 </>
 )}
 {user.foreignSource !== 'obligate' && (
 <IconButton
 label={t('common.edit')}
 icon={<Pencil size={13} />}
 size="sm"
 variant="plain"
 onClick={() => startEditUser(user)}
 className={ROW_ACTION_CLS}
 />
 )}
 {/* Tenant assignment button — hidden for SSO users (managed from Obligate) */}
 {user.foreignSource !== 'obligate' && (
 <IconButton
 label={t('users.actions.tenants', 'Manage tenant access')}
 icon={<Building2 size={13} />}
 size="sm"
 variant="plain"
 onClick={() => openTenantPanel(user)}
 className={`${ROW_ACTION_CLS} hover:text-accent`}
 />
 )}
 {user.id !== currentUser?.id && user.foreignSource !== 'obligate' && (
 <IconButton
 label={t('common.delete')}
 icon={<Trash2 size={13} />}
 size="sm"
 variant="plain"
 onClick={() => handleDeleteUser(user)}
 className={`${ROW_ACTION_CLS} hover:text-status-down`}
 />
 )}
 {/* Phone: every action in one menu. */}
 {userMenuItems(user).some((i) => !i.hidden) && (
 <ActionMenu
 items={userMenuItems(user)}
 sheetTitle={user.username.startsWith('og_') ? user.username.slice(3) : user.username}
 triggerSize="sm"
 triggerClassName="md:hidden shrink-0"
 />
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
 // Pre-fill the tenant selector with the user's current
 // tenant — the most useful default in nearly every
 // case (admins almost always create a team for where
 // they're actively working). Fallback to the active
 // chip filter, then to alpha-first.
 if (isPlatformAdmin && currentTenantId != null) {
 setFormTeamTenantId(currentTenantId);
 } else if (isPlatformAdmin && teamTenantFilter !== 'all') {
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
 className={`shrink-0 px-3 py-1 coarse:py-2 rounded-full text-xs font-medium transition-colors ${
 teamTenantFilter === 'all'
 ? 'bg-accent text-white'
 : 'bg-bg-secondary border border-transparent text-text-muted hover:text-text-primary'
 }`}
 >
 {t('common.all')}
 </button>
 {teamTenants.map((tenant) => (
 <button
 key={tenant.id}
 onClick={() => setTeamTenantFilter(tenant.id)}
 className={`shrink-0 px-3 py-1 coarse:py-2 rounded-full text-xs font-medium transition-colors ${
 teamTenantFilter === tenant.id
 ? 'bg-accent text-white'
 : 'bg-bg-secondary border border-transparent text-text-muted hover:text-text-primary'
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
 <div id="admin-users-form" className="mb-4 rounded-lg bg-bg-secondary p-4 scroll-mt-4">
 <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-3">
 {teamFormMode === 'create' ? t('users.teams.newTeam') : t('users.teams.editTeam', { name: editingTeam?.name })}
 </h3>
 <form onSubmit={teamFormMode === 'create' ? handleCreateTeam : handleEditTeam} className="space-y-3">
 <Input label={t('users.teams.nameLabel')} value={formTeamName} onChange={(e) => setFormTeamName(e.target.value)} required />
 <Input label={t('users.teams.descLabel')} value={formTeamDesc} onChange={(e) => setFormTeamDesc(e.target.value)} />
 {/* Tenant selector — required from the master tenant
 because teams are strictly mono-tenant; the admin
 must explicitly pick which tenant the team will
 operate in (it can be Default itself). On any
 other tenant the team is implicitly created in
 the current tenant — the field is hidden because
 cross-tenant create is forbidden server-side. */}
 {isPlatformAdmin && currentTenantId === 1 && teamFormMode === 'create' && (
 <div className="space-y-1">
 <label className="block text-sm font-medium text-text-secondary">
 <Building2 size={12} className="inline mr-1" />Tenant
 </label>
 <select
 value={formTeamTenantId}
 onChange={(e) => setFormTeamTenantId(e.target.value ? Number(e.target.value) : '')}
 className="w-full rounded-md bg-bg-tertiary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
 required
 >
 <option value="">— Select tenant —</option>
 {allTenants.map((tenant) => (
 <option key={tenant.id} value={tenant.id}>{tenant.name}</option>
 ))}
 </select>
 <p className="text-xs text-text-muted">
 A team grants permissions inside one tenant only. Pick where this team will operate.
 </p>
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
 <div className="rounded-lg bg-bg-secondary divide-y divide-border">
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
 <span className="rounded bg-bg-tertiary border border-transparent px-1.5 py-0.5 text-[10px] text-text-muted flex items-center gap-0.5">
 <Building2 size={9} />
 {team.tenantName}
 </span>
 )}
 </div>
 {team.description && (
 <p className="text-xs text-text-muted truncate">{team.description}</p>
 )}
 </div>
 <IconButton
 label={t('common.edit')}
 icon={<Pencil size={13} />}
 size="sm"
 variant="plain"
 showTooltip={false}
 onClick={(e) => { e.stopPropagation(); startEditTeam(team); }}
 className={ROW_ACTION_CLS}
 />
 <IconButton
 label={t('common.delete')}
 icon={<Trash2 size={13} />}
 size="sm"
 variant="plain"
 showTooltip={false}
 onClick={(e) => { e.stopPropagation(); handleDeleteTeam(team); }}
 className={`${ROW_ACTION_CLS} hover:text-status-down`}
 />
 {/* Phone: actions in a menu — clicks (portal included) must not select the row. */}
 <span className="md:hidden shrink-0" onClick={(e) => e.stopPropagation()}>
 <ActionMenu
 sheetTitle={team.name}
 triggerSize="sm"
 items={[
 { key: 'edit', icon: <Pencil size={16} />, label: t('common.edit'), onClick: () => startEditTeam(team) },
 { key: 'delete', icon: <Trash2 size={16} />, label: t('common.delete'), onClick: () => handleDeleteTeam(team), danger: true, separator: true },
 ]}
 />
 </span>
 <ChevronRight size={14} className="shrink-0 text-text-muted" />
 </div>
 ))
 )}
 </div>
 </>
 )}
 </>
 }
 detail={selectedTeam && tab === 'teams' ? (
 <div className="lg:sticky lg:top-6">
 {/* Below lg the name is in MasterDetail's back bar. */}
 <h2 className="hidden lg:block text-lg font-semibold text-text-primary mb-1">{selectedTeam.name}</h2>
 {selectedTeam.description && (
 <p className="text-sm text-text-muted mb-4">{selectedTeam.description}</p>
 )}

 {/* Right panel tabs */}
 <div className="flex gap-1 mb-4 rounded-lg bg-bg-secondary p-1 border border-transparent">
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
 <div className="rounded-lg bg-bg-secondary divide-y divide-border lg:max-h-[60vh] lg:max-h-[60dvh] lg:overflow-y-auto">
 {users.filter((u) => u.role !== 'admin').length === 0 ? (
 <p className="p-4 text-sm text-text-muted text-center">{t('users.teams.noUsers')}</p>
 ) : (
 users.filter((u) => u.role !== 'admin').map((user) => {
 const isMember = teamMembers.includes(user.id);
 return (
 // The whole row toggles membership (was: only the 16px box).
 <div
 key={user.id}
 role="checkbox"
 aria-checked={isMember}
 tabIndex={0}
 onClick={() => toggleMember(user.id)}
 onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggleMember(user.id); } }}
 className="flex items-center gap-3 px-3 py-2 coarse:min-h-11 hover:bg-bg-hover cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60"
 >
 <div
 className={`flex h-4 w-4 coarse:h-5 coarse:w-5 items-center justify-center rounded border shrink-0 ${
 isMember ? 'border-accent bg-accent' : 'border-transparent bg-bg-tertiary'
 }`}
 >
 {isMember && <Check size={12} className="text-white" />}
 </div>
 <span className="text-sm text-text-primary min-w-0 break-all">{user.username}</span>
 {user.displayName && <span className="text-xs text-text-muted">({user.displayName})</span>}
 {!user.isActive && <span className="text-[10px] text-status-down">{t('users.disabled')}</span>}
 </div>
 );
 })
 )}
 </div>
 )}

 {/* Permissions panel — Hierarchical tree */}
 {rightTab === 'permissions' && (
 <div className="rounded-lg bg-bg-secondary lg:max-h-[70vh] lg:max-h-[70dvh] lg:overflow-y-auto">
 {tree.length === 0 && ungroupedDevices.length === 0 ? (
 <p className="p-4 text-sm text-text-muted text-center">{t('users.teams.noResources')}</p>
 ) : (
 <div className="py-1">
 {/* "Ungrouped" pseudo-group — toggling this grants the team
     access to every device whose group_id IS NULL AND whose
     enrolling API key has no default_group_id (the API-key
     claim handles the "key targets a group" case
     automatically). Useful for catching orphan devices and
     for tenants whose keys never pre-assign a group. */}
 <PermUngroupedRow
 perm={ungroupedPerm}
 addPermission={addPermission}
 removePermission={removePermission}
 togglePermissionLevel={togglePermissionLevel}
 toggleCapability={toggleCapability}
 />
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
 toggleCapability={toggleCapability}
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
 isCovered={!!ungroupedPerm}
 addPermission={addPermission}
 removePermission={removePermission}
 togglePermissionLevel={togglePermissionLevel}
 toggleCapability={toggleCapability}
 />
 );
 })}
 </div>
 )}
 </div>
 )}
 </div>
 ) : null}
 />

 {/* ── Tenant Assignment Panel ── */}
 {/* Shared Drawer: full width on phones (max-w-full), Escape / Android
     back close it; w-96 + bg-primary + lighter backdrop = previous look. */}
 <Drawer
 open={!!tenantPanelUser}
 onClose={closeTenantPanel}
 side="right"
 className="w-96 max-w-full bg-bg-primary shadow-xl"
 overlayClassName="bg-black/40 backdrop-blur-none"
 bodyClassName="p-4 space-y-2"
 icon={<Building2 size={16} className="text-accent shrink-0" />}
 title={
 <span className="block">
 <span className="block truncate">{t('users.tenantPanel.title', 'Tenants')}</span>
 <span className="block truncate text-xs font-normal text-text-muted">{tenantPanelUser?.username}</span>
 </span>
 }
 footer={tenantPanelUser?.role !== 'admin' ? (
 <>
 <Button size="sm" variant="secondary" onClick={closeTenantPanel}>{t('common.cancel')}</Button>
 <Button size="sm" loading={tenantSaving} onClick={saveTenantAssignments}>{t('common.save')}</Button>
 </>
 ) : (
 <Button size="sm" variant="secondary" onClick={closeTenantPanel}>{t('common.close')}</Button>
 )}
 >
 {tenantPanelUser && (tenantPanelLoading ? (
 <div className="flex items-center justify-center py-8">
 <div className="text-sm text-text-muted">{t('common.loading')}</div>
 </div>
 ) : tenantPanelUser.role === 'admin' ? (
 /* Platform admin notice */
 <div className="rounded-lg border border-accent/20 bg-accent/5 p-3">
 <div className="flex items-start gap-2">
 <Shield size={14} className="text-accent mt-0.5 shrink-0" />
 <p className="text-xs text-text-secondary">
 {t('users.tenantPanel.adminNotice', 'Platform admins automatically access all tenants. No per-tenant assignment is needed.')}
 </p>
 </div>
 </div>
 ) : tenantAssignments.length === 0 ? (
 <p className="text-sm text-text-muted text-center py-8">{t('users.tenantPanel.none', 'No tenants available')}</p>
 ) : (
 tenantAssignments.map((assignment) => {
 const draft = tenantDraft[assignment.tenantId] ?? { isMember: assignment.isMember, role: assignment.role };
 return (
 <div
 key={assignment.tenantId}
 className={`rounded-lg border p-3 transition-colors ${
 draft.isMember ? 'border-accent/30 bg-accent/5' : 'border-transparent bg-bg-secondary'
 }`}
 >
 <div className="flex items-center justify-between gap-3">
 <div className="flex items-center gap-2 min-w-0">
 <Building2 size={14} className={draft.isMember ? 'text-accent shrink-0' : 'text-text-muted shrink-0'} />
 <span className="text-sm font-medium text-text-primary truncate">{assignment.tenantName}</span>
 </div>
 {/* Toggle switch (invisible 40px+ hit area on touch) */}
 <button
 onClick={() => toggleTenantMember(assignment.tenantId)}
 className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 transition-colors coarse:after:absolute coarse:after:-inset-2.5 coarse:after:content-[''] ${
 draft.isMember
 ? 'border-accent bg-accent'
 : 'border-transparent bg-bg-tertiary'
 }`}
 role="switch"
 aria-checked={draft.isMember}
 aria-label={assignment.tenantName}
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
 <div className="flex items-center gap-1 coarse:gap-2 mt-2">
 <span className="text-[10px] text-text-muted mr-1">{t('users.tenantPanel.role', 'Role:')}</span>
 <button
 onClick={() => setTenantRole(assignment.tenantId, 'member')}
 aria-pressed={draft.role === 'member'}
 className={`px-2 py-0.5 coarse:px-3 coarse:py-2 rounded text-[11px] font-medium transition-colors ${
 draft.role === 'member'
 ? 'bg-bg-tertiary text-text-primary border border-transparent'
 : 'text-text-muted hover:bg-bg-hover'
 }`}
 >
 {t('users.tenantPanel.member', 'Member')}
 </button>
 <button
 onClick={() => setTenantRole(assignment.tenantId, 'admin')}
 aria-pressed={draft.role === 'admin'}
 className={`px-2 py-0.5 coarse:px-3 coarse:py-2 rounded text-[11px] font-medium transition-colors ${
 draft.role === 'admin'
 ? 'bg-accent/10 text-accent border border-accent/20'
 : 'text-text-muted hover:bg-bg-hover'
 }`}
 >
 <Shield size={10} className="inline mr-0.5" />{t('users.roleAdmin')}
 </button>
 </div>
 )}
 </div>
 );
 })
 ))}
 </Drawer>
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
 addPermission: (scope: PermissionScope, scopeId: number, level: PermissionLevel, capabilities?: Capability[]) => Promise<void>;
 removePermission: (permId: number) => Promise<void>;
 togglePermissionLevel: (perm: TeamPermission) => Promise<void>;
 toggleCapability: (perm: TeamPermission, cap: Capability) => Promise<void>;
}

// Capability catalog — grouped by logical category. Oblihub-style matrix.
const CAPABILITY_CATEGORIES: Array<{
 name: string;
 capabilities: Array<{ key: Capability; label: string; description: string }>;
}> = [
 {
 name: 'Execution',
 capabilities: [
 { key: 'execute', label: 'Execute', description: 'Scripts, scans, services, install/uninstall' },
 ],
 },
 {
 name: 'Access',
 capabilities: [
 { key: 'remote', label: 'Remote', description: 'Reach, RDP, SSH shell sessions' },
 { key: 'files', label: 'Files', description: 'Browse, upload, download, edit files' },
 ],
 },
 {
 name: 'Power',
 capabilities: [
 { key: 'power', label: 'Power', description: 'Reboot, shutdown, sleep, restart agent' },
 ],
 },
];

/** Compact iOS-style toggle switch. Defers to the shared component which
 * uses pixel-precise inline geometry — the previous Tailwind-only version
 * rendered the thumb outside the track on some browsers because the
 * `translate-x-4` (16 px) + `w-3` (12 px) thumb math left almost no
 * visual padding from the track edge and rounding amplified the drift.
 */
function ToggleSwitch({ on, onChange, title }: { on: boolean; onChange: () => void; title?: string }) {
 // Bigger switch on touch screens (16×32 is too small to hit reliably).
 const coarse = useIsCoarsePointer();
 return (
 <SharedToggleSwitch
 checked={on}
 onChange={() => onChange()}
 size={coarse ? 'md' : 'sm'}
 title={title}
 />
 );
}

function CapabilityIcons({ perm, onToggle }: { perm: TeamPermission; onToggle: (cap: Capability) => void }) {
 const { t } = useTranslation();
 if (perm.level === 'ro') return null; // RO only gets monitor, no toggles
 const caps = perm.capabilities ?? [];
 return (
 <span className="flex items-center gap-3 shrink-0 max-md:flex-wrap max-md:shrink max-md:min-w-0 max-md:gap-y-2">
 {CAPABILITY_CATEGORIES.map((cat) => (
 <span key={cat.name} className="flex items-center gap-1.5">
 {cat.capabilities.map(({ key, label, description }) => (
 <span key={key} className="flex items-center gap-1">
 <ToggleSwitch on={caps.includes(key)} onChange={() => onToggle(key)} />
 {/* Description: hover tooltip with a mouse, tap popover on touch. */}
 <Tip content={`${t(`users.capabilities.${key}.label`, label)} — ${t(`users.capabilities.${key}.description`, description)}`}>
 <span className="text-[10px] uppercase tracking-wider text-text-muted">{t(`users.capabilities.${key}.label`, label)}</span>
 </Tip>
 </span>
 ))}
 </span>
 ))}
 </span>
 );
}

/**
 * Right-hand controls of a permission-tree row (group / device / ungrouped).
 * Assigned rows: RO/RW level + capability toggles + remove — on phones they
 * move to their own wrapping line under the name (`contents` keeps the
 * desktop single-row layout untouched). Unassigned rows: RO / RW add buttons.
 */
function PermControls({
 perm,
 isCovered,
 onAdd,
 removePermission,
 togglePermissionLevel,
 toggleCapability,
}: {
 perm: TeamPermission | undefined;
 isCovered: boolean;
 onAdd: (level: PermissionLevel) => void;
 removePermission: (permId: number) => Promise<void>;
 togglePermissionLevel: (perm: TeamPermission) => Promise<void>;
 toggleCapability: (perm: TeamPermission, cap: Capability) => Promise<void>;
}) {
 const { t } = useTranslation();
 if (perm) {
 return (
 <div className="contents max-md:flex max-md:basis-full max-md:flex-wrap max-md:items-center max-md:gap-2 max-md:pl-5">
 <button
 onClick={() => togglePermissionLevel(perm)}
 className={`px-2 py-0.5 coarse:px-3 coarse:py-1.5 rounded text-[11px] font-medium transition-colors shrink-0 ${
 perm.level === 'rw'
 ? 'bg-accent/10 text-accent hover:bg-accent/20'
 : 'bg-bg-tertiary text-text-muted hover:bg-bg-hover'
 }`}
 title={t('users.teams.toggleLevelHint', 'Click to toggle RO/RW')}
 >
 {perm.level === 'rw' ? <><Pencil size={10} className="inline mr-0.5" />{t('users.teams.rwLabel')}</> : <><Eye size={10} className="inline mr-0.5" />{t('users.teams.roLabel')}</>}
 </button>
 <CapabilityIcons perm={perm} onToggle={(cap) => toggleCapability(perm, cap)} />
 <IconButton
 label={t('users.teams.removePermission', 'Remove permission')}
 icon={<Trash2 size={11} />}
 size="xs"
 variant="plain"
 showTooltip={false}
 onClick={() => removePermission(perm.id)}
 className="shrink-0 hover:text-status-down"
 />
 </div>
 );
 }
 if (isCovered) {
 return <span className="text-[10px] text-text-muted italic shrink-0">{t('users.teams.inherited')}</span>;
 }
 return (
 <>
 <button onClick={() => onAdd('ro')}
 className="px-1.5 py-0.5 coarse:px-3 coarse:py-1.5 text-[10px] rounded bg-bg-tertiary text-text-muted hover:bg-bg-hover shrink-0" title={t('users.teams.readOnly', 'Read Only')}>
 {t('users.teams.roLabel')}
 </button>
 <button onClick={() => onAdd('rw')}
 className="px-1.5 py-0.5 coarse:px-3 coarse:py-1.5 coarse:ml-1.5 text-[10px] rounded bg-accent/10 text-accent hover:bg-accent/20 shrink-0" title={t('users.teams.readWrite', 'Read/Write')}>
 {t('users.teams.rwLabel')}
 </button>
 </>
 );
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
 toggleCapability,
}: PermTreeNodeProps) {
 const { t } = useTranslation();
 // Narrower indentation per level on phones (deep trees ate the name).
 const md = useMediaQuery(MEDIA.md);
 const [expanded, setExpanded] = useState(true);
 const perm = getGroupPerm(node.id);
 const isCovered = coveredGroupIds.has(node.id);
 const hasChildren = node.children.length > 0 || (devicesByGroup.get(node.id)?.length ?? 0) > 0;

 return (
 <div>
 {/* Group row */}
 <div
 className={`flex flex-wrap md:flex-nowrap items-center gap-1.5 px-2 py-1.5 hover:bg-bg-hover transition-colors ${
 perm ? 'bg-accent/5' : isCovered ? 'bg-accent/[0.02]' : ''
 }`}
 style={{ paddingLeft: `${depth * (md ? 20 : 12) + 8}px` }}
 >
 {/* Expand toggle */}
 <IconButton
 label={expanded ? t('users.teams.collapse', 'Collapse') : t('users.teams.expand', 'Expand')}
 icon={expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
 size="xs"
 variant="plain"
 touchTarget="overlay"
 showTooltip={false}
 aria-expanded={expanded}
 onClick={() => setExpanded(!expanded)}
 className={`shrink-0 ${!hasChildren ? 'invisible' : ''}`}
 />

 <FolderOpen size={13} className={`shrink-0 ${perm ? 'text-accent' : isCovered ? 'text-accent/40' : 'text-text-muted'}`} />
 <span className={`flex-1 min-w-0 text-sm truncate ${perm ? 'text-text-primary font-medium' : isCovered ? 'text-text-muted' : 'text-text-primary'}`}>
 {node.name}
 </span>

 {/* Permission controls */}
 <PermControls
 perm={perm}
 isCovered={isCovered}
 onAdd={(level) => addPermission('group', node.id, level)}
 removePermission={removePermission}
 togglePermissionLevel={togglePermissionLevel}
 toggleCapability={toggleCapability}
 />
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
 toggleCapability={toggleCapability}
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
 toggleCapability={toggleCapability}
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
 addPermission: (scope: PermissionScope, scopeId: number, level: PermissionLevel, capabilities?: Capability[]) => Promise<void>;
 removePermission: (permId: number) => Promise<void>;
 togglePermissionLevel: (perm: TeamPermission) => Promise<void>;
 toggleCapability: (perm: TeamPermission, cap: Capability) => Promise<void>;
}

interface PermUngroupedRowProps {
 perm: TeamPermission | undefined;
 addPermission: (scope: PermissionScope, scopeId: number, level: PermissionLevel, capabilities?: Capability[]) => Promise<void>;
 removePermission: (permId: number) => Promise<void>;
 togglePermissionLevel: (perm: TeamPermission) => Promise<void>;
 toggleCapability: (perm: TeamPermission, cap: Capability) => Promise<void>;
}

// "Ungrouped" pseudo-group row — sits above the real group tree and
// represents `scope='ungrouped'` on team_permissions. Stylistically a
// group row, but with a distinct icon (FolderX) and a 0 scope_id by
// convention. When ON, the team can read/write every device whose
// group_id IS NULL AND whose enrolling API key has no default group.
function PermUngroupedRow({
 perm,
 addPermission,
 removePermission,
 togglePermissionLevel,
 toggleCapability,
}: PermUngroupedRowProps) {
 const { t } = useTranslation();
 return (
 <div className={`flex flex-wrap md:flex-nowrap items-center gap-1.5 px-2 py-1.5 hover:bg-bg-hover transition-colors ${perm ? 'bg-accent/5' : ''}`} style={{ paddingLeft: '8px' }}>
 <span className="shrink-0 w-4" />
 <FolderX size={13} className={`shrink-0 ${perm ? 'text-accent' : 'text-text-muted'}`} />
 <span className={`flex-1 min-w-0 text-sm truncate ${perm ? 'text-text-primary font-medium' : 'text-text-primary'}`}>
 {t('users.teams.ungroupedLabel', 'Ungrouped (orphan devices)')}
 </span>
 <PermControls
 perm={perm}
 isCovered={false}
 onAdd={(level) => addPermission('ungrouped', 0, level)}
 removePermission={removePermission}
 togglePermissionLevel={togglePermissionLevel}
 toggleCapability={toggleCapability}
 />
 </div>
 );
}

function PermDeviceRow({
 device,
 depth,
 perm,
 isCovered,
 addPermission,
 removePermission,
 togglePermissionLevel,
 toggleCapability,
}: PermDeviceRowProps) {
 const md = useMediaQuery(MEDIA.md);
 return (
 <div
 className={`flex flex-wrap md:flex-nowrap items-center gap-1.5 px-2 py-1.5 hover:bg-bg-hover transition-colors ${
 perm ? 'bg-accent/5' : ''
 }`}
 style={{ paddingLeft: `${depth * (md ? 20 : 12) + 28}px` }}
 >
 <Monitor size={13} className={`shrink-0 ${perm ? 'text-accent' : isCovered ? 'text-accent/40' : 'text-text-muted'}`} />
 <span className={`flex-1 min-w-0 text-sm truncate ${perm ? 'text-text-primary font-medium' : isCovered ? 'text-text-muted' : 'text-text-primary'}`}>
 {device.displayName ?? device.hostname}
 </span>

 <PermControls
 perm={perm}
 isCovered={isCovered}
 onAdd={(level) => addPermission('device', device.id, level)}
 removePermission={removePermission}
 togglePermissionLevel={togglePermissionLevel}
 toggleCapability={toggleCapability}
 />
 </div>
 );
}

// ─── Restrictions Tab ──────────────────────────────────────────────────────
// Matrix: each restrictable action can be set to None / Restricted /
// Sensitive, with an optional "scope" modal that limits the restriction
// to specific devices or groups. Default is "all devices" (opt-in).

function RestrictionsTab() {
 const { t } = useTranslation();
 const [actions, setActions] = useState<RestrictableAction[]>([]);
 const [map, setMap] = useState<RestrictionMap>({});
 const [loading, setLoading] = useState(true);
 const [saving, setSaving] = useState(false);
 const [dirty, setDirty] = useState(false);
 const [scopeFor, setScopeFor] = useState<string | null>(null);

 const [loadError, setLoadError] = useState<string | null>(null);
 const load = async () => {
 setLoading(true);
 setLoadError(null);
 try {
 const { map, actions } = await restrictionApi.get();
 setMap(map);
 setActions(actions);
 setDirty(false);
 } catch (err: any) {
 const msg = err?.response?.data?.error || err?.message || 'Failed to load restrictions';
 setLoadError(msg);
 toast.error(msg);
 } finally {
 setLoading(false);
 }
 };

 useEffect(() => { load(); }, []);

 const setLevel = (key: string, level: 'none' | RestrictionLevel) => {
 setMap((cur) => {
 const next = { ...cur };
 if (level === 'none') delete next[key];
 else next[key] = cur[key]
 ? { ...cur[key], level }
 : { level, scope: { mode: 'all' } };
 return next;
 });
 setDirty(true);
 };

 const save = async () => {
 setSaving(true);
 try {
 // Server returns 202 with { approvalId, status: 'pending_approval' }
 // when `tenant.manage_restrictions` is gated as restricted — axios
 // passes that through as a normal success but `r.map` is undefined
 // in that shape. Guard against overwriting state with undefined
 // (which would crash on the next render at `map[a.key]`) and surface
 // the pending-approval state to the admin instead.
 const r = await restrictionApi.setMap(map) as any;
 if (r && r.status === 'pending_approval') {
 toast.success('Changes saved — awaiting second admin approval', { duration: 6000 });
 setDirty(false);
 return;
 }
 if (r && r.map) {
 setMap(r.map);
 setDirty(false);
 }
 } finally {
 setSaving(false);
 }
 };

 // Group actions by category for the matrix layout.
 const byCategory: Record<string, RestrictableAction[]> = {};
 for (const a of actions) {
 (byCategory[a.category] ||= []).push(a);
 }

 if (loading) return <p className="text-sm text-text-muted italic">Loading...</p>;

 if (loadError) {
 return (
 <div className="p-4 rounded-lg border border-red-400/30 bg-red-400/5">
 <p className="text-sm text-red-400 font-medium">Failed to load restrictions</p>
 <p className="text-xs text-text-muted mt-1">{loadError}</p>
 <p className="text-[11px] text-text-muted mt-2 italic">
 If this is a fresh deployment, the server migration 066 may not have run yet. Restart the server, or run migrations manually.
 </p>
 </div>
 );
 }

 if (actions.length === 0) {
 return (
 <div className="p-4 rounded-lg border border-orange-400/30 bg-orange-400/5">
 <p className="text-sm text-orange-400">No restrictable actions returned by the server.</p>
 <p className="text-xs text-text-muted mt-1">Server may not have the updated code — check the server build version.</p>
 </div>
 );
 }

 return (
 <div className="space-y-4">
 <div className="rounded-lg bg-bg-secondary p-3 text-[11px] text-text-muted">
 <p>
 <strong className="text-text-primary">None</strong> = no extra check.{' '}
 <strong className="text-orange-400">Sensitive</strong> = the acting user must provide a valid TOTP 2FA code at the moment of execution. Users without TOTP cannot trigger sensitive actions.{' '}
 <strong className="text-red-400">Restricted</strong> = a second admin must approve via Security → Approvals (strongest gate).
 </p>
 <p className="mt-1">
 Use <strong className="text-text-primary">Scope</strong> to limit a restriction to specific devices or groups. Default applies to <em>all</em> devices.
 </p>
 </div>

 {Object.entries(byCategory).map(([cat, acts]) => (
 <div key={cat} className="rounded-lg bg-bg-secondary overflow-hidden">
 <div className="px-3 py-2 bg-bg-tertiary/50 ">
 <span className="text-[10px] uppercase tracking-wider font-semibold text-text-muted">{cat}</span>
 </div>
 <div className="divide-y divide-border/40">
 {acts.map((a) => {
 const entry = (map ?? {})[a.key];
 const level: 'none' | RestrictionLevel = entry ? entry.level : 'none';
 return (
 <div key={a.key} className="flex flex-wrap md:flex-nowrap items-center gap-x-3 gap-y-2 px-3 py-2">
 {/* Phones: label on its own full-width line (no truncation), controls below. */}
 <div className="flex-1 min-w-0 max-md:basis-full">
 <p className="text-sm text-text-primary md:truncate">{a.label}</p>
 <p className="text-[10px] text-text-muted font-mono">{a.key}</p>
 </div>

 <div className="flex items-center gap-1 shrink-0">
 {(['none', 'restricted', 'sensitive'] as const).map((lv) => {
 // Color encodes severity: restricted (red) is the
 // strongest gate — it forces a SECOND admin's TOTP
 // approval, so it's strictly worse than sensitive
 // (orange) which only re-prompts the acting admin's
 // own TOTP. Don't flip these without re-checking the
 // restriction.service semantics.
 const color =
 lv === 'none' ? 'border-transparent text-text-muted'
 : lv === 'restricted' ? 'border-red-400/40 text-red-400'
 : 'border-orange-400/40 text-orange-400';
 const active = level === lv;
 return (
 <button
 key={lv}
 onClick={() => setLevel(a.key, lv)}
 className={`px-2.5 py-1 coarse:py-2 text-[11px] font-medium rounded border transition-colors capitalize ${
 active
 ? (lv === 'restricted' ? 'bg-red-400/10 border-red-400 text-red-400'
 : lv === 'sensitive' ? 'bg-orange-400/10 border-orange-400 text-orange-400'
 : 'bg-bg-tertiary border-transparent text-text-primary')
 : color + ' hover:border-accent/50'
 }`}
 >
 {lv}
 </button>
 );
 })}
 </div>

 <button
 disabled={!entry}
 onClick={() => setScopeFor(a.key)}
 className={`shrink-0 px-2 py-1 coarse:py-2 text-[10px] rounded border transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
 entry && entry.scope.mode !== 'all'
 ? 'border-accent text-accent bg-accent/10'
 : 'border-transparent text-text-muted hover:border-accent/40'
 }`}
 title={t('users.restrictions.scopeHint', 'Configure which devices / groups this restriction applies to')}
 >
 Scope: {entry?.scope.mode === 'include' ? 'Include'
 : entry?.scope.mode === 'exclude' ? 'Exclude'
 : 'All'}
 </button>
 </div>
 );
 })}
 </div>
 </div>
 ))}

 <div className="flex items-center justify-end gap-2">
 {dirty && <span className="text-xs text-orange-400">Unsaved changes</span>}
 <button
 onClick={load}
 disabled={!dirty || saving}
 className="px-3 py-1.5 coarse:py-2.5 text-xs rounded text-text-muted hover:text-text-primary disabled:opacity-30"
 >
 Reset
 </button>
 <button
 onClick={save}
 disabled={!dirty || saving}
 className="px-3 py-1.5 coarse:py-2.5 text-xs bg-accent text-white rounded hover:bg-accent/90 disabled:opacity-50"
 >
 {saving ? 'Saving…' : 'Save'}
 </button>
 </div>

 {scopeFor && (
 <RestrictionScopeModal
 actionKey={scopeFor}
 entry={map[scopeFor]}
 onClose={() => setScopeFor(null)}
 onSave={(scope) => {
 setMap((cur) => {
 const next = { ...cur };
 if (next[scopeFor]) next[scopeFor] = { ...next[scopeFor], scope };
 return next;
 });
 setDirty(true);
 setScopeFor(null);
 }}
 />
 )}
 </div>
 );
}

function RestrictionScopeModal({ actionKey, entry, onClose, onSave }: {
 actionKey: string;
 entry: { level: RestrictionLevel; scope: { mode: ScopeMode; deviceIds?: number[]; groupIds?: number[] } } | undefined;
 onClose: () => void;
 onSave: (scope: { mode: ScopeMode; deviceIds?: number[]; groupIds?: number[] }) => void;
}) {
 const { t } = useTranslation();
 // Touch devices get a search box + a capped chip list instead of
 // thousands of tiny chips (heavy DOM for a mobile WebView).
 const coarse = useIsCoarsePointer();
 const [deviceQuery, setDeviceQuery] = useState('');
 const [mode, setMode] = useState<ScopeMode>(entry?.scope.mode ?? 'all');
 const [deviceIds, setDeviceIds] = useState<number[]>(entry?.scope.deviceIds ?? []);
 const [groupIds, setGroupIds] = useState<number[]>(entry?.scope.groupIds ?? []);
 const [groupTree, setGroupTree] = useState<DeviceGroupTreeNode[]>([]);
 const [devices, setDevices] = useState<Device[]>([]);

 useEffect(() => {
 groupsApi.tree().then(setGroupTree).catch(() => {});
 deviceApi.listPaginated({ approvalStatus: 'approved', pageSize: 10000 })
 .then((r) => setDevices(r.items))
 .catch(() => {});
 }, []);

 const toggle = (arr: number[], id: number): number[] =>
 arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id];

 const flatGroups: { id: number; name: string; depth: number }[] = [];
 const walk = (nodes: DeviceGroupTreeNode[], depth: number) => {
 for (const n of nodes) {
 flatGroups.push({ id: n.id, name: n.name, depth });
 if (n.children?.length) walk(n.children, depth + 1);
 }
 };
 walk(groupTree, 0);

 const DEVICE_CAP = 200;
 const shownDevices = (() => {
 if (!coarse) return devices;
 const q = deviceQuery.trim().toLowerCase();
 const list = q
 ? devices.filter((d) => (d.displayName || d.hostname || '').toLowerCase().includes(q))
 : [...devices.filter((d) => deviceIds.includes(d.id)), ...devices.filter((d) => !deviceIds.includes(d.id))];
 return list.slice(0, DEVICE_CAP);
 })();

 return (
 <Modal
 open
 onClose={onClose}
 size="lg"
 icon={<Shield className="w-4 h-4 text-accent" />}
 title={t('users.restrictions.scopeTitle', { defaultValue: 'Scope — {{key}}', key: actionKey })}
 bodyClassName="px-4 py-3 space-y-3"
 footer={
 <>
 <button onClick={onClose} className="px-3 py-1.5 coarse:py-2.5 text-xs rounded text-text-muted hover:text-text-primary">
 {t('common.cancel')}
 </button>
 <button
 onClick={() => onSave({ mode, deviceIds: mode === 'all' ? undefined : deviceIds, groupIds: mode === 'all' ? undefined : groupIds })}
 className="px-3 py-1.5 coarse:py-2.5 text-xs bg-accent text-white rounded hover:bg-accent/90"
 >
 {t('users.restrictions.applyScope', 'Apply scope')}
 </button>
 </>
 }
 >
 <div className="flex flex-wrap items-center gap-2">
 {(['all', 'include', 'exclude'] as const).map((m) => (
 <button
 key={m}
 onClick={() => setMode(m)}
 aria-pressed={mode === m}
 className={`px-3 py-1.5 coarse:py-2.5 text-xs rounded border ${
 mode === m ? 'bg-accent text-white border-accent' : 'border-transparent text-text-muted hover:text-text-primary'
 }`}
 >
 {m === 'all' ? t('users.restrictions.scopeAll', 'All devices (default)') : m === 'include' ? t('users.restrictions.scopeInclude', 'Only these') : t('users.restrictions.scopeExclude', 'All except these')}
 </button>
 ))}
 </div>
 {mode !== 'all' && (
 <>
 <div>
 <p className="text-[10px] uppercase text-text-muted font-medium mb-1">Groups</p>
 <div className="flex flex-wrap gap-1">
 {flatGroups.length === 0 && <span className="text-xs text-text-muted italic">No groups</span>}
 {flatGroups.map((g) => (
 <button
 key={g.id}
 onClick={() => setGroupIds((a) => toggle(a, g.id))}
 aria-pressed={groupIds.includes(g.id)}
 className={`px-2 py-0.5 coarse:px-3 coarse:py-2 text-[11px] rounded border ${
 groupIds.includes(g.id)
 ? 'bg-accent/20 border-accent text-accent'
 : 'border-transparent text-text-muted hover:text-text-primary'
 }`}
 style={{ marginLeft: g.depth * 12 }}
 >
 {g.name}
 </button>
 ))}
 </div>
 </div>
 <div>
 <p className="text-[10px] uppercase text-text-muted font-medium mb-1">Devices</p>
 {coarse && devices.length > 0 && (
 <input
 type="search"
 value={deviceQuery}
 onChange={(e) => setDeviceQuery(e.target.value)}
 placeholder={t('users.restrictions.searchDevices', 'Search devices…')}
 autoCapitalize="off"
 autoCorrect="off"
 spellCheck={false}
 className="mb-1.5 w-full rounded-md bg-bg-tertiary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
 />
 )}
 <div className="flex flex-wrap gap-1 coarse:gap-1.5 max-h-48 overflow-y-auto overscroll-contain rounded p-1.5 bg-bg-tertiary/30">
 {devices.length === 0 && <span className="text-xs text-text-muted italic">No devices</span>}
 {shownDevices.map((d) => (
 <button
 key={d.id}
 onClick={() => setDeviceIds((a) => toggle(a, d.id))}
 aria-pressed={deviceIds.includes(d.id)}
 className={`px-1.5 py-0.5 coarse:px-2.5 coarse:py-2 text-[11px] rounded border ${
 deviceIds.includes(d.id)
 ? 'bg-accent/20 border-accent text-accent'
 : 'border-transparent text-text-muted hover:text-text-primary'
 }`}
 >
 {d.displayName || d.hostname}
 </button>
 ))}
 </div>
 {coarse && shownDevices.length < (deviceQuery.trim() ? devices.filter((d) => (d.displayName || d.hostname || '').toLowerCase().includes(deviceQuery.trim().toLowerCase())).length : devices.length) && (
 <p className="mt-1 text-[11px] text-text-muted">
 {t('users.restrictions.devicesTruncated', { defaultValue: 'Showing the first {{count}} devices — refine the search to find others.', count: DEVICE_CAP })}
 </p>
 )}
 </div>
 </>
 )}
 </Modal>
 );
}
