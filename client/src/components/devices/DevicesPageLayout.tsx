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

  // Layout shape:
  //   ┌──────────────────────────────────────────────────────────────┐
  //   │ <main> (flex-1 of AppLayout, already constrained to viewport)│
  //   │ ┌────────────┬───────────────────────────────────────────────┐│
  //   │ │ GroupSide  │ filters / search / chips / select  (sticky)   ││
  //   │ │  Panel     │───────────────────────────────────────────────┤│
  //   │ │  (h-full,  │ device list (this is the only scrollable area)││
  //   │ │   internal │                                               ││
  //   │ │   scroll)  │                                               ││
  //   │ └────────────┴───────────────────────────────────────────────┘│
  //   └──────────────────────────────────────────────────────────────┘
  //
  // Both panes use `min-h-0` so flex doesn't stretch them past their
  // parent (without that the inner overflow-y-auto never kicks in and
  // the scroll bubbles up to <main>, which is exactly the behaviour the
  // user complained about — sidebar scrolling away with the page).
  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <GroupSidePanel
        groupId={groupId}
        onGroupChange={handleGroupChange}
      />
      <div className="flex-1 min-w-0 min-h-0 overflow-y-auto">
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
