import { Fragment, useEffect, useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, RefreshCw, CheckCircle, XCircle, Clock, Loader2, AlertTriangle, User, CalendarClock, Terminal, Monitor, Maximize2, StopCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { scriptApi } from '@/api/script.api';
import { getSocket } from '@/socket/socketClient';
import type { ExecutionBatch } from '@obliance/shared';
import { clsx } from 'clsx';
import { PageContainer } from '@/components/common/PageContainer';
import { IconButton } from '@/components/common/IconButton';
import { Modal } from '@/components/common/Modal';
import { MEDIA, useMediaQuery } from '@/hooks/useMediaQuery';

interface BatchDevice {
 id: string;
 deviceId: number;
 hostname: string;
 osType: string;
 status: string;
 exitCode: number | null;
 stdout: string | null;
 stderr: string | null;
 triggeredAt: string;
 startedAt: string | null;
 finishedAt: string | null;
}

function StatusIcon({ status }: { status: string }) {
 switch (status) {
 case 'success': return <CheckCircle className="w-4 h-4 text-green-400" />;
 case 'failure': case 'timeout': return <XCircle className="w-4 h-4 text-red-400" />;
 case 'running': case 'sent': return <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />;
 case 'cancelled': case 'skipped': return <AlertTriangle className="w-4 h-4 text-yellow-400" />;
 default: return <Clock className="w-4 h-4 text-text-muted" />;
 }
}

function BatchStatusSummary({ batch }: { batch: ExecutionBatch }) {
 const parts: React.ReactNode[] = [];
 if (batch.successCount > 0) parts.push(<span key="s" className="text-green-400">{batch.successCount} ok</span>);
 if (batch.failureCount > 0) parts.push(<span key="f" className="text-red-400">{batch.failureCount} failed</span>);
 if (batch.runningCount > 0) parts.push(<span key="r" className="text-blue-400">{batch.runningCount} running</span>);
 if (batch.pendingCount > 0) parts.push(<span key="p" className="text-text-muted">{batch.pendingCount} pending</span>);
 return <span className="flex items-center gap-2 text-xs">{parts.reduce<React.ReactNode[]>((a, p, i) => i > 0 ? [...a, <span key={`sep${i}`} className="text-text-muted">/</span>, p] : [p], [])}</span>;
}

function TriggerBadge({ batch }: { batch: ExecutionBatch }) {
 const isSchedule = batch.triggeredBy === 'schedule' || batch.triggeredBy === 'catchup';
 return (
 <span className={clsx(
 'inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border font-medium',
 isSchedule ? 'text-blue-400 bg-blue-400/10 border-blue-400/30' : 'text-rose-400 bg-rose-400/10 border-rose-400/30',
 )}>
 {isSchedule ? <CalendarClock className="w-3 h-3" /> : <User className="w-3 h-3" />}
 {isSchedule ? (batch.scheduleName ?? 'Schedule') : (batch.triggeredByUsername ?? 'Manual')}
 </span>
 );
}

export function ScriptHistoryPage({ embedded }: { embedded?: boolean } = {}) {
 const { t } = useTranslation();
 // md+: device list | output side by side (historic layout). Below md the
 // output opens under the tapped device row (accordion): two 50 % columns
 // are unreadable on a phone.
 const isMd = useMediaQuery(MEDIA.md);
 const [batches, setBatches] = useState<ExecutionBatch[]>([]);
 const [isLoading, setIsLoading] = useState(true);
 const [expandedBatch, setExpandedBatch] = useState<string | null>(null);
 const [batchDevices, setBatchDevices] = useState<Map<string, BatchDevice[]>>(new Map());
 const [loadingBatch, setLoadingBatch] = useState<string | null>(null);
 const [selectedDevice, setSelectedDevice] = useState<BatchDevice | null>(null);
 const [fullscreenOutput, setFullscreenOutput] = useState<{ title: string; content: string; type: 'stdout' | 'stderr' } | null>(null);

 const load = useCallback(async () => {
 setIsLoading(true);
 try {
 const result = await scriptApi.listBatches({ pageSize: 100 });
 setBatches(result.items);
 } catch {
 // silent
 } finally {
 setIsLoading(false);
 }
 }, []);

 useEffect(() => { load(); }, [load]);

 // Live refresh: whenever any execution in this tenant updates status,
 // reload the batch list. Debounced to avoid hammering the API on a burst
 // of updates (e.g. a schedule hitting 50 devices at once).
 const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
 useEffect(() => {
 const socket = getSocket();
 if (!socket) return;
 const triggerReload = () => {
 if (reloadTimer.current) clearTimeout(reloadTimer.current);
 reloadTimer.current = setTimeout(() => {
 load();
 // Refresh any expanded batch that's currently open so the detail
 // view stays in sync with the list.
 if (expandedBatch) {
 scriptApi.getBatchDetail(expandedBatch).then((devices) => {
 setBatchDevices((prev) => new Map(prev).set(expandedBatch, devices as any));
 }).catch(() => {});
 }
 }, 500);
 };
 socket.on('EXECUTION_UPDATED', triggerReload);
 return () => {
 socket.off('EXECUTION_UPDATED', triggerReload);
 if (reloadTimer.current) clearTimeout(reloadTimer.current);
 };
 }, [load, expandedBatch]);

 const toggleBatch = async (batchId: string) => {
 if (expandedBatch === batchId) {
 setExpandedBatch(null);
 setSelectedDevice(null);
 return;
 }
 setExpandedBatch(batchId);
 setSelectedDevice(null);

 // Load batch devices if not cached
 if (!batchDevices.has(batchId)) {
 setLoadingBatch(batchId);
 try {
 const devices = await scriptApi.getBatchDetail(batchId);
 setBatchDevices((prev) => new Map(prev).set(batchId, devices));
 } catch {
 // silent
 } finally {
 setLoadingBatch(null);
 }
 }
 };

 const stopExecution = (dev: BatchDevice, batchId: string) => {
 scriptApi.stopExecution(dev.id).then(() => {
 toast.success(t('scripts.history.stopped', 'Stopped'));
 toggleBatch(batchId);
 toggleBatch(batchId);
 }).catch(() => toast.error(t('scripts.history.stopFailed', 'Failed to stop')));
 };

 const refreshButton = (
 <IconButton
 label={t('common.refresh', 'Refresh')}
 onClick={load}
 size="lg"
 icon={<RefreshCw className={clsx('w-4 h-4', isLoading && 'animate-spin')} />}
 className="rounded-lg hover:bg-bg-secondary"
 />
 );

 // stdout / stderr of one device: right pane on md+, inline under the row below md.
 const renderOutput = (dev: BatchDevice) => (
 <div className="flex-1 overflow-y-auto p-3 space-y-3">
 {dev.stdout && (
 <div>
 <div className="flex items-center justify-between mb-1">
 <p className="text-[10px] text-text-muted uppercase font-medium">stdout</p>
 <IconButton
 label={t('scripts.history.fullscreen', 'Full screen')}
 onClick={() => setFullscreenOutput({ title: `${dev.hostname} — stdout`, content: dev.stdout!, type: 'stdout' })}
 size="xs"
 variant="plain"
 icon={<Maximize2 className="w-3 h-3" />}
 />
 </div>
 <pre className="text-xs text-green-300 bg-black/30 rounded p-2 overflow-x-auto whitespace-pre-wrap font-mono max-h-40 overflow-y-auto">{dev.stdout}</pre>
 </div>
 )}
 {dev.stderr && (
 <div>
 <div className="flex items-center justify-between mb-1">
 <p className="text-[10px] text-text-muted uppercase font-medium">stderr</p>
 <IconButton
 label={t('scripts.history.fullscreen', 'Full screen')}
 onClick={() => setFullscreenOutput({ title: `${dev.hostname} — stderr`, content: dev.stderr!, type: 'stderr' })}
 size="xs"
 variant="plain"
 icon={<Maximize2 className="w-3 h-3" />}
 />
 </div>
 <pre className="text-xs text-red-300 bg-black/30 rounded p-2 overflow-x-auto whitespace-pre-wrap font-mono max-h-40 overflow-y-auto">{dev.stderr}</pre>
 </div>
 )}
 {!dev.stdout && !dev.stderr && (
 <p className="text-sm text-text-muted text-center py-6">
 {dev.status === 'pending' || dev.status === 'sent' || dev.status === 'running'
 ? 'Execution in progress...'
 : 'No output'}
 </p>
 )}
 </div>
 );

 return (
 <PageContainer embedded={embedded} className="space-y-4">
 {!embedded && (
 <div className="flex items-center justify-between gap-3">
 <div className="min-w-0">
 <h1 className="text-2xl font-bold text-text-primary">Execution History</h1>
 <p className="text-sm text-text-muted mt-0.5">All script executions across devices</p>
 </div>
 {refreshButton}
 </div>
 )}

 {embedded && (
 <div className="flex justify-end">
 {refreshButton}
 </div>
 )}

 {isLoading && batches.length === 0 ? (
 <div className="flex items-center justify-center py-16">
 <Loader2 className="w-6 h-6 animate-spin text-text-muted" />
 </div>
 ) : batches.length === 0 ? (
 <div className="text-center py-16 text-text-muted">
 <Terminal className="w-10 h-10 mx-auto mb-3 opacity-50" />
 <p className="text-sm">No executions yet</p>
 </div>
 ) : (
 <div className="space-y-2">
 {batches.map((batch) => {
 const isExpanded = expandedBatch === batch.batchId;
 const devices = batchDevices.get(batch.batchId) ?? [];
 const isLoadingDevices = loadingBatch === batch.batchId;

 return (
 <div key={batch.batchId} className="bg-bg-secondary rounded-xl overflow-hidden">
 {/* Batch header */}
 <button
 onClick={() => toggleBatch(batch.batchId)}
 aria-expanded={isExpanded}
 className="w-full flex items-center gap-3 px-4 py-3 hover:bg-bg-hover transition-colors text-left"
 >
 {isExpanded
 ? <ChevronDown className="w-4 h-4 text-text-muted shrink-0" />
 : <ChevronRight className="w-4 h-4 text-text-muted shrink-0" />
 }
 <div className="flex-1 min-w-0">
 <div className="flex items-center gap-2 flex-wrap">
 <span className="text-sm font-medium text-text-primary">{batch.scriptName}</span>
 <TriggerBadge batch={batch} />
 </div>
 <div className="flex items-center gap-3 mt-0.5 flex-wrap">
 <span className="text-xs text-text-muted">{new Date(batch.triggeredAt).toLocaleString()}</span>
 <span className="text-xs text-text-muted">{batch.totalCount} device(s)</span>
 <BatchStatusSummary batch={batch} />
 </div>
 </div>

 {/* Mini progress bar */}
 <div className="w-16 sm:w-24 h-1.5 bg-bg-tertiary rounded-full overflow-hidden shrink-0">
 <div className="h-full flex">
 {batch.successCount > 0 && <div className="bg-green-400" style={{ width: `${(batch.successCount / batch.totalCount) * 100}%` }} />}
 {batch.failureCount > 0 && <div className="bg-red-400" style={{ width: `${(batch.failureCount / batch.totalCount) * 100}%` }} />}
 {batch.runningCount > 0 && <div className="bg-blue-400" style={{ width: `${(batch.runningCount / batch.totalCount) * 100}%` }} />}
 </div>
 </div>
 </button>

 {/* Expanded: device list */}
 {isExpanded && (
 <div className="">
 {isLoadingDevices ? (
 <div className="flex items-center justify-center py-6">
 <Loader2 className="w-5 h-5 animate-spin text-text-muted" />
 </div>
 ) : (
 <div className="flex">
 {/* Left: device list (full width below md, output inline) */}
 <div className={clsx('divide-y divide-border md:overflow-y-auto md:max-h-80', selectedDevice && isMd ? 'w-1/2 ' : 'w-full')}>
 {devices.map((dev) => {
 const isSelected = selectedDevice?.id === dev.id;
 const canStop = dev.status === 'running' || dev.status === 'sent';
 return (
 <Fragment key={dev.id}>
 {/* Row = select button + optional sibling Stop button
 (a button must not contain another control). */}
 <div
 className={clsx(
 'flex items-center hover:bg-bg-hover transition-colors',
 isSelected && 'bg-accent/5',
 )}
 >
 <button
 onClick={() => setSelectedDevice(isSelected ? null : dev)}
 aria-expanded={!isMd ? isSelected : undefined}
 className={clsx('flex-1 min-w-0 flex items-center gap-2 pl-4 py-2 text-left', canStop ? 'pr-2' : 'pr-4')}
 >
 <StatusIcon status={dev.status} />
 <Monitor className="w-3.5 h-3.5 text-text-muted shrink-0" />
 <span className="text-sm text-text-primary truncate flex-1">{dev.hostname}</span>
 {dev.exitCode !== null && (
 <span className={clsx('text-[10px] font-mono px-1.5 py-0.5 rounded', dev.exitCode === 0 ? 'text-green-400 bg-green-400/10' : 'text-red-400 bg-red-400/10')}>
 exit {dev.exitCode}
 </span>
 )}
 {dev.finishedAt && dev.startedAt && (
 <span className="text-[10px] text-text-muted">
 {((new Date(dev.finishedAt).getTime() - new Date(dev.startedAt).getTime()) / 1000).toFixed(1)}s
 </span>
 )}
 </button>
 {canStop && (
 <IconButton
 label={t('scripts.history.stop', 'Stop execution')}
 onClick={() => stopExecution(dev, batch.batchId)}
 size="sm"
 variant="plain"
 icon={<StopCircle className="w-3.5 h-3.5" />}
 className="mr-4 shrink-0 text-red-400 hover:text-red-300 hover:bg-red-400/10"
 />
 )}
 </div>
 {!isMd && isSelected && (
 <div className="flex flex-col bg-bg-tertiary/30">
 {renderOutput(dev)}
 </div>
 )}
 </Fragment>
 );
 })}
 {devices.length === 0 && (
 <p className="text-sm text-text-muted text-center py-4">No devices in this batch</p>
 )}
 </div>

 {/* Right: stdout/stderr panel (md+) */}
 {isMd && selectedDevice && (
 <div className="w-1/2 flex flex-col max-h-80">
 <div className="px-3 py-2 bg-bg-tertiary/50 flex items-center gap-2">
 <StatusIcon status={selectedDevice.status} />
 <span className="text-sm font-medium text-text-primary">{selectedDevice.hostname}</span>
 </div>
 {renderOutput(selectedDevice)}
 </div>
 )}
 </div>
 )}
 </div>
 )}
 </div>
 );
 })}
 </div>
 )}

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
 'min-h-full p-4 text-sm font-mono whitespace-pre-wrap',
 fullscreenOutput.type === 'stdout' ? 'text-green-300' : 'text-red-300',
 )}>
 {fullscreenOutput.content}
 </pre>
 )}
 </Modal>
 </PageContainer>
 );
}
