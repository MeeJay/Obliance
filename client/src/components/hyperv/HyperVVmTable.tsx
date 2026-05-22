import { useState } from 'react';
import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';
import {
  Play, Square, Power, RotateCcw, Save, Pause, PlayCircle,
  Camera, Trash2, MoreHorizontal, Server,
} from 'lucide-react';
import type { VirtualMachine, VmAction, VmState } from '@obliance/shared';

interface Props {
  vms: VirtualMachine[];
  /** vmId currently running an action (disables its buttons + shows spinner). */
  busyVmId?: string | null;
  /** Show the host-name column (tenant-wide grid). */
  showHost?: boolean;
  onAction: (vm: VirtualMachine, action: VmAction) => void;
}

const STATE_BADGE: Record<VmState, string> = {
  running: 'bg-green-400/10 text-green-400 border-green-400/30',
  off: 'bg-gray-400/10 text-gray-400 border-gray-400/30',
  saved: 'bg-blue-400/10 text-blue-400 border-blue-400/30',
  paused: 'bg-yellow-400/10 text-yellow-400 border-yellow-400/30',
  transitioning: 'bg-orange-400/10 text-orange-400 border-orange-400/30',
  unknown: 'bg-gray-400/10 text-gray-400 border-gray-400/30',
};

function fmtMem(bytes: number | null): string {
  if (!bytes || bytes <= 0) return '—';
  const gb = bytes / (1024 ** 3);
  return gb >= 1 ? `${gb.toFixed(gb < 10 ? 1 : 0)} GB` : `${Math.round(bytes / (1024 ** 2))} MB`;
}

function fmtUptime(sec: number | null): string {
  if (!sec || sec <= 0) return '—';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function HyperVVmTable({ vms, busyVmId, showHost, onAction }: Props) {
  const { t } = useTranslation();
  const [menuVmId, setMenuVmId] = useState<string | null>(null);

  const stateLabel = (s: VmState) => t(`hyperv.state.${s}`) || s;

  if (vms.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12 text-text-muted">
        <Server className="w-8 h-8 opacity-50" />
        <p className="text-sm">{t('hyperv.noVms') || 'No virtual machines on this host.'}</p>
      </div>
    );
  }

  return (
    <div className="bg-bg-secondary rounded-xl overflow-visible">
      <table className="w-full">
        <thead>
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase">{t('hyperv.col.name') || 'Name'}</th>
            {showHost && <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase hidden md:table-cell">{t('hyperv.col.host') || 'Host'}</th>}
            <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase">{t('hyperv.col.state') || 'State'}</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase hidden lg:table-cell">vCPU</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase hidden lg:table-cell">{t('hyperv.col.memory') || 'Memory'}</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase hidden xl:table-cell">{t('hyperv.col.uptime') || 'Uptime'}</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-text-muted uppercase">{t('hyperv.col.actions') || 'Actions'}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {vms.map((vm) => {
            const busy = busyVmId === vm.vmId;
            const running = vm.state === 'running';
            const off = vm.state === 'off';
            const paused = vm.state === 'paused';
            return (
              <tr key={vm.vmId} className="hover:bg-bg-tertiary/40 transition-colors">
                <td className="px-4 py-2.5 text-sm text-text-primary font-medium">
                  {vm.name}
                  {vm.checkpointCount ? <span className="ml-2 text-[10px] text-text-muted">({vm.checkpointCount} cp)</span> : null}
                </td>
                {showHost && <td className="px-4 py-2.5 text-sm text-text-muted hidden md:table-cell">{vm.hostName ?? `#${vm.hostDeviceId}`}</td>}
                <td className="px-4 py-2.5">
                  <span className={clsx('inline-block px-2 py-0.5 text-[11px] rounded-full border', STATE_BADGE[vm.state])}>
                    {stateLabel(vm.state)}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-sm text-text-muted hidden lg:table-cell">{vm.cpuCount ?? '—'}</td>
                <td className="px-4 py-2.5 text-sm text-text-muted hidden lg:table-cell">{fmtMem(vm.memoryBytes)}</td>
                <td className="px-4 py-2.5 text-sm text-text-muted hidden xl:table-cell">{fmtUptime(vm.uptimeSeconds)}</td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center justify-end gap-1">
                    {/* Primary power toggle */}
                    {off || vm.state === 'saved' || paused ? (
                      <button
                        disabled={busy}
                        onClick={() => onAction(vm, paused ? 'resume' : 'start')}
                        title={paused ? (t('hyperv.action.resume') || 'Resume') : (t('hyperv.action.start') || 'Start')}
                        className="p-1.5 rounded text-green-400 hover:bg-green-400/10 disabled:opacity-40 transition-colors"
                      >
                        {paused ? <PlayCircle className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                      </button>
                    ) : (
                      <button
                        disabled={busy}
                        onClick={() => onAction(vm, 'shutdown')}
                        title={t('hyperv.action.shutdown') || 'Shut down (graceful)'}
                        className="p-1.5 rounded text-orange-400 hover:bg-orange-400/10 disabled:opacity-40 transition-colors"
                      >
                        <Power className="w-4 h-4" />
                      </button>
                    )}
                    {/* Restart */}
                    <button
                      disabled={busy || !running}
                      onClick={() => onAction(vm, 'restart')}
                      title={t('hyperv.action.restart') || 'Restart'}
                      className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-secondary disabled:opacity-30 transition-colors"
                    >
                      <RotateCcw className="w-4 h-4" />
                    </button>
                    {/* Overflow menu */}
                    <div className="relative">
                      <button
                        disabled={busy}
                        onClick={() => setMenuVmId(menuVmId === vm.vmId ? null : vm.vmId)}
                        className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-secondary disabled:opacity-40 transition-colors"
                      >
                        <MoreHorizontal className="w-4 h-4" />
                      </button>
                      {menuVmId === vm.vmId && (
                        <>
                          <div className="fixed inset-0 z-40" onClick={() => setMenuVmId(null)} />
                          <div className="absolute right-0 top-full mt-1 z-50 w-52 bg-bg-secondary rounded-lg shadow-2xl overflow-hidden py-1">
                            {[
                              { action: 'stop' as VmAction, label: t('hyperv.action.stop') || 'Power off (hard)', icon: Square, danger: false, show: !off },
                              { action: 'save' as VmAction, label: t('hyperv.action.save') || 'Save state', icon: Save, danger: false, show: running },
                              { action: 'pause' as VmAction, label: t('hyperv.action.pause') || 'Pause', icon: Pause, danger: false, show: running },
                              { action: 'checkpoint_create' as VmAction, label: t('hyperv.action.checkpoint') || 'Create checkpoint', icon: Camera, danger: false, show: true },
                              { action: 'delete' as VmAction, label: t('hyperv.action.delete') || 'Delete VM', icon: Trash2, danger: true, show: true },
                            ].filter((i) => i.show).map((i) => (
                              <button
                                key={i.action}
                                onClick={() => { setMenuVmId(null); onAction(vm, i.action); }}
                                className={clsx(
                                  'w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-bg-tertiary transition-colors',
                                  i.danger ? 'text-red-400' : 'text-text-primary',
                                )}
                              >
                                <i.icon className="w-3.5 h-3.5" /> {i.label}
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
