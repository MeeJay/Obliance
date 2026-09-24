import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { GroupSidePanel } from './GroupSidePanel';
import { DeviceTable } from './DeviceTable';
import { Drawer } from '@/components/common/Drawer';
import { useMediaQuery, MEDIA } from '@/hooks/useMediaQuery';

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
  const { t } = useTranslation();
  const [groupId, setGroupId] = useState<number | null>(initialGroupId);
  // Below lg (phones, tablets) the groups column would eat most of the
  // width next to the list: it becomes an off-canvas drawer opened from a
  // "Groups" button in the DeviceTable toolbar (docs/obli-mobile.md §4/§5.8).
  const isDesktop = useMediaQuery(MEDIA.lg);
  const [groupsOpen, setGroupsOpen] = useState(false);

  // Keep local state in sync when URL-provided initial groupId changes
  // (e.g. back navigation).
  useEffect(() => {
    setGroupId(initialGroupId);
  }, [initialGroupId]);

  // Leaving the drawer layout (rotation / resize to ≥ lg) closes it.
  useEffect(() => {
    if (isDesktop) setGroupsOpen(false);
  }, [isDesktop]);

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
      {isDesktop && (
        <GroupSidePanel
          groupId={groupId}
          onGroupChange={handleGroupChange}
        />
      )}
      <div className="flex-1 min-w-0 min-h-0 overflow-y-auto max-lg:overscroll-contain">
        <DeviceTable
          mode={mode}
          initialStatusFilter={initialStatusFilter}
          initialOsFilter={initialOsFilter}
          initialStaleHours={initialStaleHours}
          initialPendingUpdates={initialPendingUpdates}
          initialApprovalFilter={initialApprovalFilter}
          groupId={groupId}
          onGroupChange={handleGroupChange}
          onOpenGroups={isDesktop ? undefined : () => setGroupsOpen(true)}
        />
      </div>
      {!isDesktop && (
        <Drawer
          open={groupsOpen}
          onClose={() => setGroupsOpen(false)}
          side="left"
          size="md"
          bodyClassName="p-0"
          ariaLabel={t('groupPanel.title')}
        >
          <GroupSidePanel
            variant="drawer"
            groupId={groupId}
            onClose={() => setGroupsOpen(false)}
            onGroupChange={(gid) => {
              handleGroupChange(gid);
              // Picking a group is the drawer's job done.
              setGroupsOpen(false);
            }}
          />
        </Drawer>
      )}
    </div>
  );
}
