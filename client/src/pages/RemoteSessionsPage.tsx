import { useEffect, useState, useCallback } from 'react';
import { Monitor, Play, StopCircle, RefreshCw, Clock, User, Wifi, Terminal, Search } from 'lucide-react';
import { remoteApi } from '@/api/remote.api';
import { useDeviceStore } from '@/store/deviceStore';
import type { RemoteSession, RemoteProtocol, RemoteSessionStatus } from '@obliance/shared';
import toast from 'react-hot-toast';
import { clsx } from 'clsx';

type Tab = 'active' | 'history';

const PROTOCOL_CONFIG: Record<RemoteProtocol, { label: string; color: string; description: string }> = {
  vnc: { label: 'VNC', color: 'text-blue-400 bg-blue-400/10 border-blue-400/30', description: 'Visual desktop control' },
  rdp: { label: 'RDP', color: 'text-purple-400 bg-purple-400/10 border-purple-400/30', description: 'Remote Desktop Protocol' },
  ssh: { label: 'SSH', color: 'text-green-400 bg-green-400/10 border-green-400/30', description: 'Secure Shell terminal' },
};

const STATUS_CONFIG: Record<RemoteSessionStatus, { label: string; color: string; pulse?: boolean }> = {
  waiting: { label: 'Waiting', color: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30', pulse: true },
  connecting: { label: 'Connecting', color: 'text-blue-400 bg-blue-400/10 border-blue-400/30', pulse: true },
  active: { label: 'Active', color: 'text-green-400 bg-green-400/10 border-green-400/30', pulse: true },
  closed: { label: 'Closed', color: 'text-gray-400 bg-gray-400/10 border-gray-400/30' },
  failed: { label: 'Failed', color: 'text-red-400 bg-red-400/10 border-red-400/30' },
  timeout: { label: 'Timed out', color: 'text-orange-400 bg-orange-400/10 border-orange-400/30' },
};

function formatDuration(seconds: number | null): string {
  if (!seconds) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 1) return `${s}s`;
  return `${m}m ${s}s`;
}

function formatDate(val: string | null): string {
  if (!val) return '—';
  return new Date(val).toLocaleString();
}

const ACTIVE_STATUSES: RemoteSessionStatus[] = ['waiting', 'connecting', 'active'];

export function RemoteSessionsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('active');
  const [activeSessions, setActiveSessions] = useState<RemoteSession[]>([]);
  const [historySessions, setHistorySessions] = useState<RemoteSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deviceSearch, setDeviceSearch] = useState('');
  const [selectedDeviceId, setSelectedDeviceId] = useState<number | null>(null);
  const [selectedProtocol, setSelectedProtocol] = useState<RemoteProtocol>('ssh');
  const [sessionNotes, setSessionNotes] = useState('');
  const [isStarting, setIsStarting] = useState(false);
  const [endingSessionId, setEndingSessionId] = useState<string | null>(null);

  const { getDeviceList, fetchDevices } = useDeviceStore();

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [activeData, historyData] = await Promise.all([
        remoteApi.listSessions({ status: 'active' }),
        remoteApi.listSessions({ page: 1 }),
      ]);
      // Separate by status
      const active = activeData.items.filter(s => ACTIVE_STATUSES.includes(s.status));
      setActiveSessions(active);
      setHistorySessions(historyData.items.filter(s => !ACTIVE_STATUSES.includes(s.status)));
    } catch {
      toast.error('Failed to load sessions');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { fetchDevices(); }, [fetchDevices]);

  const handleStartSession = async () => {
    if (!selectedDeviceId) {
      toast.error('Please select a device');
      return;
    }
    setIsStarting(true);
    try {
      await remoteApi.startSession(selectedDeviceId, selectedProtocol, sessionNotes || undefined);
      toast.success(`${PROTOCOL_CONFIG[selectedProtocol].label} session initiated`);
      setSelectedDeviceId(null);
      setSessionNotes('');
      setDeviceSearch('');
      await load();
      setActiveTab('active');
    } catch {
      toast.error('Failed to start session');
    } finally {
      setIsStarting(false);
    }
  };

  const handleEndSession = async (sessionId: string) => {
    if (!confirm('End this remote session?')) return;
    setEndingSessionId(sessionId);
    try {
      await remoteApi.endSession(sessionId);
      toast.success('Session ended');
      await load();
    } catch {
      toast.error('Failed to end session');
    } finally {
      setEndingSessionId(null);
    }
  };

  const allDevices = getDeviceList();
  const filteredDevices = deviceSearch
    ? allDevices.filter(d => (d.displayName || d.hostname).toLowerCase().includes(deviceSearch.toLowerCase()) || d.ipLocal?.includes(deviceSearch))
    : allDevices;

  const selectedDevice = selectedDeviceId ? allDevices.find(d => d.id === selectedDeviceId) : null;

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Remote Sessions</h1>
          <p className="text-sm text-text-muted mt-0.5">Access devices remotely via VNC, RDP, or SSH</p>
        </div>
        <button onClick={load} className="p-2 text-text-muted hover:text-text-primary hover:bg-bg-secondary rounded-lg transition-colors">
          <RefreshCw className={clsx('w-4 h-4', isLoading && 'animate-spin')} />
        </button>
      </div>

      {/* New session panel */}
      <div className="bg-bg-secondary border border-border rounded-xl p-5 space-y-4">
        <h2 className="text-base font-semibold text-text-primary">Start New Session</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Device selector */}
          <div className="md:col-span-2 space-y-2">
            <label className="text-xs font-medium text-text-muted uppercase">Device</label>
            {selectedDevice ? (
              <div className="flex items-center gap-3 p-3 bg-bg-tertiary border border-accent/30 rounded-lg">
                <Monitor className="w-4 h-4 text-accent shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text-primary truncate">{selectedDevice.displayName || selectedDevice.hostname}</p>
                  <p className="text-xs text-text-muted">{selectedDevice.osName} · {selectedDevice.ipLocal ?? selectedDevice.ipPublic ?? 'unknown'}</p>
                </div>
                <button
                  onClick={() => { setSelectedDeviceId(null); setDeviceSearch(''); }}
                  className="text-xs text-text-muted hover:text-text-primary transition-colors"
                >
                  Change
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
                  <input
                    value={deviceSearch}
                    onChange={(e) => setDeviceSearch(e.target.value)}
                    placeholder="Search devices..."
                    className="w-full pl-8 pr-3 py-2 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
                  />
                </div>
                {deviceSearch && (
                  <div className="max-h-48 overflow-y-auto bg-bg-tertiary border border-border rounded-lg divide-y divide-border">
                    {filteredDevices.length === 0 ? (
                      <p className="px-3 py-2 text-sm text-text-muted">No devices found</p>
                    ) : (
                      filteredDevices.slice(0, 10).map((device) => (
                        <button
                          key={device.id}
                          onClick={() => { setSelectedDeviceId(device.id); setDeviceSearch(''); }}
                          className="w-full flex items-center gap-3 px-3 py-2 hover:bg-bg-secondary transition-colors text-left"
                        >
                          <Monitor className="w-4 h-4 text-text-muted shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-text-primary truncate">{device.displayName || device.hostname}</p>
                            <p className="text-xs text-text-muted truncate">{device.osName} · {device.ipLocal ?? device.ipPublic ?? 'unknown'}</p>
                          </div>
                          <span className={clsx('text-xs px-1.5 py-0.5 rounded-full border shrink-0', device.status === 'online' ? 'text-green-400 bg-green-400/10 border-green-400/30' : 'text-gray-400 bg-gray-400/10 border-gray-400/30')}>
                            {device.status}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Protocol selector */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-text-muted uppercase">Protocol</label>
            <div className="space-y-2">
              {(Object.entries(PROTOCOL_CONFIG) as [RemoteProtocol, typeof PROTOCOL_CONFIG[RemoteProtocol]][]).map(([proto, cfg]) => (
                <button
                  key={proto}
                  onClick={() => setSelectedProtocol(proto)}
                  className={clsx(
                    'w-full flex items-center gap-3 p-2.5 rounded-lg border transition-colors text-left',
                    selectedProtocol === proto ? 'border-accent bg-accent/10' : 'border-border hover:border-accent/50',
                  )}
                >
                  {proto === 'ssh' ? <Terminal className={clsx('w-4 h-4', cfg.color.split(' ')[0])} /> : <Monitor className={clsx('w-4 h-4', cfg.color.split(' ')[0])} />}
                  <div>
                    <p className="text-sm font-medium text-text-primary">{cfg.label}</p>
                    <p className="text-xs text-text-muted">{cfg.description}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Notes */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-text-muted uppercase">Notes (optional)</label>
          <input
            value={sessionNotes}
            onChange={(e) => setSessionNotes(e.target.value)}
            placeholder="Reason for access, incident number..."
            className="w-full px-3 py-2 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
          />
        </div>

        <button
          onClick={handleStartSession}
          disabled={!selectedDeviceId || isStarting}
          className="flex items-center gap-2 px-5 py-2.5 bg-accent text-white rounded-lg hover:bg-accent/80 disabled:opacity-50 transition-colors text-sm font-medium"
        >
          <Play className="w-4 h-4" />
          {isStarting ? 'Starting...' : `Start ${PROTOCOL_CONFIG[selectedProtocol].label} Session`}
        </button>
      </div>

      {/* Tabs */}
      <div className="border-b border-border">
        <nav className="-mb-px flex gap-1">
          {(['active', 'history'] as Tab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={clsx(
                'px-4 py-2.5 text-sm font-medium border-b-2 capitalize transition-colors flex items-center gap-2',
                activeTab === tab ? 'border-accent text-accent' : 'border-transparent text-text-muted hover:text-text-primary hover:border-border',
              )}
            >
              {tab === 'active' ? 'Active Sessions' : 'History'}
              {tab === 'active' && activeSessions.length > 0 && (
                <span className="text-xs px-1.5 py-0.5 bg-accent/20 text-accent rounded-full">{activeSessions.length}</span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-48">
          <RefreshCw className="w-5 h-5 animate-spin text-text-muted" />
        </div>
      ) : activeTab === 'active' ? (
        <div className="space-y-3">
          {activeSessions.length === 0 ? (
            <div className="p-12 text-center text-text-muted bg-bg-secondary border border-border rounded-xl">
              <Wifi className="w-10 h-10 mx-auto mb-3 opacity-50" />
              <p className="font-medium text-text-primary mb-1">No active sessions</p>
              <p className="text-sm">Start a new session to connect to a device.</p>
            </div>
          ) : (
            activeSessions.map((session) => {
              const statusCfg = STATUS_CONFIG[session.status];
              const protoCfg = PROTOCOL_CONFIG[session.protocol];
              const device = session.device;
              return (
                <div key={session.id} className="bg-bg-secondary border border-border rounded-xl p-4">
                  <div className="flex items-start gap-4">
                    <div className={clsx('p-2.5 rounded-lg shrink-0', protoCfg.color.split(' ')[1], protoCfg.color.split(' ')[2])}>
                      {session.protocol === 'ssh' ? <Terminal className={clsx('w-5 h-5', protoCfg.color.split(' ')[0])} /> : <Monitor className={clsx('w-5 h-5', protoCfg.color.split(' ')[0])} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-text-primary">
                          {device ? (device.displayName || device.hostname) : `Device #${session.deviceId}`}
                        </span>
                        <span className={clsx('text-xs px-2 py-0.5 rounded-full border font-medium flex items-center gap-1', statusCfg.color)}>
                          {statusCfg.pulse && <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />}
                          {statusCfg.label}
                        </span>
                        <span className={clsx('text-xs px-2 py-0.5 rounded-full border', protoCfg.color)}>
                          {protoCfg.label}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-xs text-text-muted">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          Started {formatDate(session.startedAt)}
                        </span>
                        {session.startedByUser && (
                          <span className="flex items-center gap-1">
                            <User className="w-3 h-3" />
                            {session.startedByUser.displayName || session.startedByUser.username}
                          </span>
                        )}
                        {session.connectedAt && (
                          <span className="text-green-400">Connected {formatDate(session.connectedAt)}</span>
                        )}
                      </div>
                      {session.notes && (
                        <p className="text-xs text-text-muted mt-1 italic">{session.notes}</p>
                      )}
                    </div>
                    <button
                      onClick={() => handleEndSession(session.id)}
                      disabled={endingSessionId === session.id}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg hover:bg-red-500/20 disabled:opacity-50 transition-colors shrink-0"
                    >
                      <StopCircle className="w-3.5 h-3.5" />
                      {endingSessionId === session.id ? 'Ending...' : 'End'}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {historySessions.length === 0 ? (
            <div className="p-12 text-center text-text-muted bg-bg-secondary border border-border rounded-xl">
              <Clock className="w-10 h-10 mx-auto mb-3 opacity-50" />
              <p className="font-medium text-text-primary mb-1">No session history</p>
              <p className="text-sm">Completed sessions will appear here.</p>
            </div>
          ) : (
            <div className="bg-bg-secondary border border-border rounded-xl overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-bg-tertiary/50">
                    <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase">Device</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase">Protocol</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase hidden md:table-cell">User</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase hidden lg:table-cell">Started</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase hidden lg:table-cell">Duration</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {historySessions.map((session) => {
                    const statusCfg = STATUS_CONFIG[session.status];
                    const protoCfg = PROTOCOL_CONFIG[session.protocol];
                    return (
                      <tr key={session.id} className="hover:bg-bg-tertiary transition-colors">
                        <td className="px-4 py-3">
                          <p className="text-sm text-text-primary">
                            {session.device ? (session.device.displayName || session.device.hostname) : `Device #${session.deviceId}`}
                          </p>
                          {session.notes && <p className="text-xs text-text-muted truncate max-w-xs">{session.notes}</p>}
                        </td>
                        <td className="px-4 py-3">
                          <span className={clsx('text-xs px-2 py-0.5 rounded-full border font-medium', protoCfg.color)}>
                            {protoCfg.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell">
                          <span className="text-xs text-text-muted">
                            {session.startedByUser ? (session.startedByUser.displayName || session.startedByUser.username) : '—'}
                          </span>
                        </td>
                        <td className="px-4 py-3 hidden lg:table-cell">
                          <span className="text-xs text-text-muted">{formatDate(session.startedAt)}</span>
                        </td>
                        <td className="px-4 py-3 hidden lg:table-cell">
                          <span className="text-xs text-text-muted">{formatDuration(session.durationSeconds)}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={clsx('text-xs px-2 py-0.5 rounded-full border font-medium', statusCfg.color)}>
                            {statusCfg.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
