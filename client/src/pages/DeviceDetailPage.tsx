import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Monitor, ArrowLeft, ArrowLeftRight, RefreshCw, Cpu, MemoryStick, HardDrive,
  Terminal, Package, ShieldCheck, MonitorPlay, History,
  Scan, WifiOff, Clock, Network, CircuitBoard, X,
  Server, Power, RotateCcw, Loader2, ScanLine, ChevronDown, Play, Square,
} from 'lucide-react';
import { getSocket } from '@/socket/socketClient';
import { appConfigApi } from '@/api/appConfig.api';
import { ssoApi } from '@/api/sso.api';
import { inventoryApi } from '@/api/inventory.api';
import { commandApi } from '@/api/command.api';
import { scriptApi } from '@/api/script.api';
import { updateApi } from '@/api/update.api';
import { complianceApi } from '@/api/compliance.api';
import { remoteApi } from '@/api/remote.api';
import { SshTerminalModal } from '@/components/SshTerminalModal';
import { useDeviceStore } from '@/store/deviceStore';
import { DeviceStatusBadge } from '@/components/devices/DeviceStatusBadge';
import { DeviceMetricsBar } from '@/components/devices/DeviceMetricsBar';
import { OsIcon } from '@/components/devices/OsIcon';
import type { Device, HardwareInventory, SoftwareEntry, ScriptExecution, DeviceUpdate, ComplianceResult, RemoteSession, Command } from '@obliance/shared';
import toast from 'react-hot-toast';
import { clsx } from 'clsx';

type Tab = 'overview' | 'inventory' | 'scripts' | 'updates' | 'compliance' | 'remote' | 'services' | 'commands';

const TABS: Array<{ id: Tab; label: string; icon: any }> = [
  { id: 'overview', label: 'Overview', icon: Monitor },
  { id: 'inventory', label: 'Inventory', icon: HardDrive },
  { id: 'scripts', label: 'Scripts', icon: Terminal },
  { id: 'updates', label: 'Updates', icon: Package },
  { id: 'compliance', label: 'Compliance', icon: ShieldCheck },
  { id: 'remote', label: 'Remote', icon: MonitorPlay },
  { id: 'services', label: 'Services', icon: Server },
  { id: 'commands', label: 'Tasks', icon: History },
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
          {/* GPU */}
          {(hardware.gpu ?? []).length > 0 && (
            <div className="p-4 bg-bg-secondary border border-border rounded-xl md:col-span-2">
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
            <div className="p-4 bg-bg-secondary border border-border rounded-xl md:col-span-2">
              <h4 className="text-sm font-semibold text-text-muted mb-3 flex items-center gap-2"><Network className="w-4 h-4" />Network Interfaces</h4>
              <div className="space-y-2">
                {(hardware.networkInterfaces ?? []).map((iface, i) => (
                  <div key={i} className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 text-sm">
                    <span className="text-text-primary font-medium">{iface.name}</span>
                    {iface.mac && <span className="text-text-muted text-xs font-mono">{iface.mac}</span>}
                    {iface.type && <span className="text-text-muted text-xs">{iface.type}</span>}
                    {(iface.addresses ?? []).length > 0 && (
                      <span className="text-text-muted text-xs">{(iface.addresses ?? []).join(' · ')}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* Motherboard & BIOS */}
          {(hardware.motherboard?.manufacturer || hardware.motherboard?.model || hardware.bios?.vendor) && (
            <div className="p-4 bg-bg-secondary border border-border rounded-xl md:col-span-2">
              <h4 className="text-sm font-semibold text-text-muted mb-3 flex items-center gap-2"><CircuitBoard className="w-4 h-4" />Motherboard & BIOS</h4>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1.5">
                {[
                  ['Board', [hardware.motherboard?.manufacturer, hardware.motherboard?.model].filter(Boolean).join(' ') || null],
                  ['Revision', hardware.motherboard?.version ?? null],
                  ['BIOS', hardware.bios?.vendor ? `${hardware.bios.vendor}${hardware.bios.version ? ` · ${hardware.bios.version}` : ''}` : null],
                  ['BIOS Date', hardware.bios?.date ?? null],
                ].filter(([, v]) => v).map(([k, v]) => (
                  <div key={k as string} className="flex justify-between text-sm">
                    <dt className="text-text-muted shrink-0 mr-2">{k as string}</dt>
                    <dd className="text-text-primary font-medium text-right truncate">{v as string}</dd>
                  </div>
                ))}
              </dl>
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
  const [approvingId, setApprovingId] = useState<number | null>(null);
  const [isApprovingAll, setIsApprovingAll] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);

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
    available: 'Available',
    approved: 'Approved',
    pending_install: 'Installing…',
    installed: 'Installed',
    failed: 'Failed',
  };

  const available = updates.filter((u) => u.status === 'available');
  const approved = updates.filter((u) => u.status === 'approved');

  if (isLoading) return <div className="flex items-center justify-center h-48"><RefreshCw className="w-5 h-5 animate-spin text-text-muted" /></div>;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-text-muted">
          {available.length > 0 && <span className="text-orange-400 font-medium">{available.length} available</span>}
          {available.length > 0 && approved.length > 0 && <span className="text-text-muted"> · </span>}
          {approved.length > 0 && <span className="text-green-400 font-medium">{approved.length} approved</span>}
          {available.length === 0 && approved.length === 0 && <span>No pending updates</span>}
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          {available.length > 0 && (
            <button
              onClick={handleApproveAll}
              disabled={isApprovingAll}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-green-500/10 text-green-400 border border-green-500/30 rounded-lg hover:bg-green-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isApprovingAll ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
              Approve All
            </button>
          )}
          {approved.length > 0 && (
            <button
              onClick={handleDeploy}
              disabled={isDeploying}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-accent/10 text-accent border border-accent/30 rounded-lg hover:bg-accent/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isDeploying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Package className="w-3.5 h-3.5" />}
              Deploy ({approved.length})
            </button>
          )}
          <button
            onClick={handleScan}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-bg-secondary border border-border rounded-lg hover:border-accent/50 transition-colors text-text-muted hover:text-text-primary"
          >
            <Scan className="w-3.5 h-3.5" />
            Scan
          </button>
        </div>
      </div>

      {/* Update list */}
      {updates.length === 0 ? (
        <div className="p-12 text-center text-text-muted">
          <Package className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p>No updates found — run a scan to check for updates</p>
        </div>
      ) : (
        <div className="bg-bg-secondary border border-border rounded-xl overflow-hidden">
          <div className="divide-y divide-border">
            {updates.map((update) => (
              <div key={update.id} className="px-4 py-3 flex items-center gap-3">
                <span className={clsx('text-xs font-medium px-2 py-0.5 rounded-full border shrink-0', SEVERITY_COLORS[update.severity] ?? SEVERITY_COLORS.unknown)}>
                  {update.severity}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-text-primary font-medium truncate">{update.title ?? update.updateUid}</p>
                  <p className="text-xs text-text-muted">{update.source} · <span className={clsx(
                    update.status === 'approved' ? 'text-green-400' :
                    update.status === 'installed' ? 'text-blue-400' :
                    update.status === 'failed' ? 'text-red-400' : '',
                  )}>{STATUS_LABEL[update.status] ?? update.status}</span></p>
                </div>
                {update.status === 'available' && (
                  <button
                    onClick={() => handleApprove(update.id)}
                    disabled={approvingId === update.id}
                    className="shrink-0 flex items-center gap-1 px-2.5 py-1 text-xs text-green-400 bg-green-400/10 border border-green-400/20 rounded-lg hover:bg-green-400/20 disabled:opacity-50 transition-colors"
                  >
                    {approvingId === update.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />}
                    Approve
                  </button>
                )}
                {update.status === 'approved' && (
                  <span className="shrink-0 text-xs text-green-400 opacity-60">✓ Approved</span>
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

// ─── VNC Viewer ──────────────────────────────────────────────────────────────

function VncViewer({ session, title, onClose }: { session: RemoteSession | null; title: string; onClose: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<any>(null);
  const [vncStatus, setVncStatus] = useState<'connecting' | 'connected' | 'failed'>('connecting');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Timeout — show error if tunnel is not established within 60 s
  useEffect(() => {
    if (session) return;
    const t = setTimeout(() => {
      setVncStatus('failed');
      setErrorMsg('Tunnel timed out — the agent did not respond within 60 s');
    }, 60_000);
    return () => clearTimeout(t);
  }, [session]);

  useEffect(() => {
    if (!session?.sessionToken) return;
    let rfb: any;
    const origin = window.location.origin;
    const wsUrl = origin.replace(/^https:\/\//, 'wss://').replace(/^http:\/\//, 'ws://')
      + `/api/remote/tunnel/${session.sessionToken}`;

    import('@novnc/novnc').then(({ default: RFB }) => {
      if (!containerRef.current) return;
      rfb = new RFB(containerRef.current, wsUrl, { scaleViewport: true });
      rfbRef.current = rfb;

      rfb.addEventListener('connect', () => setVncStatus('connected'));
      rfb.addEventListener('disconnect', (e: CustomEvent<{ clean: boolean }>) => {
        if (!e.detail.clean) {
          setVncStatus('failed');
          setErrorMsg('Connection lost — the tunnel was closed unexpectedly');
        } else {
          onClose();
        }
      });
      rfb.addEventListener('securityfailure', () => {
        setVncStatus('failed');
        setErrorMsg('VNC authentication failed');
      });
    }).catch(() => {
      setVncStatus('failed');
      setErrorMsg('Failed to load VNC client library');
    });

    return () => {
      try { rfb?.disconnect(); } catch {}
    };
  }, [session?.sessionToken]);

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 bg-bg-secondary border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <MonitorPlay className="w-4 h-4 text-accent" />
          <span className="text-sm font-medium text-text-primary">{title}</span>
          <span className={clsx(
            'text-xs px-2 py-0.5 rounded-full border',
            vncStatus === 'connected' ? 'text-green-400 bg-green-400/10 border-green-400/30' :
            vncStatus === 'failed'    ? 'text-red-400 bg-red-400/10 border-red-400/30' :
                                       'text-yellow-400 bg-yellow-400/10 border-yellow-400/30',
          )}>
            {vncStatus === 'connecting' ? 'Connecting…' : vncStatus}
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      {/* Connecting overlay — shown while tunnel is being established */}
      {!session && vncStatus !== 'failed' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#0d0f14]" style={{ top: '42px' }}>
          <Loader2 className="w-10 h-10 text-accent animate-spin" />
          <p className="text-text-primary font-medium">Establishing tunnel…</p>
          <p className="text-sm text-text-muted">Waiting for agent to connect back to the server</p>
        </div>
      )}
      {/* Canvas */}
      <div ref={containerRef} className="flex-1 overflow-hidden" />
      {/* Error overlay */}
      {vncStatus === 'failed' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80" style={{ top: '42px' }}>
          <div className="text-center p-8">
            <WifiOff className="w-10 h-10 text-red-400 mx-auto mb-3" />
            <p className="text-red-400 font-medium text-lg mb-1">Connection failed</p>
            <p className="text-text-muted text-sm mb-6">{errorMsg ?? 'VNC tunnel could not be established'}</p>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-bg-secondary border border-border rounded-lg text-sm text-text-muted hover:text-text-primary transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Remote Tab ──────────────────────────────────────────────────────────────

function RemoteTab({ device }: { device: Device }) {
  const [sessions, setSessions] = useState<RemoteSession[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  // Modal open flags — set immediately on button click so the modal shows a
  // connecting overlay before REMOTE_TUNNEL_READY arrives.
  const [vncModalOpen, setVncModalOpen] = useState(false);
  const [sshModalOpen, setSshModalOpen] = useState(false);
  // Null while establishing, populated when REMOTE_TUNNEL_READY fires.
  const [vncSession, setVncSession] = useState<RemoteSession | null>(null);
  const [sshSession, setSshSession] = useState<RemoteSession | null>(null);
  // Track the session ID we are personally waiting for so a concurrent
  // session started by another user doesn't overwrite our modal state.
  const pendingSshId = useRef<string | null>(null);
  const pendingVncId = useRef<string | null>(null);
  const [endingSession, setEndingSession] = useState<Set<string>>(new Set());

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
      if ((session.protocol === 'vnc' || session.protocol === 'rdp') && session.id === pendingVncId.current) {
        setVncSession(session);
        pendingVncId.current = null;
      } else if ((session.protocol === 'ssh' || session.protocol === 'cmd' || session.protocol === 'powershell') && session.id === pendingSshId.current) {
        setSshSession(session);
        pendingSshId.current = null;
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

  const handleStartSession = async (protocol: 'vnc' | 'rdp' | 'ssh' | 'cmd' | 'powershell') => {
    // Open the modal immediately so the user sees a connecting overlay
    // instead of waiting for REMOTE_TUNNEL_READY (which can take several seconds).
    if (isShellProtocol(protocol)) {
      setSshSession(null);
      setSshModalOpen(true);
    } else {
      setVncSession(null);
      setVncModalOpen(true);
    }
    setIsStarting(true);
    try {
      const session = await remoteApi.startSession(device.id, protocol);
      // Record which session ID we're waiting for so REMOTE_TUNNEL_READY
      // can ignore events from concurrent sessions opened by other users.
      if (isShellProtocol(protocol)) pendingSshId.current = session.id;
      else pendingVncId.current = session.id;
      setSessions((prev) => [session, ...prev]);
    } catch {
      toast.error('Failed to start remote session');
      // Roll back modal if the API call failed
      if (isShellProtocol(protocol)) setSshModalOpen(false);
      else setVncModalOpen(false);
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

  const isOnline = device.status === 'online';

  return (
    <>
      {vncModalOpen && (
        <VncViewer
          session={vncSession}
          title={`VNC — ${device.displayName || device.hostname}`}
          onClose={() => { setVncModalOpen(false); setVncSession(null); }}
        />
      )}
      {sshModalOpen && (
        <SshTerminalModal
          session={sshSession}
          deviceName={device.displayName || device.hostname}
          onClose={() => { setSshModalOpen(false); setSshSession(null); }}
        />
      )}
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
          {(
            device.osType === 'windows' ? (['vnc', 'cmd', 'powershell'] as const) :
            device.osType === 'macos'   ? (['vnc', 'ssh'] as const) :
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
                  <div className="flex items-center gap-2">
                    <p className="text-sm text-text-primary">{session.protocol.toUpperCase()}</p>
                    <span className={clsx(
                      'text-xs px-2 py-0.5 rounded-full border',
                      session.status === 'active'     ? 'text-green-400 bg-green-400/10 border-green-400/30' :
                      session.status === 'waiting'    ? 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30 animate-pulse' :
                      session.status === 'connecting' ? 'text-blue-400 bg-blue-400/10 border-blue-400/30 animate-pulse' :
                      session.status === 'failed'     ? 'text-red-400 bg-red-400/10 border-red-400/30' :
                      session.status === 'timeout'    ? 'text-orange-400 bg-orange-400/10 border-orange-400/30' :
                                                        'text-gray-400 bg-gray-400/10 border-gray-400/30',
                    )}>
                      {session.status}
                    </span>
                  </div>
                  <p className="text-xs text-text-muted mt-0.5">
                    {new Date(session.startedAt).toLocaleString()}
                    {session.durationSeconds != null && ` · ${Math.round(session.durationSeconds / 60)}min`}
                  </p>
                </div>
                {session.status === 'active' && (session.protocol === 'vnc' || session.protocol === 'rdp') && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => { setVncSession(session); setVncModalOpen(true); }}
                      className="text-xs px-3 py-1 bg-accent/10 text-accent border border-accent/30 rounded-lg hover:bg-accent/20 transition-colors"
                    >
                      Open
                    </button>
                    <button
                      onClick={() => handleEndSession(session)}
                      disabled={endingSession.has(session.id)}
                      title="End session"
                      className="flex items-center gap-1 text-xs px-2.5 py-1 text-red-400 border border-red-400/30 rounded-lg hover:bg-red-400/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {endingSession.has(session.id) ? <RefreshCw className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
                      End
                    </button>
                  </div>
                )}
                {session.status === 'active' && isShellProtocol(session.protocol) && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => { setSshSession(session); setSshModalOpen(true); }}
                      className="text-xs px-3 py-1 bg-green-500/10 text-green-400 border border-green-500/30 rounded-lg hover:bg-green-500/20 transition-colors"
                    >
                      Open
                    </button>
                    <button
                      onClick={() => handleEndSession(session)}
                      disabled={endingSession.has(session.id)}
                      title="End session"
                      className="flex items-center gap-1 text-xs px-2.5 py-1 text-red-400 border border-red-400/30 rounded-lg hover:bg-red-400/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
                    className="flex items-center gap-1 text-xs px-2.5 py-1 text-red-400 border border-red-400/30 rounded-lg hover:bg-red-400/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
  scan_inventory: 'Scan Inventory',
  scan_updates: 'Scan Updates',
  check_compliance: 'Check Compliance',
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
};

const CMD_STATUS_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  pending:     { color: 'text-yellow-400', bg: 'bg-yellow-400/10', label: 'Pending' },
  sent:        { color: 'text-blue-300',   bg: 'bg-blue-400/10',   label: 'Sent' },
  ack_running: { color: 'text-blue-400',   bg: 'bg-blue-400/10',   label: 'Running' },
  success:     { color: 'text-green-400',  bg: 'bg-green-400/10',  label: 'Success' },
  failure:     { color: 'text-red-400',    bg: 'bg-red-400/10',    label: 'Failed' },
  timeout:     { color: 'text-orange-400', bg: 'bg-orange-400/10', label: 'Timeout' },
  cancelled:   { color: 'text-gray-400',   bg: 'bg-gray-400/10',   label: 'Cancelled' },
};

type CmdFilter = 'all' | 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

function CommandsTab({ deviceId }: { deviceId: number }) {
  const socket = getSocket();
  const [commands, setCommands] = useState<Command[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<CmdFilter>('all');
  const [cancelling, setCancelling] = useState<Set<string>>(new Set());

  const load = async () => {
    setIsLoading(true);
    try {
      const result = await commandApi.list(deviceId);
      setCommands(result.items);
    } catch {
      toast.error('Failed to load tasks');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { load(); }, [deviceId]);

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
    socket.on('COMMAND_RESULT', onUpdate);
    return () => {
      socket.off('COMMAND_UPDATED', onUpdate);
      socket.off('COMMAND_RESULT', onUpdate);
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

  const counts: Record<CmdFilter, number> = {
    all:       commands.length,
    queued:    commands.filter(c => c.status === 'pending' || c.status === 'sent').length,
    running:   commands.filter(c => c.status === 'ack_running').length,
    done:      commands.filter(c => c.status === 'success').length,
    failed:    commands.filter(c => c.status === 'failure' || c.status === 'timeout').length,
    cancelled: commands.filter(c => c.status === 'cancelled').length,
  };

  const filtered = commands.filter(cmd => {
    if (filter === 'queued')    return cmd.status === 'pending' || cmd.status === 'sent';
    if (filter === 'running')   return cmd.status === 'ack_running';
    if (filter === 'done')      return cmd.status === 'success';
    if (filter === 'failed')    return cmd.status === 'failure' || cmd.status === 'timeout';
    if (filter === 'cancelled') return cmd.status === 'cancelled';
    return true;
  });

  const FILTER_PILLS: { key: CmdFilter; label: string }[] = [
    { key: 'all',       label: 'All' },
    { key: 'queued',    label: 'Queued' },
    { key: 'running',   label: 'Running' },
    { key: 'done',      label: 'Done' },
    { key: 'failed',    label: 'Failed' },
    { key: 'cancelled', label: 'Cancelled' },
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
                'flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium transition-colors border',
                filter === key
                  ? 'bg-accent text-white border-accent'
                  : 'bg-bg-secondary text-text-muted hover:text-text-primary border-border'
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
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-bg-secondary border border-border text-text-muted hover:text-text-primary transition-colors text-xs"
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
        <div className="bg-bg-secondary border border-border rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">Task</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">Status</th>
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
                const durationMs = cmd.result?.duration;
                const payloadKeys = Object.keys(cmd.payload ?? {});

                return (
                  <tr key={cmd.id} className="hover:bg-bg-tertiary transition-colors">
                    {/* Task label + details */}
                    <td className="px-4 py-3 max-w-0">
                      <div className="text-sm text-text-primary font-medium truncate">
                        {COMMAND_LABELS[cmd.type] ?? cmd.type}
                      </div>
                      {payloadKeys.length > 0 && (
                        <div className="text-xs text-text-muted mt-0.5 font-mono truncate">
                          {payloadKeys.filter(k => k !== 'sessionToken').map(k => `${k}=${String(cmd.payload[k])}`).join(' ')}
                        </div>
                      )}
                      {cmd.result?.error && (
                        <div className="text-xs text-red-400 mt-0.5 truncate" title={cmd.result.error}>
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

                    {/* Priority */}
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className={clsx('text-xs capitalize', {
                        'text-red-400':    cmd.priority === 'urgent',
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
                        <button
                          onClick={() => handleCancel(cmd.id)}
                          disabled={cancelling.has(cmd.id)}
                          title="Cancel task"
                          className="p-1.5 rounded-lg text-text-muted hover:text-red-400 hover:bg-red-400/10 transition-colors disabled:opacity-50"
                        >
                          {cancelling.has(cmd.id)
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <X className="w-3.5 h-3.5" />}
                        </button>
                      )}
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

// ─── Services Tab ──────────────────────────────────────────────────────────────

interface ServiceInfo {
  name: string;
  displayName?: string;
  status: string;
  startType?: string;
}

function ServicesTab({ device }: { device: Device }) {
  const [services, setServices] = useState<ServiceInfo[]>([]);
  const [isLoadingServices, setIsLoadingServices] = useState(false);
  // Per-service pending action: name → 'start' | 'stop' | 'restart'
  const [pendingService, setPendingService] = useState<Map<string, string>>(new Map());
  const listTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [filter, setFilter] = useState('');

  // Listen for command results from server (via socket)
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const onCmd = (cmd: Command) => {
      if (cmd.deviceId !== device.id) return;
      const terminal = ['success', 'failure', 'timeout'].includes(cmd.status);
      if (!terminal) return;

      if (cmd.type === 'list_services') {
        if (listTimeoutRef.current) { clearTimeout(listTimeoutRef.current); listTimeoutRef.current = null; }
        setIsLoadingServices(false);
        if (cmd.status === 'success') {
          const raw = cmd.result as any;
          // Agent may return { services: [...], count: N } or a plain array
          const arr: ServiceInfo[] = Array.isArray(raw) ? raw : (Array.isArray(raw?.services) ? raw.services : []);
          setServices(arr);
        } else {
          toast.error('Failed to load services');
        }
      }

      if (cmd.type === 'restart_service' || cmd.type === 'start_service' || cmd.type === 'stop_service') {
        const name = (cmd.payload as any)?.name as string;
        if (name) {
          setPendingService((prev) => { const m = new Map(prev); m.delete(name); return m; });
          if (cmd.status === 'success') {
            // Optimistically update the status in the list
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

    socket.on('COMMAND_RESULT', onCmd);
    socket.on('COMMAND_UPDATED', onCmd);
    return () => { socket.off('COMMAND_RESULT', onCmd); socket.off('COMMAND_UPDATED', onCmd); };
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
    <div className="bg-bg-secondary border border-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
          <Server className="w-4 h-4 text-text-muted" />
          Services
          {services.length > 0 && (
            <span className="text-xs font-normal text-text-muted bg-bg-tertiary border border-border px-1.5 py-0.5 rounded-md">
              {services.length}
            </span>
          )}
        </h3>
        <div className="flex items-center gap-2">
          {services.length > 0 && (
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter services…"
              className="px-2 py-1 text-xs bg-bg-tertiary border border-border rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50 w-40"
            />
          )}
          <button
            onClick={handleListServices}
            disabled={isLoadingServices}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-bg-tertiary border border-border rounded-lg text-text-muted hover:text-text-primary hover:border-accent/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isLoadingServices ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            {isLoadingServices ? 'Loading…' : services.length > 0 ? 'Refresh' : 'Load Services'}
          </button>
        </div>
      </div>

      {/* Body */}
      {services.length === 0 && !isLoadingServices ? (
        <div className="p-10 text-center text-text-muted text-sm">
          <Server className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p>Click <strong>Load Services</strong> to retrieve the service list from the agent</p>
        </div>
      ) : isLoadingServices && services.length === 0 ? (
        <div className="flex items-center justify-center gap-2 h-24 text-text-muted text-sm">
          <Loader2 className="w-5 h-5 animate-spin" />
          Fetching services…
        </div>
      ) : (
        <div className="overflow-auto max-h-[65vh]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-bg-secondary z-10 border-b border-border">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-text-muted uppercase tracking-wide w-6" />
                <th className="px-4 py-2 text-left text-xs font-medium text-text-muted uppercase tracking-wide">Name</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-text-muted uppercase tracking-wide hidden md:table-cell">Description</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-text-muted uppercase tracking-wide">Status</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-text-muted uppercase tracking-wide hidden lg:table-cell">Startup</th>
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
                    {/* Name */}
                    <td className="px-4 py-2 font-mono text-xs text-text-primary whitespace-nowrap">{svc.name}</td>
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
                    {/* Action buttons */}
                    <td className="px-4 py-2">
                      <div className="flex items-center justify-end gap-1">
                        {/* Start — only when stopped */}
                        <button
                          onClick={() => handleServiceAction(svc.name, 'start_service')}
                          disabled={!isStopped || !!pending}
                          title={`Start ${svc.name}`}
                          className={clsx(
                            'inline-flex items-center gap-1 px-2 py-1 text-xs rounded-lg border transition-colors',
                            isStopped && !pending
                              ? 'text-green-400 bg-green-400/10 border-green-400/30 hover:bg-green-400/20'
                              : 'text-text-muted/30 border-transparent cursor-not-allowed',
                          )}
                        >
                          {pending === 'start_service' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                          Start
                        </button>
                        {/* Stop — only when running */}
                        <button
                          onClick={() => handleServiceAction(svc.name, 'stop_service')}
                          disabled={!isRunning || !!pending}
                          title={`Stop ${svc.name}`}
                          className={clsx(
                            'inline-flex items-center gap-1 px-2 py-1 text-xs rounded-lg border transition-colors',
                            isRunning && !pending
                              ? 'text-red-400 bg-red-400/10 border-red-400/30 hover:bg-red-400/20'
                              : 'text-text-muted/30 border-transparent cursor-not-allowed',
                          )}
                        >
                          {pending === 'stop_service' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Square className="w-3 h-3" />}
                          Stop
                        </button>
                        {/* Restart — always available */}
                        <button
                          onClick={() => handleServiceAction(svc.name, 'restart_service')}
                          disabled={!!pending}
                          title={`Restart ${svc.name}`}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs text-text-muted hover:text-blue-400 hover:bg-blue-400/10 border border-transparent hover:border-blue-400/20 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                          {pending === 'restart_service' ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                          Restart
                        </button>
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

  // Quick-action state (header buttons — visible on every tab)
  const [headerPending, setHeaderPending] = useState<Set<string>>(new Set());
  const [headerRemoteOpen, setHeaderRemoteOpen] = useState(false);
  const [headerRemoteSession, setHeaderRemoteSession] = useState<RemoteSession | null>(null);
  const [headerRemoteProtocol, setHeaderRemoteProtocol] = useState<'vnc' | 'ssh' | 'cmd' | 'powershell'>('vnc');
  const [isStartingRemote, setIsStartingRemote] = useState(false);
  const [remoteDropdownOpen, setRemoteDropdownOpen] = useState(false);
  const remoteDropdownRef = useRef<HTMLDivElement>(null);
  const remoteReadyListenerRef = useRef<((s: RemoteSession) => void) | null>(null);

  const handleHeaderAction = async (type: 'restart_agent' | 'reboot' | 'shutdown') => {
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

  const handleHeaderRemote = async (protocol: 'vnc' | 'ssh' | 'cmd' | 'powershell') => {
    setRemoteDropdownOpen(false);
    setHeaderRemoteProtocol(protocol);
    setHeaderRemoteSession(null);
    setHeaderRemoteOpen(true);
    setIsStartingRemote(true);
    try {
      const session = await remoteApi.startSession(deviceId, protocol);
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
      toast.error(`Failed to start ${protocol.toUpperCase()} session`);
      setHeaderRemoteOpen(false);
    } finally {
      setIsStartingRemote(false);
    }
  };

  useEffect(() => {
    if (!remoteDropdownOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (remoteDropdownRef.current && !remoteDropdownRef.current.contains(e.target as Node)) {
        setRemoteDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [remoteDropdownOpen]);

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
    <div className="p-6 space-y-6">
      {/* Remote session launched from header */}
      {headerRemoteOpen && (
        headerRemoteProtocol === 'vnc' ? (
          <VncViewer
            session={headerRemoteSession}
            title={`VNC — ${device.displayName || device.hostname}`}
            onClose={() => { setHeaderRemoteOpen(false); setHeaderRemoteSession(null); }}
          />
        ) : (
          <SshTerminalModal
            session={headerRemoteSession}
            deviceName={device.displayName || device.hostname}
            onClose={() => { setHeaderRemoteOpen(false); setHeaderRemoteSession(null); }}
          />
        )
      )}

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
          {/* ── Scan All ── */}
          <button
            onClick={handleScanAll}
            disabled={isScanningAll || device.status !== 'online'}
            title="Scan All — triggers inventory, updates and compliance scans"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border bg-bg-secondary text-text-muted hover:text-accent hover:border-accent/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {isScanningAll ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ScanLine className="w-3.5 h-3.5" />}
            Scan All
          </button>

          {/* ── Quick actions ── */}
          <div className="flex items-center gap-1 border border-border rounded-lg bg-bg-secondary px-1 py-1">
            {/* OS-aware remote dropdown */}
            {(() => {
              const opts: Array<'vnc' | 'ssh' | 'cmd' | 'powershell'> =
                device.osType === 'windows' ? ['vnc', 'cmd', 'powershell'] :
                device.osType === 'macos'   ? ['vnc', 'ssh'] :
                                              ['ssh'];
              const label = (p: string) => p === 'powershell' ? 'PS' : p.toUpperCase();
              return (
                <div className="relative" ref={remoteDropdownRef}>
                  {opts.length === 1 ? (
                    <button
                      onClick={() => handleHeaderRemote(opts[0])}
                      disabled={isStartingRemote || headerRemoteOpen || device.status !== 'online'}
                      title={`${label(opts[0])} Remote`}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md text-green-400 hover:bg-green-400/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      {isStartingRemote ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MonitorPlay className="w-3.5 h-3.5" />}
                      {label(opts[0])}
                    </button>
                  ) : (
                    <button
                      onClick={() => setRemoteDropdownOpen((o) => !o)}
                      disabled={isStartingRemote || headerRemoteOpen || device.status !== 'online'}
                      title="Remote Control"
                      className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md text-green-400 hover:bg-green-400/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      {isStartingRemote ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MonitorPlay className="w-3.5 h-3.5" />}
                      Remote
                      <ChevronDown className="w-3 h-3" />
                    </button>
                  )}
                  {remoteDropdownOpen && (
                    <div className="absolute right-0 top-full mt-1 z-50 bg-bg-secondary border border-border rounded-lg shadow-lg overflow-hidden min-w-[130px]">
                      {opts.map((proto) => (
                        <button
                          key={proto}
                          onClick={() => handleHeaderRemote(proto)}
                          className="w-full flex items-center gap-2 px-3 py-2 text-xs text-text-primary hover:bg-bg-tertiary transition-colors text-left"
                        >
                          <MonitorPlay className="w-3.5 h-3.5 text-green-400" />
                          {proto === 'powershell' ? 'PowerShell' : proto.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
            <div className="w-px h-5 bg-border" />
            <button
              onClick={() => handleHeaderAction('restart_agent')}
              disabled={headerPending.has('restart_agent')}
              title="Restart Agent"
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md text-blue-400 hover:bg-blue-400/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {headerPending.has('restart_agent') ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
              Agent
            </button>
            <button
              onClick={() => handleHeaderAction('reboot')}
              disabled={headerPending.has('reboot')}
              title="Reboot device"
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md text-orange-400 hover:bg-orange-400/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {headerPending.has('reboot') ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
              Reboot
            </button>
            <button
              onClick={() => handleHeaderAction('shutdown')}
              disabled={headerPending.has('shutdown')}
              title="Shutdown device"
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md text-red-400 hover:bg-red-400/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {headerPending.has('shutdown') ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Power className="w-3.5 h-3.5" />}
              Off
            </button>
          </div>

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
        {activeTab === 'services' && <ServicesTab device={device} />}
        {activeTab === 'commands' && <CommandsTab deviceId={device.id} />}
      </div>
    </div>
  );
}
