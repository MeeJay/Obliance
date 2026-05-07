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
  // Sidebar admin "Agents" deep-links to /devices?approvalStatus=pending
  // so the page lands directly on the enrolment queue.
  const initialApprovalFilter = searchParams.get('approvalStatus') || undefined;

  // We render the "admin" shell for everyone now — the destructive
  // actions (delete / uninstall / transfer / approval-state filters)
  // are role-gated inside DeviceTable + DeviceRow + DeviceDetailPage,
  // not gated by `mode`. /admin/devices keeps a separate hub for the
  // pure-admin tabs (API keys / custom sections / discovery) but no
  // longer hosts a duplicate device list.
  return (
    <DevicesPageLayout
      mode="admin"
      initialStatusFilter={statusFilter}
      initialOsFilter={osFilter}
      initialStaleHours={initialStaleHours}
      initialPendingUpdates={initialPendingUpdates}
      initialApprovalFilter={initialApprovalFilter}
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
