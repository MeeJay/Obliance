import { useSearchParams } from 'react-router-dom';
import { DevicesPageLayout } from '@/components/devices/DevicesPageLayout';

export function DeviceListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const statusFilter = searchParams.get('status') || undefined;
  const groupIdParam = searchParams.get('groupId');
  const initialGroupId = groupIdParam ? parseInt(groupIdParam, 10) : null;

  return (
    <DevicesPageLayout
      mode="monitoring"
      initialStatusFilter={statusFilter}
      initialGroupId={initialGroupId}
      onGroupChange={(gid) => {
        setSearchParams((prev) => {
          const next = new URLSearchParams(prev);
          if (gid == null) next.delete('groupId');
          else next.set('groupId', String(gid));
          return next;
        }, { replace: true });
      }}
    />
  );
}
