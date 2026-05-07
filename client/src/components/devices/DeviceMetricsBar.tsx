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

  // Compute a single label width shared by CPU / RAM / every disk row,
  // sized to fit the longest visible label. Previously CPU/RAM had a
  // fixed `w-12` and disks had `w-32` — the asymmetry stood out on
  // Windows where mount labels are short (`C:`, `D:`) and the gauges
  // would still be shifted right by 80px more than CPU/RAM. Now the
  // shared width is the smaller of: 22ch (the smartMountLabel hard cap)
  // OR the actual longest label, with a 3ch floor so a fleet of single-
  // letter Windows mounts still leaves room for the "CPU"/"RAM" labels.
  //
  // We pad the computed width by 1ch so the longest label doesn't sit
  // edge-to-edge against the progress bar — when a device has only
  // CPU + RAM rows the natural width would be exactly 3ch and the gap-2
  // alone read too tight. The extra ch keeps a consistent visual
  // breathing room with longer labels (`/boot/efi`, `C:\Users`) where
  // the trailing whitespace already provided that breathing room.
  const visibleLabels: string[] = [];
  if (metrics.cpu != null) visibleLabels.push('CPU');
  if (metrics.memory != null) visibleLabels.push('RAM');
  for (const d of metrics.disks ?? []) visibleLabels.push(smartMountLabel(d.mount));
  const longest = visibleLabels.reduce((m, s) => Math.max(m, s.length), 3);
  const labelWidth = `${Math.min(23, longest + 1)}ch`;

  return (
    <div className="space-y-1.5">
      {metrics.cpu != null && (
        <div className="flex items-center gap-2">
          <Cpu className="w-3 h-3 text-text-muted shrink-0" />
          <span className="text-xs text-text-muted shrink-0" style={{ width: labelWidth }}>CPU</span>
          <PercentBar value={metrics.cpu.percent} className="flex-1" />
        </div>
      )}
      {metrics.memory != null && (
        <div className="flex items-center gap-2">
          <MemoryStick className="w-3 h-3 text-text-muted shrink-0" />
          <span className="text-xs text-text-muted shrink-0" style={{ width: labelWidth }}>RAM</span>
          <PercentBar value={metrics.memory.percent} className="flex-1" />
        </div>
      )}
      {metrics.disks && metrics.disks.map((disk) => (
        <div key={disk.mount} className="flex items-center gap-2">
          <HardDrive className="w-3 h-3 text-text-muted shrink-0" />
          <span
            className="text-xs text-text-muted shrink-0 truncate cursor-help"
            style={{ width: labelWidth }}
            title={disk.mount}
          >
            {smartMountLabel(disk.mount)}
          </span>
          <PercentBar value={disk.percent} className="flex-1" />
        </div>
      ))}
    </div>
  );
}

/**
 * Compact representation of a mount path for narrow displays. Strategy:
 *  - Single-segment paths (`/`, `/var`, `C:`, `D:\`) → return as-is.
 *  - Long paths (>22 chars) → keep the first segment and the last two,
 *    join with an ellipsis: `/home/user/projects/foo/bar` →
 *    `/home/…/foo/bar`. The full path stays available via title=.
 *  - Windows-style drives without a path stay verbatim.
 */
function smartMountLabel(mount: string): string {
  if (!mount) return mount;
  // Hard cap on visual width even after smart shortening.
  const maxChars = 22;
  if (mount.length <= maxChars) return mount;
  // Detect Windows drive letter prefix.
  const winMatch = /^([A-Za-z]:[\\\/])(.+)$/.exec(mount);
  if (winMatch) {
    const drive = winMatch[1];
    const rest = winMatch[2].replace(/\\/g, '/').split('/').filter(Boolean);
    if (rest.length > 2) {
      const tail = rest.slice(-2).join('/');
      const candidate = `${drive}…/${tail}`;
      return candidate.length <= maxChars ? candidate : `${drive}…/${rest[rest.length - 1]}`;
    }
    return mount;
  }
  // POSIX paths.
  const parts = mount.split('/').filter(Boolean);
  if (parts.length <= 2) return mount;
  const first = parts[0];
  const tail2 = parts.slice(-2).join('/');
  const candidate = `/${first}/…/${tail2}`;
  if (candidate.length <= maxChars) return candidate;
  // Fallback — first segment + last segment only.
  const tail1 = parts[parts.length - 1];
  return `/${first}/…/${tail1}`;
}
