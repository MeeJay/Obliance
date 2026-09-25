import { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Monitor, Play, StopCircle, RefreshCw, Clock, User, Wifi, Terminal, Search, ExternalLink } from 'lucide-react';
import { remoteApi } from '@/api/remote.api';
import { useDeviceStore } from '@/store/deviceStore';
import { useAuthStore } from '@/store/authStore';
import type { RemoteSession, RemoteProtocol, RemoteSessionStatus, OsType } from '@obliance/shared';
import { ObliReachViewer } from '@/components/ObliReachViewer';
import { TenantBadge } from '@/components/common/TenantBadge';
import { PageContainer } from '@/components/common/PageContainer';
import { SegmentedTabs } from '@/components/common/SegmentedTabs';
import { TableScroll } from '@/components/common/TableScroll';
import { useConfirm } from '@/components/common/ConfirmDialog';
import { getSocket } from '@/socket/socketClient';
import { anonymize } from '@/utils/anonymize';
import { canAttachRemoteSession, remoteStartErrorMessage, requireSessionToken } from '@/utils/remoteSession';
import toast from 'react-hot-toast';
import { clsx } from 'clsx';

type Tab = 'active' | 'history';

// `description` is the English fallback of remoteSessions.protocol.<id>.
const PROTOCOL_CONFIG: Record<RemoteProtocol, { label: string; color: string; description: string }> = {
 oblireach: { label: 'Oblireach', color: 'text-sky-400 bg-sky-400/10 border-sky-400/30', description: 'Native screen streaming (recommended)' },
 rdp: { label: 'RDP', color: 'text-rose-400 bg-rose-400/10 border-rose-400/30', description: 'Remote Desktop Protocol (Windows)' },
 ssh: { label: 'SSH', color: 'text-green-400 bg-green-400/10 border-green-400/30', description: 'Secure Shell terminal' },
 cmd: { label: 'CMD', color: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30', description: 'Windows Command Prompt' },
 powershell: { label: 'PowerShell', color: 'text-cyan-400 bg-cyan-400/10 border-cyan-400/30', description: 'Windows PowerShell terminal' },
 vmconsole: { label: 'VM Console', color: 'text-violet-400 bg-violet-400/10 border-violet-400/30', description: 'Hyper-V VM interactive console (FreeRDP)' },
 sshjump: { label: 'SSH ProxyJump', color: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30', description: 'Native SSH through the Obliance bastion' },
};

// `label` is the English fallback of remoteSessions.status.<id>.
const STATUS_CONFIG: Record<RemoteSessionStatus, { label: string; color: string; pulse?: boolean }> = {
 waiting: { label: 'Waiting', color: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30', pulse: true },
 connecting: { label: 'Connecting', color: 'text-blue-400 bg-blue-400/10 border-blue-400/30', pulse: true },
 active: { label: 'Active', color: 'text-green-400 bg-green-400/10 border-green-400/30', pulse: true },
 closed: { label: 'Closed', color: 'text-gray-400 bg-gray-400/10 border-gray-400/30' },
 failed: { label: 'Failed', color: 'text-red-400 bg-red-400/10 border-red-400/30' },
 timeout: { label: 'Timed out', color: 'text-orange-400 bg-orange-400/10 border-orange-400/30' },
 expired: { label: 'Expired', color: 'text-gray-400 bg-gray-400/10 border-gray-400/30' },
};

type ShellProto = 'ssh' | 'cmd' | 'powershell';
const isShellProtocol = (p: RemoteProtocol): p is ShellProto => p === 'ssh' || p === 'cmd' || p === 'powershell';

// Protocols this page can actually open in the browser (every screen size):
// Oblireach → the built-in viewer, shells → the global terminal panel. RDP has
// no web client, the VM console needs a VM (Hyper-V tab of the device) and
// ProxyJump sessions are opened by the SSH bastion only.
function launchableProtocols(osType: OsType | undefined): RemoteProtocol[] {
 switch (osType) {
 case 'windows': return ['oblireach', 'cmd', 'powershell'];
 case 'macos': return ['oblireach', 'ssh'];
 case 'linux': return ['ssh'];
 case 'freebsd':
 case 'other': return ['ssh'];
 default: return ['oblireach', 'ssh', 'cmd', 'powershell'];
 }
}

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

// 40 px targets on touch screens (desktop sizes unchanged).
const TB = 'coarse:min-h-10';

export function RemoteSessionsPage({ embedded }: { embedded?: boolean } = {}) {
 const { t } = useTranslation();
 const confirm = useConfirm();
 // Only the user who started a session holds its relay token (the server
 // strips it for everyone else and the tunnel refuses them): "View" is
 // offered on the current user's own sessions only.
 const currentUserId = useAuthStore((s) => s.user?.id);
 const [activeTab, setActiveTab] = useState<Tab>('active');
 const [activeSessions, setActiveSessions] = useState<RemoteSession[]>([]);
 const [historySessions, setHistorySessions] = useState<RemoteSession[]>([]);
 const [isLoading, setIsLoading] = useState(true);
 const [deviceSearch, setDeviceSearch] = useState('');
 const [selectedDeviceId, setSelectedDeviceId] = useState<number | null>(null);
 const [selectedProtocol, setSelectedProtocol] = useState<RemoteProtocol>('oblireach');
 const [sessionNotes, setSessionNotes] = useState('');
 const [isStarting, setIsStarting] = useState(false);
 const [endingSessionId, setEndingSessionId] = useState<string | null>(null);

 // Viewer modal state (Oblireach)
 const [orSession, setOrSession] = useState<RemoteSession | null>(null);
 const pendingOrId = useRef<string | null>(null);

 const { getDeviceList, fetchDevices } = useDeviceStore();

 const protoLabel = (p: RemoteProtocol) => PROTOCOL_CONFIG[p].label;
 const protoDescription = (p: RemoteProtocol) => t(`remoteSessions.protocol.${p}`, PROTOCOL_CONFIG[p].description);
 const statusLabel = (s: RemoteSessionStatus) => t(`remoteSessions.status.${s}`, STATUS_CONFIG[s].label);

 const load = useCallback(async () => {
 setIsLoading(true);
 try {
 const [activeData, historyData] = await Promise.all([
 remoteApi.listSessions({ status: 'active' }),
 remoteApi.listSessions({ page: 1 }),
 ]);
 const active = activeData.items.filter(s => ACTIVE_STATUSES.includes(s.status));
 setActiveSessions(active);
 setHistorySessions(historyData.items.filter(s => !ACTIVE_STATUSES.includes(s.status)));
 } catch {
 toast.error(t('remoteSessions.loadFailed', 'Failed to load sessions'));
 } finally {
 setIsLoading(false);
 }
 }, [t]);

 useEffect(() => { load(); }, [load]);
 useEffect(() => { fetchDevices(); }, [fetchDevices]);

 // Real-time updates — refresh session list and update orSession if agent connected
 useEffect(() => {
 const socket = getSocket();
 if (!socket) return;
 const onUpdated = (s: RemoteSession) => {
 setActiveSessions((prev) => {
 const exists = prev.find((x) => x.id === s.id);
 if (exists) return prev.map((x) => x.id === s.id ? s : x);
 return prev;
 });
 if (orSession?.id === s.id) setOrSession(s);
 };
 const onReady = (s: RemoteSession) => {
 setActiveSessions((prev) => prev.map((x) => x.id === s.id ? s : x));
 if (s.id === pendingOrId.current) {
 setOrSession(s);
 pendingOrId.current = null;
 }
 };
 socket.on('REMOTE_SESSION_UPDATED', onUpdated);
 socket.on('REMOTE_TUNNEL_READY', onReady);
 return () => {
 socket.off('REMOTE_SESSION_UPDATED', onUpdated);
 socket.off('REMOTE_TUNNEL_READY', onReady);
 };
 }, [orSession]);

 const allDevices = getDeviceList();
 const filteredDevices = deviceSearch
 ? allDevices.filter(d => (d.displayName || d.hostname).toLowerCase().includes(deviceSearch.toLowerCase()) || d.ipLocal?.includes(deviceSearch))
 : allDevices;

 const selectedDevice = selectedDeviceId ? allDevices.find(d => d.id === selectedDeviceId) : null;
 const availableProtocols = launchableProtocols(selectedDevice?.osType);

 // Keep the selected protocol within what the selected device supports.
 useEffect(() => {
 if (!availableProtocols.includes(selectedProtocol)) setSelectedProtocol(availableProtocols[0]);
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [selectedDevice?.osType]);

 const deviceLabel = (deviceId: number | undefined, embeddedDevice?: { displayName?: string | null; hostname?: string } | null) => {
 const d = embeddedDevice ?? (deviceId != null ? allDevices.find((x) => x.id === deviceId) : undefined);
 const name = d ? anonymize(d.displayName || d.hostname) : '';
 return name || t('remoteSessions.deviceN', 'Device #{{id}}', { id: deviceId ?? '?' });
 };

 // Shells open in the global terminal panel (same flow as the device page):
 // the tab is added once the agent's tunnel is ready.
 const openShellPanel = async (session: RemoteSession, protocol: ShellProto, deviceId: number) => {
 requireSessionToken(session);
 const { useRemoteShellStore } = await import('@/store/remoteShellStore');
 const add = () => useRemoteShellStore.getState().addSession({
 id: session.sessionToken,
 deviceId,
 deviceName: deviceLabel(deviceId),
 protocol,
 sessionToken: session.sessionToken,
 serverSessionId: session.id,
 });
 const socket = getSocket();
 if (!socket) { add(); return; }
 const onReady = (s: RemoteSession) => {
 if (s.id !== session.id) return;
 socket.off('REMOTE_TUNNEL_READY', onReady);
 add();
 };
 socket.on('REMOTE_TUNNEL_READY', onReady);
 setTimeout(() => {
 socket.off('REMOTE_TUNNEL_READY', onReady);
 const already = useRemoteShellStore.getState().sessions.find((x) => x.id === session.sessionToken);
 if (!already) add();
 }, 1500);
 };

 const handleStartSession = async () => {
 if (!selectedDeviceId) {
 toast.error(t('remoteSessions.selectDevice', 'Please select a device'));
 return;
 }
 const protocol = selectedProtocol;
 setIsStarting(true);
 // Open Oblireach viewer immediately so it's ready when the agent connects
 if (protocol === 'oblireach') {
 setOrSession({ sessionToken: '', deviceId: selectedDeviceId } as any); // placeholder — viewer shows "waiting"
 }
 let startedId: string | null = null;
 try {
 const session = await remoteApi.startSession(selectedDeviceId, protocol, sessionNotes || undefined);
 startedId = session.id;
 if (protocol === 'oblireach') {
 requireSessionToken(session);
 pendingOrId.current = session.id;
 setOrSession(session); // replace placeholder with real session
 } else if (isShellProtocol(protocol)) {
 await openShellPanel(session, protocol, selectedDeviceId);
 } else {
 toast.success(t('remoteSessions.initiated', '{{protocol}} session initiated — waiting for agent…', { protocol: protoLabel(protocol) }));
 }
 setActiveTab('active');
 setSelectedDeviceId(null);
 setSessionNotes('');
 setDeviceSearch('');
 await load();
 } catch (err) {
 // A session created without a usable token is ended right away.
 if (startedId) remoteApi.endSession(startedId).catch(() => {});
 const msg = remoteStartErrorMessage(err, t, t('remoteSessions.startFailed', 'Failed to start session'), protocol);
 if (msg) toast.error(msg);
 if (protocol === 'oblireach') setOrSession(null);
 } finally {
 setIsStarting(false);
 }
 };

 const handleEndSession = async (sessionId: string) => {
 const ok = await confirm({
 message: t('remoteSessions.endConfirm', 'End this remote session?'),
 confirmLabel: t('remoteSessions.end', 'End'),
 danger: true,
 });
 if (!ok) return;
 setEndingSessionId(sessionId);
 try {
 await remoteApi.endSession(sessionId);
 toast.success(t('remoteSessions.ended', 'Session ended'));
 await load();
 } catch {
 toast.error(t('remoteSessions.endFailed', 'Failed to end session'));
 } finally {
 setEndingSessionId(null);
 }
 };

 const userName = (session: RemoteSession) => {
 const u = (session as any).startedByUser;
 return u ? (u.displayName || u.username) : null;
 };

 return (
 <>
 <PageContainer embedded={embedded} className="space-y-6">
 {!embedded && <div className="flex items-center justify-between gap-3">
 <div className="min-w-0">
 <h1 className="text-2xl font-bold text-text-primary">{t('remoteSessions.title', 'Remote Sessions')}</h1>
 <p className="text-sm text-text-muted mt-0.5">{t('remoteSessions.subtitle', 'Access devices remotely via Oblireach, RDP, or SSH')}</p>
 </div>
 <button
 onClick={load}
 aria-label={t('common.refresh', 'Refresh')}
 title={t('common.refresh', 'Refresh')}
 className="p-2 text-text-muted hover:text-text-primary hover:bg-bg-secondary rounded-lg transition-colors shrink-0 coarse:min-h-10 coarse:min-w-10 coarse:flex coarse:items-center coarse:justify-center"
 >
 <RefreshCw className={clsx('w-4 h-4', isLoading && 'animate-spin')} />
 </button>
 </div>}

 {/* New session panel */}
 <div className="bg-bg-secondary rounded-xl p-5 space-y-4 max-sm:p-4">
 <h2 className="text-base font-semibold text-text-primary">{t('remoteSessions.startNew', 'Start New Session')}</h2>
 <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
 {/* Device selector */}
 <div className="md:col-span-2 space-y-2">
 <label className="text-xs font-medium text-text-muted uppercase">{t('remoteSessions.device', 'Device')}</label>
 {selectedDevice ? (
 <div className="flex items-center gap-3 p-3 bg-bg-tertiary border border-accent/30 rounded-lg">
 <Monitor className="w-4 h-4 text-accent shrink-0" />
 <div className="flex-1 min-w-0">
 <p className="text-sm font-medium text-text-primary truncate">{selectedDevice.displayName || selectedDevice.hostname}</p>
 <p className="text-xs text-text-muted">{selectedDevice.osName} · {selectedDevice.ipLocal ?? selectedDevice.ipPublic ?? 'unknown'}</p>
 </div>
 <button
 onClick={() => { setSelectedDeviceId(null); setDeviceSearch(''); }}
 className="text-xs text-text-muted hover:text-text-primary transition-colors shrink-0 coarse:min-h-10 coarse:px-2"
 >
 {t('remoteSessions.change', 'Change')}
 </button>
 </div>
 ) : (
 <div className="space-y-2">
 <div className="relative">
 <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
 <input
 value={deviceSearch}
 onChange={(e) => setDeviceSearch(e.target.value)}
 placeholder={t('remoteSessions.searchDevices', 'Search devices...')}
 aria-label={t('remoteSessions.searchDevices', 'Search devices...')}
 autoCapitalize="off"
 autoCorrect="off"
 spellCheck={false}
 className="w-full pl-8 pr-3 py-2 text-sm bg-bg-tertiary rounded-lg text-text-primary focus:outline-none focus:border-accent"
 />
 </div>
 {deviceSearch && (
 <div className="max-h-48 overflow-y-auto overscroll-contain bg-bg-tertiary rounded-lg divide-y divide-border">
 {filteredDevices.length === 0 ? (
 <p className="px-3 py-2 text-sm text-text-muted">{t('remoteSessions.noDevices', 'No devices found')}</p>
 ) : (
 filteredDevices.slice(0, 10).map((device) => (
 <button
 key={device.id}
 onClick={() => { setSelectedDeviceId(device.id); setDeviceSearch(''); }}
 className="w-full flex items-center gap-3 px-3 py-2 hover:bg-bg-secondary transition-colors text-left coarse:py-3"
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

 {/* Protocol selector — only what can be opened from here */}
 <div className="space-y-2">
 <label className="text-xs font-medium text-text-muted uppercase">{t('remoteSessions.protocolLabel', 'Protocol')}</label>
 <div className="space-y-2">
 {availableProtocols.map((proto) => {
 const cfg = PROTOCOL_CONFIG[proto];
 return (
 <button
 key={proto}
 onClick={() => setSelectedProtocol(proto)}
 aria-pressed={selectedProtocol === proto}
 className={clsx(
 'w-full flex items-center gap-3 p-2.5 rounded-lg border transition-colors text-left',
 selectedProtocol === proto ? 'border-accent bg-accent/10' : 'border-transparent hover:border-accent/50',
 )}
 >
 {proto === 'ssh' ? <Terminal className={clsx('w-4 h-4 shrink-0', cfg.color.split(' ')[0])} /> : <Monitor className={clsx('w-4 h-4 shrink-0', cfg.color.split(' ')[0])} />}
 <div className="min-w-0">
 <p className="text-sm font-medium text-text-primary">{cfg.label}</p>
 <p className="text-xs text-text-muted">{protoDescription(proto)}</p>
 </div>
 </button>
 );
 })}
 </div>
 </div>
 </div>

 {/* Notes */}
 <div className="space-y-1">
 <label className="text-xs font-medium text-text-muted uppercase">{t('remoteSessions.notes', 'Notes (optional)')}</label>
 <input
 value={sessionNotes}
 onChange={(e) => setSessionNotes(e.target.value)}
 placeholder={t('remoteSessions.notesPlaceholder', 'Reason for access, incident number...')}
 aria-label={t('remoteSessions.notes', 'Notes (optional)')}
 className="w-full px-3 py-2 text-sm bg-bg-tertiary rounded-lg text-text-primary focus:outline-none focus:border-accent"
 />
 </div>

 <button
 onClick={handleStartSession}
 disabled={!selectedDeviceId || isStarting}
 className="flex items-center justify-center gap-2 px-5 py-2.5 bg-accent text-white rounded-lg hover:bg-accent/80 disabled:opacity-50 transition-colors text-sm font-medium max-sm:w-full"
 >
 <Play className="w-4 h-4" />
 {isStarting
 ? t('remoteSessions.starting', 'Starting...')
 : t('remoteSessions.startProtocol', 'Start {{protocol}} Session', { protocol: protoLabel(selectedProtocol) })}
 </button>
 </div>

 {/* Tabs */}
 <SegmentedTabs<Tab>
 tabs={[
 {
 id: 'active',
 label: t('remoteSessions.tabActive', 'Active Sessions'),
 badge: activeSessions.length > 0
 ? <span className="text-xs px-1.5 py-0.5 bg-white/20 text-white rounded-full">{activeSessions.length}</span>
 : undefined,
 },
 { id: 'history', label: t('remoteSessions.tabHistory', 'History') },
 ]}
 value={activeTab}
 onChange={setActiveTab}
 />

 {isLoading ? (
 <div className="flex items-center justify-center h-48">
 <RefreshCw className="w-5 h-5 animate-spin text-text-muted" />
 </div>
 ) : activeTab === 'active' ? (
 <div className="space-y-3">
 {activeSessions.length === 0 ? (
 <div className="p-12 text-center text-text-muted bg-bg-secondary rounded-xl max-sm:p-8">
 <Wifi className="w-10 h-10 mx-auto mb-3 opacity-50" />
 <p className="font-medium text-text-primary mb-1">{t('remoteSessions.noActive', 'No active sessions')}</p>
 <p className="text-sm">{t('remoteSessions.noActiveHint', 'Start a new session to connect to a device.')}</p>
 </div>
 ) : (
 activeSessions.map((session) => {
 const statusCfg = STATUS_CONFIG[session.status];
 const protoCfg = PROTOCOL_CONFIG[session.protocol];
 const device = (session as any).device;
 const user = userName(session);
 return (
 <div key={session.id} className="bg-bg-secondary rounded-xl p-4">
 {/* Phones: info on top, actions in a full-width row below. */}
 <div className="flex items-start gap-4 max-sm:flex-wrap max-sm:gap-3">
 <div className={clsx('p-2.5 rounded-lg shrink-0', protoCfg.color.split(' ')[1], protoCfg.color.split(' ')[2])}>
 {session.protocol === 'ssh' ? <Terminal className={clsx('w-5 h-5', protoCfg.color.split(' ')[0])} /> : <Monitor className={clsx('w-5 h-5', protoCfg.color.split(' ')[0])} />}
 </div>
 <div className="flex-1 min-w-0">
 <div className="flex items-center gap-2 flex-wrap">
 <span className="text-sm font-semibold text-text-primary break-words min-w-0">
 {deviceLabel(session.deviceId, device)}
 </span>
 <span className={clsx('text-xs px-2 py-0.5 rounded-full border font-medium flex items-center gap-1', statusCfg.color)}>
 {statusCfg.pulse && <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />}
 {statusLabel(session.status)}
 </span>
 <span className={clsx('text-xs px-2 py-0.5 rounded-full border', protoCfg.color)}>
 {protoCfg.label}
 </span>
 {device && <TenantBadge tenantId={device.tenantId} tenantName={device.tenantName} />}
 </div>
 <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-xs text-text-muted">
 <span className="flex items-center gap-1">
 <Clock className="w-3 h-3" />
 {t('remoteSessions.startedAt', 'Started {{date}}', { date: formatDate(session.startedAt) })}
 </span>
 {user && (
 <span className="flex items-center gap-1">
 <User className="w-3 h-3" />
 {user}
 </span>
 )}
 {session.connectedAt && (
 <span className="text-green-400">{t('remoteSessions.agentConnectedAt', 'Agent connected {{date}}', { date: formatDate(session.connectedAt) })}</span>
 )}
 </div>
 {(session as any).notes && (
 <p className="text-xs text-text-muted mt-1 italic break-words">{(session as any).notes}</p>
 )}
 </div>

 {/* Action buttons */}
 <div className="flex items-center gap-2 shrink-0 max-sm:basis-full max-sm:[&>button]:flex-1">
 {session.status === 'active' && session.protocol === 'oblireach' && canAttachRemoteSession(session, currentUserId) && (
 <button
 onClick={() => setOrSession(session)}
 className={clsx('flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm bg-sky-500/10 text-sky-400 border border-sky-500/20 rounded-lg hover:bg-sky-500/20 transition-colors', TB)}
 >
 <ExternalLink className="w-3.5 h-3.5" />
 {t('remoteSessions.view', 'View')}
 </button>
 )}
 {/* End session */}
 <button
 onClick={() => handleEndSession(session.id)}
 disabled={endingSessionId === session.id}
 className={clsx('flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg hover:bg-red-500/20 disabled:opacity-50 transition-colors', TB)}
 >
 <StopCircle className="w-3.5 h-3.5" />
 {endingSessionId === session.id ? t('remoteSessions.ending', 'Ending...') : t('remoteSessions.end', 'End')}
 </button>
 </div>
 </div>
 </div>
 );
 })
 )}
 </div>
 ) : (
 <div className="space-y-2">
 {historySessions.length === 0 ? (
 <div className="p-12 text-center text-text-muted bg-bg-secondary rounded-xl max-sm:p-8">
 <Clock className="w-10 h-10 mx-auto mb-3 opacity-50" />
 <p className="font-medium text-text-primary mb-1">{t('remoteSessions.noHistory', 'No session history')}</p>
 <p className="text-sm">{t('remoteSessions.noHistoryHint', 'Completed sessions will appear here.')}</p>
 </div>
 ) : (
 <TableScroll className="bg-bg-secondary rounded-xl">
 <table className="w-full">
 <thead>
 <tr className=" bg-bg-tertiary/50">
 <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase max-sm:px-3">{t('remoteSessions.device', 'Device')}</th>
 <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase max-sm:px-3">{t('remoteSessions.protocolLabel', 'Protocol')}</th>
 <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase hidden md:table-cell">{t('remoteSessions.user', 'User')}</th>
 <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase hidden lg:table-cell">{t('remoteSessions.started', 'Started')}</th>
 <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase hidden lg:table-cell">{t('remoteSessions.duration', 'Duration')}</th>
 <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase max-sm:px-3">{t('remoteSessions.statusLabel', 'Status')}</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-border">
 {historySessions.map((session) => {
 const statusCfg = STATUS_CONFIG[session.status];
 const protoCfg = PROTOCOL_CONFIG[session.protocol];
 const user = userName(session);
 return (
 <tr key={session.id} className="hover:bg-bg-tertiary transition-colors">
 <td className="px-4 py-3 max-sm:px-3">
 <p className="text-sm text-text-primary">
 {deviceLabel(session.deviceId, (session as any).device)}
 </p>
 {(session as any).notes && <p className="text-xs text-text-muted truncate max-w-xs">{(session as any).notes}</p>}
 {/* Below lg the Started / Duration (and User below md)
 columns are hidden: show them here instead. */}
 <p className="lg:hidden mt-0.5 text-xs text-text-muted">
 {formatDate(session.startedAt)} · {formatDuration(session.durationSeconds)}
 {user && <span className="md:hidden"> · {user}</span>}
 </p>
 </td>
 <td className="px-4 py-3 max-sm:px-3">
 <span className={clsx('text-xs px-2 py-0.5 rounded-full border font-medium whitespace-nowrap', protoCfg.color)}>
 {protoCfg.label}
 </span>
 </td>
 <td className="px-4 py-3 hidden md:table-cell">
 <span className="text-xs text-text-muted">
 {user ?? '—'}
 </span>
 </td>
 <td className="px-4 py-3 hidden lg:table-cell">
 <span className="text-xs text-text-muted">{formatDate(session.startedAt)}</span>
 </td>
 <td className="px-4 py-3 hidden lg:table-cell">
 <span className="text-xs text-text-muted">{formatDuration(session.durationSeconds)}</span>
 </td>
 <td className="px-4 py-3 max-sm:px-3">
 <span className={clsx('text-xs px-2 py-0.5 rounded-full border font-medium whitespace-nowrap', statusCfg.color)}>
 {statusLabel(session.status)}
 </span>
 </td>
 </tr>
 );
 })}
 </tbody>
 </table>
 </TableScroll>
 )}
 </div>
 )}
 </PageContainer>

 {/* Oblireach native viewer */}
 {orSession && (
 <ObliReachViewer
 sessionToken={orSession.sessionToken}
 deviceName={deviceLabel(orSession.deviceId, (orSession as any).device)}
 preferredCodec={useAuthStore.getState().user?.preferences?.preferredCodec}
 onClose={async () => {
 // End the session server-side when the viewer closes
 try { if (orSession.id) await remoteApi.endSession(orSession.id); } catch {}
 setOrSession(null);
 load();
 }}
 onReconnect={async () => {
 // Recreate a session on the same device after an unexpected
 // WS close (Winlogon→user-session transition after CAD login).
 // Throwing (no token) stops the viewer's reconnect loop.
 const s = await remoteApi.startSession(orSession.deviceId, 'oblireach', undefined);
 try {
 requireSessionToken(s);
 } catch (err) {
 remoteApi.endSession(s.id).catch(() => {});
 throw err;
 }
 setOrSession(s);
 }}
 />
 )}
 </>
 );
}
