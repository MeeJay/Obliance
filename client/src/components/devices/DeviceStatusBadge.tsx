import { clsx } from 'clsx';
import type { ApprovalStatus, DeviceStatus } from '@obliance/shared';

const STATUS_CONFIG: Record<DeviceStatus, { label: string; color: string; dot: string }> = {
  online:      { label: 'Online',      color: 'text-green-400 bg-green-400/10 border-green-400/30',    dot: 'bg-green-400' },
  offline:     { label: 'Offline',     color: 'text-gray-400 bg-gray-400/10 border-gray-400/30',       dot: 'bg-gray-400' },
  warning:     { label: 'Warning',     color: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30', dot: 'bg-yellow-400 animate-pulse' },
  critical:    { label: 'Critical',    color: 'text-red-400 bg-red-400/10 border-red-400/30',          dot: 'bg-red-400 animate-pulse' },
  pending:     { label: 'Pending',     color: 'text-blue-400 bg-blue-400/10 border-blue-400/30',       dot: 'bg-blue-400' },
  maintenance:       { label: 'Maintenance',       color: 'text-rose-400 bg-rose-400/10 border-rose-400/30', dot: 'bg-rose-400' },
  suspended:         { label: 'Suspended',         color: 'text-gray-500 bg-gray-500/10 border-gray-500/20',       dot: 'bg-gray-500' },
  pending_uninstall: { label: 'Pending uninstall', color: 'text-orange-400 bg-orange-400/10 border-orange-400/30', dot: 'bg-orange-400 animate-pulse' },
  updating:          { label: 'Updating',          color: 'text-blue-400 bg-blue-400/10 border-blue-400/30',     dot: 'bg-blue-400 animate-pulse' },
  update_error:      { label: 'Update Error',      color: 'text-orange-400 bg-orange-400/10 border-orange-400/30', dot: 'bg-orange-400' },
};

const REFUSED_CONFIG = { label: 'Refused', color: 'text-red-400 bg-red-400/10 border-red-400/30', dot: 'bg-red-400' };

interface Props {
  status: DeviceStatus;
  approvalStatus?: ApprovalStatus;
  size?: 'sm' | 'md';
  showDot?: boolean;
}

export function DeviceStatusBadge({ status, approvalStatus, size = 'md', showDot = true }: Props) {
  const cfg = approvalStatus === 'refused'
    ? REFUSED_CONFIG
    : STATUS_CONFIG[status] ?? STATUS_CONFIG.offline;
  return (
    <span className={clsx(
      'inline-flex items-center gap-1.5 font-medium border rounded-full',
      size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-xs px-2.5 py-1',
      cfg.color,
    )}>
      {showDot && <span className={clsx('rounded-full', size === 'sm' ? 'w-1.5 h-1.5' : 'w-2 h-2', cfg.dot)} />}
      {cfg.label}
    </span>
  );
}
