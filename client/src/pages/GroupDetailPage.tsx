import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Pencil, Trash2, ArrowLeft, FolderOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useGroupStore } from '@/store/groupStore';
import { useAuthStore } from '@/store/authStore';
import { anonymize } from '@/utils/anonymize';
import { groupsApi } from '@/api/groups.api';
import type { DeviceGroup } from '@obliance/shared';
import { DeviceTable } from '@/components/devices/DeviceTable';
import { Button } from '@/components/common/Button';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import toast from 'react-hot-toast';

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

      {/* Device grid — same UX as /devices, pre-filtered on this group (+ descendants) */}
      <DeviceTable mode="monitoring" groupId={groupId} />
    </div>
  );
}
