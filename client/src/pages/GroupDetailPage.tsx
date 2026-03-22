import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Pencil, Trash2, ArrowLeft, FolderOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useGroupStore } from '@/store/groupStore';
import { useAuthStore } from '@/store/authStore';
import { groupsApi } from '@/api/groups.api';
import { deviceApi } from '@/api/device.api';
import type { DeviceGroup, DeviceGroupTreeNode, Device } from '@obliance/shared';
import { DeviceStatusBadge } from '@/components/devices/DeviceStatusBadge';
import { OsIcon } from '@/components/devices/OsIcon';
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
  const [devices, setDevices] = useState<Device[]>([]);
  const [subGroupDevices, setSubGroupDevices] = useState<Map<number, { name: string; devices: Device[] }>>(new Map());
  const [loading, setLoading] = useState(true);

  // Fetch group + devices + sub-group devices on mount
  useEffect(() => {
    async function loadData() {
      try {
        const [g, directDevs, tree] = await Promise.all([
          groupsApi.getById(groupId),
          deviceApi.list({ groupId }),
          groupsApi.tree(),
        ]);
        setGroup(g);
        setDevices(directDevs);

        // If no direct devices or group has children, load descendant devices
        const findNode = (nodes: DeviceGroupTreeNode[]): DeviceGroupTreeNode | null => {
          for (const n of nodes) {
            if (n.id === groupId) return n;
            const found = findNode(n.children);
            if (found) return found;
          }
          return null;
        };
        const node = findNode(tree);
        if (node && node.children.length > 0) {
          const subMap = new Map<number, { name: string; devices: Device[] }>();
          const loadChildren = async (children: DeviceGroupTreeNode[]) => {
            for (const child of children) {
              const childDevs = await deviceApi.list({ groupId: child.id });
              if (childDevs.length > 0) {
                subMap.set(child.id, { name: child.name, devices: childDevs });
              }
              if (child.children.length > 0) {
                await loadChildren(child.children);
              }
            }
          };
          await loadChildren(node.children);
          setSubGroupDevices(subMap);
        }
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

  // All devices = direct + all sub-groups
  const allSubDevices = Array.from(subGroupDevices.values()).flatMap(sg => sg.devices);
  const allDevices = [...devices, ...allSubDevices];
  const onlineCount = allDevices.filter((d) => d.status === 'online').length;
  const offlineCount = allDevices.filter((d) => d.status === 'offline').length;
  const warningCount = allDevices.filter((d) => d.status === 'warning' || d.status === 'critical').length;

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
            <h1 className="text-2xl font-semibold text-text-primary">{group.name}</h1>
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

      {/* Stats */}
      {allDevices.length > 0 && (
        <div className="grid gap-4 mb-6" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
          <div className="rounded-lg border border-border bg-bg-secondary p-4">
            <div className="text-sm text-text-secondary mb-1">{t('groups.detail.totalAgents', { defaultValue: 'Total Devices' })}</div>
            <div className="text-xl font-mono font-semibold text-text-primary">{allDevices.length}</div>
          </div>
          <div className="rounded-lg border border-status-up/30 bg-bg-secondary p-4">
            <div className="text-sm text-text-secondary mb-1">{t('groups.detail.online', { defaultValue: 'Online' })}</div>
            <div className="text-xl font-mono font-semibold text-status-up">{onlineCount}</div>
          </div>
          {warningCount > 0 && (
            <div className="rounded-lg border border-yellow-500/30 bg-bg-secondary p-4">
              <div className="text-sm text-text-secondary mb-1">{t('groups.detail.alert', { defaultValue: 'Warning' })}</div>
              <div className="text-xl font-mono font-semibold text-yellow-400">{warningCount}</div>
            </div>
          )}
          {offlineCount > 0 && (
            <div className="rounded-lg border border-status-down/30 bg-bg-secondary p-4">
              <div className="text-sm text-text-secondary mb-1">{t('groups.detail.offline', { defaultValue: 'Offline' })}</div>
              <div className="text-xl font-mono font-semibold text-status-down">{offlineCount}</div>
            </div>
          )}
        </div>
      )}

      {/* Device list */}
      {allDevices.length > 0 ? (
        <div className="space-y-4">
          {/* Direct devices in this group */}
          {devices.length > 0 && (
            <div className="rounded-lg border border-border bg-bg-secondary">
              <div className="px-4 py-3 border-b border-border">
                <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide">
                  {group.name} ({devices.length})
                </h3>
              </div>
              <div className="divide-y divide-border">
                {devices.map((device) => (
                  <Link key={device.id} to={`/devices/${device.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-bg-hover transition-colors">
                    <OsIcon osType={device.osType} className="w-4 h-4 text-text-muted shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-text-primary truncate">{device.displayName ?? device.hostname}</div>
                      {device.displayName && <div className="text-xs text-text-muted truncate">{device.hostname}</div>}
                    </div>
                    <DeviceStatusBadge status={device.status} size="sm" />
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Sub-group devices */}
          {Array.from(subGroupDevices.entries()).map(([sgId, { name, devices: sgDevices }]) => (
            <div key={sgId} className="rounded-lg border border-border bg-bg-secondary">
              <div className="px-4 py-3 border-b border-border flex items-center gap-2">
                <FolderOpen size={14} className="text-accent" />
                <Link to={`/group/${sgId}`} className="text-xs font-semibold text-text-muted uppercase tracking-wide hover:text-accent transition-colors">
                  {name} ({sgDevices.length})
                </Link>
              </div>
              <div className="divide-y divide-border">
                {sgDevices.map((device) => (
                  <Link key={device.id} to={`/devices/${device.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-bg-hover transition-colors">
                    <OsIcon osType={device.osType} className="w-4 h-4 text-text-muted shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-text-primary truncate">{device.displayName ?? device.hostname}</div>
                      {device.displayName && <div className="text-xs text-text-muted truncate">{device.hostname}</div>}
                    </div>
                    <DeviceStatusBadge status={device.status} size="sm" />
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        !loading && (
          <div className="rounded-lg border border-border bg-bg-secondary py-10 text-center">
            <FolderOpen size={32} className="mx-auto mb-3 text-text-muted opacity-40" />
            <p className="text-sm text-text-muted">No devices in this group</p>
          </div>
        )
      )}
    </div>
  );
}
