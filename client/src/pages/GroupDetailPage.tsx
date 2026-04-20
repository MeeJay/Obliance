import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Pencil, Trash2, ArrowLeft, FolderOpen, Calendar, Zap, ShieldCheck, ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useGroupStore } from '@/store/groupStore';
import { useAuthStore } from '@/store/authStore';
import { anonymize } from '@/utils/anonymize';
import { groupsApi } from '@/api/groups.api';
import type { DeviceGroup, ScriptSchedule, Scenario, SoftwareComplianceList } from '@obliance/shared';
import { DeviceTable } from '@/components/devices/DeviceTable';
import { Button } from '@/components/common/Button';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { scriptApi } from '@/api/script.api';
import { scenarioApi } from '@/api/scenario.api';
import { softwareComplianceApi } from '@/api/softwareCompliance.api';
import toast from 'react-hot-toast';
import { clsx } from 'clsx';

export function GroupDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { isAdmin, canWriteGroup } = useAuthStore();
  const { removeGroup, fetchGroups, fetchTree } = useGroupStore();

  const groupId = parseInt(id!, 10);
  const canWrite = canWriteGroup(groupId);

  const [group, setGroup] = useState<DeviceGroup | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        const g = await groupsApi.getById(groupId);
        setGroup(g);
      } catch {}
      setLoading(false);
    }
    loadData();
  }, [groupId]);

  if (loading && !group) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!group) {
    return (
      <div className="flex h-full flex-col items-center justify-center">
        <p className="text-text-muted">{t('monitors.notFound')}</p>
        <Link to="/" className="mt-4">
          <Button variant="secondary">{t('monitors.backToDashboard')}</Button>
        </Link>
      </div>
    );
  }

  const handleDelete = async () => {
    if (!confirm(t('groups.confirmDelete', { name: group.name }))) return;
    try {
      await groupsApi.delete(groupId);
      removeGroup(groupId);
      fetchGroups();
      fetchTree();
      toast.success(t('groups.deleted'));
      navigate('/');
    } catch {
      toast.error(t('groups.failedDelete'));
    }
  };

  return (
    <div className="p-6">
      {/* Back button */}
      <Link to="/" className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary mb-4">
        <ArrowLeft size={14} />
        {t('monitors.backToDashboard')}
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent/10">
            <FolderOpen size={24} className="text-accent" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-text-primary">{anonymize(group.name)}</h1>
            {group.description && (
              <p className="text-sm text-text-muted mt-1">{group.description}</p>
            )}
          </div>
        </div>

        {canWrite && (
          <div className="flex items-center gap-2">
            <Link to={`/group/${groupId}/edit`}>
              <Button variant="secondary" size="sm">
                <Pencil size={14} className="mr-1.5" />
                {t('common.edit')}
              </Button>
            </Link>
            {isAdmin() && (
              <Button variant="danger" size="sm" onClick={handleDelete}>
                <Trash2 size={14} className="mr-1.5" />
                {t('common.delete')}
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Automations / policies attached to this group (+ its ancestors) */}
      <GroupAttachmentsPanel groupId={groupId} />

      {/* Device grid — same UX as /devices, pre-filtered on this group (+ descendants) */}
      <DeviceTable mode="monitoring" groupId={groupId} />
    </div>
  );
}

// ── Group attachments panel ─────────────────────────────────────────────────
// Lists automations that target this group specifically:
//   - Script schedules (target_type='group' and targetIds includes this group)
//   - Scenarios (same)
//   - Software compliance lists (same)
//
// Filtering is done client-side on top of the existing list endpoints —
// avoids a per-entity "for-group" endpoint for now. Lightweight since
// tenants typically have a few dozen of each.

function GroupAttachmentsPanel({ groupId }: { groupId: number }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [schedules, setSchedules] = useState<ScriptSchedule[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [complianceLists, setComplianceLists] = useState<SoftwareComplianceList[]>([]);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const [s, sc, cl] = await Promise.all([
          scriptApi.listSchedules().catch(() => []),
          scenarioApi.list().catch(() => []),
          softwareComplianceApi.listLists().catch(() => []),
        ]);
        if (cancelled) return;
        const matchesGroup = (targetType: string, ids: number[] | undefined | null) =>
          targetType === 'group' && Array.isArray(ids) && ids.includes(groupId);
        setSchedules((s || []).filter((x) => matchesGroup(x.targetType, x.targetIds)));
        setScenarios((sc || []).filter((x) => matchesGroup(x.targetType, x.targetIds)));
        setComplianceLists((cl || []).filter((x) => matchesGroup(x.targetType, x.targetIds)));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [groupId]);

  const total = schedules.length + scenarios.length + complianceLists.length;

  // Don't render if there's nothing attached — keeps the page clean for
  // groups with no automations (new groups, device-dump bins, etc).
  if (!loading && total === 0) return null;

  return (
    <div className="mb-6 rounded-xl border border-border bg-bg-secondary overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-bg-tertiary/40 transition-colors"
      >
        {open ? <ChevronDown className="w-4 h-4 text-text-muted" /> : <ChevronRight className="w-4 h-4 text-text-muted" />}
        <span className="text-sm font-semibold text-text-primary">
          {t('groups.attachmentsTitle', 'Attached automations')}
        </span>
        <span className="text-xs text-text-muted">
          ({loading ? '…' : total})
        </span>
      </button>
      {open && !loading && (
        <div className="px-4 py-3 border-t border-border space-y-4">
          <AttachmentColumn
            icon={<Calendar className="w-3.5 h-3.5 text-accent" />}
            label={t('nav.schedules', 'Schedules')}
            items={schedules.map((s) => ({
              id: s.id,
              name: s.name,
              href: `/automations?tab=schedules`,
              hint: s.cronExpression ? `cron: ${s.cronExpression}` : s.fireOnceAt ? 'one-time' : 'manual',
              disabled: !s.enabled,
            }))}
          />
          <AttachmentColumn
            icon={<Zap className="w-3.5 h-3.5 text-accent" />}
            label={t('nav.scenarios', 'Scenarios')}
            items={scenarios.map((s) => ({
              id: s.id,
              name: s.name,
              href: `/automations?tab=scenarios`,
              hint: s.triggerType,
              disabled: !s.enabled,
            }))}
          />
          <AttachmentColumn
            icon={<ShieldCheck className="w-3.5 h-3.5 text-accent" />}
            label={t('nav.softwareCompliance', 'Software policies')}
            items={complianceLists.map((l) => ({
              id: l.id,
              name: l.name,
              href: `/policies?tab=software`,
              hint: l.listType === 'whitelist' ? 'whitelist' : 'blacklist',
              disabled: !l.enabled,
            }))}
          />
        </div>
      )}
    </div>
  );
}

interface AttachmentItem { id: number; name: string; href: string; hint?: string; disabled?: boolean }

function AttachmentColumn({ icon, label, items }: { icon: React.ReactNode; label: string; items: AttachmentItem[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        {icon}
        <span className="text-[10px] uppercase tracking-wider font-medium text-text-muted">{label}</span>
        <span className="text-[10px] text-text-muted/60">({items.length})</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((it) => (
          <Link
            key={it.id}
            to={it.href}
            className={clsx(
              'flex items-center gap-1 text-xs px-2 py-0.5 rounded border transition-colors',
              it.disabled
                ? 'border-border/30 text-text-muted/50 bg-bg-tertiary/30 line-through'
                : 'border-border text-text-secondary bg-bg-tertiary/50 hover:border-accent/40 hover:text-text-primary',
            )}
          >
            <span>{it.name}</span>
            {it.hint && (
              <span className="text-[9px] text-text-muted/70 font-mono">{it.hint}</span>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
