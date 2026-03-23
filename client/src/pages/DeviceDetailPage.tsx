import { useEffect, useRef, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import {
  Monitor, ArrowLeft, RefreshCw, Cpu, MemoryStick, HardDrive, Plus,
  Terminal, Package, Shield, ShieldCheck, ShieldOff, MonitorPlay, History,
  Scan, WifiOff, Clock, Network, CircuitBoard, X,
  Server, Power, RotateCcw, Loader2, ScanLine, ChevronDown, ChevronRight, Play, Square, Activity,
  AlertTriangle, CheckCircle2, XCircle, MinusCircle, Settings, Save, ToggleLeft, ToggleRight, Trash2, Download, TerminalSquare, FolderOpen, MessageCircle,
  ArrowLeftRight,
} from 'lucide-react';
import { getSocket } from '@/socket/socketClient';
import { inventoryApi } from '@/api/inventory.api';
import { commandApi } from '@/api/command.api';
import { deviceApi } from '@/api/device.api';
import { scriptApi } from '@/api/script.api';
import { updateApi } from '@/api/update.api';
import { complianceApi } from '@/api/compliance.api';
import { remoteApi, type ObliReachSession } from '@/api/remote.api';
import { SshTerminalModal } from '@/components/SshTerminalModal';
import { ObliReachViewer } from '@/components/ObliReachViewer';
import { ChatPanel } from '@/components/ChatPanel';
import { useDeviceStore } from '@/store/deviceStore';
import { DeviceStatusBadge } from '@/components/devices/DeviceStatusBadge';
import { DeviceMetricsBar } from '@/components/devices/DeviceMetricsBar';
import { OsIcon } from '@/components/devices/OsIcon';
import FileExplorerTab from '@/components/devices/FileExplorerTab';
import type { Device, HardwareInventory, SoftwareEntry, ScriptExecution, DeviceUpdate, ComplianceResult, CompliancePolicy, RemoteSession, Command, ServiceInfo, ProcessInfo } from '@obliance/shared';
import { SocketEvents } from '@obliance/shared';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { clsx } from 'clsx';

type Tab = 'overview' | 'inventory' | 'scripts' | 'updates' | 'compliance' | 'remote' | 'files' | 'services' | 'processes' | 'commands' | 'settings';

const TABS: Array<{ id: Tab; label: string; icon: any }> = [
  { id: 'overview', label: 'Overview', icon: Monitor },
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
              ['Last Logged In', device.lastLoggedInUser ?? '—'],
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
              ['Timezone', device.timezone ?? '—'],
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

      {/* Quick info cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <div className="p-3 bg-bg-secondary border border-border rounded-xl flex items-center gap-2.5">
          <Clock className="w-4 h-4 text-purple-400 shrink-0" />
          <div className="min-w-0">
            <p className="text-[10px] text-text-muted uppercase tracking-wide">Last Seen</p>
            <p className="text-xs text-text-primary font-medium truncate">
              {device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString() : '—'}
            </p>
          </div>
        </div>
        <div className="p-3 bg-bg-secondary border border-border rounded-xl flex items-center gap-2.5">
          <Power className="w-4 h-4 text-orange-400 shrink-0" />
          <div className="min-w-0">
            <p className="text-[10px] text-text-muted uppercase tracking-wide">Last Reboot</p>
            <p className="text-xs text-text-primary font-medium truncate">
              {device.lastRebootAt ? new Date(device.lastRebootAt).toLocaleString() : '—'}
            </p>
          </div>
        </div>
        <div className="p-3 bg-bg-secondary border border-border rounded-xl flex items-center gap-2.5">
          <Plus className="w-4 h-4 text-blue-400 shrink-0" />
          <div className="min-w-0">
            <p className="text-[10px] text-text-muted uppercase tracking-wide">Added</p>
            <p className="text-xs text-text-primary font-medium truncate">
              {new Date(device.createdAt).toLocaleDateString()}
            </p>
          </div>
        </div>
        <div className="p-3 bg-bg-secondary border border-border rounded-xl flex items-center gap-2.5">
          <Cpu className="w-4 h-4 text-cyan-400 shrink-0" />
          <div className="min-w-0">
            <p className="text-[10px] text-text-muted uppercase tracking-wide">CPU</p>
            <p className="text-xs text-text-primary font-medium truncate" title={device.cpuModel ?? undefined}>{device.cpuModel ?? '—'}</p>
            {device.cpuCores && <p className="text-[10px] text-text-muted">{device.cpuCores} cores</p>}
          </div>
        </div>
        <div className="p-3 bg-bg-secondary border border-border rounded-xl flex items-center gap-2.5">
          <MemoryStick className="w-4 h-4 text-green-400 shrink-0" />
          <div className="min-w-0">
            <p className="text-[10px] text-text-muted uppercase tracking-wide">RAM</p>
            <p className="text-xs text-text-primary font-medium">{device.ramTotalGb ? `${device.ramTotalGb} GB` : '—'}</p>
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
          {/* OS Details */}
          {hardware.os && hardware.os.edition && (
            <div className="p-4 bg-bg-secondary border border-border rounded-xl md:col-span-2">
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
                    <dd className="text-text-primary font-medium text-right truncate select-all">{v as string}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
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

          {/* BitLocker */}
          {hardware.bitlocker && hardware.bitlocker.length > 0 && (
            <div className="p-4 bg-bg-secondary border border-border rounded-xl md:col-span-2">
              <h4 className="text-sm font-semibold text-text-muted mb-3 flex items-center gap-2"><HardDrive className="w-4 h-4" />BitLocker</h4>
              <div className="space-y-3">
                {hardware.bitlocker.map((vol) => (
                  <div key={vol.driveLetter} className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-text-primary">{vol.driveLetter}</span>
                      <span className={clsx('text-xs px-2 py-0.5 rounded-full border font-medium',
                        vol.status === 'FullyEncrypted' ? 'text-green-400 bg-green-400/10 border-green-400/30' :
                        vol.status === 'FullyDecrypted' ? 'text-gray-400 bg-gray-400/10 border-gray-400/30' :
                        'text-yellow-400 bg-yellow-400/10 border-yellow-400/30'
                      )}>{vol.status}</span>
                    </div>
                    {vol.recoveryKeys.length > 0 && (
                      <div className="space-y-0.5">
                        {vol.recoveryKeys.map((key, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <code className="text-xs text-text-muted font-mono bg-bg-tertiary px-2 py-0.5 rounded select-all">{key}</code>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* Battery Health */}
          {hardware.battery?.present && (
            <div className="p-4 bg-bg-secondary border border-border rounded-xl md:col-span-2">
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
  const { t } = useTranslation();
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
    socket.on(SocketEvents.COMMAND_RESULT, onCmd);
    socket.on(SocketEvents.COMMAND_UPDATED, onCmd);
    return () => {
      socket.off(SocketEvents.COMMAND_RESULT, onCmd);
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
    failed: t('updates.status.failed'),
    excluded: t('updates.status.excluded'),
    superseded: t('updates.status.superseded'),
  };

  const available = updates.filter((u) => u.status === 'available');
  const approved = updates.filter((u) => u.status === 'approved');

  if (isLoading) return <div className="flex items-center justify-center h-48"><RefreshCw className="w-5 h-5 animate-spin text-text-muted" /></div>;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-text-muted">
          {available.length > 0 && <span className="text-orange-400 font-medium">{available.length} {t('updates.status.available').toLowerCase()}</span>}
          {available.length > 0 && approved.length > 0 && <span className="text-text-muted"> · </span>}
          {approved.length > 0 && <span className="text-green-400 font-medium">{approved.length} {t('updates.status.approved').toLowerCase()}</span>}
          {available.length === 0 && approved.length === 0 && <span>{t('updates.noPending')}</span>}
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          {available.length > 0 && (
            <button
              onClick={handleApproveAll}
              disabled={isApprovingAll}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-green-500/10 text-green-400 border border-green-500/30 rounded-lg hover:bg-green-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isApprovingAll ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
              {t('updates.actions.approveAll')}
            </button>
          )}
          {approved.length > 0 && (
            <button
              onClick={handleDeploy}
              disabled={isDeploying}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-accent/10 text-accent border border-accent/30 rounded-lg hover:bg-accent/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isDeploying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Package className="w-3.5 h-3.5" />}
              {t('updates.actions.deploy')} ({approved.length})
            </button>
          )}
          <button
            onClick={handleScan}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-bg-secondary border border-border rounded-lg hover:border-accent/50 transition-colors text-text-muted hover:text-text-primary"
          >
            <Scan className="w-3.5 h-3.5" />
            {t('updates.actions.scan')}
          </button>
        </div>
      </div>

      {/* Update list */}
      {updates.length === 0 ? (
        <div className="p-12 text-center text-text-muted">
          <Package className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p>{t('updates.noUpdates')}</p>
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
                    update.status === 'installing' || update.status === 'pending_install' ? 'text-yellow-400' :
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
                    {t('updates.actions.approve')}
                  </button>
                )}
                {update.status === 'approved' && (
                  <span className="shrink-0 text-xs text-green-400 opacity-60">✓ {t('updates.status.approved')}</span>
                )}
                {(update.status === 'failed' || update.status === 'installed') && (
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
                    className="shrink-0 flex items-center gap-1 px-2.5 py-1 text-xs text-accent bg-accent/10 border border-accent/20 rounded-lg hover:bg-accent/20 transition-colors"
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
  pass:    <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />,
  fail:    <XCircle      className="w-4 h-4 text-red-400 shrink-0" />,
  warning: <AlertTriangle className="w-4 h-4 text-yellow-400 shrink-0" />,
  error:   <MinusCircle  className="w-4 h-4 text-text-muted shrink-0" />,
};

const SEVERITY_COLOR: Record<string, string> = {
  critical: 'text-red-400',
  high:     'text-orange-400',
  medium:   'text-yellow-400',
  low:      'text-blue-400',
  info:     'text-text-muted',
};

function ComplianceTab({ deviceId }: { deviceId: number }) {
  const [results, setResults]   = useState<ComplianceResult[]>([]);
  const [policies, setPolicies] = useState<CompliancePolicy[]>([]);
  const [isLoading, setIsLoading]   = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  const load = async () => {
    setIsLoading(true);
    try {
      const [resultData, policyList] = await Promise.all([
        complianceApi.listResults({ deviceId }),
        complianceApi.listPolicies(),
      ]);
      setResults(resultData.items);
      setPolicies(policyList);
    } catch {
      toast.error('Failed to load compliance');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { load(); }, [deviceId]);

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

  const handleExport = (e: React.MouseEvent, result: ComplianceResult) => {
    e.stopPropagation();
    const policyName = result.policy?.name ?? `Policy #${result.policyId}`;
    const checkedAt  = new Date(result.checkedAt).toLocaleString();
    const score      = result.complianceScore.toFixed(0);

    const lines: string[] = [
      `"Politique","${policyName.replace(/"/g, '""')}"`,
      `"Date","${checkedAt}"`,
      `"Score","${score}%"`,
      ``,
      `"Règle","Statut","Sévérité","Valeur actuelle","Valeur attendue"`,
    ];

    for (const rr of result.results) {
      const info     = getRuleInfo(result.policyId, rr.ruleId);
      const name     = (info?.name ?? rr.ruleId).replace(/"/g, '""');
      const actual   = rr.actualValue !== null && rr.actualValue !== undefined ? String(rr.actualValue) : '';
      const expected = info?.expected !== undefined && info.expected !== null ? String(info.expected) : '';
      lines.push(`"${name}","${rr.status}","${info?.severity ?? ''}","${actual}","${expected}"`);
    }

    const csv  = lines.join('\r\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `compliance-${policyName.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (isLoading) return (
    <div className="flex items-center justify-center h-48">
      <RefreshCw className="w-5 h-5 animate-spin text-text-muted" />
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-text-muted">{results.length} policy result{results.length !== 1 ? 's' : ''}</p>
        <div className="flex gap-2">
          <button
            onClick={load}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-bg-secondary text-text-muted hover:text-text-primary transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            Refresh
          </button>
          <button
            onClick={handleTriggerCheck}
            disabled={triggering}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-accent/10 border border-accent/30 text-accent hover:bg-accent/20 disabled:opacity-50 transition-colors"
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
          <Link to="/compliance" className="mt-2 inline-block text-sm text-accent">Configure policies →</Link>
        </div>
      ) : (
        results.map((result) => {
          const isExpanded = expandedIds.has(result.id);
          const passCount    = result.results.filter(r => r.status === 'pass').length;
          const failCount    = result.results.filter(r => r.status === 'fail').length;
          const warnCount    = result.results.filter(r => r.status === 'warning').length;

          return (
            <div key={result.id} className="bg-bg-secondary border border-border rounded-xl overflow-hidden">
              {/* Policy header */}
              <div
                onClick={() => toggleExpand(result.id)}
                className="w-full flex items-center justify-between p-4 hover:bg-bg-tertiary/50 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  {isExpanded
                    ? <ChevronDown className="w-4 h-4 text-text-muted shrink-0" />
                    : <ChevronRight className="w-4 h-4 text-text-muted shrink-0" />
                  }
                  <div>
                    <p className="text-sm font-medium text-text-primary">
                      {result.policy?.name ?? `Policy #${result.policyId}`}
                    </p>
                    <p className="text-xs text-text-muted mt-0.5">
                      {result.policy?.framework && <span className="uppercase mr-2">{result.policy.framework}</span>}
                      {new Date(result.checkedAt).toLocaleString()}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  <button
                    onClick={(e) => handleExport(e, result)}
                    title="Exporter le rapport CSV"
                    className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg border border-border hover:bg-bg-primary text-text-muted hover:text-text-primary transition-colors"
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
              {isExpanded && (
                <div className="divide-y divide-border">
                  {result.results.map((rr) => {
                    const ruleInfo = getRuleInfo(result.policyId, rr.ruleId);
                    return (
                      <div key={rr.ruleId} className="flex items-start gap-3 px-4 py-3">
                        <div className="mt-0.5">{RULE_STATUS_ICON[rr.status] ?? RULE_STATUS_ICON.error}</div>
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
                            {rr.remediationTriggered && (
                              <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                                remediated
                              </span>
                            )}
                          </div>
                          <div className="flex gap-4 mt-1 text-xs text-text-muted font-mono">
                            {rr.actualValue !== null && rr.actualValue !== undefined && (
                              <span>actual: <span className="text-text-secondary">{String(rr.actualValue)}</span></span>
                            )}
                            {ruleInfo?.expected !== undefined && ruleInfo.expected !== null && (
                              <span>expected: <span className="text-text-secondary">{String(ruleInfo.expected)}</span></span>
                            )}
                          </div>
                        </div>
                        <span className={clsx(
                          'text-xs font-medium shrink-0 capitalize mt-0.5',
                          rr.status === 'pass' ? 'text-green-400'
                          : rr.status === 'fail' ? 'text-red-400'
                          : rr.status === 'warning' ? 'text-yellow-400'
                          : 'text-text-muted'
                        )}>
                          {rr.status}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })
      )}
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

function DeviceSettingsTab({ device, onSaved, adminMode, onDeleted }: {
  device: Device; onSaved: () => void; adminMode: boolean; onDeleted: () => void;
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
    displayName:   device.displayName ?? '',
    description:   device.description ?? '',
    // Tags
    tags:          [...(device.tags ?? [])],
    tagInput:      '',
    // Custom fields
    customFields:  { ...(device.customFields ?? {}) } as Record<string, string>,
    cfKey:         '',
    cfValue:       '',
    // Monitoring
    overrideGroupSettings: device.overrideGroupSettings ?? false,
    pushIntervalSeconds:   device.pushIntervalSeconds ?? null as number | null,
    scanIntervalSeconds:   device.scanIntervalSeconds ?? null as number | null,
    maxMissedPushes:       device.maxMissedPushes ?? 3,
    // Notifications
    notifOnline:   device.notificationTypes?.online   ?? true,
    notifOffline:  device.notificationTypes?.offline  ?? true,
    notifWarning:  device.notificationTypes?.warning  ?? true,
    notifCritical: device.notificationTypes?.critical ?? true,
    notifUpdate:   device.notificationTypes?.update   ?? false,
    // Display — section visibility
    hideCpu:     device.displayConfig?.hideCpu     ?? false,
    hideMemory:  device.displayConfig?.hideMemory  ?? false,
    hideDisk:    device.displayConfig?.hideDisk    ?? false,
    hideNetwork: device.displayConfig?.hideNetwork ?? false,
    hideTemps:   device.displayConfig?.hideTemps   ?? false,
    hideGpu:     device.displayConfig?.hideGpu     ?? false,
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
    sensorKey:   '',
    sensorValue: '',
    // Compliance
    complianceRemediationEnabled: device.complianceRemediationEnabled ?? true,
  });
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm(prev => ({ ...prev, [key]: value }));

  // Tags
  const addTag = () => {
    const t = form.tagInput.trim();
    if (!t || form.tags.includes(t)) return;
    set('tags', [...form.tags, t]);
    set('tagInput', '');
  };
  const removeTag = (t: string) => set('tags', form.tags.filter(x => x !== t));

  // Custom fields
  const addCf = () => {
    const k = form.cfKey.trim(), v = form.cfValue.trim();
    if (!k) return;
    set('customFields', { ...form.customFields, [k]: v });
    set('cfKey', ''); set('cfValue', '');
  };
  const removeCf = (k: string) => {
    const next = { ...form.customFields }; delete next[k]; set('customFields', next);
  };

  // Sensor renames
  const addSensor = () => {
    const k = form.sensorKey.trim(), v = form.sensorValue.trim();
    if (!k) return;
    set('sensorDisplayNames', { ...form.sensorDisplayNames, [k]: v });
    set('sensorKey', ''); set('sensorValue', '');
  };
  const removeSensor = (k: string) => {
    const next = { ...form.sensorDisplayNames }; delete next[k]; set('sensorDisplayNames', next);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const base = device.displayConfig ?? emptyDisplayConfig();
      const displayConfig: Device['displayConfig'] = {
        ...base,
        hideCpu:     form.hideCpu,
        hideMemory:  form.hideMemory,
        hideDisk:    form.hideDisk,
        hideNetwork: form.hideNetwork,
        hideTemps:   form.hideTemps,
        hideGpu:     form.hideGpu,
        cpu:    { ...(base.cpu    ?? { hiddenCores: [], hiddenCharts: [], tempSensor: null }), groupCoreThreads: form.cpuGroupCoreThreads },
        ram:    { ...(base.ram    ?? { hideUsed: false, hideFree: false, hiddenCharts: [] }), hideSwap: form.ramHideSwap },
        drives: { ...(base.drives ?? { hiddenMounts: [], renames: {} }), combineReadWrite: form.driveCombineReadWrite },
        network:{ ...(base.network?? { hiddenInterfaces: [], renames: {} }), combineInOut: form.networkCombineInOut },
      };
      await deviceApi.update(device.id, {
        displayName:   form.displayName || undefined,
        description:   form.description || undefined,
        tags:          form.tags,
        customFields:  form.customFields,
        overrideGroupSettings: form.overrideGroupSettings,
        pushIntervalSeconds:   form.overrideGroupSettings ? (form.pushIntervalSeconds ?? null) : null,
        scanIntervalSeconds:   form.overrideGroupSettings ? (form.scanIntervalSeconds ?? null) : null,
        maxMissedPushes:       form.maxMissedPushes,
        notificationTypes: {
          online:   form.notifOnline,
          offline:  form.notifOffline,
          warning:  form.notifWarning,
          critical: form.notifCritical,
          update:   form.notifUpdate,
        },
        displayConfig,
        sensorDisplayNames: form.sensorDisplayNames,
        complianceRemediationEnabled: form.complianceRemediationEnabled,
      });
      toast.success('Settings saved');
      onSaved();
    } catch {
      toast.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full px-3 py-2 text-sm bg-bg-primary border border-border rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:ring-1 focus:ring-accent';
  const cardCls  = 'p-5 bg-bg-secondary border border-border rounded-xl space-y-4';
  const headCls  = 'text-sm font-semibold text-text-muted uppercase tracking-wide';

  return (
    <div className="space-y-6 max-w-2xl">

      {/* ── Identity ── */}
      <div className={cardCls}>
        <h3 className={headCls}>Identity</h3>
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs text-text-muted mb-1 block">Display name</span>
            <input type="text" value={form.displayName} onChange={e => set('displayName', e.target.value)}
              placeholder={device.hostname} className={inputCls} />
          </label>
          <label className="block">
            <span className="text-xs text-text-muted mb-1 block">Description</span>
            <textarea value={form.description} onChange={e => set('description', e.target.value)}
              rows={2} className={`${inputCls} resize-none`} />
          </label>
        </div>
      </div>

      {/* ── Tags ── */}
      <div className={cardCls}>
        <h3 className={headCls}>Tags</h3>
        <div className="flex flex-wrap gap-1.5 min-h-[28px]">
          {form.tags.map(t => (
            <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-accent/15 text-accent border border-accent/30">
              {t}
              <button onClick={() => removeTag(t)} className="hover:text-red-400 transition-colors"><X className="w-3 h-3" /></button>
            </span>
          ))}
          {form.tags.length === 0 && <span className="text-xs text-text-muted italic">No tags</span>}
        </div>
        <div className="flex gap-2">
          <input type="text" value={form.tagInput} onChange={e => set('tagInput', e.target.value)}
            onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addTag())}
            placeholder="Add tag…" className={`${inputCls} flex-1`} />
          <button onClick={addTag}
            className="px-3 py-2 text-sm rounded-lg bg-bg-primary border border-border text-text-muted hover:text-accent hover:border-accent/50 transition-colors">
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
              <div key={k} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-bg-primary border border-border text-sm">
                <span className="font-mono text-accent shrink-0">{k}</span>
                <span className="text-text-muted">·</span>
                <span className="text-text-secondary flex-1 truncate">{v}</span>
                <button onClick={() => removeCf(k)} className="shrink-0 text-text-muted hover:text-red-400 transition-colors"><X className="w-3.5 h-3.5" /></button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input type="text" value={form.cfKey} onChange={e => set('cfKey', e.target.value)}
            placeholder="Key" className={`${inputCls} flex-1`} />
          <input type="text" value={form.cfValue} onChange={e => set('cfValue', e.target.value)}
            onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addCf())}
            placeholder="Value" className={`${inputCls} flex-1`} />
          <button onClick={addCf}
            className="px-3 py-2 text-sm rounded-lg bg-bg-primary border border-border text-text-muted hover:text-accent hover:border-accent/50 transition-colors">
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── Monitoring ── */}
      <div className={cardCls}>
        <h3 className={headCls}>Monitoring</h3>
        <ToggleRow label="Override group settings"
          description="Apply per-device values instead of group / global defaults"
          value={form.overrideGroupSettings} onChange={v => set('overrideGroupSettings', v)} />
        {form.overrideGroupSettings && (
          <div className="space-y-3 pt-3 border-t border-border">
            <label className="block">
              <span className="text-xs text-text-muted mb-1 block">Push interval (seconds)</span>
              <input type="number" min={1} max={3600}
                value={form.pushIntervalSeconds ?? ''}
                onChange={e => set('pushIntervalSeconds', e.target.value ? parseInt(e.target.value) : null)}
                placeholder="60" className={inputCls} />
            </label>
            <label className="block">
              <span className="text-xs text-text-muted mb-1 block">Scan interval (seconds) — 0 = disabled</span>
              <input type="number" min={0} max={86400}
                value={form.scanIntervalSeconds ?? ''}
                onChange={e => set('scanIntervalSeconds', e.target.value ? parseInt(e.target.value) : null)}
                placeholder="Inherit from group/global" className={inputCls} />
            </label>
            <label className="block">
              <span className="text-xs text-text-muted mb-1 block">Max missed pushes before offline</span>
              <input type="number" min={1} max={30}
                value={form.maxMissedPushes}
                onChange={e => set('maxMissedPushes', parseInt(e.target.value) || 3)}
                className={inputCls} />
            </label>
          </div>
        )}
      </div>

      {/* ── Notifications ── */}
      <div className={cardCls}>
        <h3 className={headCls}>Notifications</h3>
        <div className="space-y-3">
          <ToggleRow label="Device comes online"  value={form.notifOnline}   onChange={v => set('notifOnline', v)} />
          <ToggleRow label="Device goes offline"  value={form.notifOffline}  onChange={v => set('notifOffline', v)} />
          <ToggleRow label="Warning state"        value={form.notifWarning}  onChange={v => set('notifWarning', v)} />
          <ToggleRow label="Critical state"       value={form.notifCritical} onChange={v => set('notifCritical', v)} />
          <ToggleRow label="Updates available"    value={form.notifUpdate}   onChange={v => set('notifUpdate', v)} />
        </div>
      </div>

      {/* ── Display ── */}
      <div className={cardCls}>
        <h3 className={headCls}>Display</h3>
        <p className="text-xs text-text-muted -mt-1">Hide or adjust sensors shown on the device monitoring page.</p>

        <div className="space-y-3">
          <p className="text-xs font-semibold text-text-muted uppercase tracking-wide pt-1">Section visibility</p>
          <div className="grid grid-cols-2 gap-x-8 gap-y-3">
            <ToggleRow label="Hide CPU"     value={form.hideCpu}     onChange={v => set('hideCpu', v)} />
            <ToggleRow label="Hide Memory"  value={form.hideMemory}  onChange={v => set('hideMemory', v)} />
            <ToggleRow label="Hide Disk"    value={form.hideDisk}    onChange={v => set('hideDisk', v)} />
            <ToggleRow label="Hide Network" value={form.hideNetwork} onChange={v => set('hideNetwork', v)} />
            <ToggleRow label="Hide Temps"   value={form.hideTemps}   onChange={v => set('hideTemps', v)} />
            <ToggleRow label="Hide GPU"     value={form.hideGpu}     onChange={v => set('hideGpu', v)} />
          </div>

          <div className="pt-2 border-t border-border space-y-3">
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">CPU</p>
            <ToggleRow label="Group core threads" description="Pair hyper-threaded cores together in charts"
              value={form.cpuGroupCoreThreads} onChange={v => set('cpuGroupCoreThreads', v)} />
          </div>

          <div className="pt-2 border-t border-border space-y-3">
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">RAM</p>
            <ToggleRow label="Hide swap" value={form.ramHideSwap} onChange={v => set('ramHideSwap', v)} />
          </div>

          <div className="pt-2 border-t border-border space-y-3">
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">Drives</p>
            <ToggleRow label="Combine read/write chart"
              description="Show a single combined I/O chart instead of separate read and write"
              value={form.driveCombineReadWrite} onChange={v => set('driveCombineReadWrite', v)} />
          </div>

          <div className="pt-2 border-t border-border space-y-3">
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">Network</p>
            <ToggleRow label="Combine in/out chart"
              description="Show a single combined bandwidth chart instead of separate upload and download"
              value={form.networkCombineInOut} onChange={v => set('networkCombineInOut', v)} />
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
              <div key={k} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-bg-primary border border-border text-sm">
                <span className="font-mono text-text-muted shrink-0 truncate max-w-[40%]">{k}</span>
                <ChevronRight className="w-3.5 h-3.5 text-text-muted shrink-0" />
                <span className="text-text-primary flex-1 truncate">{v}</span>
                <button onClick={() => removeSensor(k)} className="shrink-0 text-text-muted hover:text-red-400 transition-colors"><X className="w-3.5 h-3.5" /></button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input type="text" value={form.sensorKey} onChange={e => set('sensorKey', e.target.value)}
            placeholder="Raw sensor name" className={`${inputCls} flex-1`} />
          <input type="text" value={form.sensorValue} onChange={e => set('sensorValue', e.target.value)}
            onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addSensor())}
            placeholder="Display name" className={`${inputCls} flex-1`} />
          <button onClick={addSensor}
            className="px-3 py-2 text-sm rounded-lg bg-bg-primary border border-border text-text-muted hover:text-accent hover:border-accent/50 transition-colors">
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
          onChange={v => set('complianceRemediationEnabled', v)} />
        {!form.complianceRemediationEnabled && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-xs text-yellow-400">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>Auto-remediation is disabled. Failing rules will be reported but no fix scripts will run on this device.</span>
          </div>
        )}
      </div>

      {/* ── Save ── */}
      <div className="flex justify-end">
        <button onClick={handleSave} disabled={saving}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-accent text-white hover:bg-accent/90 disabled:opacity-50 transition-colors">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save settings
        </button>
      </div>

      {/* ── Danger Zone ── */}
      {adminMode && (
        <div className="p-5 bg-bg-secondary border border-red-500/30 rounded-xl space-y-4">
          <h3 className="text-sm font-semibold text-red-400 uppercase tracking-wide">Danger Zone</h3>

          {/* Delete */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm text-text-primary">Delete device</p>
              <p className="text-xs text-text-muted mt-0.5">
                Removes this device from Obliance. The agent is <span className="text-text-primary">not</span> uninstalled
                — it will re-register on the next push.
              </p>
            </div>
            <button
              onClick={async () => {
                const name = device.displayName || device.hostname;
                if (!confirm(`Delete "${name}" from Obliance?\n\nThe agent is NOT uninstalled — it will re-register on the next push.`)) return;
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
          <div className="flex items-center justify-between gap-4">
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
                  const name = device.displayName || device.hostname;
                  if (!confirm(`Uninstall agent on "${name}"?\n\nThe agent will be removed immediately.\nIf it doesn't confirm within 10 min, the device will reappear.`)) return;
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
  const [sshModalOpen, setSshModalOpen] = useState(false);
  const [orModalOpen, setOrModalOpen]   = useState(false);
  // Null while establishing, populated when REMOTE_TUNNEL_READY fires.
  const [sshSession, setSshSession] = useState<RemoteSession | null>(null);
  const [orSession,  setOrSession]  = useState<RemoteSession | null>(null);
  // Track the session ID we are personally waiting for so a concurrent
  // session started by another user doesn't overwrite our modal state.
  const pendingSshId = useRef<string | null>(null);
  const pendingOrId  = useRef<string | null>(null);
  const [endingSession, setEndingSession] = useState<Set<string>>(new Set());
  // null = unknown (loading), false = not installed, true = installed
  const [orInstalled, setOrInstalled] = useState<boolean | null>(null);
  const [orSessions, setOrSessions] = useState<ObliReachSession[]>([]);
  const [orSessionPickerOpen, setOrSessionPickerOpen] = useState(false);
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
        setSshSession(session);
        pendingSshId.current = null;
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
        socket?.on('COMMAND_RESULT', onResult);
        socket?.on('COMMAND_UPDATED', onResult);
        // Cleanup after 10s
        setTimeout(() => {
          socket?.off('COMMAND_RESULT', onResult);
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
    setSshSession(null);
    setSshModalOpen(true);
    setIsStarting(true);
    try {
      const session = await remoteApi.startSession(device.id, protocol, undefined, wtsSessionId);
      pendingSshId.current = session.id;
      setSessions((prev) => [session, ...prev]);
    } catch {
      toast.error('Failed to start remote session');
      setSshModalOpen(false);
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
      {orModalOpen && (
        <ObliReachViewer
          sessionToken={orSession?.sessionToken ?? null}
          deviceName={device.displayName || device.hostname}
          preferredCodec={useAuthStore.getState().user?.preferences?.preferredCodec}
          onClose={async () => {
            if (orSession) try { await remoteApi.endSession(orSession.id); } catch {}
            setOrModalOpen(false);
            setOrSession(null);
          }}
        />
      )}
      {/* WTS Session picker — shown on RDS when multiple sessions are available */}
      {orSessionPickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-bg-secondary border border-border rounded-xl shadow-2xl w-full max-w-sm mx-4">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h2 className="text-sm font-semibold text-text-primary flex items-center gap-2">
                <MonitorPlay className="w-4 h-4 text-accent" />
                Choose Session
              </h2>
              <button
                onClick={() => setOrSessionPickerOpen(false)}
                className="text-text-muted hover:text-text-primary transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-3 space-y-1 max-h-72 overflow-y-auto">
              {orSessions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => handleStartObliReachSession(s.id)}
                  className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-bg-tertiary transition-colors flex items-center gap-3"
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
          </div>
        </div>
      )}
      {shellSessionPickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-bg-secondary border border-border rounded-xl shadow-2xl w-full max-w-sm mx-4">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h2 className="text-sm font-semibold text-text-primary flex items-center gap-2">
                <TerminalSquare className="w-4 h-4 text-accent" />
                {pendingShellProtocol.current === 'powershell' ? 'PowerShell' : 'CMD'} — Choose Context
              </h2>
              <button
                onClick={() => setShellSessionPickerOpen(false)}
                className="text-text-muted hover:text-text-primary transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-3 space-y-1 max-h-72 overflow-y-auto">
              <button
                onClick={() => startShellSession(pendingShellProtocol.current)}
                className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-bg-tertiary transition-colors flex items-center gap-3"
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
                  className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-bg-tertiary transition-colors flex items-center gap-3"
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
          </div>
        </div>
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
                <button
                  onClick={orInstalled === false ? () => handleInstallOblireach() : undefined}
                  disabled={!isOnline || isStarting || orInstalled === null}
                  title={orInstalled === null ? 'Checking Oblireach status…' : 'Oblireach agent not installed — click to deploy'}
                  className="flex items-center gap-2 px-4 py-2 bg-gray-500/10 text-gray-400 border border-gray-500/30 rounded-lg hover:bg-yellow-500/10 hover:text-yellow-400 hover:border-yellow-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
                >
                  <MonitorPlay className="w-4 h-4" />
                  Reach
                  <span className="text-xs opacity-70">
                    {orInstalled === null ? '…' : '(install)'}
                  </span>
                </button>
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
            device.osType === 'macos'   ? (['ssh'] as const) :
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
                {session.status === 'active' && session.protocol === 'oblireach' && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => { setOrSession(session); setOrModalOpen(true); }}
                      className="px-3 py-1 text-xs bg-sky-500/10 text-sky-400 border border-sky-500/20 rounded-lg hover:bg-sky-500/20 transition-colors"
                    >
                      View
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
  disable_privacy_mode: 'Disable Privacy',
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

                    {/* User */}
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className="text-xs text-text-muted truncate">
                        {cmd.createdByName || '—'}
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

function ServicesTab({ device }: { device: Device }) {
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
    socket.on('COMMAND_RESULT', onCmd);
    socket.on('COMMAND_UPDATED', onCmd);
    return () => {
      socket.off(SocketEvents.DEVICE_SERVICES_UPDATED, onServicesUpdated);
      socket.off('COMMAND_RESULT', onCmd);
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
          <p>No service data yet — the agent will push the list automatically on its next scan.</p>
          <p className="mt-1 text-xs opacity-70">You can also click <strong>Load Services</strong> to force an immediate fetch.</p>
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
                    {/* Run As */}
                    <td className="px-4 py-2 text-xs text-text-muted hidden xl:table-cell font-mono">{svc.runAsUser || '—'}</td>
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

// ─── Processes Tab ────────────────────────────────────────────────────────────

type SortField = 'name' | 'pid' | 'cpuPercent' | 'memBytes' | 'user';
type SortDir = 'asc' | 'desc';

function ProcessesTab({ device }: { device: Device }) {
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [filter, setFilter] = useState('');
  const [sortField, setSortField] = useState<SortField>('cpuPercent');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [killingPids, setKillingPids] = useState<Set<number>>(new Set());
  const [connected, setConnected] = useState(false);
  const { isAdmin } = useAuthStore();

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
    socket.on('COMMAND_RESULT', onCmd);
    socket.on('COMMAND_UPDATED', onCmd);

    return () => {
      socket.emit(SocketEvents.PROCESS_UNSUBSCRIBE, { deviceId: device.id });
      socket.off(SocketEvents.DEVICE_PROCESSES_UPDATED, onProcesses);
      socket.off('COMMAND_RESULT', onCmd);
      socket.off('COMMAND_UPDATED', onCmd);
      setConnected(false);
    };
  }, [device.id]);

  const handleKill = async (pid: number, name: string) => {
    if (!confirm(`Kill process "${name}" (PID ${pid})?`)) return;
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
    if (sortField !== field) return <ChevronDown className="w-3 h-3 opacity-0 group-hover:opacity-30" />;
    return sortDir === 'asc'
      ? <ChevronRight className="w-3 h-3 rotate-[-90deg]" />
      : <ChevronDown className="w-3 h-3" />;
  };

  return (
    <div className="bg-bg-secondary border border-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
          <Activity className="w-4 h-4 text-text-muted" />
          Processes
          {processes.length > 0 && (
            <span className="text-xs font-normal text-text-muted bg-bg-tertiary border border-border px-1.5 py-0.5 rounded-md">
              {processes.length}
            </span>
          )}
          {connected && processes.length > 0 && (
            <span className="text-xs font-normal text-text-muted">
              — CPU: {totalCpu.toFixed(1)}% · Mem: {formatMem(totalMem)}
            </span>
          )}
        </h3>
        <div className="flex items-center gap-2">
          {connected && (
            <span className="flex items-center gap-1.5 text-xs text-green-400">
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
              className="px-2 py-1 text-xs bg-bg-tertiary border border-border rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50 w-48"
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
        <div className="overflow-auto max-h-[70vh]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-bg-secondary z-10 border-b border-border">
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
                  <tr key={proc.pid} className="hover:bg-bg-tertiary/60 transition-colors group" title={proc.command || proc.name}>
                    <td className="px-4 py-1.5 font-mono text-xs text-text-muted">{proc.pid}</td>
                    <td className="px-4 py-1.5 text-xs text-text-primary font-medium whitespace-nowrap max-w-xs truncate">{proc.name}</td>
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
                          onClick={() => handleKill(proc.pid, proc.name)}
                          disabled={killing}
                          title={`Kill ${proc.name} (PID ${proc.pid})`}
                          className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-lg border text-red-400/70 border-transparent hover:border-red-400/30 hover:bg-red-400/10 hover:text-red-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors opacity-0 group-hover:opacity-100"
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
    </div>
  );
}

// ─── Main DeviceDetailPage ──────────────────────────────────────────────────────

export function DeviceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const deviceId = parseInt(id ?? '0', 10);
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { isAdmin } = useAuthStore();
  const { getDevice, fetchDevice } = useDeviceStore();
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [isLoading, setIsLoading] = useState(true);
  const [crossAppLinks, setCrossAppLinks] = useState<Array<{ appType: string; name: string; url: string; color: string | null }>>([]);

  // Uninstall countdown (ticks every second while device is pending_uninstall)
  const [uninstallCountdown, setUninstallCountdown] = useState<string>('');
  const _device = getDevice(deviceId);
  const _uninstallAt = _device?.uninstallAt ?? null;
  const _isPendingUninstall = _device?.status === 'pending_uninstall';
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

  // Chat state (shared across RemoteTab and header)
  const [chatOpen, setChatOpen]         = useState(false);
  const [chatMessages, setChatMessages] = useState<import('@/components/ChatPanel').ChatMessage[]>([]);
  const [chatId, setChatId]             = useState<string | null>(null);
  const [chatSessionId, setChatSessionId] = useState<number | undefined>(undefined);
  const [chatSoundEnabled, setChatSoundEnabled] = useState(true);
  const [chatSessionPickerOpen, setChatSessionPickerOpen] = useState(false);
  const [quickReplyTemplates, setQuickReplyTemplates] = useState<Array<{ id: number; translations: Record<string, string> }>>([]);

  // Fetch admin quick reply templates once
  useEffect(() => {
    import('@/api/quickReplyTemplates.api').then(({ quickReplyTemplatesApi }) => {
      quickReplyTemplatesApi.list().then(setQuickReplyTemplates).catch(() => {});
    });
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

  const handleHeaderStartObliReachSession = async (wtsSessionId?: number) => {
    setHeaderOrSessionPickerOpen(false);
    setHeaderRemoteProtocol('oblireach');
    setHeaderRemoteSession(null);
    setHeaderRemoteOpen(true);
    setIsStartingRemote(true);
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

  const handleHeaderRemote = async (protocol: 'ssh' | 'cmd' | 'powershell' | 'oblireach') => {
    setRemoteDropdownOpen(false);

    // Oblireach: if not installed redirect to install command; if installed check sessions.
    if (protocol === 'oblireach') {
      if (headerOrInstalled === false) {
        if (device?.status !== 'online') { toast.error('Device is offline'); return; }
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
    if (!confirm('Refuse this device?')) return;
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
      {headerRemoteOpen && headerRemoteProtocol === 'oblireach' && (
        <ObliReachViewer
          sessionToken={headerRemoteSession?.sessionToken ?? null}
          deviceName={device.displayName || device.hostname}
          preferredCodec={useAuthStore.getState().user?.preferences?.preferredCodec}
          onChatToggle={() => setChatOpen(o => !o)}
          chatOpen={chatOpen}
          chatSoundEnabled={chatSoundEnabled}
          onChatSoundToggle={() => setChatSoundEnabled(v => !v)}
          onClose={async () => {
            if (headerRemoteSession) try { await remoteApi.endSession(headerRemoteSession.id); } catch {}
            setHeaderRemoteOpen(false);
            setHeaderRemoteSession(null);
          }}
        />
      )}
      {headerRemoteOpen && (headerRemoteProtocol === 'ssh' || headerRemoteProtocol === 'cmd' || headerRemoteProtocol === 'powershell') && (
        <SshTerminalModal
          session={headerRemoteSession}
          deviceName={device.displayName || device.hostname}
          onClose={() => { setHeaderRemoteOpen(false); setHeaderRemoteSession(null); }}
        />
      )}
      {/* Chat session picker (RDS) */}
      {chatSessionPickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-bg-secondary border border-border rounded-xl shadow-2xl w-full max-w-sm mx-4">
            <div className="px-5 py-4 border-b border-border">
              <h3 className="text-sm font-semibold text-text-primary">Select session to chat with</h3>
              <p className="text-xs text-text-muted mt-1">Choose which user session to open the chat in.</p>
            </div>
            <div className="p-3 space-y-1 max-h-60 overflow-y-auto">
              {headerOrSessions.map((s) => (
                <button key={s.id} onClick={() => {
                  setChatSessionId(s.id);
                  setChatSessionPickerOpen(false);
                  setChatOpen(true);
                }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-bg-tertiary transition-colors text-left">
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
            <div className="px-5 py-3 border-t border-border flex justify-end">
              <button onClick={() => setChatSessionPickerOpen(false)}
                className="px-4 py-1.5 text-xs bg-bg-tertiary text-text-muted rounded-lg hover:text-text-primary">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Chat panel — slides in from the right */}
      {chatOpen && (
        <div className="fixed right-0 top-0 bottom-0 z-[60] shadow-2xl">
          <ChatPanel
            deviceUuid={device.uuid}
            sessionId={chatSessionId}
            operatorName={useAuthStore.getState().user?.displayName || useAuthStore.getState().user?.username || 'Operator'}
            onClose={() => { setChatOpen(false); setChatId(null); setChatMessages([]); setChatSessionId(undefined); }}
            onRemoteAccessGranted={() => { handleHeaderRemote('oblireach'); }}
            messages={chatMessages}
            setMessages={setChatMessages}
            chatId={chatId}
            setChatId={setChatId}
            soundEnabled={chatSoundEnabled}
            personalQuickReplies={useAuthStore.getState().user?.preferences?.quickReplies || []}
            adminTemplates={quickReplyTemplates}
          />
        </div>
      )}
      {/* WTS Session picker — header remote button (RDS with multiple sessions) */}
      {headerOrSessionPickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-bg-secondary border border-border rounded-xl shadow-2xl w-full max-w-sm mx-4">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h2 className="text-sm font-semibold text-text-primary flex items-center gap-2">
                <MonitorPlay className="w-4 h-4 text-accent" />
                Choose Session
              </h2>
              <button
                onClick={() => setHeaderOrSessionPickerOpen(false)}
                className="text-text-muted hover:text-text-primary transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-3 space-y-1 max-h-72 overflow-y-auto">
              {headerOrSessions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => handleHeaderStartObliReachSession(s.id)}
                  className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-bg-tertiary transition-colors flex items-center gap-3"
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
          </div>
        </div>
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
            {device.privacyModeEnabled && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-orange-400/10 text-orange-400 border border-orange-400/30">
                <Shield className="w-3 h-3" />
                {t('privacy.badge')}
              </span>
            )}
          </div>
          <p className="text-sm text-text-muted mt-1">
            {device.osName} · {device.ipLocal ?? device.ipPublic ?? 'unknown IP'} · Agent v{device.agentVersion ?? '?'}
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
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {device.approvalStatus === 'pending' ? (
            /* ── Pending device: only show approve / refuse ── */
            isAdmin() && (
              <>
                <button
                  onClick={handleApproveDevice}
                  disabled={isApprovingDevice}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-green-500 hover:bg-green-400 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isApprovingDevice ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                  Approve
                </button>
                <button
                  onClick={handleRefuseDevice}
                  disabled={isRefusingDevice}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-500 hover:bg-red-400 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isRefusingDevice ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
                  Refuse
                </button>
              </>
            )
          ) : (
            /* ── Approved/suspended device: show all actions ── */
            <>
              {crossAppLinks.map(link => (
                <a
                  key={link.appType}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`Open in ${link.name}`}
                  className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium border transition-colors"
                  style={{ color: link.color ?? '#58a6ff', borderColor: `${link.color ?? '#58a6ff'}40`, backgroundColor: `${link.color ?? '#58a6ff'}0d` }}
                >
                  <ArrowLeftRight size={12} />
                  {link.name}
                </a>
              ))}
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
                {/* Chat — always next to Remote */}
                <button
                  onClick={() => {
                    if (chatOpen) {
                      setChatOpen(false);
                      return;
                    }
                    // If Reach is active, use the same session
                    if (headerRemoteOpen && headerRemoteSession) {
                      // The remote session's WTS ID might be in the session picker state
                      // Just open chat — the remote session's target is already set
                      setChatOpen(true);
                      return;
                    }
                    // If multiple WTS sessions available, show picker
                    if (headerOrSessions && headerOrSessions.length > 1) {
                      setChatSessionPickerOpen(true);
                    } else if (headerOrSessions && headerOrSessions.length === 1) {
                      setChatSessionId(headerOrSessions[0].id);
                      setChatOpen(true);
                    } else {
                      setChatOpen(true);
                    }
                  }}
                  disabled={device.status !== 'online'}
                  title="Chat with user"
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md text-blue-400 hover:bg-blue-400/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <MessageCircle className="w-3.5 h-3.5" />
                  Chat
                </button>
                {/* Remote */}
                {(() => {
                  const opts: Array<'oblireach' | 'ssh' | 'cmd' | 'powershell'> =
                    device.osType === 'windows' ? ['oblireach', 'cmd', 'powershell'] :
                    device.osType === 'macos'   ? ['oblireach', 'ssh'] :
                                                  ['oblireach', 'ssh'];
                  const label = (p: string) => p === 'powershell' ? 'PS' : p === 'oblireach' ? 'Reach' : p.toUpperCase();
                  return (
                    <div className="relative" ref={remoteDropdownRef}>
                      {opts.length === 1 ? (
                        <button
                          onClick={() => handleHeaderRemote(opts[0])}
                          disabled={isStartingRemote || headerRemoteOpen || device.status !== 'online' || device.privacyModeEnabled}
                          title={`${label(opts[0])} Remote`}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md text-green-400 hover:bg-green-400/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                          {isStartingRemote ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MonitorPlay className="w-3.5 h-3.5" />}
                          {label(opts[0])}
                        </button>
                      ) : (
                        <button
                          onClick={() => setRemoteDropdownOpen((o) => !o)}
                          disabled={isStartingRemote || headerRemoteOpen || device.status !== 'online' || device.privacyModeEnabled}
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
                          {opts.map((proto) => {
                            const isOr = proto === 'oblireach';
                            const orNotInstalled = isOr && headerOrInstalled === false;
                            return (
                              <button
                                key={proto}
                                onClick={() => handleHeaderRemote(proto)}
                                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-text-primary hover:bg-bg-tertiary transition-colors text-left"
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
                    <div className="w-px h-5 bg-border" />
                    <button
                      onClick={async () => {
                        setHeaderPending((p) => new Set(p).add('privacy'));
                        try {
                          await deviceApi.disablePrivacyMode(device.id);
                          toast.success(t('privacy.disableSent'));
                        } catch { toast.error(t('privacy.disableFailed')); }
                        finally { setHeaderPending((p) => { const n = new Set(p); n.delete('privacy'); return n; }); }
                      }}
                      disabled={headerPending.has('privacy')}
                      title={t('privacy.disableTitle')}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md text-orange-400 hover:bg-orange-400/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      {headerPending.has('privacy') ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldOff className="w-3.5 h-3.5" />}
                      {t('privacy.disable')}
                    </button>
                  </>
                )}
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
            </>
          )}

          <button
            onClick={() => fetchDevice(deviceId)}
            className="p-2 text-text-muted hover:text-text-primary hover:bg-bg-secondary rounded-lg transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── Pending uninstall banner ── */}
      {device.status === 'pending_uninstall' && (
        <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-xl border border-orange-500/40 bg-orange-500/10">
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
              className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-orange-500/50 text-orange-400 hover:bg-orange-500/20 transition-colors"
            >
              Cancel uninstall
            </button>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 rounded-lg bg-bg-secondary p-1 border border-border overflow-x-auto">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const privacyBlocked = device.privacyModeEnabled && ['scripts', 'remote', 'processes', 'files'].includes(tab.id);
          return (
            <button
              key={tab.id}
              onClick={() => !privacyBlocked && setActiveTab(tab.id)}
              disabled={privacyBlocked}
              title={privacyBlocked ? t('privacy.badge') : undefined}
              className={clsx(
                'flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md whitespace-nowrap transition-colors',
                privacyBlocked
                  ? 'text-text-muted/40 cursor-not-allowed'
                  : activeTab === tab.id
                    ? 'bg-accent text-white'
                    : 'text-text-muted hover:text-text-primary',
              )}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div>
        {activeTab === 'overview' && <OverviewTab device={device} />}
        {activeTab === 'inventory' && <InventoryTab deviceId={device.id} />}
        {activeTab === 'scripts' && <ScriptsTab deviceId={device.id} />}
        {activeTab === 'updates' && <UpdatesTab deviceId={device.id} />}
        {activeTab === 'compliance' && <ComplianceTab deviceId={device.id} />}
        {activeTab === 'remote' && <RemoteTab device={device} />}
        {activeTab === 'files' && <FileExplorerTab device={device} />}
        {activeTab === 'services' && <ServicesTab device={device} />}
        {activeTab === 'processes' && <ProcessesTab device={device} />}
        {activeTab === 'commands' && <CommandsTab deviceId={device.id} />}
        {activeTab === 'settings' && <DeviceSettingsTab device={device} onSaved={() => fetchDevice(deviceId)} adminMode={isAdmin()} onDeleted={() => navigate('/devices')} />}
      </div>
    </div>
  );
}
