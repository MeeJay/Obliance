import { cloneElement, useCallback, useEffect, useRef, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import {
 Monitor, ArrowLeft, RefreshCw, Cpu, MemoryStick, HardDrive, Plus,
 Terminal, Package, Shield, ShieldCheck, ShieldOff, MonitorPlay, History,
 Scan, WifiOff, Clock, Network, CircuitBoard, X,
 Server, Power, RotateCcw, Loader2, ScanLine, ChevronDown, ChevronRight, Play, Square, Activity,
 AlertTriangle, CheckCircle2, XCircle, MinusCircle, Settings, ToggleLeft, ToggleRight, Trash2, Download, TerminalSquare, FolderOpen, MessageCircle,
 ArrowLeftRight, CalendarClock, Maximize2, StopCircle, Wrench, EyeOff, Eye, Moon, Lock, Unlock,
 ArrowRightLeft, Pencil, Check, StickyNote, Database, TrendingUp, TrendingDown, Minus,
 Printer, Cable, Rewind, Copy, ExternalLink,
} from 'lucide-react';
import { IconButton } from '@/components/common/IconButton';
import { Modal } from '@/components/common/Modal';
import { TableScroll } from '@/components/common/TableScroll';
import { ActionMenu, type ActionMenuItem } from '@/components/common/ActionMenu';
import { Tip } from '@/components/common/Tip';
import { PageContainer } from '@/components/common/PageContainer';
import { useConfirm, usePrompt } from '@/components/common/ConfirmDialog';
import { useClickOutside } from '@/hooks/useClickOutside';
import { useCanHover } from '@/hooks/useMediaQuery';
import { saveText } from '@/utils/download';
import { openExternal } from '@/utils/openExternal';
import { copyText } from '@/utils/clipboard';
import { PrivacyUnlockModal } from '@/components/devices/PrivacyUnlockModal';
import { TransferTenantModal } from '@/components/devices/TransferTenantModal';
import { PrivacyPasswordManageModal } from '@/components/devices/PrivacyPasswordManageModal';
import { CustomSectionTab } from '@/components/devices/CustomSectionTab';
import { ThresholdsEditor } from '@/components/common/ThresholdsEditor';
import { PerDiskThresholdsEditor } from '@/components/common/PerDiskThresholdsEditor';
import { SYSTEM_DEFAULT_THRESHOLDS } from '@obliance/shared';
import type { CustomSection } from '@obliance/shared';
import { getSocket } from '@/socket/socketClient';
import { inventoryApi } from '@/api/inventory.api';
import { hypervApi } from '@/api/hyperv.api';
import { HyperVVmTable } from '@/components/hyperv/HyperVVmTable';
import { EditVmModal, CreateVmModal, CheckpointModal } from '@/components/hyperv/HyperVModals';
import { veeamApi } from '@/api/veeam.api';
import { BackupJobTable } from '@/components/veeam/BackupJobTable';
import { commandApi } from '@/api/command.api';
import { deviceApi } from '@/api/device.api';
import { scriptApi } from '@/api/script.api';
import { updateApi } from '@/api/update.api';
import { complianceApi } from '@/api/compliance.api';
import { softwareComplianceApi } from '@/api/softwareCompliance.api';
import { licenseApi } from '@/api/license.api';
import { remoteApi, type ObliReachSession } from '@/api/remote.api';
// SshTerminalModal is no longer used directly — shell sessions live in
// the global multi-session panel (components/layout/GlobalShellPanel).
import { ObliReachViewer } from '@/components/ObliReachViewer';
import { useChatStore } from '@/store/chatStore';
import { useDeviceStore } from '@/store/deviceStore';
import { useTenantStore } from '@/store/tenantStore';
import { DeviceStatusBadge } from '@/components/devices/DeviceStatusBadge';
import { DeviceMetricsBar } from '@/components/devices/DeviceMetricsBar';
import { OsIcon } from '@/components/devices/OsIcon';
import FileExplorerTab from '@/components/devices/FileExplorerTab';
import RewindTab from '@/components/devices/RewindTab';
import { DeviceCvesSection } from '@/components/devices/DeviceCvesSection';
import type { Device, HardwareInventory, SoftwareEntry, Script, ScriptExecution, ScriptSchedule, DeviceUpdate, ComplianceResult, CompliancePolicy, RemoteSession, Command, ServiceInfo, ProcessInfo, DeviceLicense, SoftwareComplianceResult, SoftwareComplianceEntryResult, MetricThresholds, DeviceMetricsHistory } from '@obliance/shared';
import { SocketEvents } from '@obliance/shared';
import { useTranslation } from 'react-i18next';
import { anonymize, anonymizeIp, anonymizeMac } from '@/utils/anonymize';
import { isAgentReachable } from '@/utils/deviceStatus';
import { isCommandSupported, unsupportedTooltip } from '@/utils/capabilities';
import { mergeById } from '@/utils/mergeById';
import { TenantBadge } from '@/components/common/TenantBadge';
import toast from 'react-hot-toast';
import { clsx } from 'clsx';

type Tab = 'overview' | 'rewind' | 'inventory' | 'scripts' | 'updates' | 'compliance' | 'remote' | 'files' | 'services' | 'processes' | 'commands' | 'hyperv' | 'veeam' | 'settings' | `cs:${number}`;

const TABS: Array<{ id: Tab; label: string; icon: any }> = [
 { id: 'overview', label: 'Overview', icon: Monitor },
 { id: 'rewind', label: 'Rewind', icon: Rewind },
 { id: 'inventory', label: 'Inventory', icon: HardDrive },
 { id: 'scripts', label: 'Scripts', icon: Terminal },
 { id: 'updates', label: 'Updates', icon: Package },
 { id: 'compliance', label: 'Compliance', icon: ShieldCheck },
 { id: 'remote', label: 'Remote', icon: MonitorPlay },
 { id: 'files', label: 'Explorer', icon: FolderOpen },
 { id: 'services', label: 'Services', icon: Server },
 { id: 'processes', label: 'Processes', icon: Activity },
 { id: 'commands', label: 'Tasks', icon: History },
 { id: 'settings', label: 'Settings', icon: Settings },
];

// ─── Last-seen pill ─────────────────────────────────────────────────────────
//
// Glanceable badge next to the status in the device header. Shows the
// relative delay ("5m", "2h", "3d") colour-coded on the same thresholds
// the device list uses, so the two views agree at a glance.

function LastSeenPill({ lastSeenAt }: { lastSeenAt: string | null }) {
 // Tick the component every 30 s so the relative-time label drifts on its
 // own — without this the pill is computed once at first render and the
 // user sees "1m" even after sitting on the page for 5 minutes (then a
 // manual refresh resets it). Pairs with the metrics-push handler in
 // useSocket.ts which also advances `device.lastSeenAt` on every push,
 // so an actively talking agent shows "1m" continuously.
 const [, setTick] = useState(0);
 useEffect(() => {
 const id = window.setInterval(() => setTick((n) => n + 1), 30_000);
 return () => window.clearInterval(id);
 }, []);

 if (!lastSeenAt) {
 return (
 <span
 className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-bg-tertiary text-text-muted border border-transparent"
 title="Never seen"
 >
 <Clock className="w-3 h-3" />
 —
 </span>
 );
 }
 const date = new Date(lastSeenAt);
 const diffMs = Date.now() - date.getTime();
 const mins = Math.floor(diffMs / 60_000);
 const hours = Math.floor(diffMs / 3_600_000);
 const days = Math.floor(diffMs / 86_400_000);

 let text: string;
 let color: string;
 if (mins < 5) {
 text = `${Math.max(mins, 1)}m`;
 color = 'bg-green-400/10 text-green-400 border-green-400/30';
 } else if (mins < 60) {
 text = `${mins}m`;
 color = 'bg-yellow-400/10 text-yellow-400 border-yellow-400/30';
 } else if (hours < 24) {
 text = `${hours}h`;
 color = 'bg-orange-400/10 text-orange-400 border-orange-400/30';
 } else {
 text = `${days}d`;
 color = 'bg-red-400/10 text-red-400 border-red-400/30';
 }

 return (
 <span
 className={clsx(
 'inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full border',
 color,
 )}
 title={`Last seen ${date.toLocaleString()}`}
 >
 <Clock className="w-3 h-3" />
 {text}
 </span>
 );
}

// ─── Copy-to-clipboard icon button ──────────────────────────────────────────
//
// Small helper for identifiers (UUID, keys, IPs) that are truncated on narrow
// screens: a tap copies the full value (toast on success / failure).

function CopyValueButton({ value, className }: { value: string; className?: string }) {
 const { t } = useTranslation();
 return (
 <IconButton
 label={t('common.copy', 'Copy')}
 icon={<Copy className="w-3.5 h-3.5" />}
 size="xs"
 className={clsx('shrink-0', className)}
 onClick={async (e) => {
 e.stopPropagation();
 const ok = await copyText(value);
 if (ok) toast.success(t('common.copied', 'Copied!'));
 else toast.error(t('common.error', 'Error'));
 }}
 />
 );
}

// ─── Disabled-reason tooltip ────────────────────────────────────────────────
//
// Mouse devices keep the native title= tooltip (desktop unchanged); on touch
// the disabled control is wrapped in a <Tip> so a tap explains WHY it is
// greyed out (agent offline, legacy agent, privacy mode…).

function DisabledTip({ reason, children, className }: {
 reason?: string | null | false;
 children: React.ReactElement<{ title?: string }>;
 className?: string;
}) {
 const canHover = useCanHover();
 if (!reason) return children;
 // Mouse: keep the control's own title when it has one (desktop tooltip
 // text unchanged), otherwise surface the reason as the native tooltip.
 if (canHover) return children.props.title ? children : cloneElement(children, { title: reason });
 return <Tip content={reason} className={className}>{children}</Tip>;
}

// ─── Duplicate agent ID banner ──────────────────────────────────────────────
//
// Surfaces when the server has flagged this device's agent_id as likely
// shared by multiple physical machines (typical VM-cloning symptom: the
// machine_uuid is identical across two boxes, so every push from either
// machine lands on the same `devices` row and the row's hostname/IP
// "flicker" between the two values).
//
// The fingerprint history makes the duplication obvious — when an admin
// sees `host-A @ 10.0.0.5` and `host-B @ 10.0.0.6` alternating every
// few minutes, they know to regen machine-id on the affected boxes
// (the seeded "Regen Linux machine-id" system script does this in one
// click). Acknowledge trims the buffer so the warning re-fires only if
// alternation keeps happening.

function DuplicateAgentIdBanner({
 device,
 onAcknowledged,
}: {
 device: Device;
 onAcknowledged: () => void | Promise<void>;
}) {
 const { t } = useTranslation();
 const [expanded, setExpanded] = useState(false);
 const [acking, setAcking] = useState(false);
 const fps = Array.isArray(device.identityFingerprints) ? device.identityFingerprints : [];
 const distinctHosts = Array.from(new Set(fps.map((f) => f.hostname).filter(Boolean))) as string[];

 const handleAcknowledge = async () => {
 setAcking(true);
 try {
 await deviceApi.acknowledgeDuplicateAgentId(device.id);
 toast.success(t('duplicateAgentId.toastAcknowledged') || 'Warning dismissed');
 await onAcknowledged();
 } catch {
 toast.error(t('common.error') || 'Something went wrong');
 } finally {
 setAcking(false);
 }
 };

 return (
 <div className="rounded-lg border border-amber-400/40 bg-amber-500/10 text-amber-200">
 <div className="flex items-start gap-3 px-4 py-3 max-sm:flex-wrap">
 <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
 <div className="flex-1 min-w-0">
 <p className="text-sm font-semibold">
 {t('duplicateAgentId.bannerTitle') || 'Duplicate agent ID suspected'}
 </p>
 <p className="text-xs text-amber-200/80 mt-0.5">
 {distinctHosts.length >= 2
 ? (t('duplicateAgentId.bannerHostList', { hosts: distinctHosts.slice(0, 5).join(', '), count: distinctHosts.length })
 || `Multiple hostnames seen on this agent ID: ${distinctHosts.slice(0, 5).join(', ')}`)
 : (t('duplicateAgentId.bannerGeneric')
 || 'Multiple machines appear to share this agent ID (hostname / IP / MAC alternates between pushes).')}
 </p>
 <p className="text-xs text-amber-200/70 mt-1">
 {t('duplicateAgentId.bannerHint')
 || 'Fix: run the built-in "Regen Linux machine-id" script on each affected device, then delete the stale entry from the admin panel.'}
 </p>
 </div>
 <div className="flex items-center gap-2 shrink-0 max-sm:w-full max-sm:justify-end">
 <button
 onClick={() => setExpanded((v) => !v)}
 className="px-2 py-1 text-xs font-medium rounded-md border border-amber-400/40 hover:bg-amber-500/20 transition-colors coarse:min-h-10"
 >
 {expanded
 ? (t('duplicateAgentId.hideHistory') || 'Hide history')
 : (t('duplicateAgentId.showHistory', { count: fps.length }) || `History (${fps.length})`)}
 </button>
 <button
 onClick={handleAcknowledge}
 disabled={acking}
 className="px-2 py-1 text-xs font-medium rounded-md bg-amber-500/30 hover:bg-amber-500/40 border border-amber-400/40 transition-colors disabled:opacity-50 coarse:min-h-10"
 >
 {acking
 ? (t('common.processing', 'Working…'))
 : (t('duplicateAgentId.acknowledge') || 'Acknowledge')}
 </button>
 </div>
 </div>

 {expanded && fps.length > 0 && (
 <div className="border-t border-amber-400/30 px-4 py-3 bg-amber-500/5">
 <p className="text-xs font-semibold text-amber-200 mb-2">
 {t('duplicateAgentId.observedHeading') || 'Observed identities (most recent first)'}
 </p>
 <ul className="space-y-1 text-xs font-mono">
 {fps.slice().reverse().map((f, idx) => (
 <li key={`${f.observedAt}-${idx}`} className="flex items-center gap-3 text-amber-100/90 max-sm:flex-wrap max-sm:gap-y-0">
 <span className="text-amber-200/70 shrink-0 w-32">
 {new Date(f.observedAt).toLocaleString()}
 </span>
 <span className="truncate">
 {anonymize(f.hostname || '—')}
 <span className="text-amber-200/60"> @ </span>
 {anonymizeIp(f.ipLocal || '—')}
 {f.mac && (
 <span className="text-amber-200/60"> · {anonymizeMac(f.mac)}</span>
 )}
 </span>
 </li>
 ))}
 </ul>
 </div>
 )}
 </div>
 );
}

// ─── Note banner ────────────────────────────────────────────────────────────
//
// Obliview-style inline note: invisible until there's a note OR the
// admin is editing. Sits directly under the info line in the header
// as a rose-tinted full-width banner — no big textarea card, no
// permanent "Add note" button eating the header. The affordance to
// CREATE a note lives in the info line itself (hover-only, rendered
// by the parent).

function NoteBanner({
 description,
 editing,
 draft,
 onDraftChange,
 onStart,
 onSave,
 onCancel,
 onDelete,
}: {
 description: string | null;
 editing: boolean;
 draft: string;
 onDraftChange: (v: string) => void;
 onStart: () => void;
 onSave: () => void;
 onCancel: () => void;
 onDelete: () => void;
}) {
 const { t } = useTranslation();
 const hasNote = !!description && description.trim().length > 0;
 if (!editing && !hasNote) return null;

 if (editing) {
 return (
 <div className="mt-2 flex items-start gap-2 p-2 rounded-md bg-rose-500/10 border border-rose-500/30">
 <StickyNote className="w-3.5 h-3.5 text-rose-400 flex-shrink-0 mt-0.5" />
 <textarea
 autoFocus
 value={draft}
 onChange={(e) => onDraftChange(e.target.value)}
 onKeyDown={(e) => {
 if (e.key === 'Escape') onCancel();
 if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) onSave();
 }}
 rows={2}
 placeholder={t('deviceDetail.note.placeholder', 'Add a note about this device...')}
 className="flex-1 min-w-0 px-2 py-1 text-xs bg-bg-primary rounded text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent resize-none"
 />
 <div className="flex flex-col gap-1 flex-shrink-0">
 <IconButton
 onClick={onSave}
 size="sm"
 variant="plain"
 className="text-green-400 hover:text-green-400 hover:bg-bg-secondary"
 label={t('deviceDetail.note.save', 'Save (Ctrl+Enter)')}
 icon={<Check className="w-3.5 h-3.5" />}
 />
 <IconButton
 onClick={onCancel}
 size="sm"
 variant="plain"
 className="hover:bg-bg-secondary"
 label={t('deviceDetail.note.cancel', 'Cancel (Esc)')}
 icon={<X className="w-3.5 h-3.5" />}
 />
 {description && (
 <IconButton
 onClick={onDelete}
 size="sm"
 variant="plain"
 className="text-rose-400 hover:text-rose-300 hover:bg-bg-secondary"
 label={t('deviceDetail.note.delete', 'Delete note')}
 icon={<Trash2 className="w-3.5 h-3.5" />}
 />
 )}
 </div>
 </div>
 );
 }

 return (
 <button
 onClick={onStart}
 className="mt-2 w-full flex items-start gap-2 px-2 py-1.5 rounded-md bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300 hover:bg-rose-500/15 transition-colors text-left"
 title={t('deviceDetail.note.edit', 'Edit note')}
 >
 <StickyNote className="w-3.5 h-3.5 text-rose-400 flex-shrink-0 mt-0.5" />
 <span className="flex-1 whitespace-pre-wrap break-words">{description}</span>
 </button>
 );
}

// ─── Overview Tab ──────────────────────────────────────────────────────────────

// Per-device metric history (avg/peak/delta over 24h·7j·30j) from the
// pre-aggregated buckets. Sits below "Live Metrics" in the Overview tab.
function MetricsHistorySection({ deviceId }: { deviceId: number }) {
  const { t } = useTranslation();
  const [hist, setHist] = useState<DeviceMetricsHistory | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    deviceApi.getMetricsHistory(deviceId)
      .then((h) => { if (active) setHist(h); })
      .catch(() => { if (active) setHist(null); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [deviceId]);

  if (loading || !hist) return null;

  const windows = [
    { key: '1h' as const, label: '1H' },
    { key: '24h' as const, label: '24h' },
    { key: '7d' as const, label: '7j' },
    { key: '30d' as const, label: '30j' },
  ];
  const pct = (n: number | null) => (n == null ? '—' : `${n}%`);

  const hasCpuRam = (['1h', '24h', '7d', '30d'] as const).some((w) => hist.cpu[w].avg != null);
  const hasData = hasCpuRam || hist.disks.length > 0;

  // Signed value with a red/green "graph" arrow. Rising = red (resource filling
  // up / load climbing), falling = green, flat = muted.
  const DeltaValue = ({ value, suffix, threshold = 0.05 }: { value: number | null; suffix?: string; threshold?: number }) => {
    if (value == null) return <span className="text-text-muted">—</span>;
    const up = value > threshold, down = value < -threshold;
    const Icon = up ? TrendingUp : down ? TrendingDown : Minus;
    return (
      <span className={clsx('inline-flex items-center justify-end gap-1 font-mono tabular-nums', up ? 'text-red-400' : down ? 'text-green-400' : 'text-text-muted')}>
        <Icon className="w-3 h-3 shrink-0" />
        {value > 0 ? '+' : ''}{value}{suffix}
      </span>
    );
  };
  const MetricCard = ({ title, accent, data }: { title: string; accent: string; data: DeviceMetricsHistory['cpu'] }) => (
    <div className="p-3 bg-bg-tertiary rounded-lg">
      <span className={clsx('text-xs font-semibold', accent)}>{title}</span>
      <table className="w-full text-xs mt-2">
        <thead>
          <tr className="text-text-muted">
            <th className="text-left font-medium pb-1"></th>
            {windows.map((w) => <th key={w.key} className="text-right font-medium pb-1">{w.label}</th>)}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="text-text-muted py-0.5 pr-2">{t('deviceHistory.avg') || 'Moyenne'}</td>
            {windows.map((w) => <td key={w.key} className="text-right font-mono text-text-primary tabular-nums">{pct(data[w.key].avg)}</td>)}
          </tr>
          {/* Δ per window = this window's average vs the NEXT-longer window
              (1H↔24h, 24h↔7j, 7j↔30j) → "where am I right now vs the broader trend". */}
          <tr title={t('deviceHistory.deltaHint') || 'Écart de la moyenne vs la tranche plus longue'}>
            <td className="text-text-muted/60 py-0.5 pr-2 text-[10px]">Δ</td>
            {windows.map((w, i) => {
              const next = windows[i + 1];
              const a = data[w.key].avg;
              const b = next ? data[next.key].avg : null;
              const d = (a != null && b != null) ? Math.round((a - b) * 10) / 10 : null;
              return (
                <td key={w.key} className="text-right text-[10px]">
                  {next && d != null ? <DeltaValue value={d} suffix="pt" threshold={0.5} /> : <span className="text-text-muted/40">—</span>}
                </td>
              );
            })}
          </tr>
          <tr>
            <td className="text-text-muted py-0.5 pr-2">{t('deviceHistory.peak') || 'Pic'}</td>
            {windows.map((w) => <td key={w.key} className="text-right font-mono text-text-primary tabular-nums">{pct(data[w.key].peak)}</td>)}
          </tr>
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="p-4 bg-bg-secondary rounded-xl space-y-3">
      <h3 className="text-sm font-semibold text-text-muted uppercase tracking-wide">{t('deviceHistory.title') || 'Historique'}</h3>
      {!hasData ? (
        <p className="text-xs text-text-muted">{t('deviceHistory.empty') || "Pas encore de données — l'historique se remplit au fil des remontées de l'agent."}</p>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <MetricCard title={t('deviceHistory.cpu') || 'CPU'} accent="text-cyan-400" data={hist.cpu} />
            <MetricCard title={t('deviceHistory.ram') || 'RAM'} accent="text-violet-400" data={hist.ram} />
          </div>

          {hist.disks.length > 0 && (
            <div className="p-3 bg-bg-tertiary rounded-lg">
              <span className="text-xs font-semibold text-amber-400">{t('deviceHistory.disksTitle') || 'Disques (par volume)'}</span>
              <div className="overflow-x-auto mt-2">
                <table className="w-full text-xs max-sm:min-w-[460px]">
                  <thead>
                    <tr className="text-text-muted">
                      <th className="text-left font-medium pb-1 pr-2">{t('deviceHistory.volume') || 'Volume'}</th>
                      <th className="text-right font-medium pb-1 px-2">{t('deviceHistory.used') || 'Utilisé'}</th>
                      <th className="text-right font-medium pb-1 px-2">{t('deviceHistory.peak') || 'Pic'} 30j</th>
                      <th className="text-right font-medium pb-1 px-2">Δ 1H</th>
                      <th className="text-right font-medium pb-1 px-2">Δ 24h</th>
                      <th className="text-right font-medium pb-1 px-2">Δ 7j</th>
                      <th className="text-right font-medium pb-1 pl-2">Δ 30j</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hist.disks.map((d) => (
                      <tr key={d.mount}>
                        <td className="text-text-primary py-0.5 pr-2 font-medium truncate max-w-[120px]" title={d.mount}>{d.mount}</td>
                        <td className="text-right font-mono text-text-primary tabular-nums px-2">
                          {d.usedGb ?? '—'} / {d.totalGb ?? '—'} Go
                        </td>
                        <td className="text-right font-mono text-text-muted tabular-nums px-2">{pct(d.windows['30d'].peakPct)}</td>
                        <td className="px-2"><DeltaValue value={d.windows['1h'].deltaGb} suffix=" Go" /></td>
                        <td className="px-2"><DeltaValue value={d.windows['24h'].deltaGb} suffix=" Go" /></td>
                        <td className="px-2"><DeltaValue value={d.windows['7d'].deltaGb} suffix=" Go" /></td>
                        <td className="pl-2"><DeltaValue value={d.windows['30d'].deltaGb} suffix=" Go" /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function OverviewTab({ device }: { device: Device; onSaved: () => void }) {
 const metrics = device.latestMetrics;

 // Custom metrics (script-driven)
 const [customMetrics, setCustomMetrics] = useState<Array<{ id: number; scheduleId: number; name: string; value: string; unit: string | null; status: string; updatedAt: string }>>([]);
 useEffect(() => {
 let cancelled = false;
 deviceApi.listCustomMetrics(device.id).then((list) => {
 if (!cancelled) setCustomMetrics(list as any);
 }).catch(() => {});
 return () => { cancelled = true; };
 }, [device.id]);

 // Live update via socket
 useEffect(() => {
 const socket = getSocket();
 if (!socket) return;
 const handler = (msg: { deviceId: number; scheduleId: number; name?: string; value?: string; unit?: string | null; status?: string }) => {
 if (msg.deviceId !== device.id) return;
 setCustomMetrics((prev) => {
 const idx = prev.findIndex((m) => m.scheduleId === msg.scheduleId);
 if (idx >= 0) {
 const next = [...prev];
 next[idx] = { ...next[idx], name: msg.name ?? next[idx].name, value: msg.value ?? next[idx].value, unit: msg.unit ?? next[idx].unit, status: msg.status ?? next[idx].status, updatedAt: new Date().toISOString() };
 return next;
 }
 if (msg.value !== undefined && msg.name) {
 return [...prev, { id: Date.now(), scheduleId: msg.scheduleId, name: msg.name, value: msg.value, unit: msg.unit ?? null, status: msg.status ?? 'ok', updatedAt: new Date().toISOString() }];
 }
 return prev;
 });
 };
 socket.on('CUSTOM_METRIC_UPDATED', handler);
 return () => { socket.off('CUSTOM_METRIC_UPDATED', handler); };
 }, [device.id]);

 return (
 <div className="space-y-6">
 {/* Device info */}
 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
 <div className="p-4 bg-bg-secondary rounded-xl space-y-3">
 <h3 className="text-sm font-semibold text-text-muted uppercase tracking-wide">Identity</h3>
 <dl className="space-y-2">
 {[
 ['Hostname', anonymize(device.hostname)],
 ['Display Name', anonymize(device.displayName) || '—'],
 ['OS', device.osName ?? device.osType],
 ['OS Version', device.osVersion ?? '—'],
 ['Architecture', device.osArch ?? '—'],
 ['Agent Version', device.agentVersion ?? '—'],
 ['Last Logged In', anonymize(device.lastLoggedInUser) || '—'],
 ['Agent UUID', device.uuid ?? '—'],
 ].map(([k, v]) => (
 <div key={k} className="flex justify-between gap-2 text-sm">
 <dt className="text-text-muted shrink-0">{k}</dt>
 {k === 'Agent UUID' && device.uuid ? (
 // Full UUID wraps below lg (no hover tooltip on touch) and gets a
 // tap-to-copy button on touch devices; desktop keeps the truncated
 // cell + title tooltip.
 <dd className="min-w-0 flex items-center gap-1 text-text-primary font-medium">
 <span className="truncate font-mono text-xs max-lg:whitespace-normal max-lg:break-all max-lg:text-right" title={v as string}>{v}</span>
 <CopyValueButton value={device.uuid} className="hidden coarse:inline-flex" />
 </dd>
 ) : (
 <dd className="text-text-primary font-medium truncate">{v}</dd>
 )}
 </div>
 ))}
 </dl>
 </div>
 <div className="p-4 bg-bg-secondary rounded-xl space-y-3">
 <h3 className="text-sm font-semibold text-text-muted uppercase tracking-wide">Network</h3>
 <dl className="space-y-2">
 {[
 ['Local IP', anonymizeIp(device.ipLocal) || '—'],
 ['Public IP', anonymizeIp(device.ipPublic) || '—'],
 ['MAC Address', anonymizeMac(device.macAddress) || '—'],
 ['Timezone', device.timezone ?? '—'],
 ['Location', device.geoCity ? `${device.geoCity}, ${device.geoRegion ?? ''} ${device.geoCountry ?? ''}`.trim() : '—'],
 ].map(([k, v]) => (
 <div key={k} className="flex justify-between text-sm max-lg:gap-2">
 <dt className="text-text-muted max-lg:shrink-0">{k}</dt>
 <dd className="text-text-primary font-mono text-xs max-lg:min-w-0 max-lg:break-all max-lg:text-right">{v}</dd>
 </div>
 ))}
 </dl>
 </div>
 {/* Notes card removed — replaced by the rose NotePill in the
 page header (inline edit, keeps the overview compact). */}
 </div>

 {/* Metrics */}
 {(metrics || customMetrics.length > 0) && (
 <div className="p-4 bg-bg-secondary rounded-xl space-y-3">
 <h3 className="text-sm font-semibold text-text-muted uppercase tracking-wide">Live Metrics</h3>
 {metrics && <DeviceMetricsBar metrics={metrics} />}
 {customMetrics.length > 0 && (
 <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 pt-1">
 {customMetrics.map((m) => {
 const statusColor =
 m.status === 'critical' ? 'border-red-400/40 text-red-400' :
 m.status === 'warning' ? 'border-yellow-400/40 text-yellow-400' :
 m.status === 'error' ? 'border-gray-400/40 text-gray-400' :
 'border-cyan-400/40 text-cyan-400';
 return (
 <div key={m.id} className={clsx('p-2.5 bg-bg-tertiary border rounded-lg', statusColor)}>
 <p className="text-[10px] text-text-muted uppercase tracking-wide truncate" title={m.name}>{m.name}</p>
 <p className="text-sm font-mono font-semibold truncate" title={`${m.value}${m.unit ? ' ' + m.unit : ''}`}>
 {m.value}
 {m.unit && <span className="text-[11px] text-text-muted ml-1">{m.unit}</span>}
 </p>
 <p className="text-[9px] text-text-muted/70">
 {new Date(m.updatedAt).toLocaleTimeString()}
 </p>
 </div>
 );
 })}
 </div>
 )}
 </div>
 )}

 {/* Metric history — avg/peak/delta over 24h·7j·30j (pre-aggregated buckets) */}
 <MetricsHistorySection deviceId={device.id} />

 {/* Quick info cards */}
 <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
 <div className="p-3 bg-bg-secondary rounded-xl flex items-center gap-2.5">
 <Clock className="w-4 h-4 text-rose-400 shrink-0" />
 <div className="min-w-0">
 <p className="text-[10px] text-text-muted uppercase tracking-wide">Last Seen</p>
 <p className="text-xs text-text-primary font-medium truncate">
 {device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString() : '—'}
 </p>
 </div>
 </div>
 <div className={clsx('p-3 border rounded-xl flex items-center gap-2.5', device.rebootPending ? 'bg-orange-500/5 border-orange-500/30' : 'bg-bg-secondary border-transparent')}>
 <Power className={clsx('w-4 h-4 shrink-0', device.rebootPending ? 'text-orange-400' : 'text-orange-400')} />
 <div className="min-w-0">
 <p className="text-[10px] text-text-muted uppercase tracking-wide">Last Reboot</p>
 <p className="text-xs text-text-primary font-medium truncate">
 {device.lastRebootAt ? new Date(device.lastRebootAt).toLocaleString() : '—'}
 </p>
 {device.rebootPending && (
 <p className="text-[10px] text-orange-400 font-medium">Restart required</p>
 )}
 </div>
 </div>
 <div className="p-3 bg-bg-secondary rounded-xl flex items-center gap-2.5">
 <Plus className="w-4 h-4 text-blue-400 shrink-0" />
 <div className="min-w-0">
 <p className="text-[10px] text-text-muted uppercase tracking-wide">Added</p>
 <p className="text-xs text-text-primary font-medium truncate">
 {new Date(device.createdAt).toLocaleDateString()}
 </p>
 </div>
 </div>
 <div className="p-3 bg-bg-secondary rounded-xl flex items-center gap-2.5">
 <Cpu className="w-4 h-4 text-cyan-400 shrink-0" />
 <div className="min-w-0">
 <p className="text-[10px] text-text-muted uppercase tracking-wide">CPU</p>
 <p className="text-xs text-text-primary font-medium truncate" title={device.cpuModel ?? undefined}>{device.cpuModel ?? '—'}</p>
 {device.cpuCores && <p className="text-[10px] text-text-muted">{device.cpuCores} cores</p>}
 </div>
 </div>
 <div className="p-3 bg-bg-secondary rounded-xl flex items-center gap-2.5">
 <MemoryStick className="w-4 h-4 text-green-400 shrink-0" />
 <div className="min-w-0">
 <p className="text-[10px] text-text-muted uppercase tracking-wide">RAM</p>
 <p className="text-xs text-text-primary font-medium">{device.ramTotalGb ? `${device.ramTotalGb} GB` : '—'}</p>
 </div>
 </div>
 </div>

 {/* Asset Management */}
 <div className="p-4 bg-bg-secondary rounded-xl">
 <h4 className="text-sm font-semibold text-text-muted mb-3">Asset Management</h4>
 <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
 <div>
 <span className="text-[10px] text-text-muted uppercase block mb-1">Purchase Date</span>
 <span className="text-sm text-text-primary">{device.purchaseDate ? new Date(device.purchaseDate).toLocaleDateString() : '—'}</span>
 </div>
 <div>
 <span className="text-[10px] text-text-muted uppercase block mb-1">Warranty</span>
 <span className={clsx('text-sm font-medium',
 device.warrantyStatus === 'active' ? 'text-green-400' :
 device.warrantyStatus === 'expired' ? 'text-red-400' : 'text-text-muted'
 )}>
 {device.warrantyStatus === 'active' ? 'Active' : device.warrantyStatus === 'expired' ? 'Expired' : 'Unknown'}
 {device.warrantyExpiry && ` (${new Date(device.warrantyExpiry).toLocaleDateString()})`}
 </span>
 </div>
 <div>
 <span className="text-[10px] text-text-muted uppercase block mb-1">Device Age</span>
 <span className="text-sm text-text-primary">
 {device.purchaseDate ? `${Math.floor((Date.now() - new Date(device.purchaseDate).getTime()) / (365.25 * 86400000))} years` : '—'}
 </span>
 </div>
 <div>
 <span className="text-[10px] text-text-muted uppercase block mb-1">Lifecycle</span>
 <span className={clsx('text-xs px-2 py-0.5 rounded-full border font-medium',
 device.lifecycleStatus === 'active' ? 'text-green-400 bg-green-400/10 border-green-400/30' :
 device.lifecycleStatus === 'aging' ? 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30' :
 device.lifecycleStatus === 'end_of_life' ? 'text-red-400 bg-red-400/10 border-red-400/30' :
 'text-text-muted bg-bg-tertiary border-transparent'
 )}>
 {device.lifecycleStatus ?? 'Unknown'}
 </span>
 </div>
 </div>
 </div>

 {/* Tags now live inline next to the status pill at the top of
 the page (see header section). The duplicate row that used
 to sit here was removed to declutter the overview tab. */}
 </div>
 );
}

// ─── Disk health (SMART) ─────────────────────────────────────────────────────

function DiskHealthBadge({ status }: { status: string }) {
 const { t } = useTranslation();
 const map: Record<string, { cls: string; label: string }> = {
 good: { cls: 'text-green-400 bg-green-400/10 border-green-400/30', label: t('diskHealth.status.good') || 'Bon' },
 caution: { cls: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30', label: t('diskHealth.status.caution') || 'À surveiller' },
 bad: { cls: 'text-red-400 bg-red-400/10 border-red-400/30', label: t('diskHealth.status.bad') || 'Critique' },
 unknown: { cls: 'text-gray-400 bg-gray-400/10 border-gray-400/30', label: t('diskHealth.status.unknown') || 'Inconnu' },
 };
 const m = map[status] ?? map.unknown;
 return <span className={clsx('text-[10px] px-1.5 py-0.5 rounded-full border font-medium shrink-0', m.cls)}>{m.label}</span>;
}

/** Per-disk SMART health, fed by a scheduled metric script (not the agent).
 *  Renders nothing when there's no data (old agent / no script deployed / disks
 *  that don't expose SMART) — so it's purely additive. */
function DiskHealthPanel({ deviceId }: { deviceId: number }) {
 const { t } = useTranslation();
 const [disks, setDisks] = useState<import('@obliance/shared').SmartDisk[]>([]);
 const load = useCallback(() => { deviceApi.getDiskHealth(deviceId).then(setDisks).catch(() => {}); }, [deviceId]);
 useEffect(() => { load(); }, [load]);
 useEffect(() => {
 const socket = getSocket();
 if (!socket) return;
 const onUpd = (msg: { deviceId: number }) => { if (msg.deviceId === deviceId) load(); };
 socket.on('DISK_HEALTH_UPDATED', onUpd);
 return () => { socket.off('DISK_HEALTH_UPDATED', onUpd); };
 }, [deviceId, load]);

 if (disks.length === 0) return null;

 return (
 <div className="p-4 bg-bg-secondary rounded-xl md:col-span-2">
 <h4 className="text-sm font-semibold text-text-muted mb-3 flex items-center gap-2">
 <HardDrive className="w-4 h-4" />{t('diskHealth.title') || 'Santé disque (SMART)'}
 </h4>
 <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
 {disks.map((d) => (
 <div key={d.id} className="p-3 rounded-lg bg-bg-tertiary/40">
 <div className="flex items-center justify-between gap-2 mb-2">
 <span className="text-sm font-medium text-text-primary truncate" title={d.serial}>{d.model || d.serial || '—'}</span>
 <DiskHealthBadge status={d.status} />
 </div>
 <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-text-muted">
 {d.diskType && <span>{t('diskHealth.type') || 'Type'}: <span className="text-text-primary">{d.diskType}</span></span>}
 {d.temperatureC != null && <span>{t('diskHealth.temp') || 'Température'}: <span className="text-text-primary">{d.temperatureC}°C</span></span>}
 {d.healthPercent != null && <span>{t('diskHealth.health') || 'Santé'}: <span className="text-text-primary">{d.healthPercent}%</span></span>}
 {d.wearPercent != null && <span>{t('diskHealth.wear') || 'Usure'}: <span className="text-text-primary">{d.wearPercent}%</span></span>}
 {d.powerOnHours != null && <span>{t('diskHealth.poh') || 'Heures d\'allumage'}: <span className="text-text-primary">{d.powerOnHours} h</span></span>}
 {d.reallocatedSectors != null && d.reallocatedSectors > 0 && <span className="text-yellow-400">{t('diskHealth.reallocated') || 'Secteurs réalloués'}: {d.reallocatedSectors}</span>}
 {d.pendingSectors != null && d.pendingSectors > 0 && <span className="text-red-400">{t('diskHealth.pending') || 'Secteurs en attente'}: {d.pendingSectors}</span>}
 </div>
 </div>
 ))}
 </div>
 </div>
 );
}

// ─── Inventory Tab ──────────────────────────────────────────────────────────────

function InventoryTab({ deviceId, agentFlavor }: { deviceId: number; agentFlavor: Device['agentFlavor'] }) {
 const { t } = useTranslation();
 const [hardware, setHardware] = useState<HardwareInventory | null>(null);
 const [software, setSoftware] = useState<SoftwareEntry[]>([]);
 const [softwareTotal, setSoftwareTotal] = useState(0);
 const [softwareSearch, setSoftwareSearch] = useState('');
 // Debounced copy of the search box — drives the API call. The visible
 // input updates instantly (so typing is responsive), the request fires
 // 300 ms after the user stops typing. Was: every keystroke flipped
 // isLoading=true, unmounted the table, and refetched hardware too.
 const [debouncedSoftwareSearch, setDebouncedSoftwareSearch] = useState('');
 const [isLoading, setIsLoading] = useState(true);
 // Separate flag for the in-place software refetch so the keystroke-
 // driven query doesn't replace the whole tab with a centered spinner.
 const [softwareLoading, setSoftwareLoading] = useState(false);
 const [activeSection, setActiveSection] = useState<'hardware' | 'software'>('hardware');
 const [licenses, setLicenses] = useState<DeviceLicense[]>([]);
 const [showLicenseForm, setShowLicenseForm] = useState(false);
 const [licenseForm, setLicenseForm] = useState({ softwareName: '', licenseKey: '', licenseType: 'per_device' as string, vendor: '', expiryDate: '', notes: '' });
 const confirm = useConfirm();
 // Touch-only confirm before deleting a license (easy mis-tap on a dense
 // row); desktop with a mouse keeps the historic one-click delete.
 const canHover = useCanHover();

 const loadLicenses = useCallback(() => {
 licenseApi.listForDevice(deviceId).then(setLicenses).catch(() => {});
 }, [deviceId]);
 useEffect(() => { loadLicenses(); }, [loadLicenses]);

 // Debounce the search input. 300 ms feels snappy without hammering
 // the server on every letter; matches the DeviceTable debounce.
 useEffect(() => {
 const t = setTimeout(() => setDebouncedSoftwareSearch(softwareSearch), 300);
 return () => clearTimeout(t);
 }, [softwareSearch]);

 // Hardware fetch runs once per device — never re-fired by a search
 // keystroke. Pulling it out of the search effect was the other half of
 // the "every letter rebuilds the whole tab" bug.
 useEffect(() => {
 let cancelled = false;
 setIsLoading(true);
 inventoryApi.getHardware(deviceId)
 .then((hw) => { if (!cancelled) setHardware(hw); })
 .catch(() => { if (!cancelled) toast.error('Failed to load inventory'); })
 .finally(() => { if (!cancelled) setIsLoading(false); });
 return () => { cancelled = true; };
 }, [deviceId]);

 // Software fetch — re-runs on the debounced search. Uses a local
 // `softwareLoading` flag so the table stays mounted and only the rows
 // dim while the new query is in flight. `setIsLoading` is intentionally
 // NOT touched here.
 useEffect(() => {
 let cancelled = false;
 setSoftwareLoading(true);
 inventoryApi.getSoftware(deviceId, { search: debouncedSoftwareSearch })
 .then((sw) => {
 if (cancelled) return;
 setSoftware(sw.items);
 setSoftwareTotal(sw.total);
 })
 .catch(() => { /* keep the previous list visible on transient failures */ })
 .finally(() => { if (!cancelled) setSoftwareLoading(false); });
 return () => { cancelled = true; };
 }, [deviceId, debouncedSoftwareSearch]);

 const handleScan = async () => {
 try {
 await inventoryApi.triggerScan(deviceId);
 toast.success('Inventory scan queued');
 } catch {
 toast.error('Failed to queue scan');
 }
 };

 if (isLoading) {
 return <div className="flex items-center justify-center h-48"><RefreshCw className="w-5 h-5 animate-spin text-text-muted" /></div>;
 }

 return (
 <div className="space-y-4">
 <div className="flex flex-wrap items-center justify-between gap-2">
 <div className="flex gap-2">
 <button
 onClick={() => setActiveSection('hardware')}
 className={clsx('px-3 py-1.5 text-sm rounded-lg transition-colors coarse:min-h-10', activeSection === 'hardware' ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary hover:bg-bg-tertiary')}
 >
 Hardware
 </button>
 <button
 onClick={() => setActiveSection('software')}
 className={clsx('px-3 py-1.5 text-sm rounded-lg transition-colors coarse:min-h-10', activeSection === 'software' ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary hover:bg-bg-tertiary')}
 >
 Software ({softwareTotal})
 </button>
 </div>
 <DisabledTip reason={isCommandSupported({ agentFlavor }, 'scan_inventory') ? null : unsupportedTooltip(t)}>
 <button
 onClick={handleScan}
 disabled={!isCommandSupported({ agentFlavor }, 'scan_inventory')}
 className="flex items-center gap-2 px-3 py-1.5 text-sm bg-bg-secondary rounded-lg hover:border-accent/50 transition-colors text-text-muted hover:text-text-primary disabled:opacity-40 disabled:cursor-not-allowed coarse:min-h-10"
 >
 <Scan className="w-3.5 h-3.5" />
 Scan now
 </button>
 </DisabledTip>
 </div>

 {activeSection === 'hardware' && hardware && (
 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
 {/* OS Details */}
 {hardware.os && hardware.os.edition && (
 <div className="p-4 bg-bg-secondary rounded-xl md:col-span-2">
 <h4 className="text-sm font-semibold text-text-muted mb-3 flex items-center gap-2"><Monitor className="w-4 h-4" />Operating System</h4>
 <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1.5">
 {[
 ['Edition', hardware.os.edition],
 ['Version', hardware.os.displayVersion ? `${hardware.os.displayVersion}${hardware.os.buildNumber ? ` (${hardware.os.buildNumber})` : ''}` : null],
 hardware.os.windowsKey ? ['Windows Key', hardware.os.windowsKey] : null,
 hardware.os.officeVersion ? ['Office', hardware.os.officeVersion] : null,
 hardware.os.officeKey ? ['Office Key', `XXXXX-XXXXX-XXXXX-XXXXX-${hardware.os.officeKey}`] : null,
 ].filter((x): x is [string, string] => Array.isArray(x) && !!x[1]).map(([k, v]) => (
 <div key={k as string} className="flex justify-between text-sm">
 <dt className="text-text-muted shrink-0 mr-2">{k as string}</dt>
 <dd className="text-text-primary font-medium text-right truncate select-all max-lg:min-w-0 max-lg:whitespace-normal max-lg:break-all">{v as string}</dd>
 {/* Product keys: one-tap copy on touch (select-all needs a mouse). */}
 {k === 'Windows Key' && <CopyValueButton value={v as string} className="hidden coarse:inline-flex ml-1" />}
 </div>
 ))}
 </dl>
 </div>
 )}
 {/* CPU */}
 <div className="p-4 bg-bg-secondary rounded-xl">
 <h4 className="text-sm font-semibold text-text-muted mb-3 flex items-center gap-2"><Cpu className="w-4 h-4" />CPU</h4>
 <p className="text-text-primary">{hardware.cpu.model}</p>
 <p className="text-sm text-text-muted">{hardware.cpu.cores} cores / {hardware.cpu.threads} threads @ {hardware.cpu.speed} GHz</p>
 </div>
 {/* Memory */}
 <div className="p-4 bg-bg-secondary rounded-xl">
 <h4 className="text-sm font-semibold text-text-muted mb-3 flex items-center gap-2"><MemoryStick className="w-4 h-4" />Memory</h4>
 <p className="text-text-primary">{((hardware.memory.total ?? 0) / 1024 / 1024 / 1024).toFixed(1)} GB total</p>
 <div className="mt-2 space-y-1">
 {(hardware.memory.slots ?? []).map((slot, i) => (
 <p key={i} className="text-xs text-text-muted">{slot.bank}: {((slot.size ?? 0) / 1024 / 1024 / 1024).toFixed(0)} GB {slot.type} @ {slot.speed} MHz</p>
 ))}
 </div>
 </div>
 {/* Disks */}
 {(hardware.disks ?? []).length > 0 && (
 <div className="p-4 bg-bg-secondary rounded-xl md:col-span-2">
 <h4 className="text-sm font-semibold text-text-muted mb-3 flex items-center gap-2"><HardDrive className="w-4 h-4" />Disks</h4>
 <div className="space-y-2">
 {(hardware.disks ?? []).map((disk, i) => (
 <div key={i} className="flex items-center gap-3 text-sm max-lg:flex-wrap max-lg:gap-y-0.5">
 <span className="text-text-primary">{disk.model ?? disk.device}</span>
 <span className="text-text-muted text-xs">{disk.type}</span>
 <span className="text-text-muted text-xs">{((disk.size ?? 0) / 1024 / 1024 / 1024).toFixed(0)} GB</span>
 <span className="text-text-muted text-xs">{(disk.mounts ?? []).map((m) => m.mount).join(', ')}</span>
 </div>
 ))}
 </div>
 </div>
 )}
 {/* Disk health (SMART) — additive, hidden when no data */}
 <DiskHealthPanel deviceId={deviceId} />
 {/* GPU */}
 {(hardware.gpu ?? []).length > 0 && (
 <div className="p-4 bg-bg-secondary rounded-xl md:col-span-2">
 <h4 className="text-sm font-semibold text-text-muted mb-3 flex items-center gap-2"><Monitor className="w-4 h-4" />GPU</h4>
 <div className="space-y-2">
 {(hardware.gpu ?? []).map((gpu, i) => (
 <div key={i} className="flex flex-wrap items-center gap-3 text-sm">
 <span className="text-text-primary font-medium">{gpu.name}</span>
 {gpu.vram > 0 && (
 <span className="text-text-muted text-xs">
 {gpu.vram >= 1024 * 1024 * 1024
 ? `${(gpu.vram / 1024 / 1024 / 1024).toFixed(1)} GB VRAM`
 : `${(gpu.vram / 1024 / 1024).toFixed(0)} MB VRAM`}
 </span>
 )}
 {gpu.driver && <span className="text-text-muted text-xs">Driver {gpu.driver}</span>}
 </div>
 ))}
 </div>
 </div>
 )}
 {/* Network Interfaces */}
 {(hardware.networkInterfaces ?? []).length > 0 && (
 <div className="p-4 bg-bg-secondary rounded-xl md:col-span-2">
 <h4 className="text-sm font-semibold text-text-muted mb-3 flex items-center gap-2"><Network className="w-4 h-4" />Network Interfaces</h4>
 <div className="space-y-2">
 {(hardware.networkInterfaces ?? []).map((iface, i) => (
 <div key={i} className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 text-sm">
 <span className="text-text-primary font-medium">{anonymize(iface.name)}</span>
 {iface.mac && <span className="text-text-muted text-xs font-mono">{anonymizeMac(iface.mac)}</span>}
 {iface.type && <span className="text-text-muted text-xs">{iface.type}</span>}
 {(iface.addresses ?? []).length > 0 && (
 <span className="text-text-muted text-xs max-sm:min-w-0 max-sm:break-all">{(iface.addresses ?? []).map(a => anonymizeIp(a)).join(' · ')}</span>
 )}
 </div>
 ))}
 </div>
 </div>
 )}
 {/* Printers */}
 {(hardware.printers ?? []).length > 0 && (
 <div className="p-4 bg-bg-secondary rounded-xl md:col-span-2">
 <h4 className="text-sm font-semibold text-text-muted mb-3 flex items-center gap-2"><Printer className="w-4 h-4" />{t('device.inventory.printers') || 'Printers'}</h4>
 <div className="space-y-2">
 {(hardware.printers ?? []).map((printer, i) => (
 <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
 <span className="text-text-primary font-medium">{printer.name}</span>
 {printer.isDefault && (
 <span className="text-[10px] px-1.5 py-0.5 rounded border text-accent border-accent/30">{t('device.inventory.default') || 'Default'}</span>
 )}
 {printer.isNetwork && (
 <span className="text-[10px] px-1.5 py-0.5 rounded border text-text-muted border-border">{t('device.inventory.network') || 'Network'}</span>
 )}
 {printer.isShared && (
 <span className="text-[10px] px-1.5 py-0.5 rounded border text-text-muted border-border">{t('device.inventory.shared') || 'Shared'}</span>
 )}
 {printer.status && <span className="text-text-muted text-xs">{printer.status}</span>}
 {printer.port && <span className="text-text-muted text-xs">{printer.port}</span>}
 {printer.driver && <span className="text-text-muted text-xs">{printer.driver}</span>}
 </div>
 ))}
 </div>
 </div>
 )}
 {/* COM / serial ports */}
 {(hardware.comPorts ?? []).length > 0 && (
 <div className="p-4 bg-bg-secondary rounded-xl md:col-span-2">
 <h4 className="text-sm font-semibold text-text-muted mb-3 flex items-center gap-2"><Cable className="w-4 h-4" />{t('device.inventory.comPorts') || 'COM Ports'}</h4>
 <div className="space-y-2">
 {(hardware.comPorts ?? []).map((port, i) => (
 <div key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm">
 <span className="text-text-primary font-medium font-mono">{port.port}</span>
 {port.description && <span className="text-text-muted text-xs">{port.description}</span>}
 </div>
 ))}
 </div>
 </div>
 )}
 {/* Motherboard & BIOS */}
 {(hardware.motherboard?.manufacturer || hardware.motherboard?.model || hardware.bios?.vendor || hardware.tpm) && (
 <div className="p-4 bg-bg-secondary rounded-xl md:col-span-2">
 <h4 className="text-sm font-semibold text-text-muted mb-3 flex items-center gap-2"><CircuitBoard className="w-4 h-4" />Motherboard, BIOS & TPM</h4>
 <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1.5">
 {[
 ['Board', [hardware.motherboard?.manufacturer, hardware.motherboard?.model].filter(Boolean).join(' ') || null],
 ['Revision', hardware.motherboard?.version ?? null],
 ['BIOS', hardware.bios?.vendor ? `${hardware.bios.vendor}${hardware.bios.version ? ` · ${hardware.bios.version}` : ''}` : null],
 ['BIOS Date', hardware.bios?.date ?? null],
 ['Serial', hardware.motherboard?.serial ?? null],
 ['TPM', hardware.tpm?.present
 ? `${hardware.tpm.version || hardware.tpm.specVersion || 'Present'} — ${hardware.tpm.status ?? 'Unknown'}${hardware.tpm.manufacturerName ? ` (${hardware.tpm.manufacturerName})` : ''}`
 : hardware.tpm ? 'Not present' : null],
 ].filter(([, v]) => v).map(([k, v]) => (
 <div key={k as string} className="flex justify-between text-sm">
 <dt className="text-text-muted shrink-0 mr-2">{k as string}</dt>
 <dd className="text-text-primary font-medium text-right truncate max-lg:min-w-0 max-lg:whitespace-normal max-lg:break-words">{v as string}</dd>
 </div>
 ))}
 </dl>
 </div>
 )}

 {/* BitLocker */}
 {hardware.bitlocker && hardware.bitlocker.length > 0 && (
 <div className="p-4 bg-bg-secondary rounded-xl md:col-span-2">
 <h4 className="text-sm font-semibold text-text-muted mb-3 flex items-center gap-2"><HardDrive className="w-4 h-4" />BitLocker</h4>
 <div className="space-y-3">
 {hardware.bitlocker.map((vol) => {
 const isInProgress = vol.status === 'EncryptionInProgress' || vol.status === 'DecryptionInProgress';
 const statusLabel = vol.status === 'FullyEncrypted' ? 'Encrypted' :
 vol.status === 'FullyDecrypted' ? 'Decrypted' :
 vol.status === 'EncryptionInProgress' ? 'Encrypting…' :
 vol.status === 'DecryptionInProgress' ? 'Decrypting…' :
 vol.status === 'EncryptionPaused' ? 'Encryption paused' :
 vol.status === 'DecryptionPaused' ? 'Decryption paused' :
 vol.status;
 const statusColor = vol.status === 'FullyEncrypted' ? 'text-green-400 bg-green-400/10 border-green-400/30' :
 vol.status === 'FullyDecrypted' ? 'text-gray-400 bg-gray-400/10 border-gray-400/30' :
 isInProgress ? 'text-blue-400 bg-blue-400/10 border-blue-400/30' :
 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30';
 return (
 <div key={vol.driveLetter} className="space-y-1.5">
 <div className="flex flex-wrap items-center gap-2">
 <span className="text-sm font-medium text-text-primary">{vol.driveLetter}</span>
 <span className={clsx('text-xs px-2 py-0.5 rounded-full border font-medium', statusColor)}>
 {statusLabel}
 </span>
 {vol.protectionStatus && vol.protectionStatus !== 'Unknown' && (
 <span className={clsx('text-[10px] px-1.5 py-0.5 rounded border',
 vol.protectionStatus === 'On' ? 'text-green-400 border-green-400/30' : 'text-orange-400 border-orange-400/30'
 )}>
 Protection {vol.protectionStatus}
 </span>
 )}
 </div>
 {isInProgress && vol.encryptionPercentage != null && (
 <div className="flex items-center gap-2">
 <div className="flex-1 max-w-48 h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
 <div className="h-full bg-blue-400 rounded-full transition-all" style={{ width: `${vol.encryptionPercentage}%` }} />
 </div>
 <span className="text-xs text-blue-400 font-medium tabular-nums">{vol.encryptionPercentage}%</span>
 </div>
 )}
 {vol.recoveryKeys.length > 0 && (
 <div className="space-y-0.5">
 {vol.recoveryKeys.map((key, i) => (
 <div key={i} className="flex items-center gap-2 max-sm:min-w-0">
 <code className="text-xs text-text-muted font-mono bg-bg-tertiary px-2 py-0.5 rounded select-all max-sm:min-w-0 max-sm:break-all">{anonymize(key)}</code>
 {/* Touch: select-all is awkward on a phone — one-tap copy. */}
 <CopyValueButton value={anonymize(key)} className="hidden coarse:inline-flex" />
 </div>
 ))}
 </div>
 )}
 </div>
 );
 })}
 </div>
 </div>
 )}
 {/* Battery Health */}
 {hardware.battery?.present && (
 <div className="p-4 bg-bg-secondary rounded-xl md:col-span-2">
 <h4 className="text-sm font-semibold text-text-muted mb-3 flex items-center gap-2">
 <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
 <rect x="1" y="6" width="18" height="12" rx="2" /><line x1="23" y1="10" x2="23" y2="14" />
 </svg>
 Battery
 </h4>
 <div className="flex flex-wrap items-center gap-6">
 {hardware.battery.healthPercent != null && (
 <div>
 <p className={clsx('text-2xl font-bold', hardware.battery.healthPercent >= 80 ? 'text-green-400' : hardware.battery.healthPercent >= 50 ? 'text-yellow-400' : 'text-red-400')}>
 {hardware.battery.healthPercent.toFixed(1)}%
 </p>
 <p className="text-xs text-text-muted">Health</p>
 </div>
 )}
 {hardware.battery.cycleCount != null && hardware.battery.cycleCount > 0 && (
 <div>
 <p className="text-xl font-bold text-text-primary">{hardware.battery.cycleCount}</p>
 <p className="text-xs text-text-muted">Cycles</p>
 </div>
 )}
 {hardware.battery.designCapacity != null && hardware.battery.designCapacity > 0 && (
 <div>
 <p className="text-sm text-text-primary">{(hardware.battery.designCapacity / 1000).toFixed(1)} Wh</p>
 <p className="text-xs text-text-muted">Design capacity</p>
 </div>
 )}
 {hardware.battery.fullCapacity != null && hardware.battery.fullCapacity > 0 && (
 <div>
 <p className="text-sm text-text-primary">{(hardware.battery.fullCapacity / 1000).toFixed(1)} Wh</p>
 <p className="text-xs text-text-muted">Current max capacity</p>
 </div>
 )}
 {hardware.battery.status && (
 <div>
 <p className="text-sm text-text-primary">{hardware.battery.status}</p>
 <p className="text-xs text-text-muted">Status</p>
 </div>
 )}
 </div>
 </div>
 )}
 </div>
 )}

 {activeSection === 'software' && (
 <div className="space-y-3">
 <div className="relative">
 <input
 type="text"
 value={softwareSearch}
 onChange={(e) => setSoftwareSearch(e.target.value)}
 placeholder="Search software..."
 autoCapitalize="off" autoCorrect="off" spellCheck={false}
 className="w-full px-3 py-2 bg-bg-secondary rounded-lg text-text-primary focus:outline-none focus:border-accent text-sm"
 />
 {softwareLoading && (
 <RefreshCw className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted animate-spin" />
 )}
 </div>
 <TableScroll className={clsx('bg-bg-secondary rounded-xl transition-opacity', softwareLoading && 'opacity-60')}>
 <table className="w-full">
 <thead>
 <tr className="">
 <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase">Name</th>
 <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase hidden md:table-cell">Version</th>
 <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase hidden lg:table-cell">Publisher</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-border">
 {software.map((sw) => (
 <tr key={sw.id} className="hover:bg-bg-tertiary transition-colors">
 <td className="px-4 py-2 text-sm text-text-primary">
 {sw.name}
 {/* Columns hidden below md / lg are repeated as a muted second line. */}
 {(sw.version || sw.publisher) && (
 <p className="lg:hidden text-xs text-text-muted break-words">
 {sw.version && <span className="md:hidden">{sw.version}</span>}
 {sw.version && sw.publisher && <span className="md:hidden"> · </span>}
 {sw.publisher}
 </p>
 )}
 </td>
 <td className="px-4 py-2 text-sm text-text-muted hidden md:table-cell">{sw.version ?? '—'}</td>
 <td className="px-4 py-2 text-sm text-text-muted hidden lg:table-cell">{sw.publisher ?? '—'}</td>
 </tr>
 ))}
 </tbody>
 </table>
 </TableScroll>
 </div>
 )}

 {activeSection === 'hardware' && !hardware && (
 <p className="text-text-muted text-center py-8">No inventory data. Click "Scan now" to collect hardware info.</p>
 )}

 {/* Licenses */}
 <div className="p-4 bg-bg-secondary rounded-xl">
 <div className="flex items-center justify-between mb-3">
 <h4 className="text-sm font-semibold text-text-muted">Licenses</h4>
 <button onClick={() => setShowLicenseForm(!showLicenseForm)} className="text-xs text-accent hover:underline coarse:min-h-10 coarse:px-2">
 + Add License
 </button>
 </div>
 {showLicenseForm && (
 <div className="space-y-2 mb-3 p-3 bg-bg-tertiary rounded-lg">
 <input type="text" placeholder="Software name" value={licenseForm.softwareName}
 onChange={e => setLicenseForm(f => ({ ...f, softwareName: e.target.value }))}
 className="w-full px-3 py-1.5 text-sm bg-bg-primary rounded-lg text-text-primary focus:outline-none focus:border-accent" />
 <input type="text" placeholder="License key" value={licenseForm.licenseKey}
 autoCapitalize="off" autoCorrect="off" spellCheck={false}
 onChange={e => setLicenseForm(f => ({ ...f, licenseKey: e.target.value }))}
 className="w-full px-3 py-1.5 text-sm bg-bg-primary rounded-lg text-text-primary focus:outline-none focus:border-accent" />
 <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
 <select value={licenseForm.licenseType}
 onChange={e => setLicenseForm(f => ({ ...f, licenseType: e.target.value }))}
 className="px-3 py-1.5 text-sm bg-bg-primary rounded-lg text-text-primary focus:outline-none focus:border-accent">
 <option value="per_device">Per Device</option>
 <option value="per_user">Per User</option>
 <option value="volume">Volume</option>
 <option value="subscription">Subscription</option>
 <option value="other">Other</option>
 </select>
 <input type="text" placeholder="Vendor" value={licenseForm.vendor}
 onChange={e => setLicenseForm(f => ({ ...f, vendor: e.target.value }))}
 className="px-3 py-1.5 text-sm bg-bg-primary rounded-lg text-text-primary focus:outline-none focus:border-accent" />
 </div>
 <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
 <input type="date" placeholder="Expiry date" value={licenseForm.expiryDate}
 onChange={e => setLicenseForm(f => ({ ...f, expiryDate: e.target.value }))}
 className="px-3 py-1.5 text-sm bg-bg-primary rounded-lg text-text-primary focus:outline-none focus:border-accent" />
 <input type="text" placeholder="Notes" value={licenseForm.notes}
 onChange={e => setLicenseForm(f => ({ ...f, notes: e.target.value }))}
 className="px-3 py-1.5 text-sm bg-bg-primary rounded-lg text-text-primary focus:outline-none focus:border-accent" />
 </div>
 <div className="flex justify-end gap-2 pt-1">
 <button onClick={() => setShowLicenseForm(false)} className="px-3 py-1.5 text-xs text-text-muted hover:text-text-primary coarse:min-h-10">{t('common.cancel', 'Cancel')}</button>
 <button onClick={async () => {
 if (!licenseForm.softwareName.trim()) return;
 try {
 await licenseApi.create(deviceId, {
 softwareName: licenseForm.softwareName,
 licenseKey: licenseForm.licenseKey || null,
 licenseType: (licenseForm.licenseType || null) as DeviceLicense['licenseType'],
 vendor: licenseForm.vendor || null,
 expiryDate: licenseForm.expiryDate || null,
 notes: licenseForm.notes || null,
 });
 setLicenseForm({ softwareName: '', licenseKey: '', licenseType: 'per_device', vendor: '', expiryDate: '', notes: '' });
 setShowLicenseForm(false);
 loadLicenses();
 } catch { toast.error('Failed to add license'); }
 }} className="px-3 py-1.5 text-xs bg-accent text-white rounded-lg hover:bg-accent/90 coarse:min-h-10">{t('common.save', 'Save')}</button>
 </div>
 </div>
 )}
 {licenses.length > 0 ? (
 <TableScroll className="rounded-none">
 <table className="w-full text-sm max-sm:min-w-[440px]">
 <thead><tr className="text-xs text-text-muted ">
 <th className="text-left py-1">Software</th>
 <th className="text-left py-1">Key</th>
 <th className="text-left py-1">Type</th>
 <th className="text-left py-1">Expiry</th>
 <th className="w-8"></th>
 </tr></thead>
 <tbody>{licenses.map(lic => (
 <tr key={lic.id} className="">
 <td className="py-1.5 text-text-primary">{lic.softwareName}</td>
 <td className="py-1.5 font-mono text-text-muted">{lic.licenseKey ? '••••' + lic.licenseKey.slice(-4) : '—'}</td>
 <td className="py-1.5 text-text-muted">{lic.licenseType ?? '—'}</td>
 <td className="py-1.5 text-text-muted">{lic.expiryDate ? new Date(lic.expiryDate).toLocaleDateString() : '—'}</td>
 <td><IconButton
 label={t('deviceDetail.license.delete', 'Delete license')}
 size="xs"
 variant="plain"
 touchTarget="overlay"
 className="text-red-400 hover:text-red-300"
 icon={<Trash2 className="w-3.5 h-3.5" />}
 onClick={async () => {
 if (!canHover && !(await confirm({ message: t('deviceDetail.license.deleteConfirm', { defaultValue: 'Delete the license "{{name}}"?', name: lic.softwareName }), danger: true }))) return;
 try { await licenseApi.remove(lic.id); loadLicenses(); } catch { toast.error('Failed to delete license'); }
 }}
 /></td>
 </tr>
 ))}</tbody>
 </table>
 </TableScroll>
 ) : (
 <p className="text-xs text-text-muted">No licenses recorded</p>
 )}
 </div>
 </div>
 );
}

// ─── Scripts Tab ──────────────────────────────────────────────────────────────

function ScriptsTab({ deviceId }: { deviceId: number }) {
 type SubTab = 'schedule' | 'run' | 'history';
 const [subTab, setSubTab] = useState<SubTab>('history');

 const subTabs: Array<{ id: SubTab; label: string; icon: React.ReactNode }> = [
 { id: 'history', label: 'History', icon: <History className="w-3.5 h-3.5" /> },
 { id: 'run', label: 'Run', icon: <Play className="w-3.5 h-3.5" /> },
 { id: 'schedule', label: 'Schedule', icon: <CalendarClock className="w-3.5 h-3.5" /> },
 ];

 return (
 <div className="space-y-4">
 <div className="flex items-center gap-1 rounded-lg bg-bg-tertiary p-0.5 border border-transparent w-fit">
 {subTabs.map((st) => (
 <button
 key={st.id}
 onClick={() => setSubTab(st.id)}
 className={clsx(
 'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors coarse:min-h-10',
 subTab === st.id ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary',
 )}
 >
 {st.icon}
 {st.label}
 </button>
 ))}
 </div>
 {subTab === 'history' && <DeviceScriptHistory deviceId={deviceId} />}
 {subTab === 'run' && <DeviceScriptRun deviceId={deviceId} />}
 {subTab === 'schedule' && <DeviceScriptSchedule deviceId={deviceId} />}
 </div>
 );
}

function DeviceScriptHistory({ deviceId }: { deviceId: number }) {
 const { t } = useTranslation();
 const [executions, setExecutions] = useState<ScriptExecution[]>([]);
 const [isLoading, setIsLoading] = useState(true);
 const [expandedId, setExpandedId] = useState<string | null>(null);
 const [fullscreenOutput, setFullscreenOutput] = useState<{ title: string; content: string; type: 'stdout' | 'stderr' } | null>(null);

 const load = () => {
 setIsLoading(true);
 scriptApi.listExecutions({ deviceId, pageSize: 50 }).then((r) => setExecutions(r.items)).catch(() => {}).finally(() => setIsLoading(false));
 };

 useEffect(() => { load(); }, [deviceId]);

 const STATUS_COLORS: Record<string, string> = {
 success: 'text-green-400', failure: 'text-red-400', running: 'text-blue-400',
 pending: 'text-yellow-400', timeout: 'text-orange-400', cancelled: 'text-gray-400',
 skipped: 'text-gray-400', sent: 'text-blue-400',
 };

 if (isLoading && executions.length === 0) return <div className="flex items-center justify-center h-48"><RefreshCw className="w-5 h-5 animate-spin text-text-muted" /></div>;

 return (
 <>
 <div className="space-y-2">
 <div className="flex items-center justify-between">
 <p className="text-sm text-text-muted">{executions.length} executions</p>
 <IconButton onClick={load} label={t('common.refresh', 'Refresh')} className="hover:bg-bg-secondary rounded-lg" icon={<RefreshCw className={clsx('w-4 h-4', isLoading && 'animate-spin')} />} />
 </div>

 {executions.length === 0 ? (
 <div className="p-12 text-center text-text-muted">
 <Terminal className="w-8 h-8 mx-auto mb-2 opacity-50" />
 <p>No script executions yet</p>
 </div>
 ) : (
 <div className="space-y-1">
 {executions.map((ex) => {
 const duration = ex.finishedAt && ex.startedAt
 ? Math.round((new Date(ex.finishedAt).getTime() - new Date(ex.startedAt).getTime()) / 1000)
 : null;
 const isExpanded = expandedId === ex.id;
 const isRunning = ex.status === 'running' || ex.status === 'sent';
 return (
 <div key={ex.id} className="bg-bg-secondary rounded-lg overflow-hidden">
 {/* Stop is a real sibling button (not nested in the row toggle) so a
 near-miss on touch never expands the row instead of stopping. */}
 <div className="flex items-center hover:bg-bg-hover transition-colors">
 <button
 onClick={() => setExpandedId(isExpanded ? null : ex.id)}
 className={clsx('flex-1 min-w-0 flex items-center gap-3 pl-4 py-2.5 text-left', isRunning ? 'pr-0' : 'pr-4')}
 >
 {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-text-muted shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-text-muted shrink-0" />}
 <span className="flex-1 min-w-0">
 <span className="block text-sm text-text-primary truncate">{ex.scriptSnapshot?.name ?? 'Script'}</span>
 <span className="md:hidden block text-xs text-text-muted truncate">{ex.startedAt ? new Date(ex.startedAt).toLocaleString() : '—'}</span>
 </span>
 <span className={clsx('text-xs font-medium', STATUS_COLORS[ex.status] ?? 'text-text-muted')}>{ex.status}</span>
 <span className="text-xs text-text-muted">{ex.triggeredBy}</span>
 <span className="text-xs text-text-muted hidden md:inline">{ex.startedAt ? new Date(ex.startedAt).toLocaleString() : '—'}</span>
 {duration !== null && <span className="text-xs text-text-muted">{duration}s</span>}
 </button>
 {isRunning && (
 <IconButton
 onClick={() => { scriptApi.stopExecution(ex.id).then(() => { toast.success('Script stopped'); load(); }).catch(() => toast.error('Failed to stop')); }}
 size="sm"
 variant="plain"
 className="ml-3 mr-4 text-red-400 hover:text-red-300 hover:bg-red-400/10"
 label={t('deviceDetail.scripts.stop', 'Stop')}
 icon={<StopCircle className="w-4 h-4" />}
 />
 )}
 </div>
 {isExpanded && (
 <div className=" p-3 space-y-2 bg-bg-tertiary/50">
 {ex.stdout && (
 <div>
 <div className="flex items-center justify-between mb-1">
 <p className="text-[10px] text-text-muted uppercase font-medium">stdout</p>
 <IconButton
 onClick={() => setFullscreenOutput({ title: `${ex.scriptSnapshot?.name ?? 'Script'} — stdout`, content: ex.stdout!, type: 'stdout' })}
 size="xs"
 variant="plain"
 touchTarget="overlay"
 label={t('deviceDetail.scripts.fullscreen', 'Fullscreen')}
 icon={<Maximize2 className="w-3 h-3" />}
 />
 </div>
 <pre className="text-xs text-green-300 bg-black/30 rounded p-2 overflow-x-auto whitespace-pre-wrap font-mono max-h-40 overflow-y-auto">{ex.stdout}</pre>
 </div>
 )}
 {ex.stderr && (
 <div>
 <div className="flex items-center justify-between mb-1">
 <p className="text-[10px] text-text-muted uppercase font-medium">stderr</p>
 <IconButton
 onClick={() => setFullscreenOutput({ title: `${ex.scriptSnapshot?.name ?? 'Script'} — stderr`, content: ex.stderr!, type: 'stderr' })}
 size="xs"
 variant="plain"
 touchTarget="overlay"
 label={t('deviceDetail.scripts.fullscreen', 'Fullscreen')}
 icon={<Maximize2 className="w-3 h-3" />}
 />
 </div>
 <pre className="text-xs text-red-300 bg-black/30 rounded p-2 overflow-x-auto whitespace-pre-wrap font-mono max-h-40 overflow-y-auto">{ex.stderr}</pre>
 </div>
 )}
 {!ex.stdout && !ex.stderr && <p className="text-xs text-text-muted">No output</p>}
 {ex.exitCode !== null && <p className="text-xs text-text-muted">Exit code: {ex.exitCode}</p>}
 </div>
 )}
 </div>
 );
 })}
 </div>
 )}
 </div>

 {/* Fullscreen output modal */}
 <Modal
 open={!!fullscreenOutput}
 onClose={() => setFullscreenOutput(null)}
 title={fullscreenOutput?.title}
 size="full"
 className="bg-bg-primary"
 bodyClassName="p-0"
 >
 {fullscreenOutput && (
 <pre className={clsx(
 'p-4 text-sm font-mono overflow-x-auto whitespace-pre-wrap break-words',
 fullscreenOutput.type === 'stdout' ? 'text-green-300' : 'text-red-300',
 )}>
 {fullscreenOutput.content}
 </pre>
 )}
 </Modal>
 </>
 );
}

function DeviceScriptRun({ deviceId }: { deviceId: number }) {
 const [scripts, setScripts] = useState<Script[]>([]);
 const [scriptId, setScriptId] = useState<number | null>(null);
 const [isRunning, setIsRunning] = useState(false);

 useEffect(() => { scriptApi.list().then(setScripts).catch(() => {}); }, []);

 const handleRun = async () => {
 if (!scriptId) return;
 setIsRunning(true);
 try {
 await scriptApi.executeNow(scriptId, { deviceIds: [deviceId] });
 toast.success('Script dispatched');
 } catch {
 toast.error('Failed to execute script');
 } finally {
 setIsRunning(false);
 }
 };

 return (
 <div className="space-y-4 max-w-md">
 <div className="space-y-1">
 <label className="text-xs font-medium text-text-muted uppercase">Script</label>
 <select
 value={scriptId ?? ''}
 onChange={(e) => setScriptId(e.target.value ? parseInt(e.target.value, 10) : null)}
 className="w-full px-3 py-2 text-sm bg-bg-secondary rounded-lg text-text-primary focus:outline-none focus:border-accent"
 >
 <option value="">Select a script...</option>
 {scripts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
 </select>
 </div>
 <button
 onClick={handleRun}
 disabled={isRunning || !scriptId}
 className={clsx(
 'flex items-center justify-center gap-2 w-full py-2.5 rounded-lg text-sm font-medium transition-colors',
 isRunning || !scriptId ? 'bg-bg-tertiary text-text-muted cursor-not-allowed' : 'bg-accent text-white hover:bg-accent/80',
 )}
 >
 {isRunning ? <><Loader2 className="w-4 h-4 animate-spin" /> Running...</> : <><Play className="w-4 h-4" /> Execute now</>}
 </button>
 <p className="text-xs text-text-muted">The script will be executed on this device. Check History for results.</p>
 </div>
 );
}

function DeviceScriptSchedule({ deviceId }: { deviceId: number }) {
 const { t } = useTranslation();
 const [scripts, setScripts] = useState<Script[]>([]);
 const [schedules, setSchedules] = useState<ScriptSchedule[]>([]);
 const [isLoading, setIsLoading] = useState(true);
 const [showForm, setShowForm] = useState(false);
 const [formScriptId, setFormScriptId] = useState<number | null>(null);
 const [formMode, setFormMode] = useState<'cron' | 'once'>('cron');
 const [formCron, setFormCron] = useState('0 2 * * *');
 const [formOnceAt, setFormOnceAt] = useState('');
 const [formName, setFormName] = useState('');
 const [isSaving, setIsSaving] = useState(false);

 const load = () => {
 setIsLoading(true);
 Promise.all([scriptApi.list(), scriptApi.listSchedulesForDevice(deviceId)]).then(([s, sch]) => {
 setScripts(s);
 setSchedules(sch);
 }).catch(() => {}).finally(() => setIsLoading(false));
 };

 useEffect(() => { load(); }, [deviceId]);

 const handleCreate = async () => {
 if (!formScriptId || !formName.trim()) { toast.error('Name and script are required'); return; }
 if (formMode === 'once' && (!formOnceAt || new Date(formOnceAt) <= new Date())) { toast.error('Select a future date'); return; }
 setIsSaving(true);
 try {
 await scriptApi.createSchedule({
 name: formName,
 description: null,
 scriptId: formScriptId,
 targetType: 'device',
 targetIds: [deviceId],
 cronExpression: formMode === 'cron' ? formCron : null,
 fireOnceAt: formMode === 'once' ? new Date(formOnceAt).toISOString() : null,
 timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
 parameterValues: {},
 catchupEnabled: false,
 catchupMax: 3,
 runConditions: [],
 enabled: true,
 tenantId: 0,
 } as any);
 toast.success('Schedule created');
 setShowForm(false);
 setFormName('');
 setFormScriptId(null);
 load();
 } catch {
 toast.error('Failed to create schedule');
 } finally {
 setIsSaving(false);
 }
 };

 if (isLoading) return <div className="flex items-center justify-center h-24"><RefreshCw className="w-4 h-4 animate-spin text-text-muted" /></div>;

 const scriptMap = new Map(scripts.map((s) => [s.id, s.name]));

 const TARGET_LABELS: Record<string, string> = { all: 'All devices', group: 'Group', device: 'This device' };

 return (
 <div className="space-y-4">
 <div className="flex flex-wrap items-center justify-between gap-2">
 <p className="text-sm text-text-muted">{schedules.length} schedule(s) apply to this device</p>
 <div className="flex gap-2">
 <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-accent text-white rounded-lg hover:bg-accent/80 transition-colors coarse:min-h-10">
 <Plus className="w-3.5 h-3.5" /> New
 </button>
 <IconButton onClick={load} label={t('common.refresh', 'Refresh')} className="hover:bg-bg-secondary rounded-lg" icon={<RefreshCw className="w-3.5 h-3.5" />} />
 </div>
 </div>

 {/* Inline create form */}
 {showForm && (
 <div className="bg-bg-secondary rounded-xl p-4 space-y-3">
 <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
 <div className="space-y-1">
 <label className="text-xs font-medium text-text-muted uppercase">Name</label>
 <input value={formName} onChange={(e) => setFormName(e.target.value)}
 className="w-full px-3 py-1.5 text-sm bg-bg-tertiary rounded-lg text-text-primary focus:outline-none focus:border-accent" placeholder="Schedule name" />
 </div>
 <div className="space-y-1">
 <label className="text-xs font-medium text-text-muted uppercase">Script</label>
 <select value={formScriptId ?? ''} onChange={(e) => setFormScriptId(e.target.value ? parseInt(e.target.value, 10) : null)}
 className="w-full px-3 py-1.5 text-sm bg-bg-tertiary rounded-lg text-text-primary focus:outline-none focus:border-accent">
 <option value="">Select...</option>
 {scripts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
 </select>
 </div>
 </div>
 <div className="flex gap-2">
 <button onClick={() => setFormMode('cron')} className={clsx('flex-1 py-1.5 text-xs rounded-lg border transition-colors coarse:min-h-10', formMode === 'cron' ? 'bg-accent/10 border-accent text-accent' : 'border-transparent text-text-muted')}>Recurring</button>
 <button onClick={() => setFormMode('once')} className={clsx('flex-1 py-1.5 text-xs rounded-lg border transition-colors coarse:min-h-10', formMode === 'once' ? 'bg-accent/10 border-accent text-accent' : 'border-transparent text-text-muted')}>One-time</button>
 </div>
 {formMode === 'cron' ? (
 <input value={formCron} onChange={(e) => setFormCron(e.target.value)}
 autoCapitalize="off" autoCorrect="off" spellCheck={false}
 className="w-full px-3 py-1.5 text-sm bg-bg-tertiary rounded-lg text-text-primary focus:outline-none focus:border-accent font-mono" placeholder="0 2 * * *" />
 ) : (
 <input type="datetime-local" value={formOnceAt} min={new Date().toISOString().slice(0, 16)} onChange={(e) => setFormOnceAt(e.target.value)}
 className="w-full px-3 py-1.5 text-sm bg-bg-tertiary rounded-lg text-text-primary focus:outline-none focus:border-accent" />
 )}
 <div className="flex gap-2 justify-end">
 <button onClick={() => setShowForm(false)} className="px-3 py-1.5 text-xs text-text-muted hover:text-text-primary rounded-lg transition-colors coarse:min-h-10">Cancel</button>
 <button onClick={handleCreate} disabled={isSaving} className="px-3 py-1.5 text-xs bg-accent text-white rounded-lg hover:bg-accent/80 disabled:opacity-50 transition-colors coarse:min-h-10">
 {isSaving ? 'Creating...' : 'Create'}
 </button>
 </div>
 </div>
 )}

 {schedules.length === 0 && !showForm ? (
 <div className="p-8 text-center text-text-muted">
 <CalendarClock className="w-8 h-8 mx-auto mb-2 opacity-50" />
 <p className="text-sm">No schedules apply to this device yet.</p>
 </div>
 ) : (
 <div className="space-y-2">
 {schedules.map((sch) => (
 <div key={sch.id} className="bg-bg-secondary rounded-lg px-4 py-3 flex items-center gap-3">
 <CalendarClock className="w-4 h-4 text-text-muted shrink-0" />
 <div className="flex-1 min-w-0">
 <p className="text-sm font-medium text-text-primary break-words">{sch.name}</p>
 <p className="text-xs text-text-muted break-words">
 {scriptMap.get(sch.scriptId) ?? `Script #${sch.scriptId}`} · {sch.cronExpression ?? 'One-time'}
 <span className="ml-2 text-text-muted/60">{TARGET_LABELS[sch.targetType] ?? sch.targetType}</span>
 </p>
 </div>
 <span className={clsx('text-xs px-2 py-0.5 rounded-full border font-medium', sch.enabled ? 'text-green-400 bg-green-400/10 border-green-400/30' : 'text-gray-400 bg-gray-400/10 border-gray-400/30')}>
 {sch.enabled ? 'Active' : 'Paused'}
 </span>
 </div>
 ))}
 </div>
 )}
 </div>
 );
}

// ─── Updates Tab ──────────────────────────────────────────────────────────────

function UpdatesTab({ deviceId, agentFlavor }: { deviceId: number; agentFlavor: Device['agentFlavor'] }) {
 const { t } = useTranslation();
 const [updates, setUpdates] = useState<DeviceUpdate[]>([]);
 const [isLoading, setIsLoading] = useState(true);
 const [approvingId, setApprovingId] = useState<number | null>(null);
 const [isApprovingAll, setIsApprovingAll] = useState(false);
 const [isDeploying, setIsDeploying] = useState(false);
 // Touch/narrow layouts: tapping an update title expands it (full title +
 // KB id) — desktop keeps the single truncated line + title tooltip.
 const [expandedUpdateId, setExpandedUpdateId] = useState<number | null>(null);

 const load = async () => {
 setIsLoading(true);
 try {
 const result = await updateApi.listUpdates({ deviceId });
 setUpdates(result.items);
 } catch {
 toast.error('Failed to load updates');
 } finally {
 setIsLoading(false);
 }
 };

 useEffect(() => { load(); }, [deviceId]);

 // Real-time: reflect install results & re-fetch after scan
 useEffect(() => {
 const socket = getSocket();
 if (!socket) return;
 const onCmd = (cmd: Command) => {
 if (cmd.deviceId !== deviceId) return;
 if (cmd.type === 'install_update') {
 const uid = (cmd.payload as any)?.updateUid as string | undefined;
 if (cmd.status === 'ack_running') {
 if (uid) setUpdates((prev) => prev.map((u) =>
 u.updateUid === uid ? { ...u, status: 'installing' as const } : u
 ));
 } else if (cmd.status === 'success') {
 if (uid) setUpdates((prev) => prev.map((u) =>
 u.updateUid === uid ? { ...u, status: 'installed' as const, installedAt: new Date().toISOString() } : u
 ));
 toast.success(uid ? `Update ${uid} installed` : 'Update installed');
 } else if (['failure', 'timeout'].includes(cmd.status)) {
 if (uid) setUpdates((prev) => prev.map((u) =>
 u.updateUid === uid ? { ...u, status: 'failed' as const } : u
 ));
 toast.error(uid ? `Failed to install ${uid}` : 'Update installation failed');
 }
 return;
 }
 if (!['success', 'failure', 'timeout'].includes(cmd.status)) return;
 if (cmd.type === 'scan_updates' && cmd.status === 'success') {
 load();
 }
 };
 socket.on(SocketEvents.COMMAND_UPDATED, onCmd);
 return () => {
 socket.off(SocketEvents.COMMAND_UPDATED, onCmd);
 };
 }, [deviceId]);

 const handleScan = async () => {
 try {
 await updateApi.triggerScan(deviceId);
 toast.success('Update scan queued');
 } catch {
 toast.error('Failed to queue scan');
 }
 };

 const handleApprove = async (updateId: number) => {
 setApprovingId(updateId);
 try {
 await updateApi.approveUpdate(deviceId, updateId);
 setUpdates((prev) => prev.map((u) => u.id === updateId ? { ...u, status: 'approved' } : u));
 toast.success('Update approved');
 } catch {
 toast.error('Failed to approve update');
 } finally {
 setApprovingId(null);
 }
 };

 const handleApproveAll = async () => {
 setIsApprovingAll(true);
 try {
 await updateApi.approveAll(deviceId);
 setUpdates((prev) => prev.map((u) => u.status === 'available' ? { ...u, status: 'approved' } : u));
 toast.success('All updates approved');
 } catch {
 toast.error('Failed to approve all updates');
 } finally {
 setIsApprovingAll(false);
 }
 };

 const handleDeploy = async () => {
 setIsDeploying(true);
 try {
 const result = await updateApi.deployApproved(deviceId);
 toast.success(`${result.dispatched} update(s) queued for installation`);
 await load();
 } catch {
 toast.error('Failed to deploy updates');
 } finally {
 setIsDeploying(false);
 }
 };

 const SEVERITY_COLORS: Record<string, string> = {
 critical: 'text-red-400 bg-red-400/10 border-red-400/30',
 important: 'text-orange-400 bg-orange-400/10 border-orange-400/30',
 moderate: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30',
 optional: 'text-blue-400 bg-blue-400/10 border-blue-400/30',
 unknown: 'text-gray-400 bg-gray-400/10 border-gray-400/30',
 };

 const STATUS_LABEL: Record<string, string> = {
 available: t('updates.status.available'),
 approved: t('updates.status.approved'),
 pending_install: t('updates.status.pendingInstall'),
 installing: t('updates.status.installing'),
 installed: t('updates.status.installed'),
 pending_reboot: t('updates.status.pendingReboot'),
 failed: t('updates.status.failed'),
 excluded: t('updates.status.excluded'),
 superseded: t('updates.status.superseded'),
 };

 const available = updates.filter((u) => u.status === 'available');
 const approved = updates.filter((u) => u.status === 'approved');
 const failed = updates.filter((u) => u.status === 'failed');
 const pendingReboot = updates.filter((u) => u.status === 'pending_reboot');

 if (isLoading) return <div className="flex items-center justify-center h-48"><RefreshCw className="w-5 h-5 animate-spin text-text-muted" /></div>;

 const hasSummary = available.length > 0 || approved.length > 0 || failed.length > 0 || pendingReboot.length > 0;

 return (
 <div className="space-y-4">
 {/* Toolbar */}
 <div className="flex items-center justify-between gap-3 flex-wrap">
 <p className="text-sm text-text-muted flex items-center gap-1.5 flex-wrap">
 {available.length > 0 && <span className="text-orange-400 font-medium">{available.length} {t('updates.status.available').toLowerCase()}</span>}
 {available.length > 0 && (approved.length > 0 || failed.length > 0 || pendingReboot.length > 0) && <span className="text-text-muted">·</span>}
 {approved.length > 0 && <span className="text-green-400 font-medium">{approved.length} {t('updates.status.approved').toLowerCase()}</span>}
 {approved.length > 0 && (failed.length > 0 || pendingReboot.length > 0) && <span className="text-text-muted">·</span>}
 {failed.length > 0 && <span className="text-red-400 font-medium">{failed.length} {t('updates.status.failed').toLowerCase()}</span>}
 {failed.length > 0 && pendingReboot.length > 0 && <span className="text-text-muted">·</span>}
 {pendingReboot.length > 0 && <span className="text-orange-400 font-medium">{pendingReboot.length} {t('updates.status.pendingReboot').toLowerCase()}</span>}
 {!hasSummary && <span>{t('updates.noPending')}</span>}
 </p>
 <div className="flex items-center gap-2 flex-wrap">
 {available.length > 0 && (
 <button
 onClick={handleApproveAll}
 disabled={isApprovingAll}
 className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-green-500/10 text-green-400 border border-green-500/30 rounded-lg hover:bg-green-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors coarse:min-h-10"
 >
 {isApprovingAll ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
 {t('updates.actions.approveAll')}
 </button>
 )}
 {approved.length > 0 && (
 <button
 onClick={handleDeploy}
 disabled={isDeploying}
 className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-accent/10 text-accent border border-accent/30 rounded-lg hover:bg-accent/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors coarse:min-h-10"
 >
 {isDeploying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Package className="w-3.5 h-3.5" />}
 {t('updates.actions.deploy')} ({approved.length})
 </button>
 )}
 {failed.length > 0 && (
 <button
 onClick={async () => {
 const failedIds = new Set(failed.map((u) => u.id));
 setUpdates((prev) => prev.map((x) =>
 failedIds.has(x.id) ? { ...x, status: 'pending_install' as const } : x
 ));
 let ok = 0;
 for (const u of failed) {
 try { await updateApi.retryUpdate(deviceId, u.id); ok++; } catch {}
 }
 toast.success(`${ok} update(s) queued for retry`);
 }}
 className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-red-500/10 text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/20 transition-colors coarse:min-h-10"
 >
 <RotateCcw className="w-3.5 h-3.5" />
 Retry all ({failed.length})
 </button>
 )}
 <DisabledTip reason={isCommandSupported({ agentFlavor }, 'scan_updates') ? null : unsupportedTooltip(t)}>
 <button
 onClick={handleScan}
 disabled={!isCommandSupported({ agentFlavor }, 'scan_updates')}
 className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-bg-secondary rounded-lg hover:border-accent/50 transition-colors text-text-muted hover:text-text-primary disabled:opacity-40 disabled:cursor-not-allowed coarse:min-h-10"
 >
 <Scan className="w-3.5 h-3.5" />
 {t('updates.actions.scan')}
 </button>
 </DisabledTip>
 </div>
 </div>

 {/* Update list */}
 {updates.length === 0 ? (
 <div className="p-12 text-center text-text-muted">
 <Package className="w-8 h-8 mx-auto mb-2 opacity-50" />
 <p>{t('updates.noUpdates')}</p>
 </div>
 ) : (
 <div className="bg-bg-secondary rounded-xl overflow-hidden">
 <div className="divide-y divide-border">
 {updates.map((update) => (
 <div key={update.id} className="px-4 py-3 flex items-center gap-3">
 <span className={clsx('text-xs font-medium px-2 py-0.5 rounded-full border shrink-0', SEVERITY_COLORS[update.severity] ?? SEVERITY_COLORS.unknown)}>
 {update.severity}
 </span>
 <div className="flex-1 min-w-0">
 <p
 className={clsx(
 'text-sm text-text-primary font-medium truncate max-lg:whitespace-normal max-lg:break-words max-lg:cursor-pointer',
 expandedUpdateId !== update.id && 'max-lg:line-clamp-2',
 )}
 title={update.title ?? update.updateUid}
 onClick={() => setExpandedUpdateId((cur) => (cur === update.id ? null : update.id))}
 >
 {update.title ?? update.updateUid}
 </p>
 {expandedUpdateId === update.id && update.title && update.updateUid && (
 <p className="lg:hidden text-xs text-text-muted font-mono break-all">{update.updateUid}</p>
 )}
 <p className="text-xs text-text-muted">{update.source} · <span className={clsx(
 update.status === 'approved' ? 'text-green-400' :
 update.status === 'installing' || update.status === 'pending_install' ? 'text-yellow-400' :
 update.status === 'pending_reboot' ? 'text-orange-400' :
 update.status === 'installed' ? 'text-blue-400' :
 update.status === 'failed' ? 'text-red-400' : '',
 )}>{STATUS_LABEL[update.status] ?? update.status}</span>{update.status === 'installed' && update.installedAt && (
 <span className="text-text-muted"> · {new Date(update.installedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
 )}</p>
 </div>
 {update.status === 'available' && (
 <button
 onClick={() => handleApprove(update.id)}
 disabled={approvingId === update.id}
 className="shrink-0 flex items-center gap-1 px-2.5 py-1 text-xs text-green-400 bg-green-400/10 border border-green-400/20 rounded-lg hover:bg-green-400/20 disabled:opacity-50 transition-colors coarse:min-h-9"
 >
 {approvingId === update.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />}
 {t('updates.actions.approve')}
 </button>
 )}
 {update.status === 'approved' && (
 <span className="shrink-0 text-xs text-green-400 opacity-60">✓ {t('updates.status.approved')}</span>
 )}
 {update.status === 'failed' && (
 <button
 onClick={async () => {
 try {
 await updateApi.retryUpdate(deviceId, update.id);
 setUpdates((prev) => prev.map((u) =>
 u.id === update.id ? { ...u, status: 'pending_install' as const } : u
 ));
 toast.success(`Retry queued for ${update.updateUid}`);
 } catch {
 toast.error('Failed to retry update');
 }
 }}
 className="shrink-0 flex items-center gap-1 px-2.5 py-1 text-xs text-accent bg-accent/10 border border-accent/20 rounded-lg hover:bg-accent/20 transition-colors coarse:min-h-9"
 >
 <RotateCcw className="w-3 h-3" />
 Retry
 </button>
 )}
 </div>
 ))}
 </div>
 </div>
 )}
 </div>
 );
}

// ─── Compliance Tab ──────────────────────────────────────────────────────────────

const RULE_STATUS_ICON: Record<string, React.ReactNode> = {
 pass: <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />,
 fail: <XCircle className="w-4 h-4 text-red-400 shrink-0" />,
 warning: <AlertTriangle className="w-4 h-4 text-yellow-400 shrink-0" />,
 error: <MinusCircle className="w-4 h-4 text-text-muted shrink-0" />,
};

const SEVERITY_COLOR: Record<string, string> = {
 critical: 'text-red-400',
 high: 'text-orange-400',
 medium: 'text-yellow-400',
 low: 'text-blue-400',
 info: 'text-text-muted',
};

function ComplianceTab({ deviceId }: { deviceId: number }) {
 const { t } = useTranslation();
 const [results, setResults] = useState<ComplianceResult[]>([]);
 const [policies, setPolicies] = useState<CompliancePolicy[]>([]);
 const [presets, setPresets] = useState<import('@obliance/shared').CompliancePreset[]>([]);
 const [isLoading, setIsLoading] = useState(true);
 const [triggering, setTriggering] = useState(false);
 const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
 const [ignoredRules, setIgnoredRules] = useState<Record<number, string[]>>({});
 const [remediatingRules, setRemediatingRules] = useState<Set<string>>(new Set());

 const load = async () => {
 setIsLoading(true);
 try {
 const [resultData, policyList, presetList] = await Promise.all([
 complianceApi.listResults({ deviceId }),
 complianceApi.listPolicies(),
 complianceApi.listPresets(),
 ]);
 setResults(resultData.items);
 setPolicies(policyList);
 setPresets(presetList);
 } catch {
 toast.error('Failed to load compliance');
 } finally {
 setIsLoading(false);
 }
 };

 useEffect(() => { load(); }, [deviceId]);

 useEffect(() => {
 complianceApi.getIgnoredRules(deviceId).then(data => setIgnoredRules(data)).catch(() => {});
 }, [deviceId]);

 const isRuleIgnored = (policyId: number, ruleId: string) =>
 ignoredRules[policyId]?.includes(ruleId) ?? false;

 const getRemediationScript = (policyId: number, ruleId: string): string | undefined => {
 const policy = policies.find(p => p.id === policyId);
 const policyRule = policy?.rules.find(r => r.id === ruleId);
 if (policyRule?.remediationScript) return policyRule.remediationScript;
 for (const preset of presets) {
 const presetRule = preset.rules.find(r => r.id === ruleId);
 if (presetRule?.remediationScript) return presetRule.remediationScript;
 }
 return undefined;
 };

 const handleRemediate = async (policyId: number, ruleIds: string[]) => {
 const key = ruleIds.map(id => `${policyId}:${id}`);
 setRemediatingRules(prev => { const s = new Set(prev); key.forEach(k => s.add(k)); return s; });
 try {
 await complianceApi.remediate(deviceId, policyId, ruleIds);
 toast.success(`Remediation sent for ${ruleIds.length} rule(s)`);
 } catch {
 toast.error('Failed to send remediation');
 } finally {
 setRemediatingRules(prev => { const s = new Set(prev); key.forEach(k => s.delete(k)); return s; });
 }
 };

 const handleRemediateAll = async (result: ComplianceResult) => {
 const failingRuleIds = result.results
 .filter(rr => rr.status === 'fail' && !isRuleIgnored(result.policyId, rr.ruleId))
 .map(rr => rr.ruleId)
 .filter(id => getRemediationScript(result.policyId, id));
 if (failingRuleIds.length === 0) { toast.error('No remediable rules'); return; }
 await handleRemediate(result.policyId, failingRuleIds);
 };

 const handleIgnore = async (policyId: number, ruleIds: string[]) => {
 try {
 await complianceApi.ignoreRules(deviceId, policyId, ruleIds);
 setIgnoredRules(prev => ({
 ...prev,
 [policyId]: [...(prev[policyId] ?? []), ...ruleIds],
 }));
 toast.success(`${ruleIds.length} rule(s) ignored`);
 } catch { toast.error('Failed to ignore rules'); }
 };

 const handleUnignore = async (policyId: number, ruleIds: string[]) => {
 try {
 await complianceApi.unignoreRules(deviceId, policyId, ruleIds);
 setIgnoredRules(prev => ({
 ...prev,
 [policyId]: (prev[policyId] ?? []).filter(id => !ruleIds.includes(id)),
 }));
 toast.success(`${ruleIds.length} rule(s) unignored`);
 } catch { toast.error('Failed to unignore rules'); }
 };

 const handleTriggerCheck = async () => {
 setTriggering(true);
 try {
 await complianceApi.triggerCheck(deviceId);
 toast.success('Compliance check triggered');
 } catch {
 toast.error('Failed to trigger compliance check');
 } finally {
 setTriggering(false);
 }
 };

 const toggleExpand = (id: number) => {
 setExpandedIds(prev => {
 const next = new Set(prev);
 if (next.has(id)) next.delete(id); else next.add(id);
 return next;
 });
 };

 const getRuleInfo = (policyId: number, ruleId: string) => {
 const policy = policies.find(p => p.id === policyId);
 return policy?.rules.find(r => r.id === ruleId);
 };

 const handleExport = async (e: React.MouseEvent, result: ComplianceResult) => {
 e.stopPropagation();
 const policyName = result.policy?.name ?? `Policy #${result.policyId}`;
 const checkedAt = new Date(result.checkedAt).toLocaleString();
 const score = result.complianceScore.toFixed(0);

 const lines: string[] = [
 `"Politique","${policyName.replace(/"/g, '""')}"`,
 `"Date","${checkedAt}"`,
 `"Score","${score}%"`,
 ``,
 `"Règle","Statut","Sévérité","Valeur actuelle","Valeur attendue"`,
 ];

 for (const rr of result.results) {
 const info = getRuleInfo(result.policyId, rr.ruleId);
 const name = (info?.name ?? rr.ruleId).replace(/"/g, '""');
 const actual = rr.actualValue !== null && rr.actualValue !== undefined ? String(rr.actualValue) : '';
 const expected = info?.expected !== undefined && info.expected !== null ? String(info.expected) : '';
 lines.push(`"${name}","${rr.status}","${info?.severity ?? ''}","${actual}","${expected}"`);
 }

 const csv = lines.join('\r\n');
 // saveText → native saveFile bridge in the Android shell, <a download> in browsers.
 const ok = await saveText(
 '\uFEFF' + csv,
 `compliance-${policyName.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${new Date().toISOString().split('T')[0]}.csv`,
 'text/csv;charset=utf-8',
 );
 if (!ok) toast.error(t('common.error', 'Error'));
 };

 // ── Software Compliance ─────────────────────────────────────────────────────
 const [swResults, setSwResults] = useState<SoftwareComplianceResult[]>([]);
 const [swLoading, setSwLoading] = useState(true);
 const [swTriggering, setSwTriggering] = useState(false);
 const [swExpandedIds, setSwExpandedIds] = useState<Set<number>>(new Set());
 const [swRemediating, setSwRemediating] = useState<Set<string>>(new Set());

 const loadSwResults = useCallback(async () => {
 setSwLoading(true);
 try {
 const data = await softwareComplianceApi.getDeviceResults(deviceId);
 setSwResults(data);
 } catch {
 // silent
 } finally {
 setSwLoading(false);
 }
 }, [deviceId]);

 useEffect(() => { loadSwResults(); }, [loadSwResults]);

 const handleSwTriggerCheck = async () => {
 setSwTriggering(true);
 try {
 await softwareComplianceApi.triggerCheck(deviceId);
 toast.success('Software compliance check triggered');
 } catch {
 toast.error('Failed to trigger software compliance check');
 } finally {
 setSwTriggering(false);
 }
 };

 const handleSwRemediate = async (listId: number, entryIds: number[]) => {
 const keys = entryIds.map(id => `${listId}:${id}`);
 setSwRemediating(prev => { const s = new Set(prev); keys.forEach(k => s.add(k)); return s; });
 try {
 await softwareComplianceApi.remediate(deviceId, listId, entryIds);
 toast.success(`Remediation sent for ${entryIds.length} entry(ies)`);
 } catch {
 toast.error('Failed to send remediation');
 } finally {
 setSwRemediating(prev => { const s = new Set(prev); keys.forEach(k => s.delete(k)); return s; });
 }
 };

 const handleSwRemediateAll = async (result: SoftwareComplianceResult) => {
 const failingIds = result.results
 .filter(er => er.status === 'non_compliant')
 .map(er => er.entryId);
 if (failingIds.length === 0) { toast.error('No remediable entries'); return; }
 await handleSwRemediate(result.listId, failingIds);
 };

 const toggleSwExpand = (id: number) => {
 setSwExpandedIds(prev => {
 const next = new Set(prev);
 if (next.has(id)) next.delete(id); else next.add(id);
 return next;
 });
 };

 const swEntryStatusIcon = (status: SoftwareComplianceEntryResult['status']) => {
 switch (status) {
 case 'compliant': return <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />;
 case 'non_compliant': return <XCircle className="w-4 h-4 text-red-400 shrink-0" />;
 case 'remediated': return <RefreshCw className="w-4 h-4 text-yellow-400 shrink-0" />;
 case 'remediation_failed': return <AlertTriangle className="w-4 h-4 text-orange-400 shrink-0" />;
 default: return <MinusCircle className="w-4 h-4 text-text-muted shrink-0" />;
 }
 };

 if (isLoading) return (
 <div className="flex items-center justify-center h-48">
 <RefreshCw className="w-5 h-5 animate-spin text-text-muted" />
 </div>
 );

 return (
 <div className="space-y-4">
 {/* Header row */}
 <div className="flex flex-wrap items-center justify-between gap-2">
 <p className="text-xs text-text-muted">{results.length} policy result{results.length !== 1 ? 's' : ''}</p>
 <div className="flex gap-2">
 <button
 onClick={load}
 className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg hover:bg-bg-secondary text-text-muted hover:text-text-primary transition-colors coarse:min-h-10"
 >
 <RefreshCw className="w-3 h-3" />
 Refresh
 </button>
 <button
 onClick={handleTriggerCheck}
 disabled={triggering}
 className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-accent/10 border border-accent/30 text-accent hover:bg-accent/20 disabled:opacity-50 transition-colors coarse:min-h-10"
 >
 {triggering ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
 Run Check
 </button>
 </div>
 </div>

 {results.length === 0 ? (
 <div className="p-12 text-center text-text-muted">
 <ShieldCheck className="w-8 h-8 mx-auto mb-2 opacity-50" />
 <p className="text-sm">No compliance checks run yet</p>
 <Link to="/policies?tab=compliance" className="mt-2 inline-block text-sm text-accent">Configure policies &rarr;</Link>
 </div>
 ) : (
 results.map((result) => {
 const isExpanded = expandedIds.has(result.id);
 const passCount = result.results.filter(r => r.status === 'pass').length;
 const failCount = result.results.filter(r => r.status === 'fail').length;
 const warnCount = result.results.filter(r => r.status === 'warning').length;

 return (
 <div key={result.id} className="bg-bg-secondary rounded-xl overflow-hidden">
 {/* Policy header — below sm the actions / counts / score move to
 a second, wrapping row so the policy name keeps its width. */}
 <div
 onClick={() => toggleExpand(result.id)}
 className="w-full flex items-center justify-between p-4 hover:bg-bg-tertiary/50 transition-colors cursor-pointer max-sm:flex-wrap max-sm:gap-y-2"
 >
 <div className="flex items-center gap-3 min-w-0">
 {isExpanded
 ? <ChevronDown className="w-4 h-4 text-text-muted shrink-0" />
 : <ChevronRight className="w-4 h-4 text-text-muted shrink-0" />
 }
 <div className="min-w-0">
 <p className="text-sm font-medium text-text-primary break-words">
 {result.policy?.name ?? `Policy #${result.policyId}`}
 </p>
 <p className="text-xs text-text-muted mt-0.5">
 {result.policy?.framework && <span className="uppercase mr-2">{result.policy.framework}</span>}
 {new Date(result.checkedAt).toLocaleString()}
 </p>
 </div>
 </div>
 <div className="flex items-center gap-4 shrink-0 max-sm:w-full max-sm:flex-wrap max-sm:justify-end max-sm:gap-x-3 max-sm:gap-y-2">
 {failCount > 0 && (
 <button
 onClick={(e) => { e.stopPropagation(); handleRemediateAll(result); }}
 className="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-lg bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 transition-colors coarse:min-h-9"
 title="Remediate all failing rules"
 >
 <Wrench className="w-3 h-3" />
 Fix All
 </button>
 )}
 <button
 onClick={(e) => handleExport(e, result)}
 title={t('deviceDetail.compliance.exportCsv', 'Export the CSV report')}
 className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg hover:bg-bg-primary text-text-muted hover:text-text-primary transition-colors coarse:min-h-9"
 >
 <Download className="w-3 h-3" />
 Export
 </button>
 <div className="flex gap-3 text-xs">
 {passCount > 0 && <span className="text-green-400">✓ {passCount}</span>}
 {failCount > 0 && <span className="text-red-400">✗ {failCount}</span>}
 {warnCount > 0 && <span className="text-yellow-400">⚠ {warnCount}</span>}
 </div>
 <div className={clsx(
 'text-lg font-bold tabular-nums',
 result.complianceScore >= 80 ? 'text-green-400'
 : result.complianceScore >= 50 ? 'text-yellow-400'
 : 'text-red-400'
 )}>
 {result.complianceScore.toFixed(0)}%
 </div>
 </div>
 </div>

 {/* Score bar */}
 <div className="h-1 bg-bg-primary">
 <div
 className={clsx(
 'h-full transition-all',
 result.complianceScore >= 80 ? 'bg-green-400'
 : result.complianceScore >= 50 ? 'bg-yellow-400'
 : 'bg-red-400'
 )}
 style={{ width: `${result.complianceScore}%` }}
 />
 </div>

 {/* Expanded: per-rule breakdown */}
 {isExpanded && (() => {
 const remediableFailCount = result.results.filter(rr =>
 rr.status === 'fail' && !isRuleIgnored(result.policyId, rr.ruleId)
 && getRemediationScript(result.policyId, rr.ruleId)
 ).length;
 return (
 <div>
 {remediableFailCount > 0 && (
 <div className="flex items-center gap-2 px-4 py-2 bg-bg-tertiary/80">
 <button
 onClick={(e) => { e.stopPropagation(); handleRemediateAll(result); }}
 className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 transition-colors coarse:min-h-10"
 >
 <Wrench className="w-3.5 h-3.5" />
 Remediate all ({remediableFailCount})
 </button>
 </div>
 )}
 <div className="divide-y divide-border">
 {result.results.map((rr) => {
 const ruleInfo = getRuleInfo(result.policyId, rr.ruleId);
 const ignored = isRuleIgnored(result.policyId, rr.ruleId);
 const hasRemediation = !!getRemediationScript(result.policyId, rr.ruleId);
 const isRemediating = remediatingRules.has(`${result.policyId}:${rr.ruleId}`);
 return (
 <div key={rr.ruleId} className={clsx('flex items-start gap-3 px-4 py-3', ignored && 'opacity-50')}>
 <div className="mt-0.5">
 {ignored ? <EyeOff className="w-4 h-4 text-text-muted" /> :
 (RULE_STATUS_ICON[rr.status] ?? RULE_STATUS_ICON.error)}
 </div>
 <div className="flex-1 min-w-0">
 <div className="flex items-center gap-2 flex-wrap">
 <span className="text-sm text-text-primary">
 {ruleInfo?.name ?? rr.ruleId}
 </span>
 {ruleInfo?.severity && (
 <span className={clsx('text-xs font-medium capitalize', SEVERITY_COLOR[ruleInfo.severity])}>
 {ruleInfo.severity}
 </span>
 )}
 {ignored && (
 <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-500/10 text-gray-400 border border-gray-500/20">
 ignored
 </span>
 )}
 {rr.remediationTriggered && (
 <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
 remediated
 </span>
 )}
 </div>
 <div className="flex flex-wrap gap-x-4 mt-1 text-xs text-text-muted font-mono">
 {rr.actualValue !== null && rr.actualValue !== undefined && (
 <span className="max-lg:min-w-0 max-lg:break-all">actual: <span className="text-text-secondary">{String(rr.actualValue)}</span></span>
 )}
 {ruleInfo?.expected !== undefined && ruleInfo.expected !== null && (
 <span className="max-lg:min-w-0 max-lg:break-all">expected: <span className="text-text-secondary">{String(ruleInfo.expected)}</span></span>
 )}
 </div>
 </div>
 <div className="flex items-center gap-1.5 shrink-0 mt-0.5 coarse:mt-0 coarse:gap-0.5">
 <span className={clsx(
 'text-xs font-medium capitalize',
 ignored ? 'text-text-muted' :
 rr.status === 'pass' ? 'text-green-400'
 : rr.status === 'fail' ? 'text-red-400'
 : rr.status === 'warning' ? 'text-yellow-400'
 : 'text-text-muted'
 )}>
 {ignored ? 'ignored' : rr.status}
 </span>
 {rr.status === 'fail' && !ignored && hasRemediation && (
 <IconButton
 onClick={(e) => { e.stopPropagation(); handleRemediate(result.policyId, [rr.ruleId]); }}
 disabled={isRemediating}
 size="sm"
 variant="primary"
 className="disabled:opacity-50"
 label={t('deviceDetail.compliance.remediate', 'Remediate')}
 icon={<Wrench className={clsx('w-3.5 h-3.5', isRemediating && 'animate-spin')} />}
 />
 )}
 {!ignored ? (
 <IconButton
 onClick={(e) => { e.stopPropagation(); handleIgnore(result.policyId, [rr.ruleId]); }}
 size="sm"
 variant="plain"
 className="hover:text-yellow-400 hover:bg-yellow-400/10"
 label={t('deviceDetail.compliance.ignoreRule', 'Ignore this rule')}
 icon={<EyeOff className="w-3.5 h-3.5" />}
 />
 ) : (
 <IconButton
 onClick={(e) => { e.stopPropagation(); handleUnignore(result.policyId, [rr.ruleId]); }}
 size="sm"
 variant="plain"
 className="hover:text-green-400 hover:bg-green-400/10"
 label={t('deviceDetail.compliance.unignoreRule', 'Unignore this rule')}
 icon={<Eye className="w-3.5 h-3.5" />}
 />
 )}
 </div>
 </div>
 );
 })}
 </div>
 </div>
 );
 })()}
 </div>
 );
 })
 )}

 {/* ── Software Compliance Section ── */}
 <div className=" pt-4 mt-6">
 <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
 <p className="text-xs text-text-muted font-semibold uppercase tracking-wider">Software Compliance</p>
 <div className="flex gap-2">
 <button
 onClick={loadSwResults}
 className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg hover:bg-bg-secondary text-text-muted hover:text-text-primary transition-colors coarse:min-h-10"
 >
 <RefreshCw className={clsx('w-3 h-3', swLoading && 'animate-spin')} />
 Refresh
 </button>
 <button
 onClick={handleSwTriggerCheck}
 disabled={swTriggering}
 className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-accent/10 border border-accent/30 text-accent hover:bg-accent/20 disabled:opacity-50 transition-colors coarse:min-h-10"
 >
 {swTriggering ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
 Run Check
 </button>
 </div>
 </div>

 {swLoading ? (
 <div className="flex items-center justify-center h-24">
 <RefreshCw className="w-5 h-5 animate-spin text-text-muted" />
 </div>
 ) : swResults.length === 0 ? (
 <div className="p-8 text-center text-text-muted">
 <ShieldCheck className="w-6 h-6 mx-auto mb-2 opacity-50" />
 <p className="text-sm">No software compliance checks run yet</p>
 <Link to="/policies?tab=software" className="mt-2 inline-block text-sm text-accent">Configure software lists &rarr;</Link>
 </div>
 ) : swResults.map((result) => {
 const isExpanded = swExpandedIds.has(result.id);
 const compliantCount = result.results.filter(r => r.status === 'compliant').length;
 const nonCompliantCount = result.results.filter(r => r.status === 'non_compliant').length;

 return (
 <div key={result.id} className="bg-bg-secondary rounded-xl overflow-hidden mb-2">
 <div
 onClick={() => toggleSwExpand(result.id)}
 className="w-full flex items-center justify-between p-4 hover:bg-bg-tertiary/50 transition-colors cursor-pointer max-sm:flex-wrap max-sm:gap-y-2"
 >
 <div className="flex items-center gap-3 min-w-0">
 {isExpanded
 ? <ChevronDown className="w-4 h-4 text-text-muted shrink-0" />
 : <ChevronRight className="w-4 h-4 text-text-muted shrink-0" />
 }
 <div className="min-w-0">
 <div className="flex items-center gap-2 max-sm:flex-wrap">
 <p className="text-sm font-medium text-text-primary break-words">
 {result.list?.name ?? `List #${result.listId}`}
 </p>
 {result.list && (
 <span className={clsx(
 'text-xs px-2 py-0.5 rounded-full border font-medium',
 result.list.listType === 'whitelist'
 ? 'text-green-400 bg-green-400/10 border-green-400/30'
 : 'text-red-400 bg-red-400/10 border-red-400/30',
 )}>
 {result.list.listType}
 </span>
 )}
 </div>
 <p className="text-xs text-text-muted mt-0.5">
 {new Date(result.checkedAt).toLocaleString()}
 </p>
 </div>
 </div>
 <div className="flex items-center gap-4 shrink-0 max-sm:w-full max-sm:flex-wrap max-sm:justify-end max-sm:gap-x-3 max-sm:gap-y-2">
 {nonCompliantCount > 0 && (
 <button
 onClick={(e) => { e.stopPropagation(); handleSwRemediateAll(result); }}
 className="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-lg bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 transition-colors coarse:min-h-9"
 title="Remediate all non-compliant entries"
 >
 <Wrench className="w-3 h-3" />
 Fix All
 </button>
 )}
 <div className="flex gap-3 text-xs">
 {compliantCount > 0 && <span className="text-green-400">{compliantCount} ok</span>}
 {nonCompliantCount > 0 && <span className="text-red-400">{nonCompliantCount} fail</span>}
 </div>
 <div className={clsx(
 'text-lg font-bold tabular-nums',
 result.complianceScore >= 80 ? 'text-green-400'
 : result.complianceScore >= 50 ? 'text-yellow-400'
 : 'text-red-400'
 )}>
 {result.complianceScore.toFixed(0)}%
 </div>
 </div>
 </div>

 {/* Score bar */}
 <div className="h-1 bg-bg-primary">
 <div
 className={clsx(
 'h-full transition-all',
 result.complianceScore >= 80 ? 'bg-green-400'
 : result.complianceScore >= 50 ? 'bg-yellow-400'
 : 'bg-red-400'
 )}
 style={{ width: `${result.complianceScore}%` }}
 />
 </div>

 {/* Expanded: per-entry breakdown */}
 {isExpanded && (
 <div>
 {nonCompliantCount > 0 && (
 <div className="flex items-center gap-2 px-4 py-2 bg-bg-tertiary/80">
 <button
 onClick={(e) => { e.stopPropagation(); handleSwRemediateAll(result); }}
 className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 transition-colors coarse:min-h-10"
 >
 <Wrench className="w-3.5 h-3.5" />
 Remediate all ({nonCompliantCount})
 </button>
 </div>
 )}
 <div className="divide-y divide-border">
 {result.results.map((er) => {
 const isRemediating = swRemediating.has(`${result.listId}:${er.entryId}`);
 return (
 <div key={er.entryId} className="flex items-start gap-3 px-4 py-3">
 <div className="mt-0.5">
 {swEntryStatusIcon(er.status)}
 </div>
 <div className="flex-1 min-w-0">
 <span className="text-sm text-text-primary break-words">{er.entryName}</span>
 {er.matchedSoftware && (
 <p className="text-xs text-text-muted mt-0.5 max-lg:break-words">
 matched: <span className="font-mono">{er.matchedSoftware}</span>
 {er.matchedVersion && <span className="ml-1">v{er.matchedVersion}</span>}
 </p>
 )}
 {er.detail && (
 <p className="text-xs text-text-muted/60 mt-0.5">{er.detail}</p>
 )}
 </div>
 <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
 {er.remediationTriggered && (
 <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
 remediated
 </span>
 )}
 <span className={clsx(
 'text-xs font-medium capitalize',
 er.status === 'compliant' ? 'text-green-400'
 : er.status === 'non_compliant' ? 'text-red-400'
 : er.status === 'remediated' ? 'text-yellow-400'
 : er.status === 'remediation_failed' ? 'text-orange-400'
 : 'text-text-muted'
 )}>
 {er.status.replace('_', ' ')}
 </span>
 {er.status === 'non_compliant' && (
 <IconButton
 onClick={(e) => { e.stopPropagation(); handleSwRemediate(result.listId, [er.entryId]); }}
 disabled={isRemediating}
 size="sm"
 variant="primary"
 className="disabled:opacity-50"
 label={t('deviceDetail.compliance.remediate', 'Remediate')}
 icon={<Wrench className={clsx('w-3.5 h-3.5', isRemediating && 'animate-spin')} />}
 />
 )}
 </div>
 </div>
 );
 })}
 </div>
 </div>
 )}
 </div>
 );
 })}
 </div>
 </div>
 );
}

// ─── Device Settings Tab ─────────────────────────────────────────────────────

// ─── helpers ─────────────────────────────────────────────────────────────────

function ToggleRow({ label, description, value, onChange }: {
 label: string; description?: string; value: boolean; onChange: (v: boolean) => void;
}) {
 return (
 <div className="flex items-center justify-between gap-4">
 <div className="min-w-0">
 <p className="text-sm text-text-primary">{label}</p>
 {description && <p className="text-xs text-text-muted mt-0.5">{description}</p>}
 </div>
 <button onClick={() => onChange(!value)} className="shrink-0">
 {value ? <ToggleRight className="w-9 h-9 text-accent" /> : <ToggleLeft className="w-9 h-9 text-text-muted" />}
 </button>
 </div>
 );
}

// ─── DeviceSettingsTab ────────────────────────────────────────────────────────

function DeviceSettingsTab({ device, onSaved, adminMode, onDeleted, onManagePrivacyPassword }: {
 device: Device; onSaved: () => void; adminMode: boolean; onDeleted: () => void;
 onManagePrivacyPassword?: (mode: 'set' | 'change' | 'remove') => void;
}) {
 const emptyDisplayConfig = (): NonNullable<Device['displayConfig']> => ({
 hideCpu: false, hideMemory: false, hideDisk: false,
 hideNetwork: false, hideTemps: false, hideGpu: false,
 cpu: { hiddenCores: [], hiddenCharts: [], groupCoreThreads: false, tempSensor: null },
 ram: { hideUsed: false, hideFree: false, hideSwap: false, hiddenCharts: [] },
 gpu: { hiddenRows: [], hiddenCharts: [] },
 drives: { hiddenMounts: [], renames: {}, combineReadWrite: false },
 network: { hiddenInterfaces: [], renames: {}, combineInOut: false },
 temps: { hiddenLabels: [] },
 });

 const [form, setForm] = useState({
 // Identity
 displayName: device.displayName ?? '',
 description: device.description ?? '',
 // Tags
 tags: [...(device.tags ?? [])],
 tagInput: '',
 // Custom fields
 customFields: { ...(device.customFields ?? {}) } as Record<string, string>,
 cfKey: '',
 cfValue: '',
 // Monitoring
 overrideGroupSettings: device.overrideGroupSettings ?? false,
 pushIntervalSeconds: device.pushIntervalSeconds ?? null as number | null,
 scanIntervalSeconds: device.scanIntervalSeconds ?? null as number | null,
 maxMissedPushes: device.maxMissedPushes ?? 3,
 // Notifications
 notifOnline: device.notificationTypes?.online ?? true,
 notifOffline: device.notificationTypes?.offline ?? true,
 notifWarning: device.notificationTypes?.warning ?? true,
 notifCritical: device.notificationTypes?.critical ?? true,
 notifUpdate: device.notificationTypes?.update ?? false,
 // Display — section visibility
 hideCpu: device.displayConfig?.hideCpu ?? false,
 hideMemory: device.displayConfig?.hideMemory ?? false,
 hideDisk: device.displayConfig?.hideDisk ?? false,
 hideNetwork: device.displayConfig?.hideNetwork ?? false,
 hideTemps: device.displayConfig?.hideTemps ?? false,
 hideGpu: device.displayConfig?.hideGpu ?? false,
 // Display — CPU
 cpuGroupCoreThreads: device.displayConfig?.cpu?.groupCoreThreads ?? false,
 // Display — RAM
 ramHideSwap: device.displayConfig?.ram?.hideSwap ?? false,
 // Display — Drives
 driveCombineReadWrite: device.displayConfig?.drives?.combineReadWrite ?? false,
 // Display — Network
 networkCombineInOut: device.displayConfig?.network?.combineInOut ?? false,
 // Sensor renames
 sensorDisplayNames: { ...(device.sensorDisplayNames ?? {}) } as Record<string, string>,
 sensorKey: '',
 sensorValue: '',
 // Compliance
 complianceRemediationEnabled: device.complianceRemediationEnabled ?? true,
 // Asset Management
 purchaseDate: device.purchaseDate ?? '',
 warrantyExpiry: device.warrantyExpiry ?? '',
 warrantyVendor: device.warrantyVendor ?? '',
 expectedLifetimeYears: device.expectedLifetimeYears ?? null as number | null,
 // Lot D.2 — per-device threshold override (inherits from group then system)
 thresholdsOverride: { ...(device.thresholdsOverride ?? {}) } as import('@obliance/shared').MetricThresholds,
 });
 const [saving, setSaving] = useState(false);
 const [showTransferModal, setShowTransferModal] = useState(false);
 const { t } = useTranslation();
 const confirm = useConfirm();
 const formRef = useRef(form);
 formRef.current = form;
 const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
 // True while a persisted text field was edited but not yet saved (text
 // inputs save on blur). On Android, closing the keyboard with Back or
 // leaving the tab with the system Back gesture may never blur the field,
 // so pending edits are flushed on unmount (see effect below).
 const dirtyRef = useRef(false);
 const DRAFT_ONLY_KEYS: ReadonlyArray<string> = ['tagInput', 'cfKey', 'cfValue', 'sensorKey', 'sensorValue'];

 const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
 if (!DRAFT_ONLY_KEYS.includes(key as string)) dirtyRef.current = true;
 setForm(prev => ({ ...prev, [key]: value }));
 };

 // Auto-save: called on blur (text inputs) or immediately (toggles/selects)
 const autoSave = useCallback(() => {
 if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
 saveTimeoutRef.current = setTimeout(async () => {
 saveTimeoutRef.current = null;
 dirtyRef.current = false;
 const f = formRef.current;
 setSaving(true);
 try {
 const base = device.displayConfig ?? emptyDisplayConfig();
 const displayConfig: Device['displayConfig'] = {
 ...base,
 hideCpu: f.hideCpu, hideMemory: f.hideMemory, hideDisk: f.hideDisk,
 hideNetwork: f.hideNetwork, hideTemps: f.hideTemps, hideGpu: f.hideGpu,
 cpu: { ...(base.cpu ?? { hiddenCores: [], hiddenCharts: [], tempSensor: null }), groupCoreThreads: f.cpuGroupCoreThreads },
 ram: { ...(base.ram ?? { hideUsed: false, hideFree: false, hiddenCharts: [] }), hideSwap: f.ramHideSwap },
 drives: { ...(base.drives ?? { hiddenMounts: [], renames: {} }), combineReadWrite: f.driveCombineReadWrite },
 network:{ ...(base.network?? { hiddenInterfaces: [], renames: {} }), combineInOut: f.networkCombineInOut },
 };
 await deviceApi.update(device.id, {
 displayName: f.displayName || undefined,
 description: f.description || undefined,
 tags: f.tags, customFields: f.customFields,
 overrideGroupSettings: f.overrideGroupSettings,
 pushIntervalSeconds: f.overrideGroupSettings ? (f.pushIntervalSeconds ?? null) : null,
 scanIntervalSeconds: f.overrideGroupSettings ? (f.scanIntervalSeconds ?? null) : null,
 maxMissedPushes: f.maxMissedPushes,
 notificationTypes: { online: f.notifOnline, offline: f.notifOffline, warning: f.notifWarning, critical: f.notifCritical, update: f.notifUpdate },
 displayConfig, sensorDisplayNames: f.sensorDisplayNames,
 complianceRemediationEnabled: f.complianceRemediationEnabled,
 purchaseDate: f.purchaseDate || null,
 warrantyExpiry: f.warrantyExpiry || null,
 warrantyVendor: f.warrantyVendor || null,
 expectedLifetimeYears: f.expectedLifetimeYears,
 thresholdsOverride: f.thresholdsOverride,
 });
 onSaved();
 } catch {
 toast.error('Failed to save settings');
 } finally {
 setSaving(false);
 }
 }, 300);
 }, [device, onSaved]);

 // Flush unsaved text edits (or a pending debounced save) when the tab
 // unmounts — the scheduled callback reads formRef, so running it now
 // saves the latest values.
 const autoSaveRef = useRef(autoSave);
 autoSaveRef.current = autoSave;
 useEffect(() => () => {
 if (!dirtyRef.current && !saveTimeoutRef.current) return;
 if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
 autoSaveRef.current();
 }, []);

 // Resolved cascade up to (but not including) the device override —
 // i.e. what the device WOULD inherit if its own override were
 // cleared. Fed to ThresholdsEditor as `inheritedFrom` so the slot
 // placeholders show the inherited group/tenant/global values
 // instead of the system default.
 const [groupResolvedThresholds, setGroupResolvedThresholds] = useState<MetricThresholds | undefined>(undefined);
 useEffect(() => {
 const gid = (device as any).groupId as number | null | undefined;
 if (!gid) { setGroupResolvedThresholds(undefined); return; }
 import('@/api/thresholds.api').then(({ thresholdsApi, resolvedToInherited }) => {
 thresholdsApi.getGroupResolved(gid)
 .then((r) => setGroupResolvedThresholds(resolvedToInherited(r)))
 .catch(() => setGroupResolvedThresholds(undefined));
 });
 }, [(device as any).groupId]);

 // For toggles: set + auto-save immediately
 const setAndSave = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
 setForm(prev => ({ ...prev, [key]: value }));
 // Need a microtask so formRef picks up the new value
 setTimeout(() => autoSave(), 0);
 };

 // Tags
 const addTag = () => {
 const t = form.tagInput.trim();
 if (!t || form.tags.includes(t)) return;
 setForm(prev => ({ ...prev, tags: [...prev.tags, t], tagInput: '' }));
 setTimeout(() => autoSave(), 0);
 };
 const removeTag = (t: string) => {
 setForm(prev => ({ ...prev, tags: prev.tags.filter(x => x !== t) }));
 setTimeout(() => autoSave(), 0);
 };

 // Custom fields
 const addCf = () => {
 const k = form.cfKey.trim(), v = form.cfValue.trim();
 if (!k) return;
 setForm(prev => ({ ...prev, customFields: { ...prev.customFields, [k]: v }, cfKey: '', cfValue: '' }));
 setTimeout(() => autoSave(), 0);
 };
 const removeCf = (k: string) => {
 setForm(prev => { const next = { ...prev.customFields }; delete next[k]; return { ...prev, customFields: next }; });
 setTimeout(() => autoSave(), 0);
 };

 // Sensor renames
 const addSensor = () => {
 const k = form.sensorKey.trim(), v = form.sensorValue.trim();
 if (!k) return;
 setForm(prev => ({ ...prev, sensorDisplayNames: { ...prev.sensorDisplayNames, [k]: v }, sensorKey: '', sensorValue: '' }));
 setTimeout(() => autoSave(), 0);
 };
 const removeSensor = (k: string) => {
 setForm(prev => { const next = { ...prev.sensorDisplayNames }; delete next[k]; return { ...prev, sensorDisplayNames: next }; });
 setTimeout(() => autoSave(), 0);
 };



 const privacyPwdBlockedReason = device.privacyModeEnabled
 ? t('deviceDetail.reason.disablePrivacyFirst', 'Disable privacy mode on the device first')
 : !isAgentReachable(device.status) ? t('deviceDetail.reason.agentOnline', 'Agent must be online') : null;

 const inputCls = 'w-full px-3 py-2 text-sm bg-bg-primary rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:ring-1 focus:ring-accent';
 const cardCls = 'p-5 bg-bg-secondary rounded-xl space-y-4';
 const headCls = 'text-sm font-semibold text-text-muted uppercase tracking-wide';

 return (
 <div className="space-y-6 max-w-2xl">

 {/* ── Identity ── */}
 <div className={cardCls}>
 <h3 className={headCls}>Identity</h3>
 <div className="space-y-3">
 <label className="block">
 <span className="text-xs text-text-muted mb-1 block">Display name</span>
 <input type="text" value={form.displayName} onChange={e => set('displayName', e.target.value)}
 onBlur={autoSave} placeholder={device.hostname} className={inputCls} />
 </label>
 <label className="block">
 <span className="text-xs text-text-muted mb-1 block">Description</span>
 <textarea value={form.description} onChange={e => set('description', e.target.value)}
 onBlur={autoSave} rows={2} className={`${inputCls} resize-none`} />
 </label>
 </div>
 </div>

 {/* ── Asset Management ── */}
 <div className={cardCls}>
 <h3 className={headCls}>Asset Management</h3>
 <div className="space-y-3">
 <label className="block">
 <span className="text-xs text-text-muted mb-1 block">Purchase date</span>
 <input type="date" value={form.purchaseDate} onChange={e => set('purchaseDate', e.target.value)}
 onBlur={autoSave} className={inputCls} />
 </label>
 <label className="block">
 <span className="text-xs text-text-muted mb-1 block">Warranty expiry</span>
 <input type="date" value={form.warrantyExpiry} onChange={e => set('warrantyExpiry', e.target.value)}
 onBlur={autoSave} className={inputCls} />
 </label>
 <label className="block">
 <span className="text-xs text-text-muted mb-1 block">Warranty vendor</span>
 <input type="text" value={form.warrantyVendor} onChange={e => set('warrantyVendor', e.target.value)}
 onBlur={autoSave} placeholder="Dell, HP, Lenovo..." className={inputCls} />
 </label>
 <label className="block">
 <span className="text-xs text-text-muted mb-1 block">Expected lifetime (years)</span>
 <input type="number" min={1} max={20} value={form.expectedLifetimeYears ?? ''}
 onChange={e => set('expectedLifetimeYears', e.target.value ? parseInt(e.target.value) : null)}
 onBlur={autoSave} className={inputCls} />
 </label>
 </div>
 </div>

 {/* ── Lot D.2 — per-device threshold override ──
 Inherits from the device's group (which itself inherits from the
 system default). Empty fields mean "stay inherited". */}
 <div className={cardCls}>
 <h3 className={headCls}>Seuils personnalisés</h3>
 <ThresholdsEditor
 value={form.thresholdsOverride}
 onChange={(next) => { set('thresholdsOverride', next); autoSave(); }}
 inheritedFrom={groupResolvedThresholds}
 layer="device"
 />
 {/* Per-disk overrides — only shown when the agent has reported
 at least one mount. Removable/optical drives are filtered
 out by the editor itself. The "global" disk threshold above
 still applies to mounts not listed here. */}
 {(device.latestMetrics?.disks?.length ?? 0) > 0 && (
 <div className="mt-3 pt-3 ">
 <div className="text-xs uppercase text-text-muted tracking-wider mb-2">Override par disque</div>
 <PerDiskThresholdsEditor
 disks={device.latestMetrics!.disks!}
 value={form.thresholdsOverride}
 onChange={(next) => { set('thresholdsOverride', next); autoSave(); }}
 inheritedDisk={
 form.thresholdsOverride.disk?.warn != null && form.thresholdsOverride.disk?.crit != null
 ? { warn: form.thresholdsOverride.disk.warn, crit: form.thresholdsOverride.disk.crit }
 : SYSTEM_DEFAULT_THRESHOLDS.disk
 }
 />
 </div>
 )}
 </div>

 {/* ── Tags ── */}
 <div className={cardCls}>
 <h3 className={headCls}>Tags</h3>
 <div className="flex flex-wrap gap-1.5 min-h-[28px]">
 {form.tags.map(tag => (
 <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-accent/15 text-accent border border-accent/30">
 {tag}
 <IconButton
 onClick={() => removeTag(tag)}
 variant="plain"
 touchTarget="overlay"
 className="p-0 rounded-none text-current hover:text-red-400"
 label={t('deviceDetail.settings.removeTag', { defaultValue: 'Remove tag {{tag}}', tag })}
 showTooltip={false}
 icon={<X className="w-3 h-3" />}
 />
 </span>
 ))}
 {form.tags.length === 0 && <span className="text-xs text-text-muted italic">No tags</span>}
 </div>
 <div className="flex gap-2">
 <input type="text" value={form.tagInput} onChange={e => set('tagInput', e.target.value)}
 onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addTag())}
 placeholder="Add tag…" className={`${inputCls} flex-1`} />
 <button onClick={addTag} aria-label={t('common.add', 'Add')}
 className="px-3 py-2 text-sm rounded-lg bg-bg-primary border border-transparent text-text-muted hover:text-accent hover:border-accent/50 transition-colors">
 <Plus className="w-4 h-4" />
 </button>
 </div>
 </div>

 {/* ── Custom fields ── */}
 <div className={cardCls}>
 <h3 className={headCls}>Custom fields</h3>
 {Object.keys(form.customFields).length > 0 && (
 <div className="space-y-1">
 {Object.entries(form.customFields).map(([k, v]) => (
 <div key={k} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-bg-primary border border-transparent text-sm">
 <span className="font-mono text-accent shrink-0">{k}</span>
 <span className="text-text-muted">·</span>
 <span className="text-text-secondary flex-1 truncate">{v}</span>
 <IconButton
 onClick={() => removeCf(k)}
 variant="plain"
 touchTarget="overlay"
 className="shrink-0 p-0 rounded-none hover:text-red-400"
 label={t('common.delete', 'Delete')}
 showTooltip={false}
 icon={<X className="w-3.5 h-3.5" />}
 />
 </div>
 ))}
 </div>
 )}
 <div className="flex gap-2">
 <input type="text" value={form.cfKey} onChange={e => set('cfKey', e.target.value)}
 autoCapitalize="off" autoCorrect="off" spellCheck={false}
 placeholder="Key" className={`${inputCls} flex-1 min-w-0`} />
 <input type="text" value={form.cfValue} onChange={e => set('cfValue', e.target.value)}
 onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addCf())}
 placeholder="Value" className={`${inputCls} flex-1 min-w-0`} />
 <button onClick={addCf} aria-label={t('common.add', 'Add')}
 className="px-3 py-2 text-sm rounded-lg bg-bg-primary border border-transparent text-text-muted hover:text-accent hover:border-accent/50 transition-colors">
 <Plus className="w-4 h-4" />
 </button>
 </div>
 </div>

 {/* ── Monitoring ── */}
 <div className={cardCls}>
 <h3 className={headCls}>Monitoring</h3>
 <ToggleRow label="Override group settings"
 description="Apply per-device values instead of group / global defaults"
 value={form.overrideGroupSettings} onChange={v => setAndSave('overrideGroupSettings', v)} />
 {form.overrideGroupSettings && (
 <div className="space-y-3 pt-3 ">
 <label className="block">
 <span className="text-xs text-text-muted mb-1 block">Push interval (seconds)</span>
 <input type="number" min={1} max={3600}
 value={form.pushIntervalSeconds ?? ''}
 onChange={e => set('pushIntervalSeconds', e.target.value ? parseInt(e.target.value) : null)}
 onBlur={autoSave} placeholder="60" className={inputCls} />
 </label>
 <label className="block">
 <span className="text-xs text-text-muted mb-1 block">Scan interval (seconds) — 0 = disabled</span>
 <input type="number" min={0} max={86400}
 value={form.scanIntervalSeconds ?? ''}
 onChange={e => set('scanIntervalSeconds', e.target.value ? parseInt(e.target.value) : null)}
 onBlur={autoSave} placeholder="Inherit from group/global" className={inputCls} />
 </label>
 <label className="block">
 <span className="text-xs text-text-muted mb-1 block">Max missed pushes before offline</span>
 <input type="number" min={1} max={30}
 value={form.maxMissedPushes}
 onChange={e => set('maxMissedPushes', parseInt(e.target.value) || 3)}
 onBlur={autoSave} className={inputCls} />
 </label>
 </div>
 )}
 </div>

 {/* ── Notifications ── */}
 <div className={cardCls}>
 <h3 className={headCls}>Notifications</h3>
 <div className="space-y-3">
 <ToggleRow label="Device comes online" value={form.notifOnline} onChange={v => setAndSave('notifOnline', v)} />
 <ToggleRow label="Device goes offline" value={form.notifOffline} onChange={v => setAndSave('notifOffline', v)} />
 <ToggleRow label="Warning state" value={form.notifWarning} onChange={v => setAndSave('notifWarning', v)} />
 <ToggleRow label="Critical state" value={form.notifCritical} onChange={v => setAndSave('notifCritical', v)} />
 <ToggleRow label="Updates available" value={form.notifUpdate} onChange={v => setAndSave('notifUpdate', v)} />
 </div>
 </div>

 {/* ── Display ── */}
 <div className={cardCls}>
 <h3 className={headCls}>Display</h3>
 <p className="text-xs text-text-muted -mt-1">Hide or adjust sensors shown on the device monitoring page.</p>

 <div className="space-y-3">
 <p className="text-xs font-semibold text-text-muted uppercase tracking-wide pt-1">Section visibility</p>
 <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3">
 <ToggleRow label="Hide CPU" value={form.hideCpu} onChange={v => setAndSave('hideCpu', v)} />
 <ToggleRow label="Hide Memory" value={form.hideMemory} onChange={v => setAndSave('hideMemory', v)} />
 <ToggleRow label="Hide Disk" value={form.hideDisk} onChange={v => setAndSave('hideDisk', v)} />
 <ToggleRow label="Hide Network" value={form.hideNetwork} onChange={v => setAndSave('hideNetwork', v)} />
 <ToggleRow label="Hide Temps" value={form.hideTemps} onChange={v => setAndSave('hideTemps', v)} />
 <ToggleRow label="Hide GPU" value={form.hideGpu} onChange={v => setAndSave('hideGpu', v)} />
 </div>

 <div className="pt-2 space-y-3">
 <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">CPU</p>
 <ToggleRow label="Group core threads" description="Pair hyper-threaded cores together in charts"
 value={form.cpuGroupCoreThreads} onChange={v => setAndSave('cpuGroupCoreThreads', v)} />
 </div>

 <div className="pt-2 space-y-3">
 <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">RAM</p>
 <ToggleRow label="Hide swap" value={form.ramHideSwap} onChange={v => setAndSave('ramHideSwap', v)} />
 </div>

 <div className="pt-2 space-y-3">
 <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">Drives</p>
 <ToggleRow label="Combine read/write chart"
 description="Show a single combined I/O chart instead of separate read and write"
 value={form.driveCombineReadWrite} onChange={v => setAndSave('driveCombineReadWrite', v)} />
 </div>

 <div className="pt-2 space-y-3">
 <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">Network</p>
 <ToggleRow label="Combine in/out chart"
 description="Show a single combined bandwidth chart instead of separate upload and download"
 value={form.networkCombineInOut} onChange={v => setAndSave('networkCombineInOut', v)} />
 </div>
 </div>
 </div>

 {/* ── Sensor renames ── */}
 <div className={cardCls}>
 <h3 className={headCls}>Sensor display names</h3>
 <p className="text-xs text-text-muted -mt-1">Override sensor labels shown in the UI (key = raw sensor name, value = display name).</p>
 {Object.keys(form.sensorDisplayNames).length > 0 && (
 <div className="space-y-1">
 {Object.entries(form.sensorDisplayNames).map(([k, v]) => (
 <div key={k} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-bg-primary border border-transparent text-sm">
 <span className="font-mono text-text-muted shrink-0 truncate max-w-[40%]">{k}</span>
 <ChevronRight className="w-3.5 h-3.5 text-text-muted shrink-0" />
 <span className="text-text-primary flex-1 truncate">{v}</span>
 <IconButton
 onClick={() => removeSensor(k)}
 variant="plain"
 touchTarget="overlay"
 className="shrink-0 p-0 rounded-none hover:text-red-400"
 label={t('common.delete', 'Delete')}
 showTooltip={false}
 icon={<X className="w-3.5 h-3.5" />}
 />
 </div>
 ))}
 </div>
 )}
 <div className="flex gap-2">
 <input type="text" value={form.sensorKey} onChange={e => set('sensorKey', e.target.value)}
 autoCapitalize="off" autoCorrect="off" spellCheck={false}
 placeholder="Raw sensor name" className={`${inputCls} flex-1 min-w-0`} />
 <input type="text" value={form.sensorValue} onChange={e => set('sensorValue', e.target.value)}
 onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addSensor())}
 placeholder="Display name" className={`${inputCls} flex-1 min-w-0`} />
 <button onClick={addSensor} aria-label={t('common.add', 'Add')}
 className="px-3 py-2 text-sm rounded-lg bg-bg-primary border border-transparent text-text-muted hover:text-accent hover:border-accent/50 transition-colors">
 <Plus className="w-4 h-4" />
 </button>
 </div>
 </div>

 {/* ── Compliance ── */}
 <div className={cardCls}>
 <h3 className={headCls}>Compliance</h3>
 <ToggleRow label="Auto-remediation"
 description="Allow compliance policies to automatically run fix scripts on this device. Disable if this device must remain in a specific state (e.g. firewall intentionally off)."
 value={form.complianceRemediationEnabled}
 onChange={v => setAndSave('complianceRemediationEnabled', v)} />
 {!form.complianceRemediationEnabled && (
 <div className="flex items-start gap-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-xs text-yellow-400">
 <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
 <span>Auto-remediation is disabled. Failing rules will be reported but no fix scripts will run on this device.</span>
 </div>
 )}
 </div>

 {/* ── Auto-save indicator ── */}
 {saving && (
 <div className="flex items-center gap-2 justify-end text-xs text-text-muted">
 <Loader2 className="w-3 h-3 animate-spin" />
 Saving…
 </div>
 )}

 {/* ── Privacy mode remote toggle ── */}
 {adminMode && (
 <div className="p-5 bg-bg-secondary rounded-xl space-y-4">
 <div className="flex items-center justify-between gap-4">
 <div>
 <h3 className="text-sm font-semibold text-text-primary uppercase tracking-wide flex items-center gap-2">
 <Shield className="w-4 h-4 text-orange-400" />
 Privacy mode
 </h3>
 <p className="text-xs text-text-muted mt-1">
 When enabled, the agent refuses remote-access commands (scripts, processes, files, remote control). The user can also toggle it locally from the tray icon.
 </p>
 </div>
 <div className="shrink-0">
 {device.privacyModeEnabled ? (
 <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-orange-400/10 text-orange-400 border border-orange-400/30">
 <Shield className="w-3 h-3" />
 Active
 </span>
 ) : (
 <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-bg-tertiary text-text-muted border border-transparent">
 Off
 </span>
 )}
 </div>
 </div>

 <div className="flex items-center gap-2 flex-wrap">
 {!device.privacyModeEnabled ? (
 <DisabledTip reason={!isAgentReachable(device.status) && t('deviceDetail.reason.agentOnline', 'Agent must be online')}>
 <button
 onClick={async () => {
 if (!(await confirm(t('deviceDetail.privacy.enableConfirm', 'Enable privacy mode on this device? Remote-access features will be blocked until it is turned off (locally via the tray icon or remotely from here).')))) return;
 try {
 await deviceApi.enablePrivacyMode(device.id);
 toast.success('Privacy mode enable command sent');
 setTimeout(onSaved, 1500);
 } catch { toast.error('Failed to send enable command'); }
 }}
 disabled={!isAgentReachable(device.status)}
 className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg border border-orange-400/40 text-orange-400 hover:bg-orange-400/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
 >
 <Shield className="w-3.5 h-3.5" />
 Enable privacy mode
 </button>
 </DisabledTip>
 ) : (
 <p className="text-xs text-text-muted">
 Privacy mode is currently active. Use the Disable button in the top header bar (or the tray icon on the machine) to turn it off.
 </p>
 )}
 </div>
 </div>
 )}

 {/* ── Privacy password (gate) ── */}
 {adminMode && (
 <div className="p-5 bg-bg-secondary rounded-xl space-y-4">
 <div className="flex items-center justify-between gap-4">
 <div>
 <h3 className="text-sm font-semibold text-text-primary uppercase tracking-wide flex items-center gap-2">
 <Lock className="w-4 h-4 text-accent" />
 Privacy password
 </h3>
 <p className="text-xs text-text-muted mt-1">
 Local password stored on the agent. Required to unlock privacy-blocked features from the console or to disable privacy mode remotely. Obliance never stores the password itself — only whether one is set.
 </p>
 </div>
 <div className="shrink-0">
 {device.privacyPasswordSet ? (
 <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-green-500/10 text-green-400 border border-green-400/30">
 <Lock className="w-3 h-3" />
 Set
 </span>
 ) : (
 <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-bg-tertiary text-text-muted border border-transparent">
 Not set
 </span>
 )}
 </div>
 </div>

 <div className="flex items-center gap-2 flex-wrap">
 {!device.privacyPasswordSet && (
 <DisabledTip reason={privacyPwdBlockedReason}>
 <button
 onClick={() => onManagePrivacyPassword?.('set')}
 disabled={device.privacyModeEnabled || !isAgentReachable(device.status)}
 className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg border border-accent/40 text-accent hover:bg-accent/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
 >
 <Lock className="w-3.5 h-3.5" />
 Set password
 </button>
 </DisabledTip>
 )}
 {device.privacyPasswordSet && (
 <>
 <DisabledTip reason={privacyPwdBlockedReason}>
 <button
 onClick={() => onManagePrivacyPassword?.('change')}
 disabled={device.privacyModeEnabled || !isAgentReachable(device.status)}
 className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg border border-accent/40 text-accent hover:bg-accent/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
 >
 <Lock className="w-3.5 h-3.5" />
 Change password
 </button>
 </DisabledTip>
 <DisabledTip reason={privacyPwdBlockedReason}>
 <button
 onClick={() => onManagePrivacyPassword?.('remove')}
 disabled={device.privacyModeEnabled || !isAgentReachable(device.status)}
 className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg border border-red-500/40 text-red-400 hover:bg-red-500/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
 >
 <Trash2 className="w-3.5 h-3.5" />
 Remove password
 </button>
 </DisabledTip>
 </>
 )}
 </div>
 </div>
 )}

 {/* ── Danger Zone ── */}
 {adminMode && (
 <div className="p-5 bg-bg-secondary border border-red-500/30 rounded-xl space-y-4">
 <h3 className="text-sm font-semibold text-red-400 uppercase tracking-wide">Danger Zone</h3>

 {/* Transfer to another tenant */}
 <div className="flex items-center justify-between gap-4 max-sm:flex-col max-sm:items-start max-sm:gap-2">
 <div>
 <p className="text-sm text-text-primary">Transfer to another tenant</p>
 <p className="text-xs text-text-muted mt-0.5">
 Move this device to a different tenant you are admin of. Group, custom metrics,
 schedule alerts and compliance results in the current tenant are cleared.
 The agent is reconfigured with the target tenant's API key on its next check-in.
 </p>
 </div>
 <button
 onClick={() => setShowTransferModal(true)}
 className="shrink-0 flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg border border-accent/40 text-accent hover:bg-accent/10 transition-colors"
 >
 <ArrowRightLeft className="w-3.5 h-3.5" />
 Transfer
 </button>
 </div>

 <div className="h-px bg-border" />

 {/* Delete */}
 <div className="flex items-center justify-between gap-4 max-sm:flex-col max-sm:items-start max-sm:gap-2">
 <div>
 <p className="text-sm text-text-primary">Delete device</p>
 <p className="text-xs text-text-muted mt-0.5">
 Removes this device from Obliance. The agent is <span className="text-text-primary">not</span> uninstalled
 — it will re-register on the next push.
 </p>
 </div>
 <button
 onClick={async () => {
 const name = anonymize(device.displayName || device.hostname);
 if (!(await confirm({
 message: t('deviceDetail.settings.deleteConfirm', { defaultValue: 'Delete "{{name}}" from Obliance?\n\nThe agent is NOT uninstalled — it will re-register on the next push.', name }),
 danger: true,
 }))) return;
 try {
 await deviceApi.delete(device.id);
 toast.success(`Device "${name}" deleted`);
 onDeleted();
 } catch {
 toast.error('Failed to delete device');
 }
 }}
 className="shrink-0 flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg border border-red-500/40 text-red-400 hover:bg-red-500/10 transition-colors"
 >
 <Trash2 className="w-3.5 h-3.5" />
 Delete
 </button>
 </div>

 <div className="h-px bg-border" />

 {/* Uninstall */}
 <div className="flex items-center justify-between gap-4 max-sm:flex-col max-sm:items-start max-sm:gap-2">
 <div>
 <p className="text-sm text-text-primary">Uninstall agent</p>
 {device.status === 'pending_uninstall' ? (
 <p className="text-xs text-orange-400 mt-0.5 animate-pulse">
 Uninstall in progress — agent is being removed from the machine.
 Device disappears from all lists and will reappear automatically if the agent doesn't confirm.
 </p>
 ) : (
 <p className="text-xs text-text-muted mt-0.5">
 Immediately uninstalls the agent on the machine. The device disappears
 from all lists at once and is permanently deleted when the agent confirms.
 If the agent doesn't respond within <span className="text-text-primary">10 min</span>, the device comes back.
 </p>
 )}
 </div>
 {device.status === 'pending_uninstall' ? (
 <button
 onClick={async () => {
 try {
 await deviceApi.cancelUninstall(device.id);
 toast.success('Uninstall cancelled — device restored');
 onSaved();
 } catch {
 toast.error('Failed to cancel uninstall');
 }
 }}
 className="shrink-0 flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg border border-orange-500/40 text-orange-400 hover:bg-orange-500/10 transition-colors"
 >
 <Power className="w-3.5 h-3.5" />
 Cancel
 </button>
 ) : (
 <button
 onClick={async () => {
 const name = anonymize(device.displayName || device.hostname);
 if (!(await confirm({
 message: t('deviceDetail.settings.uninstallConfirm', { defaultValue: 'Uninstall agent on "{{name}}"?\n\nThe agent will be removed immediately.\nIf it doesn\'t confirm within 10 min, the device will reappear.', name }),
 danger: true,
 confirmLabel: t('deviceDetail.settings.uninstall', 'Uninstall'),
 }))) return;
 try {
 await deviceApi.initiateUninstall(device.id);
 toast.success('Uninstall command sent — device hidden from all lists');
 onSaved();
 } catch {
 toast.error('Failed to send uninstall command');
 }
 }}
 className="shrink-0 flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg border border-orange-500/40 text-orange-400 hover:bg-orange-500/10 transition-colors"
 >
 <Power className="w-3.5 h-3.5" />
 Uninstall
 </button>
 )}
 </div>
 </div>
 )}

 {showTransferModal && (
 <TransferTenantModal
 deviceId={device.id}
 deviceName={anonymize(device.displayName || device.hostname)}
 onClose={() => setShowTransferModal(false)}
 onTransferred={onDeleted}
 />
 )}
 </div>
 );
}

// ─── Remote Tab ──────────────────────────────────────────────────────────────

function RemoteTab({ device }: { device: Device }) {
 const { t } = useTranslation();
 const [sessions, setSessions] = useState<RemoteSession[]>([]);
 const [isLoading, setIsLoading] = useState(false);
 const [isStarting, setIsStarting] = useState(false);
 // Oblireach modal open flag. Shell sessions (SSH/CMD/PowerShell) now
 // live in the global multi-session panel.
 const [orModalOpen, setOrModalOpen] = useState(false);
 const [orSession, setOrSession] = useState<RemoteSession | null>(null);
 // Track the session ID we are personally waiting for so a concurrent
 // session started by another user doesn't overwrite our modal state.
 const pendingSshId = useRef<string | null>(null);
 const pendingOrId = useRef<string | null>(null);
 const [endingSession, setEndingSession] = useState<Set<string>>(new Set());
 // null = unknown (loading), false = not installed, true = installed
 const [orInstalled, setOrInstalled] = useState<boolean | null>(null);
 const [orSessions, setOrSessions] = useState<ObliReachSession[]>([]);
 const [orSessionPickerOpen, setOrSessionPickerOpen] = useState(false);
 // Remember the wtsSessionId used for the current Oblireach session so the
 // ObliReachViewer's onReconnect prop can redial the same target after a
 // Winlogon→user-session transition (login via CAD) tears the tunnel down.
 const orWtsSessionIdRef = useRef<number | undefined>(undefined);
 // Shell session picker (cmd/powershell — choose SYSTEM or user session)
 const [shellSessionPickerOpen, setShellSessionPickerOpen] = useState(false);
 const [shellWtsSessions, setShellWtsSessions] = useState<{ id: number; username: string; domain: string; state: string; name: string }[]>([]);
 const pendingShellProtocol = useRef<'cmd' | 'powershell' | 'ssh'>('cmd');
 const [orVersion, setOrVersion] = useState<string | null>(null);
 const [orLatestVersion, setOrLatestVersion] = useState<string | null>(null);
 const [isUpdatingOr, setIsUpdatingOr] = useState(false);

 useEffect(() => {
 remoteApi.listObliReachDeviceUuids().then((uuids) => {
 const installed = device.uuid ? uuids.has(device.uuid) : false;
 setOrInstalled(installed);
 if (installed && device.uuid) {
 // Fetch current agent version and latest available version in parallel
 Promise.all([
 remoteApi.getObliReachDevice(device.uuid),
 remoteApi.getObliReachLatestVersion(),
 ]).then(([dev, latest]) => {
 setOrVersion(dev?.version ?? null);
 setOrLatestVersion(latest);
 });
 }
 }).catch(() => setOrInstalled(false));
 }, [device.uuid]);

 useEffect(() => {
 const load = async () => {
 setIsLoading(true);
 try {
 const result = await remoteApi.listSessions({ deviceId: device.id });
 setSessions(result.items);
 } catch {
 toast.error('Failed to load sessions');
 } finally {
 setIsLoading(false);
 }
 };
 load();
 }, [device.id]);

 // Real-time session status updates via socket
 useEffect(() => {
 const socket = getSocket();
 if (!socket) return;

 const onSessionUpdated = (session: RemoteSession) => {
 if (session.deviceId !== device.id) return;
 setSessions((prev) => prev.map((s) => s.id === session.id ? session : s));
 };

 const onTunnelReady = (session: RemoteSession) => {
 if (session.deviceId !== device.id) return;
 setSessions((prev) => prev.map((s) => s.id === session.id ? session : s));
 // Only update the modal if this is the session WE started — not a
 // concurrent session opened by another user on the same device.
 if ((session.protocol === 'ssh' || session.protocol === 'cmd' || session.protocol === 'powershell') && session.id === pendingSshId.current) {
 pendingSshId.current = null;
 // Shell sessions are managed by GlobalShellPanel via the global store.
 } else if (session.protocol === 'oblireach' && session.id === pendingOrId.current) {
 setOrSession(session);
 pendingOrId.current = null;
 }
 };

 socket.on('REMOTE_SESSION_UPDATED', onSessionUpdated);
 socket.on('REMOTE_TUNNEL_READY', onTunnelReady);

 return () => {
 socket.off('REMOTE_SESSION_UPDATED', onSessionUpdated);
 socket.off('REMOTE_TUNNEL_READY', onTunnelReady);
 };
 }, [device.id]);

 const isShellProtocol = (p: string) => p === 'ssh' || p === 'cmd' || p === 'powershell';

 const handleInstallOblireach = async () => {
 if (!isOnline) { toast.error('Device is offline'); return; }
 try {
 await commandApi.enqueue(device.id, 'install_oblireach', {}, 'high');
 toast.success('Install command sent — the Oblireach agent will be deployed shortly.');
 } catch {
 toast.error('Failed to send install command');
 }
 };

 const handleUpdateOblireach = async () => {
 if (!device.uuid) return;
 setIsUpdatingOr(true);
 try {
 await remoteApi.queueObliReachUpdate(device.uuid);
 toast.success('Update command queued — Oblireach will update on its next heartbeat.');
 } catch {
 toast.error('Failed to queue update command');
 } finally {
 setIsUpdatingOr(false);
 }
 };

 /** Returns true when the Oblireach agent version is strictly older than the latest available. */
 const orUpdateAvailable =
 orInstalled === true &&
 orVersion != null &&
 orLatestVersion != null &&
 orVersion !== orLatestVersion &&
 (() => {
 const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number);
 const [cm, cmi, cp] = parse(orVersion);
 const [lm, lmi, lp] = parse(orLatestVersion);
 if (cm !== lm) return cm < lm;
 if (cmi !== lmi) return cmi < lmi;
 return cp < lp;
 })();

 const handleStartObliReachSession = async (wtsSessionId?: number) => {
 setOrSessionPickerOpen(false);
 setOrSession(null);
 setOrModalOpen(true);
 setIsStarting(true);
 orWtsSessionIdRef.current = wtsSessionId;
 try {
 const session = await remoteApi.startSession(device.id, 'oblireach', undefined, wtsSessionId);
 pendingOrId.current = session.id;
 setSessions((prev) => [session, ...prev]);
 } catch {
 toast.error('Failed to start remote session');
 setOrModalOpen(false);
 } finally {
 setIsStarting(false);
 }
 };

 // Triggered by ObliReachViewer when its WebSocket closes unexpectedly
 // (typical cause: operator logged the console target in through the CAD
 // screen → Winlogon→user-session transition tore down the tunnel). We
 // recreate a fresh session on the same device + same WTS session ID,
 // which flips the sessionToken prop on the viewer and reopens its WS.
 const handleReconnectObliReach = async () => {
 const session = await remoteApi.startSession(
 device.id, 'oblireach', undefined, orWtsSessionIdRef.current,
 );
 pendingOrId.current = session.id;
 setSessions((prev) => [session, ...prev]);
 setOrSession(session);
 };

 const handleStartSession = async (protocol: 'oblireach' | 'rdp' | 'ssh' | 'cmd' | 'powershell') => {
 // Open the modal immediately so the user sees a connecting overlay
 // instead of waiting for REMOTE_TUNNEL_READY (which can take several seconds).
 // If Oblireach agent not installed, redirect to install flow
 if (protocol === 'oblireach' && orInstalled === false) {
 handleInstallOblireach();
 return;
 }
 if (protocol === 'oblireach') {
 // Fetch session list — show picker if multiple sessions available.
 try {
 const sessions = await remoteApi.getObliReachSessions(device.uuid ?? '');
 if (sessions.length > 1) {
 setOrSessions(sessions);
 setOrSessionPickerOpen(true);
 return;
 }
 // Single session (or none) — launch directly with that session ID.
 await handleStartObliReachSession(sessions[0]?.id);
 } catch {
 await handleStartObliReachSession(undefined);
 }
 return;
 }
 if (isShellProtocol(protocol) && device.osType === 'windows' && (protocol === 'cmd' || protocol === 'powershell')) {
 // On Windows, fetch WTS sessions to let user choose SYSTEM vs user session
 pendingShellProtocol.current = protocol;
 try {
 const res = await commandApi.enqueue(device.id, 'list_wts_sessions', {}, 'high');
 // The result will come async via command result — but for simplicity,
 // we'll wait a bit for the command to complete, or open picker with just SYSTEM option
 // Actually, use the direct command channel: send and listen for result
 setShellWtsSessions([]);
 setShellSessionPickerOpen(true);
 // Listen for the command result
 const onResult = (cmd: Command) => {
 if (cmd.id !== res.id) return;
 if (cmd.status === 'success' && cmd.result) {
 const sessions = (cmd.result as any)?.sessions ?? [];
 setShellWtsSessions(sessions);
 }
 };
 const socket = getSocket();
 socket?.on('COMMAND_UPDATED', onResult);
 // Cleanup after 10s
 setTimeout(() => {
 socket?.off('COMMAND_UPDATED', onResult);
 }, 10_000);
 } catch {
 // Failed to list sessions — open directly as SYSTEM
 startShellSession(protocol);
 }
 return;
 }
 if (isShellProtocol(protocol)) {
 startShellSession(protocol);
 }
 };

 const startShellSession = async (protocol: 'ssh' | 'cmd' | 'powershell', wtsSessionId?: number) => {
 setShellSessionPickerOpen(false);
 setIsStarting(true);
 try {
 const session = await remoteApi.startSession(device.id, protocol, undefined, wtsSessionId);
 pendingSshId.current = session.id;
 setSessions((prev) => [session, ...prev]);

 // Push to the global multi-session panel instead of opening a
 // modal local to this page — the user can then minimize, tab
 // between shells, and it survives route changes.
 const deviceName = anonymize(device.displayName || device.hostname) || `#${device.id}`;
 const { useRemoteShellStore } = await import('@/store/remoteShellStore');
 const add = () => useRemoteShellStore.getState().addSession({
 id: session.sessionToken,
 deviceId: device.id,
 deviceName,
 protocol,
 sessionToken: session.sessionToken,
   serverSessionId: session.id,
 });
 const socket = getSocket();
 if (socket) {
 const onReady = (s: RemoteSession) => {
 if (s.deviceId !== device.id || s.id !== session.id) return;
 socket.off('REMOTE_TUNNEL_READY', onReady);
 add();
 };
 socket.on('REMOTE_TUNNEL_READY', onReady);
 setTimeout(() => {
 socket.off('REMOTE_TUNNEL_READY', onReady);
 const already = useRemoteShellStore.getState().sessions.find((x) => x.id === session.sessionToken);
 if (!already) add();
 }, 1500);
 } else {
 add();
 }
 } catch {
 toast.error('Failed to start remote session');
 } finally {
 setIsStarting(false);
 }
 };

 const handleEndSession = async (session: RemoteSession) => {
 setEndingSession((prev) => new Set(prev).add(session.id));
 try {
 await remoteApi.endSession(session.id);
 setSessions((prev) => prev.map((s) =>
 s.id === session.id ? { ...s, status: 'expired' as const } : s,
 ));
 } catch {
 toast.error('Failed to end session');
 } finally {
 setEndingSession((prev) => { const next = new Set(prev); next.delete(session.id); return next; });
 }
 };

 const isOnline = isAgentReachable(device.status);

 return (
 <>
 {orModalOpen && (
 <ObliReachViewer
 sessionToken={orSession?.sessionToken ?? null}
 deviceName={anonymize(device.displayName || device.hostname)}
 preferredCodec={useAuthStore.getState().user?.preferences?.preferredCodec}
 onClose={async () => {
 if (orSession) try { await remoteApi.endSession(orSession.id); } catch {}
 setOrModalOpen(false);
 setOrSession(null);
 }}
 onReconnect={handleReconnectObliReach}
 />
 )}
 {/* WTS Session picker — shown on RDS when multiple sessions are available */}
 <Modal
 open={orSessionPickerOpen}
 onClose={() => setOrSessionPickerOpen(false)}
 title={t('deviceDetail.remote.chooseSession', 'Choose Session')}
 icon={<MonitorPlay className="w-4 h-4 text-accent" />}
 size="sm"
 phoneLayout="sheet"
 closeOnBackdrop={false}
 className="sm:max-w-sm"
 bodyClassName="p-3"
 >
 <div className="space-y-1 sm:max-h-72 sm:overflow-y-auto">
 {orSessions.map((s) => (
 <button
 key={s.id}
 onClick={() => handleStartObliReachSession(s.id)}
 className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-bg-tertiary transition-colors flex items-center gap-3 coarse:min-h-12"
 >
 <div className={clsx(
 'w-2 h-2 rounded-full flex-shrink-0',
 s.state === 'Active' ? 'bg-green-400' :
 s.state === 'Disconnected' ? 'bg-yellow-400' : 'bg-gray-400',
 )} />
 <div className="min-w-0 flex-1">
 <div className="text-sm font-medium text-text-primary truncate">
 {s.username || '(no user)'}
 </div>
 <div className="text-xs text-text-muted">
 {s.state}{s.isConsole ? ' · Console' : ''}{s.stationName ? ` · ${s.stationName}` : ''}
 </div>
 </div>
 </button>
 ))}
 </div>
 </Modal>
 <Modal
 open={shellSessionPickerOpen}
 onClose={() => setShellSessionPickerOpen(false)}
 title={<>{pendingShellProtocol.current === 'powershell' ? 'PowerShell' : 'CMD'} — {t('deviceDetail.remote.chooseContext', 'Choose Context')}</>}
 icon={<TerminalSquare className="w-4 h-4 text-accent" />}
 size="sm"
 phoneLayout="sheet"
 closeOnBackdrop={false}
 className="sm:max-w-sm"
 bodyClassName="p-3"
 >
 <div className="space-y-1 sm:max-h-72 sm:overflow-y-auto">
 <button
 onClick={() => startShellSession(pendingShellProtocol.current)}
 className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-bg-tertiary transition-colors flex items-center gap-3 coarse:min-h-12"
 >
 <div className="w-2 h-2 rounded-full flex-shrink-0 bg-blue-400" />
 <div className="min-w-0 flex-1">
 <div className="text-sm font-medium text-text-primary">SYSTEM</div>
 <div className="text-xs text-text-muted">Run as NT AUTHORITY\SYSTEM</div>
 </div>
 </button>
 {shellWtsSessions.map((s) => (
 <button
 key={s.id}
 onClick={() => startShellSession(pendingShellProtocol.current, s.id)}
 className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-bg-tertiary transition-colors flex items-center gap-3 coarse:min-h-12"
 >
 <div className={clsx(
 'w-2 h-2 rounded-full flex-shrink-0',
 s.state === 'active' ? 'bg-green-400' :
 s.state === 'disconnected' ? 'bg-yellow-400' : 'bg-gray-400',
 )} />
 <div className="min-w-0 flex-1">
 <div className="text-sm font-medium text-text-primary truncate">
 {s.domain ? `${s.domain}\\${s.username}` : s.username}
 </div>
 <div className="text-xs text-text-muted">
 Session {s.id}{s.name ? ` · ${s.name}` : ''} · {s.state}
 </div>
 </div>
 </button>
 ))}
 {shellWtsSessions.length === 0 && (
 <div className="px-3 py-2 text-xs text-text-muted flex items-center gap-2">
 <RefreshCw className="w-3 h-3 animate-spin" />
 Loading user sessions…
 </div>
 )}
 </div>
 </Modal>
 {/* Shell sessions now render in the global GlobalShellPanel. */}
 <div className="space-y-4">
 {/* Start session buttons */}
 <div className="p-4 bg-bg-secondary rounded-xl space-y-3">
 <h3 className="text-sm font-semibold text-text-primary">Start Remote Session</h3>
 {!isOnline && (
 <p className="text-sm text-yellow-400 flex items-center gap-2">
 <WifiOff className="w-4 h-4" />
 Device is offline — remote access unavailable
 </p>
 )}
 <div className="flex flex-wrap gap-2">
 {/* Oblireach — Windows and macOS only */}
 {device.osType !== 'linux' && (
 <>
 {orInstalled === true ? (
 <button
 onClick={() => handleStartSession('oblireach')}
 disabled={!isOnline || isStarting}
 className="flex items-center gap-2 px-4 py-2 bg-accent/10 text-accent border border-accent/30 rounded-lg hover:bg-accent/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
 >
 <MonitorPlay className="w-4 h-4" />
 Reach
 </button>
 ) : (
 <DisabledTip reason={
 (!isOnline || isStarting || orInstalled === null || !isCommandSupported(device, 'install_oblireach'))
 && (!isCommandSupported(device, 'install_oblireach') ? unsupportedTooltip(t) : (orInstalled === null ? t('deviceDetail.reason.reachChecking', 'Checking Oblireach status…') : t('deviceDetail.reason.reachNotInstalled', 'Oblireach agent not installed — click to deploy')))
 }>
 <button
 onClick={orInstalled === false ? () => handleInstallOblireach() : undefined}
 disabled={!isOnline || isStarting || orInstalled === null || !isCommandSupported(device, 'install_oblireach')}
 title={!isCommandSupported(device, 'install_oblireach') ? unsupportedTooltip(t) : (orInstalled === null ? t('deviceDetail.reason.reachChecking', 'Checking Oblireach status…') : t('deviceDetail.reason.reachNotInstalled', 'Oblireach agent not installed — click to deploy'))}
 className="flex items-center gap-2 px-4 py-2 bg-gray-500/10 text-gray-400 border border-gray-500/30 rounded-lg hover:bg-yellow-500/10 hover:text-yellow-400 hover:border-yellow-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
 >
 <MonitorPlay className="w-4 h-4" />
 Reach
 <span className="text-xs opacity-70">
 {orInstalled === null ? '…' : '(install)'}
 </span>
 </button>
 </DisabledTip>
 )}
 {/* Update available badge */}
 {orUpdateAvailable && (
 <button
 onClick={handleUpdateOblireach}
 disabled={isUpdatingOr}
 title={`Update Oblireach: v${orVersion} → v${orLatestVersion}`}
 className="flex items-center gap-1.5 px-3 py-2 bg-yellow-500/10 text-yellow-400 border border-yellow-500/30 rounded-lg hover:bg-yellow-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-xs font-medium"
 >
 <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
 <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
 </svg>
 {isUpdatingOr ? 'Queuing…' : `Update Reach → v${orLatestVersion}`}
 </button>
 )}
 </>
 )}
 {/* Other protocols */}
 {(
 device.osType === 'windows' ? (['cmd', 'powershell'] as const) :
 device.osType === 'macos' ? (['ssh'] as const) :
 (['ssh'] as const)
 ).map((proto) => (
 <button
 key={proto}
 onClick={() => handleStartSession(proto)}
 disabled={!isOnline || isStarting}
 className="flex items-center gap-2 px-4 py-2 bg-accent/10 text-accent border border-accent/30 rounded-lg hover:bg-accent/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
 >
 <MonitorPlay className="w-4 h-4" />
 {proto === 'powershell' ? 'PowerShell' : proto.toUpperCase()}
 </button>
 ))}
 </div>
 </div>

 {/* Session history */}
 <div className="bg-bg-secondary rounded-xl overflow-hidden">
 <div className="px-4 py-3 ">
 <h3 className="text-sm font-semibold text-text-primary">Session History</h3>
 </div>
 {isLoading ? (
 <div className="flex items-center justify-center h-24"><RefreshCw className="w-4 h-4 animate-spin text-text-muted" /></div>
 ) : sessions.length === 0 ? (
 <div className="p-6 text-center text-text-muted text-sm">No remote sessions yet</div>
 ) : (
 <div className="divide-y divide-border">
 {sessions.map((session) => (
 <div key={session.id} className="px-4 py-3 flex items-center gap-4 max-sm:gap-2">
 <div className="flex-1 min-w-0">
 <div className="flex items-center gap-2">
 <p className="text-sm text-text-primary">{session.protocol.toUpperCase()}</p>
 <span className={clsx(
 'text-xs px-2 py-0.5 rounded-full border',
 session.status === 'active' ? 'text-green-400 bg-green-400/10 border-green-400/30' :
 session.status === 'waiting' ? 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30 animate-pulse' :
 session.status === 'connecting' ? 'text-blue-400 bg-blue-400/10 border-blue-400/30 animate-pulse' :
 session.status === 'failed' ? 'text-red-400 bg-red-400/10 border-red-400/30' :
 session.status === 'timeout' ? 'text-orange-400 bg-orange-400/10 border-orange-400/30' :
 'text-gray-400 bg-gray-400/10 border-gray-400/30',
 )}>
 {session.status}
 </span>
 </div>
 <p className="text-xs text-text-muted mt-0.5">
 {session.startedByUser && (
 <span className="text-text-primary">{session.startedByUser.displayName || session.startedByUser.username} · </span>
 )}
 {new Date(session.startedAt).toLocaleString()}
 {session.durationSeconds != null && ` · ${Math.round(session.durationSeconds / 60)}min`}
 </p>
 </div>
 {session.status === 'active' && session.protocol === 'oblireach' && (
 <div className="flex items-center gap-2">
 <button
 onClick={() => { setOrSession(session); setOrModalOpen(true); }}
 className="px-3 py-1 text-xs bg-sky-500/10 text-sky-400 border border-sky-500/20 rounded-lg hover:bg-sky-500/20 transition-colors coarse:min-h-10"
 >
 View
 </button>
 </div>
 )}
 {session.status === 'active' && isShellProtocol(session.protocol) && (
 <div className="flex items-center gap-2">
 <button
 onClick={async () => {
 const { useRemoteShellStore } = await import('@/store/remoteShellStore');
 const deviceName = anonymize(device.displayName || device.hostname) || `#${device.id}`;
 // If already in the panel, just switch to it; else add.
 const st = useRemoteShellStore.getState();
 if (st.sessions.find((x) => x.id === session.sessionToken)) {
 st.setActive(session.sessionToken);
 st.setOpen(true);
 } else {
 st.addSession({
 id: session.sessionToken,
 deviceId: device.id,
 deviceName,
 protocol: session.protocol as 'ssh' | 'cmd' | 'powershell',
 sessionToken: session.sessionToken,
   serverSessionId: session.id,
 });
 }
 }}
 className="text-xs px-3 py-1 bg-green-500/10 text-green-400 border border-green-500/30 rounded-lg hover:bg-green-500/20 transition-colors coarse:min-h-10"
 >
 Open
 </button>
 <button
 onClick={() => handleEndSession(session)}
 disabled={endingSession.has(session.id)}
 title="End session"
 className="flex items-center gap-1 text-xs px-2.5 py-1 text-red-400 border border-red-400/30 rounded-lg hover:bg-red-400/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors coarse:min-h-10"
 >
 {endingSession.has(session.id) ? <RefreshCw className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
 End
 </button>
 </div>
 )}
 {(session.status === 'waiting' || session.status === 'connecting') && (
 <button
 onClick={() => handleEndSession(session)}
 disabled={endingSession.has(session.id)}
 title="Cancel session"
 className="flex items-center gap-1 text-xs px-2.5 py-1 text-red-400 border border-red-400/30 rounded-lg hover:bg-red-400/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors coarse:min-h-10"
 >
 {endingSession.has(session.id)
 ? <RefreshCw className="w-3 h-3 animate-spin" />
 : <X className="w-3 h-3" />}
 Cancel
 </button>
 )}
 </div>
 ))}
 </div>
 )}
 </div>
 </div>
 </>
 );
}

// ─── Commands / Tasks Tab ───────────────────────────────────────────────────────

const COMMAND_LABELS: Record<string, string> = {
 run_script: 'Run Script',
 install_update: 'Install Update',
 install_updates: 'Install Updates (batch)',
 cancel_script: 'Cancel Script',
 scan_inventory: 'Scan Inventory',
 scan_updates: 'Scan Updates',
 check_compliance: 'Check Compliance',
 remediate_rule: 'Remediate Rule',
 open_remote_tunnel: 'Open Tunnel',
 close_remote_tunnel: 'Close Tunnel',
 reboot: 'Reboot',
 shutdown: 'Shutdown',
 restart_agent: 'Restart Agent',
 list_services: 'List Services',
 restart_service: 'Restart Service',
 start_service: 'Start Service',
 stop_service: 'Stop Service',
 install_software: 'Install Software',
 uninstall_software: 'Uninstall Software',
 uninstall_agent: 'Uninstall Agent',
 install_oblireach: 'Install ObliReach',
 disable_privacy_mode: 'Disable Privacy',
 list_processes: 'List Processes',
 kill_process: 'Kill Process',
 list_wts_sessions: 'List Sessions',
 list_directory: 'List Directory',
 create_directory: 'Create Directory',
 rename_file: 'Rename File',
 delete_file: 'Delete File',
 download_file: 'Download File',
 upload_file: 'Upload File',
 scan_network: 'Network Scan',
};

const CMD_STATUS_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
 pending: { color: 'text-yellow-400', bg: 'bg-yellow-400/10', label: 'Pending' },
 sent: { color: 'text-blue-300', bg: 'bg-blue-400/10', label: 'Sent' },
 ack_running: { color: 'text-blue-400', bg: 'bg-blue-400/10', label: 'Running' },
 success: { color: 'text-green-400', bg: 'bg-green-400/10', label: 'Success' },
 failure: { color: 'text-red-400', bg: 'bg-red-400/10', label: 'Failed' },
 timeout: { color: 'text-orange-400', bg: 'bg-orange-400/10', label: 'Timeout' },
 cancelled: { color: 'text-gray-400', bg: 'bg-gray-400/10', label: 'Cancelled' },
};

// ─── Hyper-V Tab ─────────────────────────────────────────────────────────────
// VM list + power/checkpoint/delete control for a virtualization host. Only
// mounted when device.virtualizationHostType is set. Actions go through the
// server's capability + restriction gate (so some return 202 pending-approval
// or trigger the 2FA modal transparently via the axios interceptor).
function HyperVTab({ deviceId }: { deviceId: number }) {
 const { t } = useTranslation();
 const confirm = useConfirm();
 const prompt = usePrompt();
 const [vms, setVms] = useState<import('@obliance/shared').VirtualMachine[]>([]);
 const [loading, setLoading] = useState(true);
 const [busyVmId, setBusyVmId] = useState<string | null>(null);
 const [refreshing, setRefreshing] = useState(false);
 const [modal, setModal] = useState<{ kind: 'edit' | 'checkpoints'; vm: import('@obliance/shared').VirtualMachine } | { kind: 'create' } | null>(null);
 const [liveConsole, setLiveConsole] = useState<{ token: string | null; sessionId: string; vmName: string; vmId: string } | null>(null);
 const openLiveConsole = useCallback(async (vm: import('@obliance/shared').VirtualMachine) => {
 try {
 const sess = await remoteApi.startSession(deviceId, 'vmconsole', undefined, undefined, vm.vmId);
 setLiveConsole({ token: sess.sessionToken ?? null, sessionId: String(sess.id), vmName: vm.name, vmId: vm.vmId });
 } catch (e: any) {
 toast.error(e?.response?.data?.error || (t('hyperv.consoleError', 'Could not open the interactive console')));
 }
 }, [deviceId, t]);
 // Auto-reconnect for the interactive VM console (mobile networks drop the
 // WebSocket when the app goes to the background): same contract as the
 // header Reach viewer — open a fresh session and hand the viewer its token.
 const reconnectLiveConsole = useCallback(async () => {
 const cur = liveConsole;
 if (!cur) return;
 const sess = await remoteApi.startSession(deviceId, 'vmconsole', undefined, undefined, cur.vmId);
 setLiveConsole((prev) => (prev ? { ...prev, token: sess.sessionToken ?? null, sessionId: String(sess.id) } : prev));
 }, [deviceId, liveConsole]);
 const [installingConsole, setInstallingConsole] = useState(false);
 const handleInstallConsole = async () => {
 setInstallingConsole(true);
 try {
 await hypervApi.installConsole(deviceId);
 toast.success(t('hyperv.consoleInstalling', 'Installing the console helper on the host (~130 MB download)…'), { duration: 7000 });
 } catch (e: any) {
 toast.error(e?.response?.data?.error || (t('common.error') || 'Failed'));
 } finally {
 setTimeout(() => setInstallingConsole(false), 3000);
 }
 };

 const load = useCallback(async () => {
 try { const fresh = await hypervApi.listForDevice(deviceId); setVms((prev) => mergeById(prev, fresh, (v) => v.vmId)); }
 catch { /* keep previous list */ }
 finally { setLoading(false); }
 }, [deviceId]);
 useEffect(() => { load(); }, [load]);

 // Live updates while the tab is open: (1) listen for the server's
 // HYPERV_VMS_UPDATED broadcast (fired whenever the host re-posts — after
 // an action settles, an inventory scan, or a live ping); (2) ping the
 // host every 4s so changes made directly on the host surface quickly.
 // The ephemeral ping doesn't hit the command queue / task history.
 useEffect(() => {
 const socket = getSocket();
 const onUpdate = (p: { hostDeviceId: number; vms: import('@obliance/shared').VirtualMachine[] }) => {
 if (p.hostDeviceId === deviceId) setVms((prev) => mergeById(prev, p.vms, (v) => v.vmId));
 };
 socket?.on('HYPERV_VMS_UPDATED', onUpdate);
 hypervApi.live(deviceId).catch(() => {});
 const iv = setInterval(() => { hypervApi.live(deviceId).catch(() => {}); }, 4000);
 return () => { socket?.off('HYPERV_VMS_UPDATED', onUpdate); clearInterval(iv); };
 }, [deviceId]);

 // Adapter matching the modals' RunAction signature. Surfaces pending-approval
 // + reloads the list after the host re-enumerates.
 const runVm = useCallback(async (vmId: string, action: import('@obliance/shared').VmAction, params?: Record<string, unknown>) => {
 const out = await hypervApi.action(deviceId, vmId, action, params);
 if (out && out.status === 'pending_approval') {
 toast.success(t('hyperv.pendingApproval') || 'Action saved — awaiting second admin approval', { duration: 6000 });
 } else {
 toast.success(t('hyperv.actionQueued') || 'Action sent to host');
 }
 setTimeout(() => load(), 2500);
 return out;
 }, [deviceId, load, t]);

 const handleRefresh = async () => {
 setRefreshing(true);
 try {
 await hypervApi.refresh(deviceId);
 // The agent re-enumerates async; give it a moment then reload.
 setTimeout(() => { load(); setRefreshing(false); }, 2500);
 } catch {
 toast.error(t('common.error') || 'Failed');
 setRefreshing(false);
 }
 };

 const handleAction = async (vm: import('@obliance/shared').VirtualMachine, action: import('@obliance/shared').VmAction) => {
 if (action === 'delete' && !(await confirm({
 message: t('hyperv.confirmDelete', { name: vm.name, defaultValue: 'Delete VM "{{name}}"? This is irreversible.' }),
 danger: true,
 }))) return;
 let params: Record<string, unknown> | undefined;
 if (action === 'checkpoint_create') {
 // Cancel / Escape / Android Back abort the action; an empty but
 // confirmed name creates an unnamed checkpoint.
 const name = await prompt({
 message: t('hyperv.checkpointNamePrompt', 'Checkpoint name (optional):'),
 plain: false,
 });
 if (name === null) return;
 params = name ? { checkpointName: name } : undefined;
 }
 setBusyVmId(vm.vmId);
 try {
 const out = await hypervApi.action(deviceId, vm.vmId, action, params);
 if (out && out.status === 'pending_approval') {
 toast.success(t('hyperv.pendingApproval') || 'Action saved — awaiting second admin approval', { duration: 6000 });
 } else {
 toast.success(t('hyperv.actionQueued') || 'Action sent to host');
 }
 setTimeout(() => load(), 2500);
 } catch (e: any) {
 toast.error(e?.response?.data?.error || (t('common.error') || 'Failed'));
 } finally {
 setBusyVmId(null);
 }
 };

 if (loading) {
 return <div className="flex items-center justify-center h-48"><RefreshCw className="w-5 h-5 animate-spin text-text-muted" /></div>;
 }

 return (
 <div className="space-y-3">
 <div className="flex flex-wrap items-center justify-between gap-2">
 <h3 className="text-sm font-semibold text-text-primary">
 {t('hyperv.title') || 'Hyper-V virtual machines'} <span className="text-text-muted font-normal">({vms.length})</span>
 </h3>
 <div className="flex flex-wrap items-center gap-2">
 <button
 onClick={handleInstallConsole}
 disabled={installingConsole}
 title={t('hyperv.installConsoleHint', 'Download the interactive console helper (~130 MB) onto this host')}
 className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-bg-secondary text-text-muted rounded-lg hover:text-text-primary hover:bg-bg-tertiary disabled:opacity-50 transition-colors coarse:min-h-10"
 >
 <Download className={clsx('w-3.5 h-3.5', installingConsole && 'animate-pulse')} />
 {t('hyperv.installConsole', 'Install console')}
 </button>
 <button
 onClick={() => setModal({ kind: 'create' })}
 className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-accent/10 text-accent border border-accent/30 rounded-lg hover:bg-accent/20 transition-colors coarse:min-h-10"
 >
 <Plus className="w-3.5 h-3.5" />
 {t('hyperv.newVm') || 'New VM'}
 </button>
 <button
 onClick={handleRefresh}
 disabled={refreshing}
 className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-bg-secondary text-text-muted rounded-lg hover:text-text-primary hover:bg-bg-tertiary disabled:opacity-50 transition-colors coarse:min-h-10"
 >
 <RefreshCw className={clsx('w-3.5 h-3.5', refreshing && 'animate-spin')} />
 {t('hyperv.refresh') || 'Refresh'}
 </button>
 </div>
 </div>
 <HyperVVmTable
 vms={vms}
 busyVmId={busyVmId}
 hostDeviceId={deviceId}
 onAction={handleAction}
 onEdit={(vm) => setModal({ kind: 'edit', vm })}
 onCheckpoints={(vm) => setModal({ kind: 'checkpoints', vm })}
 onInteractiveConsole={openLiveConsole}
 />
 {modal?.kind === 'edit' && <EditVmModal vm={modal.vm} run={runVm} onClose={() => { setModal(null); setTimeout(load, 2500); }} />}
 {modal?.kind === 'checkpoints' && <CheckpointModal vm={modal.vm} run={runVm} onClose={() => { setModal(null); setTimeout(load, 2500); }} />}
 {modal?.kind === 'create' && <CreateVmModal run={runVm} onClose={() => { setModal(null); setTimeout(load, 2500); }} />}
 {liveConsole && (
 <ObliReachViewer
 sessionToken={liveConsole.token}
 deviceName={liveConsole.vmName}
 onClose={async () => {
 try { await remoteApi.endSession(liveConsole.sessionId); } catch {}
 setLiveConsole(null);
 }}
 onReconnect={reconnectLiveConsole}
 />
 )}
 </div>
 );
}

// ─── Veeam Backups Tab ───────────────────────────────────────────────────────
// Backup-job list + start/stop/retry/enable/disable control for a Veeam B&R
// host. Only mounted when device.backupHostType is set. Actions go through the
// server's capability + restriction gate (so some return 202 pending-approval
// or trigger the 2FA modal transparently via the axios interceptor).
function VeeamTab({ deviceId }: { deviceId: number }) {
 const { t } = useTranslation();
 const confirm = useConfirm();
 const [jobs, setJobs] = useState<import('@obliance/shared').BackupJob[]>([]);
 const [loading, setLoading] = useState(true);
 const [busyJobId, setBusyJobId] = useState<string | null>(null);
 const [refreshing, setRefreshing] = useState(false);

 const load = useCallback(async () => {
 try { const fresh = await veeamApi.listForDevice(deviceId); setJobs((prev) => mergeById(prev, fresh, (j) => j.jobId)); }
 catch { /* keep previous list */ }
 finally { setLoading(false); }
 }, [deviceId]);
 useEffect(() => { load(); }, [load]);

 // Live updates while the tab is open: listen for the server's
 // VEEAM_JOBS_UPDATED broadcast + ping the host every 5s so changes made
 // directly in the Veeam console surface quickly. The ping is ephemeral
 // (no command-queue / task-history row).
 useEffect(() => {
 const socket = getSocket();
 const onUpdate = (p: { hostDeviceId: number; jobs: import('@obliance/shared').BackupJob[] }) => {
 if (p.hostDeviceId === deviceId) setJobs((prev) => mergeById(prev, p.jobs, (j) => j.jobId));
 };
 socket?.on('VEEAM_JOBS_UPDATED', onUpdate);
 veeamApi.live(deviceId).catch(() => {});
 const iv = setInterval(() => { veeamApi.live(deviceId).catch(() => {}); }, 5000);
 return () => { socket?.off('VEEAM_JOBS_UPDATED', onUpdate); clearInterval(iv); };
 }, [deviceId]);

 const handleAction = async (job: import('@obliance/shared').BackupJob, action: import('@obliance/shared').BackupJobAction) => {
 if (action === 'stop' && !(await confirm({
 message: t('veeam.confirmStop', { name: job.name, defaultValue: 'Stop the running job "{{name}}"? The backup will be incomplete.' }),
 danger: true,
 confirmLabel: t('deviceDetail.veeam.stopJob', 'Stop job'),
 }))) return;
 setBusyJobId(job.jobId);
 try {
 const out = await veeamApi.action(deviceId, job.jobId, action);
 if (out && out.status === 'pending_approval') {
 toast.success(t('veeam.pendingApproval') || 'Action saved — awaiting second admin approval', { duration: 6000 });
 } else {
 toast.success(t('veeam.actionQueued') || 'Action sent to host');
 }
 setTimeout(() => load(), 2500);
 } catch (e: any) {
 toast.error(e?.response?.data?.error || (t('common.error') || 'Failed'));
 } finally {
 setBusyJobId(null);
 }
 };

 const handleRefresh = async () => {
 setRefreshing(true);
 try {
 await veeamApi.refresh(deviceId);
 setTimeout(() => { load(); setRefreshing(false); }, 2500);
 } catch {
 toast.error(t('common.error') || 'Failed');
 setRefreshing(false);
 }
 };

 if (loading) {
 return <div className="flex items-center justify-center h-48"><RefreshCw className="w-5 h-5 animate-spin text-text-muted" /></div>;
 }

 return (
 <div className="space-y-3">
 <div className="flex flex-wrap items-center justify-between gap-2">
 <h3 className="text-sm font-semibold text-text-primary">
 {t('veeam.title') || 'Veeam backup jobs'} <span className="text-text-muted font-normal">({jobs.length})</span>
 </h3>
 <button
 onClick={handleRefresh}
 disabled={refreshing}
 className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-bg-secondary text-text-muted rounded-lg hover:text-text-primary hover:bg-bg-tertiary disabled:opacity-50 transition-colors coarse:min-h-10"
 >
 <RefreshCw className={clsx('w-3.5 h-3.5', refreshing && 'animate-spin')} />
 {t('veeam.refresh') || 'Refresh'}
 </button>
 </div>
 <BackupJobTable
 jobs={jobs}
 busyJobId={busyJobId}
 onAction={handleAction}
 />
 </div>
 );
}

type CmdFilter = 'all' | 'queued' | 'running' | 'done' | 'failed' | 'cancelled' | 'remediation';

function CommandsTab({ deviceId }: { deviceId: number }) {
 const { t } = useTranslation();
 const socket = getSocket();
 // Below lg a tap on a task row un-truncates its payload / error (desktop
 // keeps the single-line cells + title tooltip).
 const [expandedCmdId, setExpandedCmdId] = useState<string | null>(null);
 const [commands, setCommands] = useState<Command[]>([]);
 const [totalCount, setTotalCount] = useState(0);
 const [isLoading, setIsLoading] = useState(true);
 const [filter, setFilter] = useState<CmdFilter>('all');
 const [cancelling, setCancelling] = useState<Set<string>>(new Set());
 const [pageSize, setPageSize] = useState(50);
 const [page, setPage] = useState(1);

 const load = async () => {
 setIsLoading(true);
 try {
 const result = await commandApi.list(deviceId, {
 page,
 limit: pageSize > 0 ? pageSize : undefined, // 0 = all
 });
 setCommands(result.items);
 setTotalCount(result.total);
 } catch {
 toast.error('Failed to load tasks');
 } finally {
 setIsLoading(false);
 }
 };

 useEffect(() => { load(); }, [deviceId, page, pageSize]);

 // Real-time: update or prepend commands as they change
 useEffect(() => {
 const onUpdate = (cmd: Command) => {
 if (cmd.deviceId !== deviceId) return;
 setCommands(prev => {
 const idx = prev.findIndex(c => c.id === cmd.id);
 if (idx >= 0) {
 const next = [...prev];
 next[idx] = cmd;
 return next;
 }
 return [cmd, ...prev];
 });
 };
 if (!socket) return;
 socket.on('COMMAND_UPDATED', onUpdate);
 return () => {
 socket.off('COMMAND_UPDATED', onUpdate);
 };
 }, [deviceId, socket]);

 const handleCancel = async (cmdId: string) => {
 setCancelling(prev => new Set(prev).add(cmdId));
 try {
 await commandApi.cancel(cmdId);
 setCommands(prev => prev.map(c => c.id === cmdId ? { ...c, status: 'cancelled' as const } : c));
 } catch {
 toast.error('Failed to cancel task');
 } finally {
 setCancelling(prev => { const s = new Set(prev); s.delete(cmdId); return s; });
 }
 };

 const isRemediation = (c: Command) => c.type === 'remediate_rule';
 const nonRemediation = commands.filter(c => !isRemediation(c));
 const remediationCmds = commands.filter(isRemediation);

 const counts: Record<CmdFilter, number> = {
 all: nonRemediation.length,
 queued: nonRemediation.filter(c => c.status === 'pending' || c.status === 'sent').length,
 running: nonRemediation.filter(c => c.status === 'ack_running').length,
 done: nonRemediation.filter(c => c.status === 'success').length,
 failed: nonRemediation.filter(c => c.status === 'failure' || c.status === 'timeout').length,
 cancelled: nonRemediation.filter(c => c.status === 'cancelled').length,
 remediation: remediationCmds.length,
 };

 const filtered = commands.filter(cmd => {
 if (filter === 'remediation') return isRemediation(cmd);
 if (filter === 'queued') return !isRemediation(cmd) && (cmd.status === 'pending' || cmd.status === 'sent');
 if (filter === 'running') return !isRemediation(cmd) && cmd.status === 'ack_running';
 if (filter === 'done') return !isRemediation(cmd) && cmd.status === 'success';
 if (filter === 'failed') return !isRemediation(cmd) && (cmd.status === 'failure' || cmd.status === 'timeout');
 if (filter === 'cancelled') return !isRemediation(cmd) && cmd.status === 'cancelled';
 return !isRemediation(cmd); // 'all' excludes remediation
 });

 const FILTER_PILLS: { key: CmdFilter; label: string }[] = [
 { key: 'all', label: 'All' },
 { key: 'queued', label: 'Queued' },
 { key: 'running', label: 'Running' },
 { key: 'done', label: 'Done' },
 { key: 'failed', label: 'Failed' },
 { key: 'cancelled', label: 'Cancelled' },
 { key: 'remediation', label: 'Remediation' },
 ];

 if (isLoading) return (
 <div className="flex items-center justify-center h-48">
 <RefreshCw className="w-5 h-5 animate-spin text-text-muted" />
 </div>
 );

 return (
 <div className="space-y-4">
 {/* Header: filters + refresh */}
 <div className="flex items-center justify-between gap-2 flex-wrap">
 <div className="flex items-center gap-1.5 flex-wrap">
 {FILTER_PILLS.map(({ key, label }) => (
 <button
 key={key}
 onClick={() => setFilter(key)}
 className={clsx(
 'flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium transition-colors border coarse:min-h-9',
 filter === key
 ? 'bg-accent text-white border-accent'
 : 'bg-bg-secondary text-text-muted hover:text-text-primary border-transparent'
 )}
 >
 {label}
 {counts[key] > 0 && (
 <span className={clsx(
 'rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
 filter === key ? 'bg-white/20 text-white' : 'bg-bg-tertiary text-text-muted'
 )}>
 {counts[key]}
 </span>
 )}
 </button>
 ))}
 </div>
 <button
 onClick={load}
 className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-bg-secondary border border-transparent text-text-muted hover:text-text-primary transition-colors text-xs coarse:min-h-10"
 >
 <RefreshCw className="w-3.5 h-3.5" /> Refresh
 </button>
 </div>

 {/* Table */}
 {filtered.length === 0 ? (
 <div className="p-12 text-center text-text-muted">
 <History className="w-8 h-8 mx-auto mb-2 opacity-50" />
 <p>{filter === 'all' ? 'No tasks issued yet' : 'No tasks with this status'}</p>
 </div>
 ) : (
 <TableScroll className="bg-bg-secondary rounded-xl">
 <table className="w-full">
 <thead>
 <tr className="">
 <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">Task</th>
 <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">Status</th>
 <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider hidden md:table-cell">User</th>
 <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider hidden md:table-cell">Priority</th>
 <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider hidden lg:table-cell">Created</th>
 <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider hidden lg:table-cell">Duration</th>
 <th className="px-4 py-3 w-10" />
 </tr>
 </thead>
 <tbody className="divide-y divide-border">
 {filtered.map((cmd) => {
 const sc = CMD_STATUS_CONFIG[cmd.status] ?? { color: 'text-text-muted', bg: 'bg-bg-tertiary', label: cmd.status };
 const isRunning = cmd.status === 'ack_running';
 const canCancel = cmd.status === 'pending';
 const durationMs = cmd.durationMs;
 const payloadKeys = Object.keys(cmd.payload ?? {});
 const expanded = expandedCmdId === cmd.id;
 const expandCls = expanded ? 'max-lg:whitespace-normal max-lg:break-all' : '';

 return (
 <tr key={cmd.id} className="hover:bg-bg-tertiary transition-colors">
 {/* Task label + details */}
 <td
 className="px-4 py-3 max-w-0 max-lg:cursor-pointer"
 onClick={() => setExpandedCmdId(expanded ? null : cmd.id)}
 >
 <div className="text-sm text-text-primary font-medium truncate">
 {COMMAND_LABELS[cmd.type] ?? cmd.type}
 </div>
 {/* Columns hidden below md / lg, repeated as a secondary line. */}
 <div className={clsx('lg:hidden text-[11px] text-text-muted mt-0.5 truncate', expandCls)}>
 <span className="md:hidden">{cmd.createdByName || '—'} · <span className="capitalize">{cmd.priority}</span> · </span>
 {new Date(cmd.createdAt).toLocaleString()}
 {durationMs != null && ` · ${durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`}`}
 </div>
 {cmd.type === 'remediate_rule' && cmd.payload?.ruleName ? (
 <div className={clsx('text-xs text-text-muted mt-0.5 truncate', expandCls)}>
 {cmd.payload.ruleName} <span className="font-mono text-text-muted/60">({cmd.payload.ruleId})</span>
 </div>
 ) : payloadKeys.length > 0 && (
 <div className={clsx('text-xs text-text-muted mt-0.5 font-mono truncate', expandCls)}>
 {payloadKeys.filter(k => !['sessionToken', 'script'].includes(k)).map(k => `${k}=${String(cmd.payload[k]).slice(0, 80)}`).join(' ')}
 </div>
 )}
 {cmd.result?.error && (
 <div className={clsx('text-xs text-red-400 mt-0.5 truncate', expandCls)} title={cmd.result.error}>
 {cmd.result.error}
 </div>
 )}
 </td>

 {/* Status badge */}
 <td className="px-4 py-3">
 <span className={clsx('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium', sc.color, sc.bg)}>
 {isRunning && <Loader2 className="w-3 h-3 animate-spin" />}
 {sc.label}
 </span>
 </td>

 {/* User */}
 <td className="px-4 py-3 hidden md:table-cell">
 <span className="text-xs text-text-muted truncate">
 {cmd.createdByName || '—'}
 </span>
 </td>

 {/* Priority */}
 <td className="px-4 py-3 hidden md:table-cell">
 <span className={clsx('text-xs capitalize', {
 'text-red-400': cmd.priority === 'urgent',
 'text-orange-400': cmd.priority === 'high',
 'text-text-muted': cmd.priority === 'normal' || cmd.priority === 'low',
 })}>
 {cmd.priority}
 </span>
 </td>

 {/* Created at */}
 <td className="px-4 py-3 text-xs text-text-muted hidden lg:table-cell whitespace-nowrap">
 {new Date(cmd.createdAt).toLocaleString()}
 </td>

 {/* Duration */}
 <td className="px-4 py-3 text-xs text-text-muted hidden lg:table-cell whitespace-nowrap">
 {durationMs != null
 ? durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`
 : '—'}
 </td>

 {/* Cancel action */}
 <td className="px-4 py-3 text-right">
 {canCancel && (
 <IconButton
 onClick={() => handleCancel(cmd.id)}
 disabled={cancelling.has(cmd.id)}
 label={t('deviceDetail.tasks.cancel', 'Cancel task')}
 variant="danger"
 className="rounded-lg disabled:opacity-50"
 icon={cancelling.has(cmd.id)
 ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
 : <X className="w-3.5 h-3.5" />}
 />
 )}
 </td>
 </tr>
 );
 })}
 </tbody>
 </table>
 </TableScroll>
 )}

 {/* Pagination */}
 {totalCount > 0 && (
 <div className="flex flex-wrap items-center justify-between gap-4 max-sm:gap-2 text-xs text-text-muted">
 <div className="flex items-center gap-2">
 <span>Show</span>
 <select
 value={pageSize}
 onChange={(e) => { setPageSize(parseInt(e.target.value)); setPage(1); }}
 className="px-2 py-1 bg-bg-secondary rounded text-text-primary text-xs focus:outline-none focus:border-accent"
 >
 {[20, 50, 100, 200, 500].map(n => (
 <option key={n} value={n}>{n}</option>
 ))}
 <option value={0}>All</option>
 </select>
 <span>of {totalCount} tasks</span>
 </div>
 {pageSize > 0 && Math.ceil(totalCount / pageSize) > 1 && (
 <div className="flex items-center gap-1">
 <button
 onClick={() => setPage(p => Math.max(1, p - 1))}
 disabled={page <= 1}
 aria-label={t('deviceDetail.pagination.previous', 'Previous page')}
 className="px-2 py-1 rounded hover:bg-bg-secondary disabled:opacity-30 transition-colors coarse:min-h-10 coarse:min-w-10"
 >
 ←
 </button>
 <span className="px-2">{page} / {Math.ceil(totalCount / pageSize)}</span>
 <button
 onClick={() => setPage(p => Math.min(Math.ceil(totalCount / pageSize), p + 1))}
 disabled={page >= Math.ceil(totalCount / pageSize)}
 aria-label={t('deviceDetail.pagination.next', 'Next page')}
 className="px-2 py-1 rounded hover:bg-bg-secondary disabled:opacity-30 transition-colors coarse:min-h-10 coarse:min-w-10"
 >
 →
 </button>
 </div>
 )}
 </div>
 )}
 </div>
 );
}

// ─── Services Tab ──────────────────────────────────────────────────────────────

function ServicesTab({ device }: { device: Device }) {
 const { t } = useTranslation();
 // Reason shown (tap on touch) when the agent flavour can't run a command.
 const unsup = (c: Parameters<typeof isCommandSupported>[1]) => (isCommandSupported(device, c) ? null : unsupportedTooltip(t));
 const [services, setServices] = useState<ServiceInfo[]>([]);
 const [isLoadingServices, setIsLoadingServices] = useState(false);
 // Per-service pending action: name → 'start' | 'stop' | 'restart'
 const [pendingService, setPendingService] = useState<Map<string, string>>(new Map());
 const listTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
 const [filter, setFilter] = useState('');

 // Auto-load stored services from server on mount
 useEffect(() => {
 let cancelled = false;
 deviceApi.getServices(device.id).then((svcs) => {
 if (!cancelled && svcs.length > 0) setServices(svcs);
 }).catch(() => {/* silent — no stored data yet */});
 return () => { cancelled = true; };
 }, [device.id]);

 // Listen for real-time updates (watcher goroutine + post-action re-collect)
 // and for command results (manual refresh, start/stop/restart ACKs)
 useEffect(() => {
 const socket = getSocket();
 if (!socket) return;

 // Agent pushed a fresh service list → replace the whole state
 const onServicesUpdated = (payload: { deviceId: number; services: ServiceInfo[] }) => {
 if (payload.deviceId !== device.id) return;
 setServices(payload.services);
 setIsLoadingServices(false);
 if (listTimeoutRef.current) { clearTimeout(listTimeoutRef.current); listTimeoutRef.current = null; }
 };

 const onCmd = (cmd: Command) => {
 if (cmd.deviceId !== device.id) return;
 const terminal = ['success', 'failure', 'timeout'].includes(cmd.status);
 if (!terminal) return;

 if (cmd.type === 'list_services') {
 // Manual refresh result — the watcher POST will arrive shortly and
 // update the list; clear the spinner now.
 if (listTimeoutRef.current) { clearTimeout(listTimeoutRef.current); listTimeoutRef.current = null; }
 setIsLoadingServices(false);
 if (cmd.status !== 'success') toast.error('Failed to load services');
 }

 if (cmd.type === 'restart_service' || cmd.type === 'start_service' || cmd.type === 'stop_service') {
 const name = (cmd.payload as any)?.name as string;
 if (name) {
 setPendingService((prev) => { const m = new Map(prev); m.delete(name); return m; });
 if (cmd.status === 'success') {
 // Optimistic update — the watcher POST will confirm shortly
 const newStatus = cmd.type === 'start_service' ? 'running'
 : cmd.type === 'stop_service' ? 'stopped' : null;
 if (newStatus) {
 setServices((prev) => prev.map((s) => s.name === name ? { ...s, status: newStatus } : s));
 }
 const actionLabel = cmd.type === 'start_service' ? 'started'
 : cmd.type === 'stop_service' ? 'stopped' : 'restarted';
 toast.success(`Service "${name}" ${actionLabel}`);
 } else {
 const actionLabel = cmd.type === 'start_service' ? 'start'
 : cmd.type === 'stop_service' ? 'stop' : 'restart';
 toast.error(`Failed to ${actionLabel} "${name}"`);
 }
 }
 }
 };

 socket.on(SocketEvents.DEVICE_SERVICES_UPDATED, onServicesUpdated);
 socket.on('COMMAND_UPDATED', onCmd);
 return () => {
 socket.off(SocketEvents.DEVICE_SERVICES_UPDATED, onServicesUpdated);
 socket.off('COMMAND_UPDATED', onCmd);
 };
 }, [device.id]);

 const handleListServices = async () => {
 setIsLoadingServices(true);
 if (listTimeoutRef.current) clearTimeout(listTimeoutRef.current);
 try {
 await commandApi.enqueue(device.id, 'list_services');
 listTimeoutRef.current = setTimeout(() => {
 listTimeoutRef.current = null;
 setIsLoadingServices(false);
 toast.error('Services request timed out — agent did not respond');
 }, 90000);
 } catch {
 setIsLoadingServices(false);
 toast.error('Failed to dispatch list_services command');
 }
 };

 const handleServiceAction = async (name: string, type: 'start_service' | 'stop_service' | 'restart_service') => {
 setPendingService((prev) => new Map(prev).set(name, type));
 try {
 await commandApi.enqueue(device.id, type, { name });
 } catch {
 setPendingService((prev) => { const m = new Map(prev); m.delete(name); return m; });
 toast.error(`Failed to send command`);
 }
 };

 const filtered = filter
 ? services.filter((s) =>
 s.name.toLowerCase().includes(filter.toLowerCase()) ||
 (s.displayName ?? '').toLowerCase().includes(filter.toLowerCase())
 )
 : services;

 return (
 <div className="bg-bg-secondary rounded-xl overflow-hidden">
 {/* Header — wraps below sm: the filter + refresh go to their own row */}
 <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-3 max-sm:gap-2">
 <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
 <Server className="w-4 h-4 text-text-muted" />
 Services
 {services.length > 0 && (
 <span className="text-xs font-normal text-text-muted bg-bg-tertiary border border-transparent px-1.5 py-0.5 rounded-md">
 {services.length}
 </span>
 )}
 </h3>
 <div className="flex items-center gap-2 max-sm:w-full">
 {services.length > 0 && (
 <input
 type="text"
 value={filter}
 onChange={(e) => setFilter(e.target.value)}
 placeholder="Filter services…"
 autoCapitalize="off" autoCorrect="off" spellCheck={false}
 className="px-2 py-1 text-xs bg-bg-tertiary rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50 w-40 max-sm:w-auto max-sm:flex-1 max-sm:min-w-0"
 />
 )}
 <DisabledTip reason={!isCommandSupported(device, 'list_services') && unsupportedTooltip(t)}>
 <button
 onClick={handleListServices}
 disabled={isLoadingServices || !isCommandSupported(device, 'list_services')}
 className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-bg-tertiary rounded-lg text-text-muted hover:text-text-primary hover:border-accent/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
 >
 {isLoadingServices ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
 {isLoadingServices ? 'Loading…' : services.length > 0 ? 'Refresh' : 'Load Services'}
 </button>
 </DisabledTip>
 </div>
 </div>

 {/* Body */}
 {services.length === 0 && !isLoadingServices ? (
 <div className="p-10 text-center text-text-muted text-sm">
 <Server className="w-8 h-8 mx-auto mb-2 opacity-40" />
 <p>No service data yet — the agent will push the list automatically on its next scan.</p>
 <p className="mt-1 text-xs opacity-70">You can also click <strong>Load Services</strong> to force an immediate fetch.</p>
 </div>
 ) : isLoadingServices && services.length === 0 ? (
 <div className="flex items-center justify-center gap-2 h-24 text-text-muted text-sm">
 <Loader2 className="w-5 h-5 animate-spin" />
 Fetching services…
 </div>
 ) : (
 <div className="overflow-auto overscroll-x-contain md:max-h-[65dvh] md:supports-[not(height:100dvh)]:max-h-[65vh]">
 <table className="w-full text-sm">
 <thead className="sticky top-0 bg-bg-secondary z-10 ">
 <tr>
 <th className="px-4 py-2 text-left text-xs font-medium text-text-muted uppercase tracking-wide w-6" />
 <th className="px-4 py-2 text-left text-xs font-medium text-text-muted uppercase tracking-wide">Name</th>
 <th className="px-4 py-2 text-left text-xs font-medium text-text-muted uppercase tracking-wide hidden md:table-cell">Description</th>
 <th className="px-4 py-2 text-left text-xs font-medium text-text-muted uppercase tracking-wide">Status</th>
 <th className="px-4 py-2 text-left text-xs font-medium text-text-muted uppercase tracking-wide hidden lg:table-cell">Startup</th>
 <th className="px-4 py-2 text-left text-xs font-medium text-text-muted uppercase tracking-wide hidden xl:table-cell">Run As</th>
 <th className="px-4 py-2 text-right text-xs font-medium text-text-muted uppercase tracking-wide">Actions</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-border">
 {filtered.map((svc) => {
 const pending = pendingService.get(svc.name);
 const isRunning = svc.status === 'running';
 const isStopped = svc.status === 'stopped';
 return (
 <tr key={svc.name} className="hover:bg-bg-tertiary/60 transition-colors group">
 {/* Status dot */}
 <td className="pl-4 pr-1 py-2">
 <span className={clsx(
 'block w-2 h-2 rounded-full',
 isRunning ? 'bg-green-400' : isStopped ? 'bg-gray-500' : 'bg-yellow-400',
 )} />
 </td>
 {/* Name (+ the columns hidden below md / lg / xl as secondary lines) */}
 <td className="px-4 py-2 font-mono text-xs text-text-primary whitespace-nowrap max-md:whitespace-normal max-md:break-all">
 {svc.name}
 {svc.displayName && (
 <span className="md:hidden block font-sans text-[11px] text-text-muted break-words">{svc.displayName}</span>
 )}
 {(svc.startType || svc.runAsUser) && (
 <span className="xl:hidden lg:can-hover:hidden block font-sans text-[11px] text-text-muted whitespace-normal break-all">
 {svc.startType && <span className="lg:hidden">{svc.startType}</span>}
 {svc.startType && svc.runAsUser && <span className="lg:hidden"> · </span>}
 {svc.runAsUser && <span className="font-mono">{svc.runAsUser}</span>}
 </span>
 )}
 </td>
 {/* Description */}
 <td className="px-4 py-2 text-xs text-text-muted hidden md:table-cell max-w-xs truncate">{svc.displayName || '—'}</td>
 {/* Status badge */}
 <td className="px-4 py-2">
 <span className={clsx(
 'text-xs px-2 py-0.5 rounded-full border',
 isRunning ? 'text-green-400 bg-green-400/10 border-green-400/30' :
 isStopped ? 'text-gray-400 bg-gray-400/10 border-gray-400/30' :
 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30',
 )}>
 {svc.status}
 </span>
 </td>
 {/* Start type */}
 <td className="px-4 py-2 text-xs text-text-muted hidden lg:table-cell">{svc.startType || '—'}</td>
 {/* Run As */}
 <td className="px-4 py-2 text-xs text-text-muted hidden xl:table-cell font-mono">{svc.runAsUser || '—'}</td>
 {/* Action buttons — inline from md, one "⋯" menu below */}
 <td className="px-4 py-2 max-md:px-2">
 <div className="md:hidden flex justify-end">
 <ActionMenu
 label={t('deviceDetail.services.actionsFor', { defaultValue: 'Actions for {{name}}', name: svc.name })}
 sheetTitle={svc.displayName || svc.name}
 triggerClassName={pending ? 'animate-pulse' : undefined}
 items={[
 {
 key: 'start',
 icon: <Play className="w-4 h-4" />,
 label: t('deviceDetail.services.start', 'Start'),
 description: !isCommandSupported(device, 'start_service') ? unsupportedTooltip(t) : undefined,
 disabled: !isStopped || !!pending || !isCommandSupported(device, 'start_service'),
 onClick: () => handleServiceAction(svc.name, 'start_service'),
 },
 {
 key: 'stop',
 icon: <Square className="w-4 h-4" />,
 label: t('deviceDetail.services.stop', 'Stop'),
 description: !isCommandSupported(device, 'stop_service') ? unsupportedTooltip(t) : undefined,
 disabled: !isRunning || !!pending || !isCommandSupported(device, 'stop_service'),
 danger: true,
 onClick: () => handleServiceAction(svc.name, 'stop_service'),
 },
 {
 key: 'restart',
 icon: <RotateCcw className="w-4 h-4" />,
 label: t('deviceDetail.services.restart', 'Restart'),
 description: !isCommandSupported(device, 'restart_service') ? unsupportedTooltip(t) : undefined,
 disabled: !!pending || !isCommandSupported(device, 'restart_service'),
 onClick: () => handleServiceAction(svc.name, 'restart_service'),
 },
 ]}
 />
 </div>
 <div className="hidden md:flex items-center justify-end gap-1">
 {/* Start — only when stopped */}
 <DisabledTip reason={unsup('start_service')}>
 <button
 onClick={() => handleServiceAction(svc.name, 'start_service')}
 disabled={!isStopped || !!pending || !isCommandSupported(device, 'start_service')}
 title={isCommandSupported(device, 'start_service') ? `Start ${svc.name}` : unsupportedTooltip(t)}
 className={clsx(
 'inline-flex items-center gap-1 px-2 py-1 text-xs rounded-lg border transition-colors',
 isStopped && !pending && isCommandSupported(device, 'start_service')
 ? 'text-green-400 bg-green-400/10 border-green-400/30 hover:bg-green-400/20'
 : 'text-text-muted/30 border-transparent cursor-not-allowed',
 )}
 >
 {pending === 'start_service' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
 Start
 </button>
 </DisabledTip>
 {/* Stop — only when running */}
 <DisabledTip reason={unsup('stop_service')}>
 <button
 onClick={() => handleServiceAction(svc.name, 'stop_service')}
 disabled={!isRunning || !!pending || !isCommandSupported(device, 'stop_service')}
 title={isCommandSupported(device, 'stop_service') ? `Stop ${svc.name}` : unsupportedTooltip(t)}
 className={clsx(
 'inline-flex items-center gap-1 px-2 py-1 text-xs rounded-lg border transition-colors',
 isRunning && !pending && isCommandSupported(device, 'stop_service')
 ? 'text-red-400 bg-red-400/10 border-red-400/30 hover:bg-red-400/20'
 : 'text-text-muted/30 border-transparent cursor-not-allowed',
 )}
 >
 {pending === 'stop_service' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Square className="w-3 h-3" />}
 Stop
 </button>
 </DisabledTip>
 {/* Restart — always available */}
 <DisabledTip reason={unsup('restart_service')}>
 <button
 onClick={() => handleServiceAction(svc.name, 'restart_service')}
 disabled={!!pending || !isCommandSupported(device, 'restart_service')}
 title={isCommandSupported(device, 'restart_service') ? `Restart ${svc.name}` : unsupportedTooltip(t)}
 className="inline-flex items-center gap-1 px-2 py-1 text-xs text-text-muted hover:text-blue-400 hover:bg-blue-400/10 border border-transparent hover:border-blue-400/20 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
 >
 {pending === 'restart_service' ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
 Restart
 </button>
 </DisabledTip>
 </div>
 </td>
 </tr>
 );
 })}
 </tbody>
 </table>
 {filter && filtered.length === 0 && (
 <div className="p-6 text-center text-text-muted text-xs">No services match "{filter}"</div>
 )}
 </div>
 )}
 </div>
 );
}

// ─── Processes Tab ────────────────────────────────────────────────────────────

type SortField = 'name' | 'pid' | 'cpuPercent' | 'memBytes' | 'user';
type SortDir = 'asc' | 'desc';

function ProcessesTab({ device }: { device: Device }) {
 const { t } = useTranslation();
 const [processes, setProcesses] = useState<ProcessInfo[]>([]);
 const [filter, setFilter] = useState('');
 const [sortField, setSortField] = useState<SortField>('cpuPercent');
 const [sortDir, setSortDir] = useState<SortDir>('desc');
 const [killingPids, setKillingPids] = useState<Set<number>>(new Set());
 const [connected, setConnected] = useState(false);
 const { isAdmin } = useAuthStore();
 const confirm = useConfirm();
 // Touch devices: a row tap opens a detail sheet (full command line, user,
 // Kill) — the command line otherwise only lives in the row's title=.
 const canHover = useCanHover();
 const [detailPid, setDetailPid] = useState<number | null>(null);

 // Subscribe to process stream on mount, unsubscribe on unmount
 useEffect(() => {
 const socket = getSocket();
 if (!socket) return;

 socket.emit(SocketEvents.PROCESS_SUBSCRIBE, { deviceId: device.id });
 setConnected(true);

 const onProcesses = (payload: { deviceId: number; processes: ProcessInfo[] }) => {
 if (payload.deviceId !== device.id) return;
 setProcesses(payload.processes);
 };

 const onCmd = (cmd: Command) => {
 if (cmd.deviceId !== device.id) return;
 if (cmd.type === 'kill_process') {
 const pid = (cmd.payload as any)?.pid as number;
 if (!pid) return;
 const terminal = ['success', 'failure', 'timeout'].includes(cmd.status);
 if (!terminal) return;
 setKillingPids((prev) => { const s = new Set(prev); s.delete(pid); return s; });
 if (cmd.status === 'success') {
 toast.success(`Process ${pid} killed`);
 setProcesses((prev) => prev.filter((p) => p.pid !== pid));
 } else {
 toast.error(`Failed to kill process ${pid}`);
 }
 }
 };

 socket.on(SocketEvents.DEVICE_PROCESSES_UPDATED, onProcesses);
 socket.on('COMMAND_UPDATED', onCmd);

 return () => {
 socket.emit(SocketEvents.PROCESS_UNSUBSCRIBE, { deviceId: device.id });
 socket.off(SocketEvents.DEVICE_PROCESSES_UPDATED, onProcesses);
 socket.off('COMMAND_UPDATED', onCmd);
 setConnected(false);
 };
 }, [device.id]);

 const handleKill = async (pid: number, name: string) => {
 if (!(await confirm({
 message: t('deviceDetail.processes.killConfirm', { defaultValue: 'Kill process "{{name}}" (PID {{pid}})?', name, pid }),
 danger: true,
 confirmLabel: t('deviceDetail.processes.kill', 'Kill'),
 }))) return;
 setKillingPids((prev) => new Set(prev).add(pid));
 try {
 await commandApi.enqueue(device.id, 'kill_process', { pid, name }, 'high');
 } catch {
 setKillingPids((prev) => { const s = new Set(prev); s.delete(pid); return s; });
 toast.error('Failed to send kill command');
 }
 };

 const toggleSort = (field: SortField) => {
 if (sortField === field) {
 setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
 } else {
 setSortField(field);
 setSortDir(field === 'name' || field === 'user' ? 'asc' : 'desc');
 }
 };

 const filtered = filter
 ? processes.filter((p) =>
 p.name.toLowerCase().includes(filter.toLowerCase()) ||
 p.user.toLowerCase().includes(filter.toLowerCase()) ||
 String(p.pid).includes(filter)
 )
 : processes;

 const sorted = [...filtered].sort((a, b) => {
 const dir = sortDir === 'asc' ? 1 : -1;
 switch (sortField) {
 case 'name': return dir * a.name.localeCompare(b.name);
 case 'pid': return dir * (a.pid - b.pid);
 case 'cpuPercent': return dir * (a.cpuPercent - b.cpuPercent);
 case 'memBytes': return dir * (a.memBytes - b.memBytes);
 case 'user': return dir * a.user.localeCompare(b.user);
 default: return 0;
 }
 });

 const formatMem = (bytes: number) => {
 if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`;
 if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
 return `${(bytes / 1024).toFixed(0)} KB`;
 };

 const totalCpu = processes.reduce((s, p) => s + p.cpuPercent, 0);
 const totalMem = processes.reduce((s, p) => s + p.memBytes, 0);

 const SortIcon = ({ field }: { field: SortField }) => {
 if (sortField !== field) return <ChevronDown className="w-3 h-3 opacity-30 can-hover:opacity-0 can-hover:group-hover:opacity-30" />;
 return sortDir === 'asc'
 ? <ChevronRight className="w-3 h-3 rotate-[-90deg]" />
 : <ChevronDown className="w-3 h-3" />;
 };

 return (
 <div className="bg-bg-secondary rounded-xl overflow-hidden">
 {/* Header — wraps below sm (totals and filter get their own rows) */}
 <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-3 max-sm:gap-2">
 <h3 className="text-sm font-semibold text-text-primary flex flex-wrap items-center gap-2">
 <Activity className="w-4 h-4 text-text-muted" />
 Processes
 {processes.length > 0 && (
 <span className="text-xs font-normal text-text-muted bg-bg-tertiary border border-transparent px-1.5 py-0.5 rounded-md">
 {processes.length}
 </span>
 )}
 {connected && processes.length > 0 && (
 <span className="text-xs font-normal text-text-muted">
 — CPU: {totalCpu.toFixed(1)}% · Mem: {formatMem(totalMem)}
 </span>
 )}
 </h3>
 <div className="flex items-center gap-2 max-sm:w-full">
 {connected && (
 <span className="flex items-center gap-1.5 text-xs text-green-400 shrink-0">
 <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
 Live
 </span>
 )}
 {processes.length > 0 && (
 <input
 type="text"
 value={filter}
 onChange={(e) => setFilter(e.target.value)}
 placeholder="Filter processes…"
 autoCapitalize="off" autoCorrect="off" spellCheck={false}
 className="px-2 py-1 text-xs bg-bg-tertiary rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50 w-48 max-sm:w-auto max-sm:flex-1 max-sm:min-w-0"
 />
 )}
 </div>
 </div>

 {/* Body */}
 {processes.length === 0 ? (
 <div className="p-10 text-center text-text-muted text-sm">
 <Activity className="w-8 h-8 mx-auto mb-2 opacity-40" />
 {connected ? (
 <>
 <Loader2 className="w-5 h-5 mx-auto mb-2 animate-spin" />
 <p>Waiting for process data from agent…</p>
 <p className="mt-1 text-xs opacity-70">The agent will send the process list shortly.</p>
 </>
 ) : (
 <p>Agent not connected.</p>
 )}
 </div>
 ) : (
 <div className="overflow-auto overscroll-x-contain md:max-h-[70dvh] md:supports-[not(height:100dvh)]:max-h-[70vh]">
 <table className="w-full text-sm">
 <thead className="sticky top-0 bg-bg-secondary z-10 ">
 <tr>
 <th
 className="px-4 py-2 text-left text-xs font-medium text-text-muted uppercase tracking-wide cursor-pointer select-none group"
 onClick={() => toggleSort('pid')}
 >
 <span className="inline-flex items-center gap-1">PID <SortIcon field="pid" /></span>
 </th>
 <th
 className="px-4 py-2 text-left text-xs font-medium text-text-muted uppercase tracking-wide cursor-pointer select-none group"
 onClick={() => toggleSort('name')}
 >
 <span className="inline-flex items-center gap-1">Name <SortIcon field="name" /></span>
 </th>
 <th
 className="px-4 py-2 text-right text-xs font-medium text-text-muted uppercase tracking-wide cursor-pointer select-none group"
 onClick={() => toggleSort('cpuPercent')}
 >
 <span className="inline-flex items-center gap-1 justify-end">CPU % <SortIcon field="cpuPercent" /></span>
 </th>
 <th
 className="px-4 py-2 text-right text-xs font-medium text-text-muted uppercase tracking-wide cursor-pointer select-none group"
 onClick={() => toggleSort('memBytes')}
 >
 <span className="inline-flex items-center gap-1 justify-end">Memory <SortIcon field="memBytes" /></span>
 </th>
 <th
 className="px-4 py-2 text-left text-xs font-medium text-text-muted uppercase tracking-wide cursor-pointer select-none group hidden lg:table-cell"
 onClick={() => toggleSort('user')}
 >
 <span className="inline-flex items-center gap-1">User <SortIcon field="user" /></span>
 </th>
 {isAdmin() && (
 <th className="px-4 py-2 text-right text-xs font-medium text-text-muted uppercase tracking-wide w-20">
 Actions
 </th>
 )}
 </tr>
 </thead>
 <tbody className="divide-y divide-border">
 {sorted.map((proc) => {
 const killing = killingPids.has(proc.pid);
 return (
 <tr
 key={proc.pid}
 className="hover:bg-bg-tertiary/60 transition-colors group coarse:cursor-pointer"
 title={canHover ? (proc.command || proc.name) : undefined}
 onClick={canHover ? undefined : () => setDetailPid(proc.pid)}
 >
 <td className="px-4 py-1.5 font-mono text-xs text-text-muted">{proc.pid}</td>
 <td className="px-4 py-1.5 text-xs text-text-primary font-medium whitespace-nowrap max-w-xs truncate">
 {proc.name}
 {/* User column is hidden below lg — repeat it under the name. */}
 {proc.user && <span className="lg:hidden block text-[11px] font-normal font-mono text-text-muted truncate">{proc.user}</span>}
 </td>
 <td className="px-4 py-1.5 text-xs text-right font-mono">
 <span className={clsx(
 proc.cpuPercent > 80 ? 'text-red-400' :
 proc.cpuPercent > 30 ? 'text-yellow-400' :
 'text-text-muted',
 )}>
 {proc.cpuPercent.toFixed(1)}
 </span>
 </td>
 <td className="px-4 py-1.5 text-xs text-right font-mono text-text-muted">{formatMem(proc.memBytes)}</td>
 <td className="px-4 py-1.5 text-xs text-text-muted font-mono hidden lg:table-cell max-w-[10rem] truncate">{proc.user || '—'}</td>
 {isAdmin() && (
 <td className="px-4 py-1.5 text-right">
 <button
 onClick={(e) => { e.stopPropagation(); handleKill(proc.pid, proc.name); }}
 disabled={killing || !isCommandSupported(device, 'kill_process')}
 title={isCommandSupported(device, 'kill_process') ? `Kill ${proc.name} (PID ${proc.pid})` : unsupportedTooltip(t)}
 className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-lg border text-red-400/70 border-transparent hover:border-red-400/30 hover:bg-red-400/10 hover:text-red-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors can-hover:opacity-0 can-hover:group-hover:opacity-100 coarse:min-h-9"
 >
 {killing ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3" />}
 Kill
 </button>
 </td>
 )}
 </tr>
 );
 })}
 </tbody>
 </table>
 {filter && sorted.length === 0 && (
 <div className="p-6 text-center text-text-muted text-xs">No processes match "{filter}"</div>
 )}
 </div>
 )}

 {/* Touch-only process detail sheet */}
 {(() => {
 const proc = detailPid != null ? processes.find((p) => p.pid === detailPid) : undefined;
 const killable = isAdmin() && isCommandSupported(device, 'kill_process');
 return (
 <Modal
 open={!!proc}
 onClose={() => setDetailPid(null)}
 title={proc?.name}
 icon={<Activity className="w-4 h-4 text-text-muted" />}
 size="sm"
 phoneLayout="sheet"
 footer={proc && isAdmin() ? (
 <DisabledTip reason={!isCommandSupported(device, 'kill_process') && unsupportedTooltip(t)}>
 <button
 onClick={() => { const p = proc; setDetailPid(null); handleKill(p.pid, p.name); }}
 disabled={killingPids.has(proc.pid) || !killable}
 className="inline-flex items-center justify-center gap-1.5 min-h-10 px-4 text-sm rounded-lg border border-red-400/30 text-red-400 bg-red-400/10 hover:bg-red-400/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
 >
 {killingPids.has(proc.pid) ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
 {t('deviceDetail.processes.kill', 'Kill')}
 </button>
 </DisabledTip>
 ) : undefined}
 >
 {proc && (
 <dl className="space-y-2 text-sm">
 {([
 ['PID', String(proc.pid)],
 [t('deviceDetail.processes.user', 'User'), proc.user || '—'],
 ['CPU', `${proc.cpuPercent.toFixed(1)} %`],
 [t('deviceDetail.processes.memory', 'Memory'), formatMem(proc.memBytes)],
 ] as Array<[string, string]>).map(([k, v]) => (
 <div key={k} className="flex justify-between gap-3">
 <dt className="text-text-muted shrink-0">{k}</dt>
 <dd className="text-text-primary font-mono text-xs text-right min-w-0 break-all">{v}</dd>
 </div>
 ))}
 {proc.command && (
 <div>
 <dt className="text-text-muted mb-1">{t('deviceDetail.processes.commandLine', 'Command line')}</dt>
 <dd className="text-text-primary font-mono text-xs break-all bg-bg-tertiary rounded-lg p-2 select-all">{proc.command}</dd>
 </div>
 )}
 </dl>
 )}
 </Modal>
 );
 })()}
 </div>
 );
}

// ─── Main DeviceDetailPage ──────────────────────────────────────────────────────

export function DeviceDetailPage() {
 const { id } = useParams<{ id: string }>();
 const deviceId = parseInt(id ?? '0', 10);
 const navigate = useNavigate();
 const { t } = useTranslation();
 const { isAdmin, permissions } = useAuthStore();
 const confirm = useConfirm();
 // Approve / Refuse buttons unlock for admins OR users with the
 // `agent_config:approval` team capability. Server-side gate is in
 // device.routes.ts on the matching POST endpoints.
 const canManageApproval = isAdmin() || (permissions?.tenantCapabilities ?? []).includes('agent_config:approval');
 const fetchDevice = useDeviceStore((s) => s.fetchDevice);
 const updateDeviceMetrics = useDeviceStore((s) => s.updateDeviceMetrics);
 // Live metrics refresh — the agent push pipeline emits
 // DEVICE_METRICS_PUSHED on every push, but the page wasn't subscribed
 // so the displayed CPU/RAM/disk values stayed frozen until a manual
 // refresh. We patch the in-memory device's `latestMetrics` so the
 // metric bars + sensor cards re-render automatically.
 useEffect(() => {
 const socket = getSocket();
 if (!socket) return;
 const onMetrics = (msg: { deviceId: number; metrics: unknown }) => {
 if (msg.deviceId !== deviceId) return;
 // Defensive parse — the server normally sends a typed object,
 // but legacy callers occasionally stringify it.
 const metrics = (typeof msg.metrics === 'string' ? JSON.parse(msg.metrics) : msg.metrics) as import('@obliance/shared').DeviceMetrics;
 updateDeviceMetrics(deviceId, metrics);
 };
 socket.on('DEVICE_METRICS_PUSHED', onMetrics);
 return () => { socket.off('DEVICE_METRICS_PUSHED', onMetrics); };
 }, [deviceId, updateDeviceMetrics]);

 // Live mode — while the device detail page is open, ask the agent
 // to push every ~3s so the user actually sees CPU/RAM moving. The
 // server enforces a fixed window (60s) so a stale tab can't keep a
 // device in fast-push forever; we re-arm every 30s as long as the
 // page stays mounted. Reverting to the configured push_interval is
 // automatic on unmount (no command needed — the window expires).
 useEffect(() => {
 let cancelled = false;
 const arm = async () => {
 if (cancelled) return;
 try { await deviceApi.requestLiveMetrics(deviceId, 'live', 60); } catch { /* offline agent — silent */ }
 };
 arm();
 const id = window.setInterval(arm, 30 * 1000);
 return () => { cancelled = true; window.clearInterval(id); };
 }, [deviceId]);
 // Explicit selector — Zustand re-renders this component whenever the
 // device row is mutated in the store (via socket events, push updates,
 // or local fetches). Without the selector, destructuring getDevice
 // returned a stale snapshot until a manual refresh.
 const selectedDevice = useDeviceStore((s) => s.devices.get(deviceId));
 const [activeTab, setActiveTab] = useState<Tab>('overview');
 const [isLoading, setIsLoading] = useState(true);

 // Cross-tenant auto-switch: when the deep-link points to a device that
 // isn't visible under the active tenant, ask the server which tenant
 // owns it. The server only answers when the caller actually has access
 // to that tenant, so we can silently switch without a confirmation
 // step. While the switch is in flight we show a small "switching"
 // loader instead of the dead-end "Device not found".
 const [tenantSwitchTarget, setTenantSwitchTarget] = useState<string | null>(null);

 // Inline rename + note editing (header-level).
 const [editingName, setEditingName] = useState(false);
 const [nameDraft, setNameDraft] = useState('');
 const [editingNote, setEditingNote] = useState(false);
 const [noteDraft, setNoteDraft] = useState('');

 // Custom sections that apply to this device (resolved server-side)
 const [customSections, setCustomSections] = useState<CustomSection[]>([]);
 useEffect(() => {
 if (!deviceId) return;
 fetch(`/api/devices/${deviceId}/custom-sections`, { credentials: 'include' })
 .then((r) => r.ok ? r.json() : { data: [] })
 .then((res) => setCustomSections(res.data ?? []))
 .catch(() => setCustomSections([]));
 }, [deviceId]);

 // Privacy unlock state: features currently unlocked by password + expiry
 const [privacyUnlocks, setPrivacyUnlocks] = useState<Record<string, number>>({});
 const [unlockModalFeature, setUnlockModalFeature] = useState<null | { feature: 'scripts' | 'remote' | 'files' | 'processes'; navigateTo?: Tab; afterUnlock?: () => void }>(null);
 const [managePasswordMode, setManagePasswordMode] = useState<null | 'set' | 'change' | 'remove'>(null);
 const [disablePrivacyPrompt, setDisablePrivacyPrompt] = useState(false);

 // Reload unlock state from server on mount and after each unlock
 useEffect(() => {
 if (!deviceId) return;
 deviceApi.listPrivacyUnlocks(deviceId).then((list) => {
 const map: Record<string, number> = {};
 for (const u of list) map[u.feature] = u.expiresAt;
 setPrivacyUnlocks(map);
 }).catch(() => {});
 }, [deviceId]);

 // Drop expired unlocks automatically every 10s
 useEffect(() => {
 const int = setInterval(() => {
 setPrivacyUnlocks((prev) => {
 const now = Date.now();
 const next: Record<string, number> = {};
 for (const [k, v] of Object.entries(prev)) if (v > now) next[k] = v;
 return next;
 });
 }, 10000);
 return () => clearInterval(int);
 }, []);

 const isFeatureUnlocked = (feature: string) => {
 const exp = privacyUnlocks[feature];
 return exp && exp > Date.now();
 };

 const unlockCountdown = (feature: string): string | null => {
 const exp = privacyUnlocks[feature];
 if (!exp || exp <= Date.now()) return null;
 const remaining = Math.max(0, exp - Date.now());
 const mins = Math.floor(remaining / 60000);
 const secs = Math.floor((remaining % 60000) / 1000);
 return `${mins}:${secs.toString().padStart(2, '0')}`;
 };

 // Force re-render every second when at least one feature is unlocked,
 // so the countdown badge ticks down in real-time.
 const [, forceTick] = useState(0);
 useEffect(() => {
 if (Object.keys(privacyUnlocks).length === 0) return;
 const t = setInterval(() => forceTick((n) => n + 1), 1000);
 return () => clearInterval(t);
 }, [privacyUnlocks]);
 const [crossAppLinks, setCrossAppLinks] = useState<Array<{ appType: string; name: string; url: string; color: string | null }>>([]);

 // Uninstall countdown (ticks every second while device is pending_uninstall)
 const [uninstallCountdown, setUninstallCountdown] = useState<string>('');
 const _uninstallAt = selectedDevice?.uninstallAt ?? null;
 const _isPendingUninstall = selectedDevice?.status === 'pending_uninstall';
 useEffect(() => {
 if (!_isPendingUninstall || !_uninstallAt) {
 setUninstallCountdown('');
 return;
 }
 const tick = () => {
 const remaining = Math.max(0, new Date(_uninstallAt).getTime() - Date.now());
 const m = Math.floor(remaining / 60000);
 const s = Math.floor((remaining % 60000) / 1000);
 setUninstallCountdown(remaining <= 0 ? '0:00' : `${m}:${String(s).padStart(2, '0')}`);
 };
 tick();
 const t = setInterval(tick, 1000);
 return () => clearInterval(t);
 }, [_uninstallAt, _isPendingUninstall]);

 // Chat — now uses global store (persists across page navigation)
 const [chatSessionPickerOpen, setChatSessionPickerOpen] = useState(false);
 const chatIsOpen = useChatStore(s => s.isOpen && s.sessions.length > 0);

 // Register remote-access callback so chat can trigger ObliReach
 useEffect(() => {
 useChatStore.getState().setOnRemoteAccessGranted(() => {
 handleHeaderRemote('oblireach');
 });
 return () => { useChatStore.getState().setOnRemoteAccessGranted(null); };
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, []);

 // Quick-action state (header buttons — visible on every tab)
 const [headerPending, setHeaderPending] = useState<Set<string>>(new Set());
 // null = loading, false = not installed, true = installed+online
 const [headerOrInstalled, setHeaderOrInstalled] = useState<boolean | null>(null);
 const [headerOrVersion, setHeaderOrVersion] = useState<string | null>(null);
 const [headerOrLatestVersion, setHeaderOrLatestVersion] = useState<string | null>(null);
 const [headerRemoteOpen, setHeaderRemoteOpen] = useState(false);
 const [headerRemoteSession, setHeaderRemoteSession] = useState<RemoteSession | null>(null);
 const [headerRemoteProtocol, setHeaderRemoteProtocol] = useState<'ssh' | 'cmd' | 'powershell' | 'oblireach'>('oblireach');
 const [isStartingRemote, setIsStartingRemote] = useState(false);
 const [remoteDropdownOpen, setRemoteDropdownOpen] = useState(false);
 const [headerOrSessions, setHeaderOrSessions] = useState<ObliReachSession[]>([]);
 const [headerOrSessionPickerOpen, setHeaderOrSessionPickerOpen] = useState(false);
 const remoteDropdownRef = useRef<HTMLDivElement>(null);
 const remoteReadyListenerRef = useRef<((s: RemoteSession) => void) | null>(null);
 // wtsSessionId used for the current header Oblireach session, reused on
 // auto-reconnect after login transition.
 const headerOrWtsSessionIdRef = useRef<number | undefined>(undefined);

 const handleHeaderAction = async (type: 'restart_agent' | 'reboot' | 'shutdown' | 'sleep') => {
 setHeaderPending((p) => new Set(p).add(type));
 try {
 await commandApi.enqueue(deviceId, type, {});
 toast.success(`${type.replace(/_/g, ' ')} command sent`);
 } catch {
 toast.error(`Failed to send ${type} command`);
 } finally {
 setHeaderPending((p) => { const n = new Set(p); n.delete(type); return n; });
 }
 };

 // Force-applies an agent update via the 'update_agent' command. The server
 // resolves the target version + arch-aware MSI; the agent applies it (no
 // self-update anymore). Goes through the standard command restriction flow.
 const handleUpdateAgent = async () => {
 if (!(await confirm(t('devices.action.updateAgentConfirm', { count: 1, defaultValue: 'Update the agent on {{count}} device(s)?' })))) return;
 setHeaderPending((p) => new Set(p).add('update_agent'));
 try {
 await commandApi.enqueue(deviceId, 'update_agent', {}, 'high');
 toast.success(t('devices.action.updateAgent') || 'Update agent');
 } catch {
 toast.error(t('common.error') || 'Something went wrong');
 } finally {
 setHeaderPending((p) => { const n = new Set(p); n.delete('update_agent'); return n; });
 }
 };

 const handleHeaderStartObliReachSession = async (wtsSessionId?: number) => {
 setHeaderOrSessionPickerOpen(false);
 setHeaderRemoteProtocol('oblireach');
 setHeaderRemoteSession(null);
 setHeaderRemoteOpen(true);
 setIsStartingRemote(true);
 headerOrWtsSessionIdRef.current = wtsSessionId;
 try {
 const session = await remoteApi.startSession(deviceId, 'oblireach', undefined, wtsSessionId);
 const socket = getSocket();
 if (socket) {
 const onReady = (s: RemoteSession) => {
 if (s.deviceId !== deviceId || s.id !== session.id) return;
 setHeaderRemoteSession(s);
 socket.off('REMOTE_TUNNEL_READY', onReady);
 remoteReadyListenerRef.current = null;
 };
 remoteReadyListenerRef.current = onReady;
 socket.on('REMOTE_TUNNEL_READY', onReady);
 }
 } catch {
 toast.error('Failed to start Oblireach session');
 setHeaderRemoteOpen(false);
 } finally {
 setIsStartingRemote(false);
 }
 };

 // Called by ObliReachViewer after an unexpected WS close (see doc on
 // onReconnect prop). Recreates the session on the same WTS target so
 // the viewer can reopen its tunnel.
 const handleHeaderReconnectObliReach = async () => {
 const session = await remoteApi.startSession(
 deviceId, 'oblireach', undefined, headerOrWtsSessionIdRef.current,
 );
 setHeaderRemoteSession(session);
 };

 const handleHeaderRemote = async (protocol: 'ssh' | 'cmd' | 'powershell' | 'oblireach') => {
 setRemoteDropdownOpen(false);

 // Oblireach: if not installed redirect to install command; if installed check sessions.
 if (protocol === 'oblireach') {
 if (headerOrInstalled === false) {
 if (!isAgentReachable(device?.status)) { toast.error('Device is offline'); return; }
 try {
 await commandApi.enqueue(deviceId, 'install_oblireach', {}, 'high');
 toast.success('Install command sent — Oblireach will deploy shortly.');
 } catch { toast.error('Failed to send install command'); }
 return;
 }
 if (headerOrInstalled === null) { toast('Checking Oblireach status…'); return; }
 // Installed — check sessions and show picker if multiple.
 try {
 const sessions = await remoteApi.getObliReachSessions(device?.uuid ?? '');
 if (sessions.length > 1) {
 setHeaderOrSessions(sessions);
 setHeaderOrSessionPickerOpen(true);
 return;
 }
 await handleHeaderStartObliReachSession(sessions[0]?.id);
 } catch {
 await handleHeaderStartObliReachSession(undefined);
 }
 return;
 }

 // SSH / CMD / PowerShell now go through the global multi-session panel
 // so they can be minimized, switched between, and survive route changes.
 setIsStartingRemote(true);
 try {
 const session = await remoteApi.startSession(deviceId, protocol);
 const deviceName = anonymize(device?.displayName || device?.hostname) || `#${deviceId}`;
 const { useRemoteShellStore } = await import('@/store/remoteShellStore');
 const add = () => useRemoteShellStore.getState().addSession({
 id: session.sessionToken,
 deviceId,
 deviceName,
 protocol,
 sessionToken: session.sessionToken,
   serverSessionId: session.id,
 });
 const socket = getSocket();
 if (socket) {
 const onReady = (s: RemoteSession) => {
 if (s.deviceId !== deviceId || s.id !== session.id) return;
 socket.off('REMOTE_TUNNEL_READY', onReady);
 add();
 };
 socket.on('REMOTE_TUNNEL_READY', onReady);
 // Safety: open the tab anyway after 1.5s even if READY never came.
 setTimeout(() => {
 socket.off('REMOTE_TUNNEL_READY', onReady);
 const already = useRemoteShellStore.getState().sessions.find((x) => x.id === session.sessionToken);
 if (!already) add();
 }, 1500);
 } else {
 add();
 }
 } catch {
 toast.error(`Failed to start ${protocol.toUpperCase()} session`);
 } finally {
 setIsStartingRemote(false);
 }
 };

 // pointerdown (capture) — closes on touch as soon as the finger lands,
 // including when the user starts scrolling.
 useClickOutside(remoteDropdownRef, () => setRemoteDropdownOpen(false), remoteDropdownOpen);

 // Keep the active tab scrolled into view in the (horizontally scrolling)
 // tab bar — e.g. after the privacy unlock modal switches tab on a phone.
 // Horizontal only: never scrolls the page itself.
 const tabsBarRef = useRef<HTMLDivElement>(null);
 useEffect(() => {
 const bar = tabsBarRef.current;
 const el = bar?.querySelector<HTMLElement>('[data-active-tab="true"]');
 if (!bar || !el) return;
 const b = bar.getBoundingClientRect();
 const r = el.getBoundingClientRect();
 if (r.left < b.left) bar.scrollLeft -= b.left - r.left + 8;
 else if (r.right > b.right) bar.scrollLeft += r.right - b.right + 8;
 }, [activeTab]);


 const [isApprovingDevice, setIsApprovingDevice] = useState(false);
 const [isRefusingDevice, setIsRefusingDevice] = useState(false);

 const handleApproveDevice = async () => {
 setIsApprovingDevice(true);
 try {
 await deviceApi.approve(deviceId);
 toast.success('Device approved');
 await fetchDevice(deviceId);
 } catch {
 toast.error('Failed to approve device');
 } finally {
 setIsApprovingDevice(false);
 }
 };

 const handleRefuseDevice = async () => {
 if (!(await confirm({ message: t('deviceDetail.header.refuseConfirm', 'Refuse this device?'), danger: true, confirmLabel: t('deviceDetail.header.refuse', 'Refuse') }))) return;
 setIsRefusingDevice(true);
 try {
 await deviceApi.refuse(deviceId);
 toast.success('Device refused');
 navigate('/devices');
 } catch {
 toast.error('Failed to refuse device');
 } finally {
 setIsRefusingDevice(false);
 }
 };

 const [isScanningAll, setIsScanningAll] = useState(false);
 const handleScanAll = async () => {
 setIsScanningAll(true);
 try {
 await Promise.all([
 commandApi.enqueue(deviceId, 'scan_inventory'),
 commandApi.enqueue(deviceId, 'scan_updates'),
 commandApi.enqueue(deviceId, 'check_compliance'),
 ]);
 toast.success('Scan All commands dispatched');
 } catch {
 toast.error('Failed to dispatch Scan All');
 } finally {
 setIsScanningAll(false);
 }
 };

 // Re-fetch when the tenant changes so the device load retries after a
 // silent cross-tenant switch (deviceId stays the same, only the tenant
 // flips).
 const currentTenantId = useTenantStore((s) => s.currentTenantId);
 useEffect(() => {
 let cancelled = false;
 const load = async () => {
 setIsLoading(true);
 setTenantSwitchTarget(null);
 const dev = await fetchDevice(deviceId);
 if (cancelled) return;
 if (dev) {
 setIsLoading(false);
 return;
 }
 // Device not visible under the current tenant — try to locate it.
 // The server only returns the tenant when the caller has access to
 // it; otherwise we fall through to the regular "Device not found".
 const located = await deviceApi.locate(deviceId);
 if (cancelled) return;
 if (located && located.currentTenantId !== located.tenantId) {
 // Silent switch: keep isLoading true so the UI shows the spinner
 // (with the target tenant name) instead of "Device not found"
 // mid-flight. AppLayout's reset-to-/ effect is suppressed via
 // sessionStorage so the URL survives the tenant change.
 setTenantSwitchTarget(located.tenantName);
 sessionStorage.setItem('skipTenantSwitchRedirect', '1');
 try {
 await useTenantStore.getState().setCurrentTenant(located.tenantId);
 // The currentTenantId dep change will re-run this effect; we
 // just need to keep the loading state until that happens.
 } catch {
 // Server refused the switch (rare — would mean the access
 // check raced). Drop the spinner and show "Device not found".
 if (!cancelled) {
 sessionStorage.removeItem('skipTenantSwitchRedirect');
 setTenantSwitchTarget(null);
 setIsLoading(false);
 }
 }
 return;
 }
 setIsLoading(false);
 };
 load();
 return () => { cancelled = true; };
 }, [deviceId, fetchDevice, currentTenantId]);

 const device = selectedDevice;

 const startRename = () => {
 if (!device) return;
 setNameDraft(device.displayName ?? device.hostname ?? '');
 setEditingName(true);
 };
 const saveRename = async () => {
 if (!device) return;
 const v = nameDraft.trim();
 const current = device.displayName ?? device.hostname ?? '';
 if (!v || v === current) { setEditingName(false); return; }
 try {
 await deviceApi.update(device.id, { displayName: v });
 setEditingName(false);
 await fetchDevice(device.id);
 } catch { toast.error('Failed to rename'); }
 };

 const startNote = () => {
 if (!device) return;
 setNoteDraft(device.description ?? '');
 setEditingNote(true);
 };
 const saveNote = async () => {
 if (!device) return;
 if (noteDraft === (device.description ?? '')) { setEditingNote(false); return; }
 try {
 // Send null (not undefined) when emptied so the server clears the
 // DB column. `description: undefined` is stripped by the service
 // layer and the old note sticks around.
 const next: string | null = noteDraft.trim() === '' ? null : noteDraft;
 await deviceApi.update(device.id, { description: next });
 setEditingNote(false);
 await fetchDevice(device.id);
 } catch { toast.error('Failed to save note'); }
 };
 const deleteNote = async () => {
 if (!device) return;
 try {
 await deviceApi.update(device.id, { description: null });
 setEditingNote(false);
 setNoteDraft('');
 await fetchDevice(device.id);
 } catch { toast.error('Failed to delete note'); }
 };

 useEffect(() => {
 if (!device?.uuid) { setHeaderOrInstalled(false); return; }
 remoteApi.listObliReachDeviceUuids().then((uuids) => {
 const installed = uuids.has(device.uuid!);
 setHeaderOrInstalled(installed);
 if (installed) {
 Promise.all([
 remoteApi.getObliReachDevice(device.uuid!),
 remoteApi.getObliReachLatestVersion(),
 ]).then(([dev, latest]) => {
 setHeaderOrVersion(dev?.version ?? null);
 setHeaderOrLatestVersion(latest);
 });
 }
 }).catch(() => setHeaderOrInstalled(false));
 }, [device?.uuid]);

 useEffect(() => {
 if (!device?.uuid) return;
 fetch(`/api/auth/device-links?uuid=${encodeURIComponent(device.uuid)}`, { credentials: 'include' })
 .then(r => r.json())
 .then((d: { success: boolean; data?: Array<{ appType: string; name: string; url: string; color: string | null }> }) => {
 if (d.success && d.data) setCrossAppLinks(d.data);
 })
 .catch(() => {});
 }, [device?.uuid]);


 if (isLoading) {
 return (
 <div className="flex flex-col items-center justify-center h-64 gap-3">
 <RefreshCw className="w-6 h-6 animate-spin text-text-muted" />
 {tenantSwitchTarget && (
 <p className="text-sm text-text-muted">
 {t('deviceDetail.locate.switching', { tenant: tenantSwitchTarget })
 || `Switching to ${tenantSwitchTarget}…`}
 </p>
 )}
 </div>
 );
 }

 if (!device) {
 return (
 <div className="p-6 text-center">
 <p className="text-text-muted">{t('deviceDetail.notFound') || 'Device not found'}</p>
 <Link to="/devices" className="mt-2 inline-block text-sm text-accent">
 {t('deviceDetail.locate.backLink') || '← Back to devices'}
 </Link>
 </div>
 );
 }

 // ── Header actions (shared by the inline buttons and the phone "⋯" sheet) ──
 const unsup = (c: Parameters<typeof isCommandSupported>[1]) => (isCommandSupported(device, c) ? null : unsupportedTooltip(t));
 const scanAllSupported = isCommandSupported(device, 'scan_inventory') && isCommandSupported(device, 'scan_updates') && isCommandSupported(device, 'check_compliance');
 const scanAllDisabled = isScanningAll || !isAgentReachable(device.status) || !scanAllSupported;
 const scanAllReason = !scanAllSupported ? unsupportedTooltip(t) : !isAgentReachable(device.status) ? t('deviceDetail.reason.agentOnline', 'Agent must be online') : null;
 const showUpdateAgent = device.updateAvailable && device.status !== 'updating' && device.status !== 'update_error';

 const handleAirgapToggle = async () => {
 if (device.airgapEnabled) {
 setHeaderPending((p) => new Set(p).add('airgap'));
 try {
 await deviceApi.disableAirgap(device.id);
 toast.success(t('airgap.disableSent', 'Airgap disable command sent'));
 } catch { toast.error(t('airgap.disableFailed')); }
 finally { setHeaderPending((p) => { const n = new Set(p); n.delete('airgap'); return n; }); }
 } else {
 if (!(await confirm({
 message: t('airgap.confirmEnable', 'This will isolate this device from all network traffic except Obliance server communication. Continue?'),
 danger: true,
 confirmLabel: t('airgap.enable', 'Enable Airgap'),
 }))) return;
 setHeaderPending((p) => new Set(p).add('airgap'));
 try {
 await deviceApi.enableAirgap(device.id);
 toast.success(t('airgap.enableSent', 'Airgap enable command sent'));
 } catch { toast.error(t('airgap.enableFailed')); }
 finally { setHeaderPending((p) => { const n = new Set(p); n.delete('airgap'); return n; }); }
 }
 };

 const handleDisablePrivacy = async () => {
 // If a password gate is set, prompt the user via the modal.
 if (device.privacyPasswordSet) {
 setDisablePrivacyPrompt(true);
 return;
 }
 setHeaderPending((p) => new Set(p).add('privacy'));
 try {
 await deviceApi.disablePrivacyMode(device.id);
 toast.success(t('privacy.disableSent'));
 } catch { toast.error(t('privacy.disableFailed')); }
 finally { setHeaderPending((p) => { const n = new Set(p); n.delete('privacy'); return n; }); }
 };

 // Below md the secondary header actions collapse into one "⋯" bottom
 // sheet (Chat + Remote stay as buttons). md+ renders them inline.
 const phoneHeaderItems: ActionMenuItem[] = [
 {
 key: 'scanAll',
 icon: <ScanLine className="w-4 h-4" />,
 label: t('deviceDetail.header.scanAll', 'Scan All'),
 description: scanAllReason ?? undefined,
 disabled: scanAllDisabled,
 onClick: handleScanAll,
 },
 {
 key: 'airgap',
 icon: <WifiOff className="w-4 h-4" />,
 label: device.airgapEnabled ? t('airgap.disable', 'Disable Airgap') : t('airgap.enable', 'Enable Airgap'),
 disabled: headerPending.has('airgap'),
 hidden: !isAdmin(),
 onClick: handleAirgapToggle,
 },
 {
 key: 'privacy',
 icon: <ShieldOff className="w-4 h-4" />,
 label: t('privacy.disable', 'Disable Privacy'),
 disabled: headerPending.has('privacy'),
 hidden: !(device.privacyModeEnabled && isAdmin()),
 onClick: handleDisablePrivacy,
 },
 {
 key: 'updateAgent',
 icon: <Download className="w-4 h-4" />,
 label: t('devices.action.updateAgent', 'Update agent'),
 description: unsup('update_agent') ?? undefined,
 disabled: headerPending.has('update_agent') || !isCommandSupported(device, 'update_agent'),
 hidden: !showUpdateAgent,
 onClick: handleUpdateAgent,
 },
 {
 key: 'restartAgent',
 icon: <RotateCcw className="w-4 h-4" />,
 label: t('deviceDetail.header.restartAgent', 'Restart Agent'),
 description: unsup('restart_agent') ?? undefined,
 disabled: headerPending.has('restart_agent') || !isCommandSupported(device, 'restart_agent'),
 separator: true,
 onClick: () => handleHeaderAction('restart_agent'),
 },
 {
 key: 'sleep',
 icon: <Moon className="w-4 h-4" />,
 label: t('deviceDetail.header.sleep', 'Suspend device (sleep)'),
 description: unsup('sleep') ?? undefined,
 disabled: headerPending.has('sleep') || !isCommandSupported(device, 'sleep'),
 onClick: () => handleHeaderAction('sleep'),
 },
 {
 key: 'reboot',
 icon: <RotateCcw className="w-4 h-4" />,
 label: t('deviceDetail.header.reboot', 'Reboot device'),
 description: unsup('reboot') ?? undefined,
 disabled: headerPending.has('reboot') || !isCommandSupported(device, 'reboot'),
 onClick: () => handleHeaderAction('reboot'),
 },
 {
 key: 'shutdown',
 icon: <Power className="w-4 h-4" />,
 label: t('deviceDetail.header.shutdown', 'Shutdown device'),
 description: unsup('shutdown') ?? undefined,
 disabled: headerPending.has('shutdown') || !isCommandSupported(device, 'shutdown'),
 danger: true,
 onClick: () => handleHeaderAction('shutdown'),
 },
 ...crossAppLinks.map((link, i): ActionMenuItem => ({
 key: `app-${link.appType}`,
 icon: <ExternalLink className="w-4 h-4" />,
 label: t('deviceDetail.header.openIn', { defaultValue: 'Open in {{app}}', app: link.name }),
 separator: i === 0,
 onClick: () => { void openExternal(link.url); },
 })),
 ];

 const deviceTitle = anonymize(device.displayName || device.hostname);

 return (
 <PageContainer className="space-y-6">
 {/* Remote session launched from header */}
 {headerRemoteOpen && headerRemoteProtocol === 'oblireach' && (
 <ObliReachViewer
 sessionToken={headerRemoteSession?.sessionToken ?? null}
 deviceName={anonymize(device.displayName || device.hostname)}
 preferredCodec={useAuthStore.getState().user?.preferences?.preferredCodec}
 onChatToggle={() => {
 const cs = useChatStore.getState();
 if (cs.isOpen && cs.sessions.length > 0) cs.toggleOpen();
 else cs.openChat(device.uuid, device.displayName || device.hostname);
 }}
 chatOpen={chatIsOpen}
 chatSoundEnabled={useChatStore.getState().soundEnabled}
 onChatSoundToggle={() => useChatStore.getState().toggleSound()}
 onClose={async () => {
 if (headerRemoteSession) try { await remoteApi.endSession(headerRemoteSession.id); } catch {}
 setHeaderRemoteOpen(false);
 setHeaderRemoteSession(null);
 }}
 onReconnect={handleHeaderReconnectObliReach}
 />
 )}
 {/* SSH/CMD/PowerShell sessions now live in the global panel rendered
 at the AppLayout level — nothing to render here anymore. */}
 {/* Chat session picker (RDS) */}
 <Modal
 open={chatSessionPickerOpen}
 onClose={() => setChatSessionPickerOpen(false)}
 title={t('deviceDetail.chat.pickSessionTitle', 'Select session to chat with')}
 size="sm"
 phoneLayout="sheet"
 closeOnBackdrop={false}
 showCloseButton={false}
 className="sm:max-w-sm"
 bodyClassName="p-3 pt-0"
 footer={
 <button onClick={() => setChatSessionPickerOpen(false)}
 className="px-4 py-1.5 text-xs bg-bg-tertiary text-text-muted rounded-lg hover:text-text-primary coarse:min-h-10">
 {t('common.cancel', 'Cancel')}
 </button>
 }
 >
 <p className="text-xs text-text-muted px-1 pb-2">{t('deviceDetail.chat.pickSessionHint', 'Choose which user session to open the chat in.')}</p>
 <div className="space-y-1 sm:max-h-60 sm:overflow-y-auto">
 {headerOrSessions.map((s) => (
 <button key={s.id} onClick={() => {
 setChatSessionPickerOpen(false);
 useChatStore.getState().openChat(device.uuid, device.displayName || device.hostname, s.id);
 }}
 className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-bg-tertiary transition-colors text-left coarse:min-h-12">
 <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center text-accent text-xs font-bold">
 {s.id}
 </div>
 <div className="flex-1 min-w-0">
 <div className="text-sm text-text-primary font-medium truncate">{s.username || 'Unknown'}</div>
 <div className="text-[10px] text-text-muted">{s.state} · {s.stationName || `Session ${s.id}`}</div>
 </div>
 </button>
 ))}
 </div>
 </Modal>
 {/* WTS Session picker — header remote button (RDS with multiple sessions) */}
 <Modal
 open={headerOrSessionPickerOpen}
 onClose={() => setHeaderOrSessionPickerOpen(false)}
 title={t('deviceDetail.remote.chooseSession', 'Choose Session')}
 icon={<MonitorPlay className="w-4 h-4 text-accent" />}
 size="sm"
 phoneLayout="sheet"
 closeOnBackdrop={false}
 className="sm:max-w-sm"
 bodyClassName="p-3"
 >
 <div className="space-y-1 sm:max-h-72 sm:overflow-y-auto">
 {headerOrSessions.map((s) => (
 <button
 key={s.id}
 onClick={() => handleHeaderStartObliReachSession(s.id)}
 className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-bg-tertiary transition-colors flex items-center gap-3 coarse:min-h-12"
 >
 <div className={clsx(
 'w-2 h-2 rounded-full flex-shrink-0',
 s.state === 'Active' ? 'bg-green-400' :
 s.state === 'Disconnected' ? 'bg-yellow-400' : 'bg-gray-400',
 )} />
 <div className="min-w-0 flex-1">
 <div className="text-sm font-medium text-text-primary truncate">
 {s.username || '(no user)'}
 </div>
 <div className="text-xs text-text-muted">
 {s.state}{s.isConsole ? ' · Console' : ''}{s.stationName ? ` · ${s.stationName}` : ''}
 </div>
 </div>
 </button>
 ))}
 </div>
 </Modal>

 {/* Airgap banner */}
 {device.airgapEnabled && (
 <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-blue-400/40 bg-blue-500/10 text-blue-300">
 <WifiOff className="w-5 h-5 shrink-0" />
 <div className="flex-1 min-w-0">
 <p className="text-sm font-semibold">{t('airgap.bannerTitle')}</p>
 <p className="text-xs text-blue-300/80 mt-0.5">{t('airgap.bannerMessage')}</p>
 </div>
 </div>
 )}

 {/* Agent update-available banner — admins force-apply the update from
 here (agents no longer self-update). Hidden while the agent is
 already mid-update / errored (the status badge covers those). */}
 {device.updateAvailable && device.status !== 'updating' && device.status !== 'update_error' && (
 <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-blue-400/40 bg-blue-500/10 text-blue-300">
 <Download className="w-5 h-5 shrink-0" />
 <div className="flex-1 min-w-0">
 <p className="text-sm font-semibold">{t('deviceDetail.updateBanner') || 'Agent update available'}</p>
 </div>
 <DisabledTip reason={unsup('update_agent')}>
 <button
 onClick={handleUpdateAgent}
 disabled={headerPending.has('update_agent') || !isCommandSupported(device, 'update_agent')}
 className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-blue-500/20 hover:bg-blue-500/30 text-blue-200 border border-blue-400/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0 coarse:min-h-10"
 >
 {headerPending.has('update_agent') ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
 {t('devices.action.updateAgent') || 'Update agent'}
 </button>
 </DisabledTip>
 </div>
 )}

 {/* Duplicate agent ID banner — fires when the server observes too
 many distinct hostnames / IPs / MACs on this single agent_id in
 a short window (typical VM-cloning without machine-id regen). */}
 {device.duplicateAgentIdSuspected && (
 <DuplicateAgentIdBanner device={device} onAcknowledged={async () => { await fetchDevice(deviceId); }} />
 )}

 {/* Header — below lg (and below xl on touch tablets, e.g. 1024 landscape)
 the action cluster drops to its own row (it used to be shrink-0 next to
 the name and squeezed it to nothing on tablets). */}
 <div className="flex items-start gap-4 max-lg:flex-wrap max-lg:gap-3 coarse:max-xl:flex-wrap coarse:max-xl:gap-3">
 <IconButton
 onClick={() => {
 // Prefer history back so the previous page (with its filters) is restored.
 // Fall back to /devices if there is no history entry.
 if (window.history.length > 1) navigate(-1);
 else navigate('/devices');
 }}
 size="lg"
 variant="plain"
 className="rounded-lg hover:bg-bg-secondary mt-0.5"
 label={t('common.back', 'Back')}
 icon={<ArrowLeft className="w-4 h-4" />}
 />
 <div className="flex-1 min-w-0">
 <div className="flex items-center gap-3 flex-wrap max-sm:gap-2">
 <OsIcon osType={device.osType} className="w-5 h-5 text-text-muted shrink-0" />
 {editingName ? (
 <div className="flex items-center gap-1 max-sm:w-full max-sm:min-w-0">
 <input
 autoFocus
 value={nameDraft}
 onChange={(e) => setNameDraft(e.target.value)}
 onKeyDown={(e) => {
 if (e.key === 'Enter') saveRename();
 if (e.key === 'Escape') setEditingName(false);
 }}
 autoCapitalize="off" autoCorrect="off" spellCheck={false}
 className="text-2xl font-bold bg-bg-tertiary border border-accent rounded px-2 py-0.5 text-text-primary focus:outline-none focus:ring-1 focus:ring-accent max-sm:min-w-0 max-sm:flex-1 max-sm:w-full max-sm:text-xl"
 />
 <IconButton
 onClick={saveRename}
 size="sm"
 variant="plain"
 className="text-green-400 hover:text-green-400 hover:bg-bg-secondary"
 label={t('common.save', 'Save')}
 icon={<Check className="w-4 h-4" />}
 />
 <IconButton
 onClick={() => setEditingName(false)}
 size="sm"
 variant="plain"
 className="hover:bg-bg-secondary"
 label={t('common.cancel', 'Cancel')}
 icon={<X className="w-4 h-4" />}
 />
 </div>
 ) : (
 <div className="flex items-center gap-1 min-w-0">
 <h1 className="text-2xl font-bold text-text-primary truncate max-sm:text-xl">
 {deviceTitle}
 </h1>
 <IconButton
 onClick={startRename}
 size="sm"
 variant="plain"
 className="hover:bg-bg-secondary"
 label={t('deviceDetail.header.rename', 'Rename')}
 icon={<Pencil className="w-3.5 h-3.5" />}
 />
 </div>
 )}
 <DeviceStatusBadge status={device.status} scheduleAlert={device.scheduleAlert} />
 <LastSeenPill lastSeenAt={device.lastSeenAt} />
 {/* Master/god-view: surface the device's owning tenant in
 the header so the admin always knows which customer
 they're acting on. Hidden on child tenants (the chip is
 redundant when you're inside that tenant). */}
 <TenantBadge tenantId={device.tenantId} tenantName={device.tenantName} size="md" />
 {/* Tags — surfaced inline next to the status so admins
 spot at a glance which functional buckets a device
 belongs to. Same compact chip style as the device
 table column option. The detached row of tags below
 still shows them larger; this is the quick-glance
 version. */}
 {Array.isArray(device.tags) && device.tags.length > 0 && (
 <div className="inline-flex items-center gap-1 flex-wrap">
 {device.tags.map((tag) => (
 <span
 key={tag}
 className="px-2 py-0.5 text-xs rounded-full bg-bg-tertiary text-text-muted"
 >
 {tag}
 </span>
 ))}
 </div>
 )}
 {device.privacyModeEnabled && (
 <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-orange-400/10 text-orange-400 border border-orange-400/30">
 <Shield className="w-3 h-3" />
 {t('privacy.badge')}
 </span>
 )}
 {device.airgapEnabled && (
 <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-blue-500/10 text-blue-400 border border-blue-400/30">
 <WifiOff className="w-3 h-3" />
 {t('airgap.badge')}
 </span>
 )}
 {device.agentFlavor === 'legacy' && (
 <DisabledTip reason={t('deviceDetail.header.legacyHint', 'Legacy Go 1.20 agent — no remote shell / ObliReach / software compliance / auto-update')}>
 <span
 className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full bg-amber-400/10 text-amber-400 border border-amber-400/30 uppercase tracking-wider"
 >
 Legacy
 </span>
 </DisabledTip>
 )}
 </div>
 <p className="group text-sm text-text-muted mt-1">
 {device.osName} · {anonymizeIp(device.ipLocal ?? device.ipPublic ?? 'unknown IP')} · Agent v{device.agentVersion ?? '?'}
 {device.osType !== 'linux' && headerOrInstalled === true && headerOrVersion && (
 <span>
 {' '}· Reach v{headerOrVersion}
 {headerOrLatestVersion && headerOrVersion !== headerOrLatestVersion && (() => {
 const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number);
 const [cm, cmi, cp] = parse(headerOrVersion);
 const [lm, lmi, lp] = parse(headerOrLatestVersion);
 const isOlder = cm !== lm ? cm < lm : cmi !== lmi ? cmi < lmi : cp < lp;
 return isOlder ? <span className="ml-1 text-yellow-400">↑ v{headerOrLatestVersion}</span> : null;
 })()}
 </span>
 )}
 {/* "add note" affordance — revealed on hover with a mouse
 (where Obliview puts it), always visible on touch. */}
 {!device.description && !editingNote && (
 <button
 onClick={startNote}
 className="ml-2 can-hover:opacity-0 can-hover:group-hover:opacity-100 transition-opacity inline-flex items-center gap-1 text-rose-400 hover:text-rose-300 coarse:min-h-8"
 title={t('deviceDetail.note.add', 'Add a note')}
 >
 <Plus className="w-3 h-3" />
 <span className="text-xs">add note</span>
 </button>
 )}
 </p>
 {/* Rose note banner under the info line — only rendered when a
 note exists or while editing. Click anywhere on the banner
 to edit. */}
 <NoteBanner
 description={device.description}
 editing={editingNote}
 draft={noteDraft}
 onDraftChange={setNoteDraft}
 onStart={startNote}
 onSave={saveNote}
 onCancel={() => setEditingNote(false)}
 onDelete={deleteNote}
 />
 </div>
 {/* Below lg: order-last so the refresh button stays on the first row
 (next to the name) and the action cluster gets a full-width row. */}
 <div className="flex items-center gap-2 shrink-0 flex-wrap max-lg:order-last max-lg:w-full max-lg:shrink max-lg:min-w-0 coarse:max-xl:order-last coarse:max-xl:w-full coarse:max-xl:shrink coarse:max-xl:min-w-0">
 {device.approvalStatus === 'pending' ? (
 /* ── Pending device: only show approve / refuse ── */
 canManageApproval && (
 <>
 <button
 onClick={handleApproveDevice}
 disabled={isApprovingDevice}
 className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-green-500 hover:bg-green-400 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors coarse:min-h-10"
 >
 {isApprovingDevice ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
 Approve
 </button>
 <button
 onClick={handleRefuseDevice}
 disabled={isRefusingDevice}
 className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-500 hover:bg-red-400 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors coarse:min-h-10"
 >
 {isRefusingDevice ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
 Refuse
 </button>
 </>
 )
 ) : (
 /* ── Approved/suspended device: show all actions ── */
 <div className="flex flex-col items-end gap-2 max-lg:items-start max-lg:min-w-0 max-lg:flex-1 coarse:max-xl:items-start coarse:max-xl:min-w-0 coarse:max-xl:flex-1">
 {/* ── Cross-app links (Obliview, Obliguard, Oblimap…) — in the "⋯" sheet below md ── */}
 {crossAppLinks.length > 0 && (
 <div className="flex items-center gap-1.5 flex-wrap max-md:hidden">
 {crossAppLinks.map(link => (
 <a
 key={link.appType}
 href={link.url}
 target="_blank"
 rel="noopener noreferrer"
 onClick={(e) => { e.preventDefault(); void openExternal(link.url); }}
 title={`Open in ${link.name}`}
 className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium border transition-colors coarse:min-h-9"
 style={{ color: link.color ?? '#58a6ff', borderColor: `${link.color ?? '#58a6ff'}40`, backgroundColor: `${link.color ?? '#58a6ff'}0d` }}
 >
 <ArrowLeftRight size={12} />
 {link.name}
 </a>
 ))}
 </div>
 )}
 {/* ── Action bar ── (wraps on tablet; secondary actions move to "⋯" below md) */}
 <div className="flex items-center gap-2 flex-wrap">
 {/* ── Scan All ── */}
 <DisabledTip reason={scanAllDisabled && !isScanningAll && scanAllReason} className="max-md:hidden">
 <button
 onClick={handleScanAll}
 disabled={scanAllDisabled}
 title={scanAllSupported ? 'Scan All — triggers inventory, updates and compliance scans' : unsupportedTooltip(t)}
 className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-transparent bg-bg-secondary text-text-muted hover:text-accent hover:border-accent/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors max-md:hidden"
 >
 {isScanningAll ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ScanLine className="w-3.5 h-3.5" />}
 Scan All
 </button>
 </DisabledTip>

 {/* ── Airgap (admin only) ── */}
 {isAdmin() && (
 <button
 onClick={handleAirgapToggle}
 disabled={headerPending.has('airgap')}
 title={device.airgapEnabled ? t('airgap.disable') : t('airgap.enable')}
 className={clsx(
 "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors disabled:opacity-40 disabled:cursor-not-allowed max-md:hidden",
 device.airgapEnabled
 ? "border-blue-400/50 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20"
 : "border-transparent bg-bg-secondary text-text-muted hover:text-blue-400 hover:border-blue-400/50"
 )}
 >
 {headerPending.has('airgap') ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <WifiOff className="w-3.5 h-3.5" />}
 {device.airgapEnabled ? t('airgap.disable') : t('airgap.enable')}
 </button>
 )}

 {/* ── Quick actions ── */}
 <div className="flex items-center gap-1 rounded-lg bg-bg-secondary px-1 py-1 flex-wrap">
 {/* Chat — always next to Remote */}
 <DisabledTip reason={
 (!isAgentReachable(device.status) || headerOrInstalled === false || device.privacyModeEnabled) && (
 headerOrInstalled === false
 ? t('deviceDetail.reason.chatNoReach', 'ObliReach is not deployed on this device — chat is unavailable')
 : device.privacyModeEnabled
 ? t('deviceDetail.reason.chatPrivacy', 'Chat is unavailable while privacy mode is active (ObliReach service is stopped)')
 : t('deviceDetail.reason.agentOnline', 'Agent must be online'))
 }>
 <button
 onClick={async () => {
 // If a chat for THIS device is already open, toggle visibility
 const cs = useChatStore.getState();
 const thisDeviceOpen = cs.sessions.some(s => s.deviceUuid === device.uuid);
 if (thisDeviceOpen && cs.isOpen) {
 // Switch to its tab (in case another tab is active)
 const tab = cs.sessions.find(s => s.deviceUuid === device.uuid);
 if (tab && tab.key !== cs.activeKey) { cs.setActiveTab(tab.key); return; }
 cs.toggleOpen();
 return;
 }
 if (thisDeviceOpen && !cs.isOpen) {
 const tab = cs.sessions.find(s => s.deviceUuid === device.uuid);
 if (tab) cs.setActiveTab(tab.key);
 cs.toggleOpen();
 return;
 }
 // If Reach is active, use the same session
 if (headerRemoteOpen && headerRemoteSession) {
 useChatStore.getState().openChat(device.uuid, device.displayName || device.hostname);
 return;
 }
 // Fetch fresh sessions for THIS device before opening chat
 try {
 const sessions = await remoteApi.getObliReachSessions(device?.uuid ?? '');
 if (sessions.length > 1) {
 setHeaderOrSessions(sessions);
 setChatSessionPickerOpen(true);
 return;
 }
 if (sessions.length === 1) {
 useChatStore.getState().openChat(device.uuid, device.displayName || device.hostname, sessions[0].id);
 return;
 }
 } catch {
 // Fall through — open chat without session selection
 }
 useChatStore.getState().openChat(device.uuid, device.displayName || device.hostname);
 }}
 disabled={!isAgentReachable(device.status) || headerOrInstalled === false || device.privacyModeEnabled}
 title={
 headerOrInstalled === false
 ? t('deviceDetail.reason.chatNoReach', 'ObliReach is not deployed on this device — chat is unavailable')
 : device.privacyModeEnabled
 ? t('deviceDetail.reason.chatPrivacy', 'Chat is unavailable while privacy mode is active (ObliReach service is stopped)')
 : 'Chat with user'
 }
 className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md text-blue-400 hover:bg-blue-400/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors coarse:min-h-10"
 >
 <MessageCircle className="w-3.5 h-3.5" />
 Chat
 {headerOrInstalled === false && <Lock className="w-3 h-3 text-orange-400" />}
 </button>
 </DisabledTip>
 {/* Remote */}
 {(() => {
 const opts: Array<'oblireach' | 'ssh' | 'cmd' | 'powershell'> =
 device.osType === 'windows' ? ['oblireach', 'cmd', 'powershell'] :
 device.osType === 'macos' ? ['oblireach', 'ssh'] :
 ['oblireach', 'ssh'];
 const label = (p: string) => p === 'powershell' ? 'PS' : p === 'oblireach' ? 'Reach' : p.toUpperCase();
 // Privacy gate state for the 'remote' feature
 const remoteHardBlocked = device.privacyModeEnabled && !device.privacyPasswordSet;
 const remoteDisabledReason = remoteHardBlocked
 ? t('deviceDetail.reason.privacyBlocked', 'Blocked by privacy mode (no privacy password set on this device)')
 : !isAgentReachable(device.status) ? t('deviceDetail.reason.agentOnline', 'Agent must be online') : null;
 const remoteUnlocked = isFeatureUnlocked('remote');
 const remoteSoftGated = device.privacyModeEnabled && device.privacyPasswordSet && !remoteUnlocked;
 const guardedClick = (action: () => void) => {
 if (remoteSoftGated) {
 setUnlockModalFeature({ feature: 'remote', afterUnlock: action });
 } else {
 action();
 }
 };
 return (
 <div className="relative" ref={remoteDropdownRef}>
 {opts.length === 1 ? (
 <DisabledTip reason={remoteDisabledReason}>
 <button
 onClick={() => guardedClick(() => handleHeaderRemote(opts[0]))}
 disabled={isStartingRemote || headerRemoteOpen || !isAgentReachable(device.status) || remoteHardBlocked}
 title={`${label(opts[0])} Remote`}
 className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md text-green-400 hover:bg-green-400/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors coarse:min-h-10"
 >
 {isStartingRemote ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MonitorPlay className="w-3.5 h-3.5" />}
 {label(opts[0])}
 {remoteSoftGated && <Lock className="w-3 h-3 text-orange-400" />}
 {remoteUnlocked && device.privacyModeEnabled && <Unlock className="w-3 h-3 text-green-400" />}
 </button>
 </DisabledTip>
 ) : (
 <DisabledTip reason={remoteDisabledReason}>
 <button
 onClick={() => guardedClick(() => setRemoteDropdownOpen((o) => !o))}
 disabled={isStartingRemote || headerRemoteOpen || !isAgentReachable(device.status) || remoteHardBlocked}
 title="Remote Control"
 className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md text-green-400 hover:bg-green-400/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors coarse:min-h-10"
 >
 {isStartingRemote ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MonitorPlay className="w-3.5 h-3.5" />}
 Remote
 <ChevronDown className="w-3 h-3" />
 {remoteSoftGated && <Lock className="w-3 h-3 text-orange-400" />}
 {remoteUnlocked && device.privacyModeEnabled && <Unlock className="w-3 h-3 text-green-400" />}
 </button>
 </DisabledTip>
 )}
 {remoteDropdownOpen && (
 <div className="absolute right-0 top-full mt-1 z-50 bg-bg-secondary rounded-lg shadow-lg overflow-hidden min-w-[130px] max-md:left-0 max-md:right-auto max-md:min-w-[160px]">
 {opts.map((proto) => {
 const isOr = proto === 'oblireach';
 const orNotInstalled = isOr && headerOrInstalled === false;
 return (
 <button
 key={proto}
 onClick={() => handleHeaderRemote(proto)}
 className="w-full flex items-center gap-2 px-3 py-2 text-xs text-text-primary hover:bg-bg-tertiary transition-colors text-left coarse:min-h-11 coarse:text-sm"
 >
 <MonitorPlay className={`w-3.5 h-3.5 ${orNotInstalled ? 'text-orange-400' : 'text-green-400'}`} />
 <span>{proto === 'powershell' ? 'PowerShell' : proto === 'oblireach' ? 'Oblireach' : proto.toUpperCase()}</span>
 {orNotInstalled && (
 <span className="ml-auto text-[10px] text-orange-400 font-medium">Install</span>
 )}
 </button>
 );
 })}
 </div>
 )}
 </div>
 );
 })()}
 {device.privacyModeEnabled && isAdmin() && (
 <>
 <div className="w-px h-5 bg-border max-md:hidden" />
 <button
 onClick={handleDisablePrivacy}
 disabled={headerPending.has('privacy')}
 title={t('privacy.disableTitle')}
 className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md text-orange-400 hover:bg-orange-400/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors max-md:hidden"
 >
 {headerPending.has('privacy') ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldOff className="w-3.5 h-3.5" />}
 {t('privacy.disable')}
 {device.privacyPasswordSet && <Lock className="w-3 h-3" />}
 </button>
 </>
 )}
 <div className="w-px h-5 bg-border max-md:hidden" />
 {showUpdateAgent && (
 <DisabledTip reason={unsup('update_agent')} className="max-md:hidden">
 <button
 onClick={handleUpdateAgent}
 disabled={headerPending.has('update_agent') || !isCommandSupported(device, 'update_agent')}
 title={!isCommandSupported(device, 'update_agent') ? unsupportedTooltip(t) : (t('devices.action.updateAgent') || 'Update agent')}
 className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md text-blue-400 hover:bg-blue-400/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors max-md:hidden"
 >
 {headerPending.has('update_agent') ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
 {t('devices.action.updateAgent') || 'Update agent'}
 </button>
 </DisabledTip>
 )}
 <DisabledTip reason={unsup('restart_agent')} className="max-md:hidden">
 <button
 onClick={() => handleHeaderAction('restart_agent')}
 disabled={headerPending.has('restart_agent') || !isCommandSupported(device, 'restart_agent')}
 title={isCommandSupported(device, 'restart_agent') ? 'Restart Agent' : unsupportedTooltip(t)}
 className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md text-blue-400 hover:bg-blue-400/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors max-md:hidden"
 >
 {headerPending.has('restart_agent') ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
 Agent
 </button>
 </DisabledTip>
 <DisabledTip reason={unsup('sleep')} className="max-md:hidden">
 <button
 onClick={() => handleHeaderAction('sleep')}
 disabled={headerPending.has('sleep') || !isCommandSupported(device, 'sleep')}
 title={isCommandSupported(device, 'sleep') ? 'Suspend device (sleep)' : unsupportedTooltip(t)}
 className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md text-blue-400 hover:bg-blue-400/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors max-md:hidden"
 >
 {headerPending.has('sleep') ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Moon className="w-3.5 h-3.5" />}
 Sleep
 </button>
 </DisabledTip>
 <DisabledTip reason={unsup('reboot')} className="max-md:hidden">
 <button
 onClick={() => handleHeaderAction('reboot')}
 disabled={headerPending.has('reboot') || !isCommandSupported(device, 'reboot')}
 title={isCommandSupported(device, 'reboot') ? 'Reboot device' : unsupportedTooltip(t)}
 className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md text-orange-400 hover:bg-orange-400/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors max-md:hidden"
 >
 {headerPending.has('reboot') ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
 Reboot
 </button>
 </DisabledTip>
 <DisabledTip reason={unsup('shutdown')} className="max-md:hidden">
 <button
 onClick={() => handleHeaderAction('shutdown')}
 disabled={headerPending.has('shutdown') || !isCommandSupported(device, 'shutdown')}
 title={isCommandSupported(device, 'shutdown') ? 'Shutdown device' : unsupportedTooltip(t)}
 className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md text-red-400 hover:bg-red-400/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors max-md:hidden"
 >
 {headerPending.has('shutdown') ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Power className="w-3.5 h-3.5" />}
 Off
 </button>
 </DisabledTip>
 {/* Phone: every secondary action in one bottom sheet */}
 <ActionMenu
 items={phoneHeaderItems}
 label={t('deviceDetail.header.moreActions', 'More device actions')}
 sheetTitle={deviceTitle}
 triggerClassName="md:hidden"
 />
 </div>
 </div>
 </div>
 )}

 <IconButton
 size="lg"
 variant="plain"
 className="rounded-lg hover:bg-bg-secondary"
 label={t('deviceDetail.header.refresh', 'Refresh device + force agent metrics push')}
 icon={<RefreshCw className="w-4 h-4" />}
 onClick={async () => {
 // Two-part refresh: re-fetch the device row from the
 // server (hostname/group/tags/etc. that change rarely)
 // AND ask the agent to push fresh metrics immediately.
 // Without the second step, the row already shows the
 // last-pushed metrics — clicking would change nothing
 // visible until the next push tick (potentially 60s).
 await Promise.all([
 fetchDevice(deviceId),
 deviceApi.requestLiveMetrics(deviceId, 'push_now').catch(() => null),
 ]);
 }}
 />
 </div>
 </div>

 {/* ── Pending uninstall banner ── */}
 {device.status === 'pending_uninstall' && (
 <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-xl border border-orange-500/40 bg-orange-500/10 max-sm:flex-wrap max-sm:gap-2">
 <div className="flex items-center gap-3">
 <Power className="w-4 h-4 text-orange-400 shrink-0 animate-pulse" />
 <div>
 <p className="text-sm font-medium text-orange-300">Uninstall in progress</p>
 <p className="text-xs text-orange-400/80">
 Agent uninstall command sent.
 {uninstallCountdown
 ? ` If unconfirmed, device will reappear in ${uninstallCountdown}.`
 : ' Device will reappear if the agent does not confirm.'}
 </p>
 </div>
 </div>
 {isAdmin() && (
 <button
 onClick={async () => {
 try {
 await deviceApi.cancelUninstall(device.id);
 toast.success('Uninstall cancelled — device restored');
 fetchDevice(deviceId);
 } catch {
 toast.error('Failed to cancel uninstall');
 }
 }}
 className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-orange-500/50 text-orange-400 hover:bg-orange-500/20 transition-colors coarse:min-h-10"
 >
 Cancel uninstall
 </button>
 )}
 </div>
 )}

 {/* Tabs — scroll horizontally when they don't fit (active tab kept in view) */}
 <div ref={tabsBarRef} className="flex items-center gap-1 rounded-lg bg-bg-secondary p-1 border border-transparent overflow-x-auto overscroll-x-contain max-md:scrollbar-none">
 {(() => {
 // Inject custom section tabs between Remote and Explorer.
 const customTabs = customSections.map((cs) => ({
 id: `cs:${cs.id}` as Tab,
 label: cs.name,
 icon: TerminalSquare,
 _custom: cs,
 }));
 const tabList = [...TABS];
 const remoteIdx = tabList.findIndex((t) => t.id === 'remote');
 if (remoteIdx >= 0) {
 tabList.splice(remoteIdx + 1, 0, ...customTabs as any);
 }
 // Hyper-V tab only when the agent flagged this host as a virtualization
 // host. Inserted just before Settings.
 if (device.virtualizationHostType) {
 const settingsIdx = tabList.findIndex((t) => t.id === 'settings');
 const hvTab = { id: 'hyperv' as Tab, label: 'Hyper-V', icon: Server };
 if (settingsIdx >= 0) tabList.splice(settingsIdx, 0, hvTab as any);
 else tabList.push(hvTab as any);
 }
 // Veeam Backups tab only when the agent flagged this host as a backup
 // server. Inserted just before Settings.
 if (device.backupHostType) {
 const settingsIdx = tabList.findIndex((t) => t.id === 'settings');
 const veeamTab = { id: 'veeam' as Tab, label: 'Backups', icon: Database };
 if (settingsIdx >= 0) tabList.splice(settingsIdx, 0, veeamTab as any);
 else tabList.push(veeamTab as any);
 }
 return tabList;
 })().map((tab) => {
 const Icon = tab.icon;
 const isCustomSection = typeof tab.id === 'string' && tab.id.startsWith('cs:');
 // Custom sections are classified under the 'remote' privacy feature
 // since they open a live shell-like view — semantically remote.
 const privacyGatedTab = isCustomSection || ['scripts', 'remote', 'processes', 'files'].includes(tab.id as string);
 const inPrivacyMode = device.privacyModeEnabled && privacyGatedTab;
 const hasPasswordGate = device.privacyPasswordSet;
 const featureKey = isCustomSection ? 'remote'
 : tab.id === 'scripts' ? 'scripts'
 : tab.id === 'remote' ? 'remote'
 : tab.id === 'files' ? 'files'
 : tab.id === 'processes' ? 'processes'
 : '';
 const unlocked = featureKey && isFeatureUnlocked(featureKey);
 const softGated = inPrivacyMode && hasPasswordGate && !unlocked;
 const hardBlocked = inPrivacyMode && !hasPasswordGate;
 const handleClick = () => {
 if (hardBlocked) return;
 if (softGated) {
 setUnlockModalFeature({ feature: featureKey as any, navigateTo: tab.id as Tab });
 return;
 }
 setActiveTab(tab.id as Tab);
 };
 return (
 <DisabledTip key={tab.id} reason={hardBlocked && t('deviceDetail.reason.tabPrivacyBlocked', 'Blocked by privacy mode — no privacy password is set on this device')} className="shrink-0">
 <button
 onClick={handleClick}
 disabled={hardBlocked}
 data-active-tab={activeTab === tab.id ? 'true' : undefined}
 title={hardBlocked ? t('privacy.badge') : softGated ? 'Click to unlock with password' : undefined}
 className={clsx(
 'flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md whitespace-nowrap transition-colors shrink-0 max-sm:px-3',
 hardBlocked
 ? 'text-text-muted/40 cursor-not-allowed'
 : activeTab === tab.id
 ? 'bg-accent text-white'
 : 'text-text-muted hover:text-text-primary',
 )}
 >
 <Icon className="w-4 h-4" />
 {tab.label}
 {softGated && <Lock className="w-3 h-3 text-orange-400" />}
 {unlocked && inPrivacyMode && (
 <span className="inline-flex items-center gap-1 text-[10px] font-mono text-green-400 bg-green-400/10 border border-green-400/30 px-1.5 py-0.5 rounded-full">
 <Unlock className="w-2.5 h-2.5" />
 {unlockCountdown(featureKey as string)}
 </span>
 )}
 </button>
 </DisabledTip>
 );
 })}
 </div>

 {/* Tab content */}
 <div>
 {activeTab === 'overview' && <OverviewTab device={device} onSaved={() => fetchDevice(deviceId)} />}
 {activeTab === 'rewind' && <RewindTab deviceId={device.id} />}
 {activeTab === 'inventory' && <InventoryTab deviceId={device.id} agentFlavor={device.agentFlavor} />}
 {activeTab === 'scripts' && <ScriptsTab deviceId={device.id} />}
 {activeTab === 'updates' && <UpdatesTab deviceId={device.id} agentFlavor={device.agentFlavor} />}
 {activeTab === 'compliance' && (
 <div className="space-y-4">
 {/* CVE section — auto-hides when the device has zero matches AND
 quietly 403s for users without `cve:read`. No need to gate it
 from here; the component handles both states itself. */}
 <DeviceCvesSection deviceId={device.id} />
 <ComplianceTab deviceId={device.id} />
 </div>
 )}
 {activeTab === 'remote' && <RemoteTab device={device} />}
 {activeTab === 'files' && <FileExplorerTab device={device} />}
 {activeTab === 'services' && <ServicesTab device={device} />}
 {activeTab === 'processes' && <ProcessesTab device={device} />}
 {activeTab === 'commands' && <CommandsTab deviceId={device.id} />}
 {activeTab === 'hyperv' && <HyperVTab deviceId={device.id} />}
 {activeTab === 'veeam' && <VeeamTab deviceId={device.id} />}
 {activeTab === 'settings' && <DeviceSettingsTab device={device} onSaved={() => fetchDevice(deviceId)} adminMode={isAdmin()} onDeleted={() => navigate('/devices')} onManagePrivacyPassword={(mode) => setManagePasswordMode(mode)} />}
 {typeof activeTab === 'string' && activeTab.startsWith('cs:') && (() => {
 const id = parseInt(activeTab.slice(3));
 const section = customSections.find((s) => s.id === id);
 if (!section) return null;
 return <CustomSectionTab key={`cs-${section.id}`} deviceId={device.id} section={section} />;
 })()}
 </div>

 {/* Privacy unlock modal */}
 {unlockModalFeature && (
 <PrivacyUnlockModal
 deviceId={device.id}
 feature={unlockModalFeature.feature}
 onClose={() => setUnlockModalFeature(null)}
 onUnlocked={(ttlSeconds) => {
 setPrivacyUnlocks((prev) => ({ ...prev, [unlockModalFeature.feature]: Date.now() + ttlSeconds * 1000 }));
 if (unlockModalFeature.navigateTo) setActiveTab(unlockModalFeature.navigateTo);
 const after = unlockModalFeature.afterUnlock;
 setUnlockModalFeature(null);
 if (after) setTimeout(after, 50);
 }}
 />
 )}

 {/* Privacy password manage modal */}
 {managePasswordMode && (
 <PrivacyPasswordManageModal
 deviceId={device.id}
 mode={managePasswordMode}
 onClose={() => setManagePasswordMode(null)}
 onSuccess={() => { fetchDevice(deviceId); }}
 />
 )}

 {/* Disable privacy with password — reuses the unlock modal in 'disable' mode */}
 {disablePrivacyPrompt && (
 <PrivacyUnlockModal
 deviceId={device.id}
 feature={'scripts' as any}
 mode="disable"
 onClose={() => setDisablePrivacyPrompt(false)}
 onUnlocked={() => {
 setDisablePrivacyPrompt(false);
 setTimeout(() => fetchDevice(deviceId), 1500);
 }}
 />
 )}
 </PageContainer>
 );
}
