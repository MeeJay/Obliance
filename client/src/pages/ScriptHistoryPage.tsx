import { useEffect, useState, useCallback } from 'react';
import { ChevronDown, ChevronRight, RefreshCw, CheckCircle, XCircle, Clock, Loader2, AlertTriangle, User, CalendarClock, Terminal, Monitor, Maximize2, X, StopCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { scriptApi } from '@/api/script.api';
import type { ExecutionBatch } from '@obliance/shared';
import { clsx } from 'clsx';

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

  return (
    <div className={embedded ? 'space-y-4' : 'p-6 space-y-4'}>
      {!embedded && (
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Execution History</h1>
            <p className="text-sm text-text-muted mt-0.5">All script executions across devices</p>
          </div>
          <button onClick={load} className="p-2 text-text-muted hover:text-text-primary hover:bg-bg-secondary rounded-lg transition-colors">
            <RefreshCw className={clsx('w-4 h-4', isLoading && 'animate-spin')} />
          </button>
        </div>
      )}

      {embedded && (
        <div className="flex justify-end">
          <button onClick={load} className="p-2 text-text-muted hover:text-text-primary hover:bg-bg-secondary rounded-lg transition-colors">
            <RefreshCw className={clsx('w-4 h-4', isLoading && 'animate-spin')} />
          </button>
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
              <div key={batch.batchId} className="bg-bg-secondary border border-border rounded-xl overflow-hidden">
                {/* Batch header */}
                <button
                  onClick={() => toggleBatch(batch.batchId)}
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
                  <div className="w-24 h-1.5 bg-bg-tertiary rounded-full overflow-hidden shrink-0">
                    <div className="h-full flex">
                      {batch.successCount > 0 && <div className="bg-green-400" style={{ width: `${(batch.successCount / batch.totalCount) * 100}%` }} />}
                      {batch.failureCount > 0 && <div className="bg-red-400" style={{ width: `${(batch.failureCount / batch.totalCount) * 100}%` }} />}
                      {batch.runningCount > 0 && <div className="bg-blue-400" style={{ width: `${(batch.runningCount / batch.totalCount) * 100}%` }} />}
                    </div>
                  </div>
                </button>

                {/* Expanded: device list */}
                {isExpanded && (
                  <div className="border-t border-border">
                    {isLoadingDevices ? (
                      <div className="flex items-center justify-center py-6">
                        <Loader2 className="w-5 h-5 animate-spin text-text-muted" />
                      </div>
                    ) : (
                      <div className="flex">
                        {/* Left: device list */}
                        <div className={clsx('divide-y divide-border overflow-y-auto max-h-80', selectedDevice ? 'w-1/2 border-r border-border' : 'w-full')}>
                          {devices.map((dev) => (
                            <button
                              key={dev.id}
                              onClick={() => setSelectedDevice(selectedDevice?.id === dev.id ? null : dev)}
                              className={clsx(
                                'w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-bg-hover transition-colors',
                                selectedDevice?.id === dev.id && 'bg-accent/5',
                              )}
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
                              {(dev.status === 'running' || dev.status === 'sent') && (
                                <span
                                  onClick={(e) => { e.stopPropagation(); scriptApi.stopExecution(dev.id).then(() => { toast.success('Stopped'); toggleBatch(batch.batchId); toggleBatch(batch.batchId); }).catch(() => toast.error('Failed to stop')); }}
                                  className="p-1 text-red-400 hover:text-red-300 hover:bg-red-400/10 rounded transition-colors cursor-pointer shrink-0" title="Stop"
                                >
                                  <StopCircle className="w-3.5 h-3.5" />
                                </span>
                              )}
                            </button>
                          ))}
                          {devices.length === 0 && (
                            <p className="text-sm text-text-muted text-center py-4">No devices in this batch</p>
                          )}
                        </div>

                        {/* Right: stdout/stderr panel */}
                        {selectedDevice && (
                          <div className="w-1/2 flex flex-col max-h-80">
                            <div className="px-3 py-2 border-b border-border bg-bg-tertiary/50 flex items-center gap-2">
                              <StatusIcon status={selectedDevice.status} />
                              <span className="text-sm font-medium text-text-primary">{selectedDevice.hostname}</span>
                            </div>
                            <div className="flex-1 overflow-y-auto p-3 space-y-3">
                              {selectedDevice.stdout && (
                                <div>
                                  <div className="flex items-center justify-between mb-1">
                                    <p className="text-[10px] text-text-muted uppercase font-medium">stdout</p>
                                    <button onClick={() => setFullscreenOutput({ title: `${selectedDevice.hostname} — stdout`, content: selectedDevice.stdout!, type: 'stdout' })} className="p-0.5 text-text-muted hover:text-text-primary transition-colors" title="Fullscreen">
                                      <Maximize2 className="w-3 h-3" />
                                    </button>
                                  </div>
                                  <pre className="text-xs text-green-300 bg-black/30 rounded p-2 overflow-x-auto whitespace-pre-wrap font-mono max-h-40 overflow-y-auto">{selectedDevice.stdout}</pre>
                                </div>
                              )}
                              {selectedDevice.stderr && (
                                <div>
                                  <div className="flex items-center justify-between mb-1">
                                    <p className="text-[10px] text-text-muted uppercase font-medium">stderr</p>
                                    <button onClick={() => setFullscreenOutput({ title: `${selectedDevice.hostname} — stderr`, content: selectedDevice.stderr!, type: 'stderr' })} className="p-0.5 text-text-muted hover:text-text-primary transition-colors" title="Fullscreen">
                                      <Maximize2 className="w-3 h-3" />
                                    </button>
                                  </div>
                                  <pre className="text-xs text-red-300 bg-black/30 rounded p-2 overflow-x-auto whitespace-pre-wrap font-mono max-h-40 overflow-y-auto">{selectedDevice.stderr}</pre>
                                </div>
                              )}
                              {!selectedDevice.stdout && !selectedDevice.stderr && (
                                <p className="text-sm text-text-muted text-center py-6">
                                  {selectedDevice.status === 'pending' || selectedDevice.status === 'sent' || selectedDevice.status === 'running'
                                    ? 'Execution in progress...'
                                    : 'No output'}
                                </p>
                              )}
                            </div>
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
      {fullscreenOutput && (
        <>
          <div className="fixed inset-0 bg-black/60 z-50" onClick={() => setFullscreenOutput(null)} />
          <div className="fixed inset-4 z-50 bg-bg-primary border border-border rounded-xl flex flex-col overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
              <h3 className="text-sm font-semibold text-text-primary">{fullscreenOutput.title}</h3>
              <button onClick={() => setFullscreenOutput(null)} className="p-1 text-text-muted hover:text-text-primary rounded transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <pre className={clsx(
              'flex-1 p-4 text-sm font-mono overflow-auto whitespace-pre-wrap',
              fullscreenOutput.type === 'stdout' ? 'text-green-300' : 'text-red-300',
            )}>
              {fullscreenOutput.content}
            </pre>
          </div>
        </>
      )}
    </div>
  );
}
