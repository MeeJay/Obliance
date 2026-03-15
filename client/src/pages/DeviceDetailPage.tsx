import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Monitor, ArrowLeft, ArrowLeftRight, RefreshCw, Cpu, MemoryStick, HardDrive,
  Terminal, Package, ShieldCheck, MonitorPlay, History,
  Scan, WifiOff, Clock
} from 'lucide-react';
import { appConfigApi } from '@/api/appConfig.api';
import { ssoApi } from '@/api/sso.api';
import { inventoryApi } from '@/api/inventory.api';
import { commandApi } from '@/api/command.api';
import { scriptApi } from '@/api/script.api';
import { updateApi } from '@/api/update.api';
import { complianceApi } from '@/api/compliance.api';
import { remoteApi } from '@/api/remote.api';
import { useDeviceStore } from '@/store/deviceStore';
import { DeviceStatusBadge } from '@/components/devices/DeviceStatusBadge';
import { DeviceMetricsBar } from '@/components/devices/DeviceMetricsBar';
import { OsIcon } from '@/components/devices/OsIcon';
import type { Device, HardwareInventory, SoftwareEntry, ScriptExecution, DeviceUpdate, ComplianceResult, RemoteSession, Command } from '@obliance/shared';
import toast from 'react-hot-toast';
import { clsx } from 'clsx';

type Tab = 'overview' | 'inventory' | 'scripts' | 'updates' | 'compliance' | 'remote' | 'commands';

const TABS: Array<{ id: Tab; label: string; icon: any }> = [
  { id: 'overview', label: 'Overview', icon: Monitor },
  { id: 'inventory', label: 'Inventory', icon: HardDrive },
  { id: 'scripts', label: 'Scripts', icon: Terminal },
  { id: 'updates', label: 'Updates', icon: Package },
  { id: 'compliance', label: 'Compliance', icon: ShieldCheck },
  { id: 'remote', label: 'Remote', icon: MonitorPlay },
  { id: 'commands', label: 'Commands', icon: History },
];

// ─── Overview Tab ──────────────────────────────────────────────────────────────

function OverviewTab({ device }: { device: Device }) {
  const metrics = device.latestMetrics;

  return (
    <div className="space-y-6">
      {/* Device info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-4 bg-bg-secondary border border-border rounded-xl space-y-3">
          <h3 className="text-sm font-semibold text-text-muted uppercase tracking-wide">Identity</h3>
          <dl className="space-y-2">
            {[
              ['Hostname', device.hostname],
              ['Display Name', device.displayName || '—'],
              ['OS', device.osName ?? device.osType],
              ['OS Version', device.osVersion ?? '—'],
              ['Architecture', device.osArch ?? '—'],
              ['Agent Version', device.agentVersion ?? '—'],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between text-sm">
                <dt className="text-text-muted">{k}</dt>
                <dd className="text-text-primary font-medium">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="p-4 bg-bg-secondary border border-border rounded-xl space-y-3">
          <h3 className="text-sm font-semibold text-text-muted uppercase tracking-wide">Network</h3>
          <dl className="space-y-2">
            {[
              ['Local IP', device.ipLocal ?? '—'],
              ['Public IP', device.ipPublic ?? '—'],
              ['MAC Address', device.macAddress ?? '—'],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between text-sm">
                <dt className="text-text-muted">{k}</dt>
                <dd className="text-text-primary font-mono text-xs">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      {/* Metrics */}
      {metrics && (
        <div className="p-4 bg-bg-secondary border border-border rounded-xl space-y-3">
          <h3 className="text-sm font-semibold text-text-muted uppercase tracking-wide">Live Metrics</h3>
          <DeviceMetricsBar metrics={metrics} />
        </div>
      )}

      {/* Hardware summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {device.cpuModel && (
          <div className="p-4 bg-bg-secondary border border-border rounded-xl flex items-center gap-3">
            <Cpu className="w-5 h-5 text-blue-400 shrink-0" />
            <div>
              <p className="text-xs text-text-muted">CPU</p>
              <p className="text-sm text-text-primary font-medium">{device.cpuModel}</p>
              {device.cpuCores && <p className="text-xs text-text-muted">{device.cpuCores} cores</p>}
            </div>
          </div>
        )}
        {device.ramTotalGb && (
          <div className="p-4 bg-bg-secondary border border-border rounded-xl flex items-center gap-3">
            <MemoryStick className="w-5 h-5 text-green-400 shrink-0" />
            <div>
              <p className="text-xs text-text-muted">RAM</p>
              <p className="text-sm text-text-primary font-medium">{device.ramTotalGb} GB</p>
            </div>
          </div>
        )}
        <div className="p-4 bg-bg-secondary border border-border rounded-xl flex items-center gap-3">
          <Clock className="w-5 h-5 text-purple-400 shrink-0" />
          <div>
            <p className="text-xs text-text-muted">Last seen</p>
            <p className="text-sm text-text-primary font-medium">
              {device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString() : '—'}
            </p>
          </div>
        </div>
      </div>

      {/* Tags */}
      {device.tags && device.tags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {device.tags.map((tag) => (
            <span key={tag} className="px-2 py-1 text-xs bg-bg-tertiary border border-border rounded-full text-text-muted">
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Inventory Tab ──────────────────────────────────────────────────────────────

function InventoryTab({ deviceId }: { deviceId: number }) {
  const [hardware, setHardware] = useState<HardwareInventory | null>(null);
  const [software, setSoftware] = useState<SoftwareEntry[]>([]);
  const [softwareTotal, setSoftwareTotal] = useState(0);
  const [softwareSearch, setSoftwareSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<'hardware' | 'software'>('hardware');

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        const [hw, sw] = await Promise.all([
          inventoryApi.getHardware(deviceId),
          inventoryApi.getSoftware(deviceId, { search: softwareSearch }),
        ]);
        setHardware(hw);
        setSoftware(sw.items);
        setSoftwareTotal(sw.total);
      } catch {
        toast.error('Failed to load inventory');
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [deviceId, softwareSearch]);

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
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <button
            onClick={() => setActiveSection('hardware')}
            className={clsx('px-3 py-1.5 text-sm rounded-lg transition-colors', activeSection === 'hardware' ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary hover:bg-bg-tertiary')}
          >
            Hardware
          </button>
          <button
            onClick={() => setActiveSection('software')}
            className={clsx('px-3 py-1.5 text-sm rounded-lg transition-colors', activeSection === 'software' ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary hover:bg-bg-tertiary')}
          >
            Software ({softwareTotal})
          </button>
        </div>
        <button
          onClick={handleScan}
          className="flex items-center gap-2 px-3 py-1.5 text-sm bg-bg-secondary border border-border rounded-lg hover:border-accent/50 transition-colors text-text-muted hover:text-text-primary"
        >
          <Scan className="w-3.5 h-3.5" />
          Scan now
        </button>
      </div>

      {activeSection === 'hardware' && hardware && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* CPU */}
          <div className="p-4 bg-bg-secondary border border-border rounded-xl">
            <h4 className="text-sm font-semibold text-text-muted mb-3 flex items-center gap-2"><Cpu className="w-4 h-4" />CPU</h4>
            <p className="text-text-primary">{hardware.cpu.model}</p>
            <p className="text-sm text-text-muted">{hardware.cpu.cores} cores / {hardware.cpu.threads} threads @ {hardware.cpu.speed} GHz</p>
          </div>
          {/* Memory */}
          <div className="p-4 bg-bg-secondary border border-border rounded-xl">
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
            <div className="p-4 bg-bg-secondary border border-border rounded-xl md:col-span-2">
              <h4 className="text-sm font-semibold text-text-muted mb-3 flex items-center gap-2"><HardDrive className="w-4 h-4" />Disks</h4>
              <div className="space-y-2">
                {(hardware.disks ?? []).map((disk, i) => (
                  <div key={i} className="flex items-center gap-3 text-sm">
                    <span className="text-text-primary">{disk.model ?? disk.device}</span>
                    <span className="text-text-muted text-xs">{disk.type}</span>
                    <span className="text-text-muted text-xs">{((disk.size ?? 0) / 1024 / 1024 / 1024).toFixed(0)} GB</span>
                    <span className="text-text-muted text-xs">{(disk.mounts ?? []).map((m) => m.mount).join(', ')}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {activeSection === 'software' && (
        <div className="space-y-3">
          <input
            type="text"
            value={softwareSearch}
            onChange={(e) => setSoftwareSearch(e.target.value)}
            placeholder="Search software..."
            className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent text-sm"
          />
          <div className="bg-bg-secondary border border-border rounded-xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase">Name</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase hidden md:table-cell">Version</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase hidden lg:table-cell">Publisher</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {software.map((sw) => (
                  <tr key={sw.id} className="hover:bg-bg-tertiary transition-colors">
                    <td className="px-4 py-2 text-sm text-text-primary">{sw.name}</td>
                    <td className="px-4 py-2 text-sm text-text-muted hidden md:table-cell">{sw.version ?? '—'}</td>
                    <td className="px-4 py-2 text-sm text-text-muted hidden lg:table-cell">{sw.publisher ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeSection === 'hardware' && !hardware && (
        <p className="text-text-muted text-center py-8">No inventory data. Click "Scan now" to collect hardware info.</p>
      )}
    </div>
  );
}

// ─── Scripts Tab ──────────────────────────────────────────────────────────────

function ScriptsTab({ deviceId }: { deviceId: number }) {
  const [executions, setExecutions] = useState<ScriptExecution[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        const result = await scriptApi.listExecutions({ deviceId, pageSize: 20 });
        setExecutions(result.items);
      } catch {
        toast.error('Failed to load executions');
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [deviceId]);

  const STATUS_COLORS: Record<string, string> = {
    success: 'text-green-400',
    failure: 'text-red-400',
    running: 'text-blue-400',
    pending: 'text-yellow-400',
    timeout: 'text-orange-400',
    cancelled: 'text-gray-400',
    skipped: 'text-gray-400',
    sent: 'text-blue-400',
  };

  if (isLoading) return <div className="flex items-center justify-center h-48"><RefreshCw className="w-5 h-5 animate-spin text-text-muted" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-text-muted">{executions.length} recent executions</p>
        <Link to="/scripts" className="text-sm text-accent hover:text-accent/80">Script library →</Link>
      </div>
      {executions.length === 0 ? (
        <div className="p-12 text-center text-text-muted">
          <Terminal className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p>No script executions yet</p>
        </div>
      ) : (
        <div className="bg-bg-secondary border border-border rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase">Script</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase hidden md:table-cell">Trigger</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase hidden md:table-cell">Started</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase hidden lg:table-cell">Duration</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {executions.map((ex) => {
                const duration = ex.finishedAt && ex.startedAt
                  ? Math.round((new Date(ex.finishedAt).getTime() - new Date(ex.startedAt).getTime()) / 1000)
                  : null;
                return (
                  <tr key={ex.id} className="hover:bg-bg-tertiary transition-colors">
                    <td className="px-4 py-2 text-sm text-text-primary">{ex.scriptSnapshot.name}</td>
                    <td className="px-4 py-2">
                      <span className={clsx('text-xs font-medium', STATUS_COLORS[ex.status] ?? 'text-text-muted')}>
                        {ex.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-xs text-text-muted hidden md:table-cell">{ex.triggeredBy}</td>
                    <td className="px-4 py-2 text-xs text-text-muted hidden md:table-cell">
                      {ex.startedAt ? new Date(ex.startedAt).toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-2 text-xs text-text-muted hidden lg:table-cell">
                      {duration !== null ? `${duration}s` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Updates Tab ──────────────────────────────────────────────────────────────

function UpdatesTab({ deviceId }: { deviceId: number }) {
  const [updates, setUpdates] = useState<DeviceUpdate[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
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
    load();
  }, [deviceId]);

  const handleScan = async () => {
    try {
      await updateApi.triggerScan(deviceId);
      toast.success('Update scan queued');
    } catch {
      toast.error('Failed to queue scan');
    }
  };

  const SEVERITY_COLORS: Record<string, string> = {
    critical: 'text-red-400 bg-red-400/10 border-red-400/30',
    important: 'text-orange-400 bg-orange-400/10 border-orange-400/30',
    moderate: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30',
    optional: 'text-blue-400 bg-blue-400/10 border-blue-400/30',
    unknown: 'text-gray-400 bg-gray-400/10 border-gray-400/30',
  };

  if (isLoading) return <div className="flex items-center justify-center h-48"><RefreshCw className="w-5 h-5 animate-spin text-text-muted" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-text-muted">{updates.filter((u) => u.status === 'available').length} available updates</p>
        <button
          onClick={handleScan}
          className="flex items-center gap-2 px-3 py-1.5 text-sm bg-bg-secondary border border-border rounded-lg hover:border-accent/50 transition-colors text-text-muted hover:text-text-primary"
        >
          <Scan className="w-3.5 h-3.5" />
          Scan
        </button>
      </div>
      {updates.length === 0 ? (
        <div className="p-12 text-center text-text-muted">
          <Package className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p>No updates found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {updates.map((update) => (
            <div key={update.id} className="p-4 bg-bg-secondary border border-border rounded-xl flex items-start gap-3">
              <span className={clsx('text-xs font-medium px-2 py-0.5 rounded-full border shrink-0 mt-0.5', SEVERITY_COLORS[update.severity] ?? SEVERITY_COLORS.unknown)}>
                {update.severity}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-text-primary font-medium">{update.title ?? update.updateUid}</p>
                <p className="text-xs text-text-muted">{update.source} · {update.status}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Compliance Tab ──────────────────────────────────────────────────────────────

function ComplianceTab({ deviceId }: { deviceId: number }) {
  const [results, setResults] = useState<ComplianceResult[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        const result = await complianceApi.listResults({ deviceId });
        setResults(result.items);
      } catch {
        toast.error('Failed to load compliance');
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [deviceId]);

  if (isLoading) return <div className="flex items-center justify-center h-48"><RefreshCw className="w-5 h-5 animate-spin text-text-muted" /></div>;

  return (
    <div className="space-y-4">
      {results.length === 0 ? (
        <div className="p-12 text-center text-text-muted">
          <ShieldCheck className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p>No compliance checks run yet</p>
          <Link to="/compliance" className="mt-2 inline-block text-sm text-accent">Configure policies →</Link>
        </div>
      ) : (
        results.map((result) => (
          <div key={result.id} className="p-4 bg-bg-secondary border border-border rounded-xl">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-sm font-medium text-text-primary">{result.policy?.name ?? `Policy ${result.policyId}`}</p>
                <p className="text-xs text-text-muted">{result.policy?.framework} · Checked {new Date(result.checkedAt).toLocaleString()}</p>
              </div>
              <div className={clsx(
                'text-lg font-bold',
                result.complianceScore >= 80 ? 'text-green-400' : result.complianceScore >= 50 ? 'text-yellow-400' : 'text-red-400'
              )}>
                {result.complianceScore.toFixed(0)}%
              </div>
            </div>
            <div className="flex gap-3 text-xs">
              <span className="text-green-400">{result.results.filter((r) => r.status === 'pass').length} pass</span>
              <span className="text-red-400">{result.results.filter((r) => r.status === 'fail').length} fail</span>
              <span className="text-yellow-400">{result.results.filter((r) => r.status === 'warning').length} warning</span>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ─── Remote Tab ──────────────────────────────────────────────────────────────

function RemoteTab({ device }: { device: Device }) {
  const [sessions, setSessions] = useState<RemoteSession[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isStarting, setIsStarting] = useState(false);

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

  const handleStartSession = async (protocol: 'vnc' | 'rdp' | 'ssh') => {
    setIsStarting(true);
    try {
      const session = await remoteApi.startSession(device.id, protocol);
      setSessions((prev) => [session, ...prev]);
      toast.success(`Remote session started (${protocol.toUpperCase()})`);
      // TODO: open noVNC / RDP client in modal
    } catch {
      toast.error('Failed to start remote session');
    } finally {
      setIsStarting(false);
    }
  };

  const isOnline = device.status === 'online';

  return (
    <div className="space-y-4">
      {/* Start session buttons */}
      <div className="p-4 bg-bg-secondary border border-border rounded-xl space-y-3">
        <h3 className="text-sm font-semibold text-text-primary">Start Remote Session</h3>
        {!isOnline && (
          <p className="text-sm text-yellow-400 flex items-center gap-2">
            <WifiOff className="w-4 h-4" />
            Device is offline — remote access unavailable
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {(['vnc', 'rdp', 'ssh'] as const).map((proto) => (
            <button
              key={proto}
              onClick={() => handleStartSession(proto)}
              disabled={!isOnline || isStarting}
              className="flex items-center gap-2 px-4 py-2 bg-accent/10 text-accent border border-accent/30 rounded-lg hover:bg-accent/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
            >
              <MonitorPlay className="w-4 h-4" />
              {proto.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Session history */}
      <div className="bg-bg-secondary border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-text-primary">Session History</h3>
        </div>
        {isLoading ? (
          <div className="flex items-center justify-center h-24"><RefreshCw className="w-4 h-4 animate-spin text-text-muted" /></div>
        ) : sessions.length === 0 ? (
          <div className="p-6 text-center text-text-muted text-sm">No remote sessions yet</div>
        ) : (
          <div className="divide-y divide-border">
            {sessions.map((session) => (
              <div key={session.id} className="px-4 py-3 flex items-center gap-4">
                <div className="flex-1">
                  <p className="text-sm text-text-primary">{session.protocol.toUpperCase()} · {session.status}</p>
                  <p className="text-xs text-text-muted">
                    {new Date(session.startedAt).toLocaleString()}
                    {session.durationSeconds && ` · ${Math.round(session.durationSeconds / 60)}min`}
                  </p>
                </div>
                <span className={clsx(
                  'text-xs px-2 py-0.5 rounded-full border',
                  session.status === 'active' ? 'text-green-400 bg-green-400/10 border-green-400/30' : 'text-gray-400 bg-gray-400/10 border-gray-400/30'
                )}>
                  {session.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Commands Tab ──────────────────────────────────────────────────────────────

function CommandsTab({ deviceId }: { deviceId: number }) {
  const [commands, setCommands] = useState<Command[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        const result = await commandApi.list(deviceId);
        setCommands(result.items);
      } catch {
        toast.error('Failed to load commands');
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [deviceId]);

  const STATUS_COLORS: Record<string, string> = {
    success: 'text-green-400',
    failure: 'text-red-400',
    ack_running: 'text-blue-400',
    pending: 'text-yellow-400',
    sent: 'text-blue-400',
    timeout: 'text-orange-400',
    cancelled: 'text-gray-400',
  };

  if (isLoading) return <div className="flex items-center justify-center h-48"><RefreshCw className="w-5 h-5 animate-spin text-text-muted" /></div>;

  return (
    <div className="space-y-4">
      {commands.length === 0 ? (
        <div className="p-12 text-center text-text-muted">
          <History className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p>No commands issued yet</p>
        </div>
      ) : (
        <div className="bg-bg-secondary border border-border rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase">Command</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase hidden md:table-cell">Priority</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase hidden md:table-cell">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {commands.map((cmd) => (
                <tr key={cmd.id} className="hover:bg-bg-tertiary transition-colors">
                  <td className="px-4 py-2 text-sm text-text-primary font-mono">{cmd.type}</td>
                  <td className="px-4 py-2">
                    <span className={clsx('text-xs font-medium', STATUS_COLORS[cmd.status] ?? 'text-text-muted')}>
                      {cmd.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs text-text-muted hidden md:table-cell">{cmd.priority}</td>
                  <td className="px-4 py-2 text-xs text-text-muted hidden md:table-cell">
                    {new Date(cmd.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Main DeviceDetailPage ──────────────────────────────────────────────────────

export function DeviceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const deviceId = parseInt(id ?? '0', 10);
  const { getDevice, fetchDevice } = useDeviceStore();
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [isLoading, setIsLoading] = useState(true);
  const [obliviewUrl, setObliviewUrl] = useState<string | null>(null);
  const [obliguardUrl, setObliguardUrl] = useState<string | null>(null);
  const [oblimapUrl, setOblimapUrl] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      await fetchDevice(deviceId);
      setIsLoading(false);
    };
    load();
  }, [deviceId, fetchDevice]);

  const device = getDevice(deviceId);

  useEffect(() => {
    if (!device?.uuid) return;
    setObliviewUrl(null);
    setObliguardUrl(null);
    setOblimapUrl(null);
    appConfigApi.proxyObliviewLink(device.uuid).then((url) => setObliviewUrl(url)).catch(() => {});
    appConfigApi.proxyObliguardLink(device.uuid).then((url) => setObliguardUrl(url)).catch(() => {});
    appConfigApi.proxyOblimapLink(device.uuid).then((url) => setOblimapUrl(url)).catch(() => {});
  }, [device?.uuid]);

  function handleSwitch(targetUrl: string) {
    ssoApi.generateSwitchToken()
      .then((token) => {
        const from = window.location.origin;
        try {
          const url = new URL(targetUrl);
          window.location.href = `${url.origin}/auth/foreign?token=${encodeURIComponent(token)}&from=${encodeURIComponent(from)}&source=obliance&redirect=${encodeURIComponent(url.pathname)}`;
        } catch { window.location.href = targetUrl; }
      })
      .catch(() => { window.location.href = targetUrl; });
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-6 h-6 animate-spin text-text-muted" />
      </div>
    );
  }

  if (!device) {
    return (
      <div className="p-6 text-center">
        <p className="text-text-muted">Device not found</p>
        <Link to="/devices" className="mt-2 inline-block text-sm text-accent">← Back to devices</Link>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Link to="/devices" className="p-2 text-text-muted hover:text-text-primary hover:bg-bg-secondary rounded-lg transition-colors mt-0.5">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <OsIcon osType={device.osType} className="w-5 h-5 text-text-muted shrink-0" />
            <h1 className="text-2xl font-bold text-text-primary truncate">{device.displayName || device.hostname}</h1>
            <DeviceStatusBadge status={device.status} />
          </div>
          <p className="text-sm text-text-muted mt-1">
            {device.osName} · {device.ipLocal ?? device.ipPublic ?? 'unknown IP'} · Agent v{device.agentVersion ?? '?'}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {obliviewUrl && (
            <button
              type="button"
              onClick={() => handleSwitch(obliviewUrl)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all
                text-[#6366f1] bg-[#1e1b4b]/40 border-[#4338ca]/50
                hover:text-white hover:bg-[#1e1b4b]/60 hover:border-[#6366f1]"
            >
              <ArrowLeftRight size={13} />
              Obliview
            </button>
          )}
          {obliguardUrl && (
            <button
              type="button"
              onClick={() => handleSwitch(obliguardUrl)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all
                text-[#fb923c] bg-[#431407]/40 border-[#c2410c]/50
                hover:text-white hover:bg-[#431407]/60 hover:border-[#ea580c]"
            >
              <ArrowLeftRight size={13} />
              Obliguard
            </button>
          )}
          {oblimapUrl && (
            <button
              type="button"
              onClick={() => handleSwitch(oblimapUrl)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all
                text-[#10b981] bg-[#022c22]/40 border-[#047857]/50
                hover:text-white hover:bg-[#022c22]/60 hover:border-[#059669]"
            >
              <ArrowLeftRight size={13} />
              Oblimap
            </button>
          )}
          <button
            onClick={() => fetchDevice(deviceId)}
            className="p-2 text-text-muted hover:text-text-primary hover:bg-bg-secondary rounded-lg transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-border">
        <nav className="-mb-px flex gap-1 overflow-x-auto">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={clsx(
                  'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors',
                  activeTab === tab.id
                    ? 'border-accent text-accent'
                    : 'border-transparent text-text-muted hover:text-text-primary hover:border-border',
                )}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab content */}
      <div>
        {activeTab === 'overview' && <OverviewTab device={device} />}
        {activeTab === 'inventory' && <InventoryTab deviceId={device.id} />}
        {activeTab === 'scripts' && <ScriptsTab deviceId={device.id} />}
        {activeTab === 'updates' && <UpdatesTab deviceId={device.id} />}
        {activeTab === 'compliance' && <ComplianceTab deviceId={device.id} />}
        {activeTab === 'remote' && <RemoteTab device={device} />}
        {activeTab === 'commands' && <CommandsTab deviceId={device.id} />}
      </div>
    </div>
  );
}
