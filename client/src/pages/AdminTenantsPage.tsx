import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Building2, Plus, Pencil, Trash2, Users, X, Check } from 'lucide-react';
import type { Tenant } from '@obliance/shared';
import { Button } from '@/components/common/Button';

interface TenantMember {
  id: number;
  username: string;
  display_name: string | null;
  role: string;
  is_active: boolean;
  tenantRole: 'admin' | 'member';
}

interface TenantWithMemberCount extends Tenant {
  memberCount?: number;
}

// ── Inline form for creating / editing a tenant ────────────────────────────
function TenantForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: { name: string; slug: string };
  onSave: (name: string, slug: string) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial?.name ?? '');
  const [slug, setSlug] = useState(initial?.slug ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const autoSlug = (n: string) =>
    n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  const handleNameChange = (v: string) => {
    setName(v);
    if (!initial) setSlug(autoSlug(v));
  };

  const handleSubmit = async () => {
    if (!name.trim() || !slug.trim()) { setError(t('common.requiredField')); return; }
    setSaving(true);
    setError('');
    try {
      await onSave(name.trim(), slug.trim());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-end gap-2">
      <div className="flex-1">
        <label className="block text-xs text-text-muted mb-1">{t('tenant.name')}</label>
        <input
          type="text"
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          className="w-full rounded-lg border border-border bg-bg-primary px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
          placeholder={t('tenant.namePlaceholder')}
        />
      </div>
      <div className="w-40">
        <label className="block text-xs text-text-muted mb-1">{t('tenant.slug')}</label>
        <input
          type="text"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          className="w-full rounded-lg border border-border bg-bg-primary px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
          placeholder="my-org"
        />
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <Button size="sm" onClick={handleSubmit} disabled={saving}>
        <Check size={14} />
      </Button>
      <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>
        <X size={14} />
      </Button>
    </div>
  );
}

// ── Members panel ───────────────────────────────────────────────────────────
function MembersPanel({ tenantId, onClose }: { tenantId: number; onClose: () => void }) {
  const { t } = useTranslation();
  const [members, setMembers] = useState<TenantMember[]>([]);
  const [allUsers, setAllUsers] = useState<{ id: number; username: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingId, setAddingId] = useState<number | ''>('');

  const fetchMembers = async () => {
    const res = await fetch(`/api/tenants/${tenantId}/members`, { credentials: 'include' });
    const d = await res.json();
    setMembers(d.data ?? []);
    setLoading(false);
  };

  const fetchUsers = async () => {
    const res = await fetch('/api/users', { credentials: 'include' });
    const d = await res.json();
    setAllUsers(d.data ?? []);
  };

  useEffect(() => {
    fetchMembers();
    fetchUsers();
  }, [tenantId]);

  const addMember = async () => {
    if (!addingId) return;
    await fetch(`/api/tenants/${tenantId}/members`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: addingId, role: 'member' }),
    });
    setAddingId('');
    fetchMembers();
  };

  const toggleRole = async (userId: number, currentRole: string) => {
    const newRole = currentRole === 'admin' ? 'member' : 'admin';
    await fetch(`/api/tenants/${tenantId}/members/${userId}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: newRole }),
    });
    fetchMembers();
  };

  const removeMember = async (userId: number) => {
    if (!confirm(t('common.confirmDelete'))) return;
    await fetch(`/api/tenants/${tenantId}/members/${userId}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    fetchMembers();
  };

  const nonMembers = allUsers.filter((u) => !members.find((m) => m.id === u.id));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-bg-secondary shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
            <Users size={15} />
            {t('tenant.members')}
          </h3>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary">
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3 max-h-80 overflow-y-auto">
          {loading ? (
            <p className="text-sm text-text-muted text-center py-4">{t('common.loading')}</p>
          ) : members.length === 0 ? (
            <p className="text-sm text-text-muted text-center py-4">{t('tenant.noMembers')}</p>
          ) : (
            members.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="text-sm text-text-primary font-medium">{m.username}</span>
                  {m.display_name && (
                    <span className="ml-1 text-xs text-text-muted">({m.display_name})</span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => toggleRole(m.id, m.tenantRole)}
                    className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                      m.tenantRole === 'admin'
                        ? 'border-accent text-accent hover:bg-accent/10'
                        : 'border-border text-text-muted hover:border-text-muted'
                    }`}
                    title={t('tenant.toggleRole')}
                  >
                    {m.tenantRole}
                  </button>
                  <button
                    onClick={() => removeMember(m.id)}
                    className="text-text-muted hover:text-red-400 transition-colors"
                    title={t('tenant.removeMember')}
                  >
                    <X size={13} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {nonMembers.length > 0 && (
          <div className="px-5 py-3 border-t border-border flex items-center gap-2">
            <select
              value={addingId}
              onChange={(e) => setAddingId(e.target.value ? Number(e.target.value) : '')}
              className="flex-1 rounded-lg border border-border bg-bg-primary px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="">{t('tenant.selectUser')}</option>
              {nonMembers.map((u) => (
                <option key={u.id} value={u.id}>{u.username}</option>
              ))}
            </select>
            <Button size="sm" onClick={addMember} disabled={!addingId}>
              {t('tenant.addMember')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main page ───────────────────────────────────────────────────────────────
export function AdminTenantsPage() {
  const { t } = useTranslation();
  const [tenants, setTenants] = useState<TenantWithMemberCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [membersForId, setMembersForId] = useState<number | null>(null);

  const fetchTenants = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/tenants', { credentials: 'include' });
      const d = await res.json();
      setTenants(d.data ?? []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchTenants(); }, []);

  const handleCreate = async (name: string, slug: string) => {
    const res = await fetch('/api/tenants', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, slug }),
    });
    if (!res.ok) {
      const d = await res.json();
      throw new Error(d.error ?? t('common.error'));
    }
    setCreating(false);
    fetchTenants();
  };

  const handleUpdate = async (id: number, name: string, slug: string) => {
    const res = await fetch(`/api/tenants/${id}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, slug }),
    });
    if (!res.ok) {
      const d = await res.json();
      throw new Error(d.error ?? t('common.error'));
    }
    setEditingId(null);
    fetchTenants();
  };

  const handleDelete = async (id: number) => {
    if (!confirm(t('tenant.confirmDelete'))) return;
    await fetch(`/api/tenants/${id}`, { method: 'DELETE', credentials: 'include' });
    fetchTenants();
  };

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-text-primary flex items-center gap-2">
            <Building2 size={20} className="text-accent" />
            {t('tenant.pageTitle')}
          </h1>
          <p className="text-sm text-text-muted mt-0.5">{t('tenant.pageDesc')}</p>
        </div>
        {!creating && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus size={14} />
            {t('tenant.create')}
          </Button>
        )}
      </div>

      {creating && (
        <div className="mb-4 p-4 rounded-xl border border-border bg-bg-secondary">
          <TenantForm onSave={handleCreate} onCancel={() => setCreating(false)} />
        </div>
      )}

      {loading ? (
        <p className="text-sm text-text-muted">{t('common.loading')}</p>
      ) : tenants.length === 0 ? (
        <p className="text-sm text-text-muted">{t('tenant.noTenants')}</p>
      ) : (
        <div className="space-y-2">
          {tenants.map((tenant) => (
            <div
              key={tenant.id}
              className="rounded-xl border border-border bg-bg-secondary px-4 py-3"
            >
              {editingId === tenant.id ? (
                <TenantForm
                  initial={{ name: tenant.name, slug: tenant.slug }}
                  onSave={(name, slug) => handleUpdate(tenant.id, name, slug)}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Building2 size={14} className="text-accent shrink-0" />
                      <span className="text-sm font-semibold text-text-primary">{tenant.name}</span>
                      {tenant.id === 1 && (
                        <span className="text-[10px] bg-accent/15 text-accent rounded px-1.5 py-0.5">
                          {t('tenant.default')}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-text-muted mt-0.5">
                      /{tenant.slug} · {t('tenant.createdAt')} {new Date(tenant.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => setMembersForId(tenant.id)}
                      title={t('tenant.manageMembers')}
                      className="flex items-center gap-1 text-xs text-text-muted hover:text-text-primary px-2 py-1 rounded-md hover:bg-bg-hover transition-colors"
                    >
                      <Users size={13} />
                      {t('tenant.members')}
                    </button>
                    <button
                      onClick={() => setEditingId(tenant.id)}
                      title={t('common.edit')}
                      className="p-1.5 text-text-muted hover:text-text-primary rounded-md hover:bg-bg-hover transition-colors"
                    >
                      <Pencil size={13} />
                    </button>
                    {tenant.id !== 1 && (
                      <button
                        onClick={() => handleDelete(tenant.id)}
                        title={t('common.delete')}
                        className="p-1.5 text-text-muted hover:text-red-400 rounded-md hover:bg-bg-hover transition-colors"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {membersForId !== null && (
        <MembersPanel tenantId={membersForId} onClose={() => setMembersForId(null)} />
      )}
    </div>
  );
}
