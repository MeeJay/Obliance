import { useSearchParams } from 'react-router-dom';
import { DevicesPageLayout } from '@/components/devices/DevicesPageLayout';

export function DeviceListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const statusFilter = searchParams.get('status') || undefined;
  const groupIdParam = searchParams.get('groupId');
  const initialGroupId = groupIdParam ? parseInt(groupIdParam, 10) : null;
  // Dashboard click-throughs land here with extra filters in the URL:
  // ?os=windows / ?stale=72 / ?pendingUpdates=1. Each is forwarded to the
  // device list query so the user lands directly on the filtered set.
  const osFilter = searchParams.get('os') || undefined;
  const staleParam = searchParams.get('stale');
  const initialStaleHours = staleParam ? parseInt(staleParam, 10) : undefined;
  const initialPendingUpdates = searchParams.get('pendingUpdates') === '1';

  return (
    <DevicesPageLayout
      mode="monitoring"
      initialStatusFilter={statusFilter}
      initialOsFilter={osFilter}
      initialStaleHours={initialStaleHours}
      initialPendingUpdates={initialPendingUpdates}
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
