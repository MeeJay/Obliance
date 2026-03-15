import { clsx } from 'clsx';
import type { DeviceMetrics } from '@obliance/shared';
import { Cpu, MemoryStick, HardDrive } from 'lucide-react';

function PercentBar({ value, className }: { value: number; className?: string }) {
  const pct = Math.min(100, Math.max(0, value));
  const color = pct > 90 ? 'bg-red-400' : pct > 70 ? 'bg-yellow-400' : 'bg-green-400';
  return (
    <div className={clsx('flex items-center gap-1.5', className)}>
      <div className="flex-1 h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
        <div className={clsx('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-text-muted w-8 text-right">{pct}%</span>
    </div>
  );
}

interface Props {
  metrics: DeviceMetrics | undefined;
  compact?: boolean;
}

export function DeviceMetricsBar({ metrics, compact = false }: Props) {
  if (!metrics || (!metrics.cpu && !metrics.memory)) {
    return <span className="text-xs text-text-muted">No metrics</span>;
  }

  if (compact) {
    return (
      <div className="flex items-center gap-3 text-xs text-text-muted">
        {metrics.cpu != null && (
          <span className="flex items-center gap-1">
            <Cpu className="w-3 h-3" />
            {metrics.cpu.percent}%
          </span>
        )}
        {metrics.memory != null && (
          <span className="flex items-center gap-1">
            <MemoryStick className="w-3 h-3" />
            {metrics.memory.percent}%
          </span>
        )}
        {metrics.disks && metrics.disks.length > 0 && (
          <span className="flex items-center gap-1">
            <HardDrive className="w-3 h-3" />
            {metrics.disks[0].percent}%
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {metrics.cpu != null && (
        <div className="flex items-center gap-2">
          <Cpu className="w-3 h-3 text-text-muted shrink-0" />
          <span className="text-xs text-text-muted w-12">CPU</span>
          <PercentBar value={metrics.cpu.percent} className="flex-1" />
        </div>
      )}
      {metrics.memory != null && (
        <div className="flex items-center gap-2">
          <MemoryStick className="w-3 h-3 text-text-muted shrink-0" />
          <span className="text-xs text-text-muted w-12">RAM</span>
          <PercentBar value={metrics.memory.percent} className="flex-1" />
        </div>
      )}
      {metrics.disks && metrics.disks.map((disk) => (
        <div key={disk.mount} className="flex items-center gap-2">
          <HardDrive className="w-3 h-3 text-text-muted shrink-0" />
          <span className="text-xs text-text-muted w-12 truncate">{disk.mount}</span>
          <PercentBar value={disk.percent} className="flex-1" />
        </div>
      ))}
    </div>
  );
}
