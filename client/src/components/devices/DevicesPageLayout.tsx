import { useState } from 'react';
import { GroupSidePanel } from './GroupSidePanel';
import { DeviceTable } from './DeviceTable';

interface DevicesPageLayoutProps {
  mode: 'monitoring' | 'admin';
  initialStatusFilter?: string;
}

export function DevicesPageLayout({ mode, initialStatusFilter }: DevicesPageLayoutProps) {
  const [groupId, setGroupId] = useState<number | null>(null);

  return (
    <div className="flex h-full gap-0">
      <GroupSidePanel
        groupId={groupId}
        onGroupChange={setGroupId}
      />
      <div className="flex-1 min-w-0 p-6">
        <DeviceTable
          mode={mode}
          initialStatusFilter={initialStatusFilter}
          groupId={groupId}
          onGroupChange={setGroupId}
        />
      </div>
    </div>
  );
}
