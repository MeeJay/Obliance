import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';
import type { ApprovalStatus, DeviceStatus } from '@obliance/shared';

const STATUS_CONFIG: Record<DeviceStatus, { i18nKey: string; color: string; dot: string }> = {
  online:            { i18nKey: 'deviceStatus.online',           color: 'text-green-400 bg-green-400/10 border-green-400/30',     dot: 'bg-green-400' },
  offline:           { i18nKey: 'deviceStatus.offline',          color: 'text-gray-400 bg-gray-400/10 border-gray-400/30',        dot: 'bg-gray-400' },
  warning:           { i18nKey: 'deviceStatus.warning',          color: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30',  dot: 'bg-yellow-400 animate-pulse' },
  critical:          { i18nKey: 'deviceStatus.critical',         color: 'text-red-400 bg-red-400/10 border-red-400/30',           dot: 'bg-red-400 animate-pulse' },
  pending:           { i18nKey: 'deviceStatus.pending',          color: 'text-blue-400 bg-blue-400/10 border-blue-400/30',        dot: 'bg-blue-400' },
  maintenance:       { i18nKey: 'deviceStatus.maintenance',      color: 'text-rose-400 bg-rose-400/10 border-rose-400/30',        dot: 'bg-rose-400' },
  suspended:         { i18nKey: 'deviceStatus.suspended',        color: 'text-gray-500 bg-gray-500/10 border-gray-500/20',        dot: 'bg-gray-500' },
  pending_uninstall: { i18nKey: 'deviceStatus.pendingUninstall', color: 'text-orange-400 bg-orange-400/10 border-orange-400/30',  dot: 'bg-orange-400 animate-pulse' },
  updating:          { i18nKey: 'deviceStatus.updating',         color: 'text-blue-400 bg-blue-400/10 border-blue-400/30',        dot: 'bg-blue-400 animate-pulse' },
  update_error:      { i18nKey: 'deviceStatus.updateError',      color: 'text-orange-400 bg-orange-400/10 border-orange-400/30',  dot: 'bg-orange-400' },
};

interface Props {
  status: DeviceStatus;
  approvalStatus?: ApprovalStatus;
  size?: 'sm' | 'md';
  showDot?: boolean;
}

export function DeviceStatusBadge({ status, approvalStatus, size = 'md', showDot = true }: Props) {
  const { t } = useTranslation();
  const isRefused = approvalStatus === 'refused';
  const cfg = isRefused
    ? { i18nKey: 'deviceStatus.refused', color: 'text-red-400 bg-red-400/10 border-red-400/30', dot: 'bg-red-400' }
    : STATUS_CONFIG[status] ?? STATUS_CONFIG.offline;
  return (
    <span className={clsx(
      'inline-flex items-center gap-1.5 font-medium border rounded-full',
      size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-xs px-2.5 py-1',
      cfg.color,
    )}>
      {showDot && <span className={clsx('rounded-full', size === 'sm' ? 'w-1.5 h-1.5' : 'w-2 h-2', cfg.dot)} />}
      {t(cfg.i18nKey)}
    </span>
  );
}
