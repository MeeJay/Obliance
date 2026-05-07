import { useState, useEffect } from 'react';
import { GroupSidePanel } from './GroupSidePanel';
import { DeviceTable } from './DeviceTable';

interface DevicesPageLayoutProps {
  mode: 'monitoring' | 'admin';
  initialStatusFilter?: string;
  initialOsFilter?: string;
  initialStaleHours?: number;
  initialPendingUpdates?: boolean;
  initialGroupId?: number | null;
  /** ApprovalStatus to land on (admin shortcut from the sidebar's
   *  "Agents" entry which deep-links to the pending bucket). */
  initialApprovalFilter?: string;
  onGroupChange?: (groupId: number | null) => void;
}

export function DevicesPageLayout({
  mode, initialStatusFilter, initialOsFilter, initialStaleHours, initialPendingUpdates,
  initialApprovalFilter, initialGroupId = null, onGroupChange,
}: DevicesPageLayoutProps) {
  const [groupId, setGroupId] = useState<number | null>(initialGroupId);

  // Keep local state in sync when URL-provided initial groupId changes
  // (e.g. back navigation).
  useEffect(() => {
    setGroupId(initialGroupId);
  }, [initialGroupId]);

  const handleGroupChange = (gid: number | null) => {
    setGroupId(gid);
    onGroupChange?.(gid);
  };

  return (
    <div className="flex gap-0">
      <GroupSidePanel
        groupId={groupId}
        onGroupChange={handleGroupChange}
      />
      <div className="flex-1 min-w-0 p-6">
        <DeviceTable
          mode={mode}
          initialStatusFilter={initialStatusFilter}
          initialOsFilter={initialOsFilter}
          initialStaleHours={initialStaleHours}
          initialPendingUpdates={initialPendingUpdates}
          initialApprovalFilter={initialApprovalFilter}
          groupId={groupId}
          onGroupChange={handleGroupChange}
        />
      </div>
    </div>
  );
}
