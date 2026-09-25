import 'xterm/css/xterm.css';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import {
 Terminal as TerminalIcon, X, Maximize2, Minus, Plus,
 AlertTriangle, Keyboard, Copy, Radio, RotateCcw, Ungroup, Columns2,
} from 'lucide-react';
import { clsx } from 'clsx';
import { VirtualKeyPanel } from '@/components/VirtualKeyPanel';
import { ActionMenu, type ActionMenuItem } from '@/components/common/ActionMenu';
import { useRemoteShellStore, type ShellSession, type ShellProtocol } from '@/store/remoteShellStore';
import { remoteApi } from '@/api/remote.api';
import { deviceApi } from '@/api/device.api';
import { getSocket } from '@/socket/socketClient';
import { useNativeTopOffset } from '@/hooks/useNativeTopOffset';
import { useNativeBack } from '@/hooks/useNativeBack';
import { useCanHover, useIsCoarsePointer, useLayoutMode } from '@/hooks/useMediaQuery';
import { isAndroidApp, isTouchDevice } from '@/native/bridge';
import { copyText } from '@/utils/clipboard';
import { remoteStartErrorMessage, requireSessionToken } from '@/utils/remoteSession';
import type { Device } from '@obliance/shared';
import { isAgentReachable } from '@/utils/deviceStatus';
import toast from 'react-hot-toast';

// Per-session runtime state held in refs (xterm, ws, fit) — zustand can't
// store class instances cleanly so we keep them out-of-band keyed by session id.
interface Runtime {
 term: XTerm;
 fit: FitAddon;
 ws: WebSocket | null;
 /** DOM element the terminal is currently attached to (null before first attach) */
 attachedTo: HTMLElement | null;
 /** Whether term.open() has been called once already. After that we move
 * the terminal's own DOM element instead of re-opening. */
 opened: boolean;
}

const PROTOCOL_LABEL: Record<ShellProtocol, string> = {
 ssh: 'SSH',
 cmd: 'CMD',
 powershell: 'PowerShell',
};

/** 40 px touch target on coarse pointers (desktop size unchanged). */
const TOUCH_BTN = 'coarse:min-h-10 coarse:min-w-10 coarse:inline-flex coarse:items-center coarse:justify-center';

function buildWsUrl(sessionToken: string): string {
 const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
 return `${proto}//${window.location.host}/api/remote/tunnel/${sessionToken}`;
}

function sendResize(ws: WebSocket, cols: number, rows: number) {
 try { ws.send(JSON.stringify({ type: 'resize', cols, rows })); } catch {}
}

export function GlobalShellPanel() {
 const { t } = useTranslation();
 const { sessions, activeId, isOpen, groupedIds } = useRemoteShellStore();
 const removeSession = useRemoteShellStore((s) => s.removeSession);
 const setActive = useRemoteShellStore((s) => s.setActive);
 const setOpen = useRemoteShellStore((s) => s.setOpen);
 const setStatus = useRemoteShellStore((s) => s.setStatus);
 const addSession = useRemoteShellStore((s) => s.addSession);
 const toggleGrouped = useRemoteShellStore((s) => s.toggleGrouped);

 // Device-aware presentation (docs/obli-mobile.md §4-§5): touch screens get
 // menus instead of drag-and-drop / Ctrl+click, phones a compact toolbar.
 const isPhone = useLayoutMode() === 'phone';
 const canHover = useCanHover();
 const coarse = useIsCoarsePointer();
 // The Fullscreen API is a no-op in the Android WebView (no custom view).
 const fullscreenSupported = typeof document !== 'undefined' && !!document.fullscreenEnabled && !isAndroidApp();

 // Devices for the picker. Fetched lazily when the modal opens (full
 // tenant fleet, not bound to whatever is cached in the deviceStore).
 const [pickerDevices, setPickerDevices] = useState<Device[]>([]);
 const [pickerLoading, setPickerLoading] = useState(false);

 // Single-view container (used when not in group mode)
 const containerRef = useRef<HTMLDivElement>(null);
 // Tile containers for grid mode: one <div> per grouped session
 const tileRefs = useRef<Map<string, HTMLDivElement>>(new Map());
 const runtimes = useRef<Map<string, Runtime>>(new Map());
 // Virtual keys (Esc, Tab, arrows, Ctrl combos, F-keys) are shown by default
 // on touch screens: a soft keyboard has none of them.
 const [showKeys, setShowKeys] = useState(() => isTouchDevice());
 const [pickerOpen, setPickerOpen] = useState(false);
 const [pickerSearch, setPickerSearch] = useState('');
 const [isFullscreen, setIsFullscreen] = useState(false);
 // Broadcast mode: when on, keystrokes typed in any grouped tile fan
 // out to every WS in the group. The flag is mirrored to a ref so the
 // xterm `onData` closure captured at runtime-construction time can
 // read the current value without being torn down/rebuilt every toggle.
 const [broadcast, setBroadcast] = useState(false);
 const broadcastRef = useRef(false);
 useEffect(() => { broadcastRef.current = broadcast; }, [broadcast]);
 // Drag-and-drop grouping — id of the tab currently being dragged and
 // the tab the pointer is hovering over. Both reset on drop/end.
 const [dragId, setDragId] = useState<string | null>(null);
 const [dragOverId, setDragOverId] = useState<string | null>(null);
 const nativeTop = useNativeTopOffset();

 // Android back: close the device picker first, then minimize the panel
 // (sessions stay alive). Escape is left to the terminal, except in the
 // picker where it closes the picker.
 useNativeBack(() => { setOpen(false); }, sessions.length > 0 && isOpen);
 useNativeBack(() => { setPickerOpen(false); }, pickerOpen, { escape: true });

 // Recently-used device ids for the "+" picker, persisted in localStorage.
 // We push a device id to the front whenever a shell is opened on it.
 const MRU_KEY = 'shellPanel:recentDeviceIds';
 const getRecent = (): number[] => {
 try {
 const raw = localStorage.getItem(MRU_KEY);
 return raw ? JSON.parse(raw) as number[] : [];
 } catch { return []; }
 };
 const pushRecent = (deviceId: number) => {
 try {
 const cur = getRecent().filter((id) => id !== deviceId);
 localStorage.setItem(MRU_KEY, JSON.stringify([deviceId, ...cur].slice(0, 50)));
 } catch {}
 };

 // Track fullscreen state via the browser event (F11 / Esc also trigger it)
 useEffect(() => {
 const onChange = () => setIsFullscreen(!!document.fullscreenElement);
 document.addEventListener('fullscreenchange', onChange);
 return () => document.removeEventListener('fullscreenchange', onChange);
 }, []);
 const toggleFullscreen = () => {
 if (document.fullscreenElement) {
 document.exitFullscreen?.();
 } else {
 document.documentElement.requestFullscreen?.();
 }
 };

 // Grid mode is active when the active tab belongs to a group of 2+.
 const isGroupMode = !!(activeId && groupedIds.includes(activeId) && groupedIds.length >= 2);
 const visibleIds: string[] = isGroupMode
 ? sessions.filter((s) => groupedIds.includes(s.id)).map((s) => s.id)
 : (activeId ? [activeId] : []);

 // ── Create runtime for a new session ────────────────────────────────────
 const ensureRuntime = useCallback((session: ShellSession) => {
 if (runtimes.current.has(session.id)) return runtimes.current.get(session.id)!;

 const term = new XTerm({
 theme: {
 background: '#0d0f14',
 foreground: '#e2e8f0',
 cursor: '#7c6af7',
 selectionBackground: '#7c6af730',
 },
 fontFamily: '"Cascadia Code", "Fira Code", "JetBrains Mono", monospace',
 fontSize: 16,
 cursorBlink: true,
 convertEol: true,
 });
 const fit = new FitAddon();
 term.loadAddon(fit);

 // Open the WebSocket tunnel
 const ws = new WebSocket(buildWsUrl(session.sessionToken));
 ws.binaryType = 'arraybuffer';

 ws.onopen = () => {
 setStatus(session.id, 'connected');
 try { sendResize(ws, term.cols, term.rows); } catch {}
 };
 ws.onmessage = (ev) => {
 if (typeof ev.data === 'string' && ev.data.startsWith('{')) return;
 const data = ev.data instanceof ArrayBuffer ? new Uint8Array(ev.data) : ev.data;
 term.write(data);
 };
 ws.onerror = () => setStatus(session.id, 'error', t('shell.wsFailed') || 'WebSocket connection failed');
 ws.onclose = (ev) => {
 if (ev.wasClean) setStatus(session.id, 'disconnected');
 else setStatus(session.id, 'error', t('shell.connectionLost') || 'Connection lost');
 };

 term.onData((data: string) => {
 const encoded = new TextEncoder().encode(data);
 // Broadcast mode — when active, every keystroke in any grouped
 // tile fans out to every other grouped session's WS. The check
 // happens at keystroke time so toggling the flag takes effect on
 // the next character without re-creating runtimes.
 const g = useRemoteShellStore.getState().groupedIds;
 if (broadcastRef.current && g.includes(session.id) && g.length >= 2) {
 for (const id of g) {
 const rt = runtimes.current.get(id);
 if (rt?.ws && rt.ws.readyState === WebSocket.OPEN) {
 rt.ws.send(encoded);
 }
 }
 return;
 }
 if (ws.readyState === WebSocket.OPEN) {
 ws.send(encoded);
 }
 });
 term.onResize(({ cols, rows }) => {
 if (ws.readyState === WebSocket.OPEN) sendResize(ws, cols, rows);
 });

 const rt: Runtime = { term, fit, ws, attachedTo: null, opened: false };
 runtimes.current.set(session.id, rt);
 return rt;
 }, [setStatus, t]);

 // ── Attach visible terminals to their DOM containers ────────────────────
 //
 // Visible set:
 // - single mode : [activeId]
 // - grid mode : every session that's in `groupedIds`
 //
 // Runs on a short rAF delay so ref callbacks (tileRefs) have definitely
 // been populated before we try to attach. Runtimes keep their websocket
 // + xterm buffer alive; we just move the DOM into the right container.
 useEffect(() => {
 if (!isOpen) return;

 const handle = requestAnimationFrame(() => {
 const visibleSet = new Set(visibleIds);

 // Single-view: remove all non-visible terminal elements from the
 // container first, otherwise overflow:hidden shows the first child
 // (stale terminal) instead of the active one.
 if (!isGroupMode && containerRef.current) {
 for (const [id, rt] of runtimes.current) {
 if (!visibleSet.has(id) && rt.opened) {
 const el = (rt.term as any).element as HTMLElement | undefined;
 if (el?.parentElement === containerRef.current) {
 containerRef.current.removeChild(el);
 }
 rt.attachedTo = null;
 }
 }
 }

 for (const id of visibleIds) {
 const session = sessions.find((s) => s.id === id);
 if (!session) continue;
 const rt = ensureRuntime(session);
 const target = isGroupMode
 ? tileRefs.current.get(id) ?? null
 : containerRef.current;
 if (!target) continue; // Not in DOM yet — effect will re-run.

 // Same target? Just refit.
 if (rt.attachedTo === target) {
 try { rt.fit.fit(); } catch {}
 continue;
 }

 try {
 if (!rt.opened) {
 // First-time attach: let xterm build its DOM inside `target`.
 rt.term.open(target);
 rt.opened = true;
 } else {
 // Move the already-built terminal element into the new parent.
 // Appending a DOM node that already has a parent auto-removes
 // it from the old one (standard DOM behaviour).
 const el = (rt.term as any).element as HTMLElement | undefined;
 if (el) target.appendChild(el);
 else rt.term.open(target); // fallback (shouldn't happen)
 }
 rt.attachedTo = target;
 rt.fit.fit();
 } catch (err) {
 console.error('shell attach failed', err);
 }
 }

 // Cleanup: if a runtime is no longer visible, leave its DOM where it
 // is (it will be implicitly removed when the next visible runtime
 // moves into the same container, or when the containing div unmounts).
 // We still clear `attachedTo` so the next visible transition treats
 // it as needing re-attachment.
 for (const [id, rt] of runtimes.current) {
 if (!visibleSet.has(id) && rt.attachedTo) {
 rt.attachedTo = null;
 }
 }

 // Focus the active terminal
 if (activeId) {
 try { runtimes.current.get(activeId)?.term.focus(); } catch {}
 }
 });

 return () => cancelAnimationFrame(handle);
 }, [activeId, isOpen, sessions, ensureRuntime, isGroupMode, visibleIds.join('|')]);

 // ── Resize observer — refit every visible terminal when the panel or
 // any tile changes size.
 useEffect(() => {
 const targets: HTMLDivElement[] = [];
 if (isGroupMode) {
 for (const id of visibleIds) {
 const el = tileRefs.current.get(id);
 if (el) targets.push(el);
 }
 } else if (containerRef.current) {
 targets.push(containerRef.current);
 }
 if (targets.length === 0) return;

 const ro = new ResizeObserver(() => {
 for (const id of visibleIds) {
 const rt = runtimes.current.get(id);
 try { rt?.fit.fit(); } catch {}
 }
 });
 targets.forEach((t) => ro.observe(t));
 return () => ro.disconnect();
 }, [isOpen, isGroupMode, visibleIds.join('|')]);

 // ── Session cleanup: when a session is removed from the store, tear
 // down its runtime (ws + xterm) to free memory.
 useEffect(() => {
 const alive = new Set(sessions.map((s) => s.id));
 for (const [id, rt] of runtimes.current) {
 if (!alive.has(id)) {
 try { rt.ws?.close(); } catch {}
 try { rt.term.dispose(); } catch {}
 runtimes.current.delete(id);
 }
 }
 // Push every live session's deviceId into the MRU (dedup + cap inside).
 // This catches sessions added from DeviceDetailPage too.
 for (const s of sessions) pushRecent(s.deviceId);
 }, [sessions]);

 // ── Send raw bytes to the active session (used by the VirtualKeyPanel) ──
 const sendRawToActive = useCallback((sequence: string) => {
 if (!activeId) return;
 const rt = runtimes.current.get(activeId);
 if (rt?.ws && rt.ws.readyState === WebSocket.OPEN) {
 rt.ws.send(new TextEncoder().encode(sequence));
 }
 // Keep the keyboard focus in the terminal with a mouse. On touch the
 // key panel no longer steals focus (see its wrapper below), and a
 // focus() here would re-open a soft keyboard the user just dismissed.
 if (!isTouchDevice()) {
 try { rt?.term.focus(); } catch {}
 }
 }, [activeId]);

 // Copy the visible+scrollback buffer of a session to the clipboard.
 // If the user has a selection (drag-highlight inside xterm), prefer
 // that; otherwise dump the whole buffer. Trailing whitespace is
 // trimmed so an empty-row tail doesn't leave the clipboard with
 // hundreds of blank lines.
 const copyTerminal = async (id: string) => {
 const rt = runtimes.current.get(id);
 if (!rt) return;
 let text = '';
 try { text = rt.term.getSelection() ?? ''; } catch {}
 if (!text) {
 try {
 const buf = rt.term.buffer.active;
 const lines: string[] = [];
 for (let i = 0; i < buf.length; i++) {
 lines.push(buf.getLine(i)?.translateToString(true) ?? '');
 }
 text = lines.join('\n').replace(/\s+$/, '');
 } catch { /* no buffer yet — empty copy */ }
 }
 // Clipboard API → execCommand → native bridge (WebView-safe).
 const ok = await copyText(text);
 if (ok) toast.success(text ? (t('shell.copied') || 'Terminal contents copied') : (t('shell.nothingToCopy') || 'Nothing to copy'));
 else toast.error(t('shell.clipboardBlocked') || 'Clipboard blocked by the browser');
 };

 // Reconnect a session that hit `error` or `disconnected`. Tears down
 // the dead runtime and opens a fresh tunnel; the new tab inherits
 // group membership so the layout doesn't shift. Wait for
 // REMOTE_TUNNEL_READY before adding the new tab so the runtime's WS
 // doesn't open against an agent that hasn't reconnected yet.
 const handleReconnect = async (id: string) => {
 const s = useRemoteShellStore.getState().sessions.find((x) => x.id === id);
 if (!s) return;
 const wasGrouped = useRemoteShellStore.getState().groupedIds.includes(id);
 const oldRt = runtimes.current.get(id);
 try { oldRt?.ws?.close(); } catch {}
 try { oldRt?.term.dispose(); } catch {}
 runtimes.current.delete(id);
 removeSession(id);
 let freshId: string | null = null;
 try {
 const fresh = await remoteApi.startSession(s.deviceId, s.protocol);
 freshId = fresh.id;
 // No relay token = no tunnel to open: never add a tab for it.
 requireSessionToken(fresh);
 const socket = getSocket();
 const add = () => {
 addSession({
 id: fresh.sessionToken,
 deviceId: s.deviceId,
 deviceName: s.deviceName,
 protocol: s.protocol,
 sessionToken: fresh.sessionToken,
 serverSessionId: fresh.id,
 });
 if (wasGrouped) toggleGrouped(fresh.sessionToken);
 };
 if (!socket) { add(); return; }
 const onReady = (rs: any) => {
 if (rs.id !== fresh.id) return;
 socket.off('REMOTE_TUNNEL_READY', onReady);
 add();
 };
 socket.on('REMOTE_TUNNEL_READY', onReady);
 setTimeout(() => {
 socket.off('REMOTE_TUNNEL_READY', onReady);
 if (!useRemoteShellStore.getState().sessions.find((x) => x.id === fresh.sessionToken)) {
 add();
 }
 }, 1500);
 } catch (err) {
 if (freshId) remoteApi.endSession(freshId).catch(() => {});
 const msg = remoteStartErrorMessage(err, t, t('shell.reconnectFailed', 'Reconnect failed'), s.protocol);
 if (msg) toast.error(msg);
 }
 };

 // ── Drag-and-drop grouping ──────────────────────────────────────────────
 // Dragging tab A onto tab B puts both in the active split group. If
 // either was already in the group the other joins it; otherwise a
 // fresh 2-tab group is created. The active tab is set to the source
 // so the user lands in the new split immediately.
 const handleTabDrop = (sourceId: string, targetId: string) => {
 if (!sourceId || sourceId === targetId) return;
 const st = useRemoteShellStore.getState();
 // toggleGrouped flips one id at a time; calling it for each missing
 // id converges on the union (source ∪ target ∪ existing group).
 if (!st.groupedIds.includes(sourceId)) toggleGrouped(sourceId);
 if (!st.groupedIds.includes(targetId)) toggleGrouped(targetId);
 setActive(sourceId);
 };

 // Tap path for split view (touch screens have no drag-and-drop in a
 // WebView and no Ctrl key): same effect as Ctrl+click on a tab.
 const toggleSplit = (id: string) => {
 toggleGrouped(id);
 setActive(id);
 };

 // Close = kill the shell + tear down the local runtime. The server
 // also reacts to the browser WS dropping by calling endSession, so
 // this is effectively a no-op REST call followed by a local cleanup.
 const handleDisconnect = async (id: string) => {
 const s = useRemoteShellStore.getState().sessions.find((x) => x.id === id);
 if (s?.serverSessionId) {
 try { await remoteApi.endSession(s.serverSessionId); } catch {}
 }
 const rt = runtimes.current.get(id);
 try { rt?.ws?.close(); } catch {}
 try { rt?.term.dispose(); } catch {}
 runtimes.current.delete(id);
 removeSession(id);
 };

 // ── Open a new session on a chosen device/protocol ──────────────────────
 const openNew = async (deviceId: number, deviceName: string, protocol: ShellProtocol) => {
 pushRecent(deviceId);
 let startedId: string | null = null;
 try {
 const session = await remoteApi.startSession(deviceId, protocol);
 startedId = session.id;
 // No relay token = no tunnel to open: never add a tab for it.
 requireSessionToken(session);
 // The server emits REMOTE_TUNNEL_READY when the agent is actually
 // connected. Listen once for it and then add the session.
 const socket = getSocket();
 const add = () => addSession({
 id: session.sessionToken,
 deviceId,
 deviceName,
 protocol,
 sessionToken: session.sessionToken,
 serverSessionId: session.id,
 });
 if (!socket) { add(); return; }
 const onReady = (s: any) => {
 if (s.id !== session.id) return;
 socket.off('REMOTE_TUNNEL_READY', onReady);
 add();
 };
 socket.on('REMOTE_TUNNEL_READY', onReady);
 // Safety fallback — some protocols may not emit READY; open anyway after 1s
 setTimeout(() => {
 socket.off('REMOTE_TUNNEL_READY', onReady);
 if (!useRemoteShellStore.getState().sessions.find((x) => x.id === session.sessionToken)) {
 add();
 }
 }, 1500);
 } catch (err) {
 if (startedId) remoteApi.endSession(startedId).catch(() => {});
 const msg = remoteStartErrorMessage(err, t, t('shell.startFailed', { protocol: PROTOCOL_LABEL[protocol], defaultValue: 'Failed to start {{protocol}} session' }), protocol);
 if (msg) toast.error(msg);
 }
 setPickerOpen(false);
 };

 const openPicker = async () => {
 setPickerSearch('');
 setPickerOpen(true);
 setPickerLoading(true);
 try {
 const res = await deviceApi.listPaginated({
 approvalStatus: 'approved',
 pageSize: 10000,
 });
 setPickerDevices(res.items);
 } catch {
 toast.error(t('shell.loadDevicesFailed') || 'Failed to load devices');
 setPickerDevices([]);
 } finally {
 setPickerLoading(false);
 }
 };

 if (sessions.length === 0) return null;

 const activeSession = sessions.find((s) => s.id === activeId);

 // ── Minimized pill (in the FloatingDock, under the chat FAB) ─────────────
 if (!isOpen) {
 const pillLabel = t('shell.pill', { count: sessions.length })
 || `${sessions.length} shell${sessions.length > 1 ? 's' : ''}`;
 const pillTitle = t('shell.pillTitle', { count: sessions.length })
 || `${sessions.length} remote shell session${sessions.length > 1 ? 's' : ''}`;
 return (
 <button
 onClick={() => setOpen(true)}
 title={pillTitle}
 aria-label={pillTitle}
 className="pointer-events-auto relative shrink-0 flex items-center gap-2 px-3 py-2 rounded-full bg-accent text-white shadow-lg hover:bg-accent/90 transition-colors coarse:min-h-11 coarse:px-4"
 >
 <TerminalIcon className="w-4 h-4" />
 <span className="text-sm font-medium">
 {pillLabel}
 </span>
 {sessions.some((s) => s.status === 'error') && (
 <AlertTriangle className="w-3.5 h-3.5 text-red-300" />
 )}
 </button>
 );
 }

 const closeLabel = t('shell.closeSession') || 'Close session';

 // Phone toolbar overflow: the secondary actions live in a "⋯" menu.
 const phoneMenuItems: ActionMenuItem[] = [
 {
 key: 'copy',
 icon: <Copy className="w-4 h-4" />,
 label: t('shell.copyContents') || 'Copy terminal contents',
 onClick: () => { if (activeSession) void copyTerminal(activeSession.id); },
 hidden: !activeSession || isGroupMode,
 },
 {
 key: 'ungroup',
 icon: <Ungroup className="w-4 h-4" />,
 label: t('shell.clearSplit') || 'Clear split group',
 onClick: () => useRemoteShellStore.getState().clearGroup(),
 hidden: groupedIds.length < 2,
 },
 {
 key: 'fullscreen',
 icon: <Maximize2 className="w-4 h-4" />,
 label: isFullscreen ? (t('shell.exitFullscreen') || 'Exit fullscreen') : (t('shell.enterFullscreen') || 'Enter fullscreen'),
 onClick: toggleFullscreen,
 hidden: !fullscreenSupported,
 },
 {
 key: 'close',
 icon: <X className="w-4 h-4" />,
 label: closeLabel,
 onClick: () => { if (activeSession) void handleDisconnect(activeSession.id); },
 hidden: !activeSession,
 danger: true,
 separator: true,
 },
 ];

 return (
 <div
 className="pointer-events-auto fixed inset-x-0 bottom-0 z-[1] flex flex-col bg-[#0d0f14] pb-safe px-safe"
 style={{ top: nativeTop }}
 role="dialog"
 aria-label={t('shell.panelTitle') || 'Remote shells'}
 >
 {/* ── Toolbar ── */}
 <div className="flex items-center justify-between px-3 py-1.5 bg-bg-primary shrink-0 gap-3 pt-[max(0.375rem,var(--safe-top))] max-md:gap-1.5 max-md:px-2">
 <div className="flex items-center gap-2 min-w-0 overflow-x-auto scrollbar-thin">
 <TerminalIcon className="w-4 h-4 text-text-muted shrink-0 max-md:hidden" />

 {/* Tabs */}
 {sessions.map((s) => {
 const isActive = s.id === activeId;
 const isGrouped = groupedIds.includes(s.id);
 const statusColor =
 s.status === 'connected' ? 'text-green-400' :
 s.status === 'connecting' ? 'text-yellow-400' :
 s.status === 'error' ? 'text-red-400' :
 'text-gray-400';
 const isDeadStatus = s.status === 'error' || s.status === 'disconnected';
 const isDropTarget = dragOverId === s.id && dragId && dragId !== s.id;
 // Touch: every tab action (split, reconnect, copy, close) sits in
 // a per-tab menu — no drag, no Ctrl, no 18 px close target.
 const tabMenuItems: ActionMenuItem[] = [
 {
 key: 'split',
 icon: <Columns2 className="w-4 h-4" />,
 label: isGrouped ? (t('shell.removeFromSplit') || 'Remove from split view') : (t('shell.addToSplit') || 'Add to split view'),
 onClick: () => toggleSplit(s.id),
 hidden: sessions.length < 2 && !isGrouped,
 },
 {
 key: 'reconnect',
 icon: <RotateCcw className="w-4 h-4" />,
 label: t('shell.reconnect') || 'Reconnect',
 onClick: () => { void handleReconnect(s.id); },
 hidden: !isDeadStatus,
 },
 {
 key: 'copy',
 icon: <Copy className="w-4 h-4" />,
 label: t('shell.copyContents') || 'Copy terminal contents',
 onClick: () => { void copyTerminal(s.id); },
 },
 {
 key: 'close',
 icon: <X className="w-4 h-4" />,
 label: closeLabel,
 onClick: () => { void handleDisconnect(s.id); },
 danger: true,
 separator: true,
 },
 ];
 return (
 <div
 key={s.id}
 draggable={canHover}
 onDragStart={(e) => {
 setDragId(s.id);
 try {
 e.dataTransfer.effectAllowed = 'move';
 e.dataTransfer.setData('text/plain', s.id);
 } catch {}
 }}
 onDragOver={(e) => {
 if (!dragId || dragId === s.id) return;
 e.preventDefault();
 e.dataTransfer.dropEffect = 'move';
 if (dragOverId !== s.id) setDragOverId(s.id);
 }}
 onDragLeave={() => {
 if (dragOverId === s.id) setDragOverId(null);
 }}
 onDrop={(e) => {
 e.preventDefault();
 const src = dragId ?? e.dataTransfer.getData('text/plain');
 setDragId(null);
 setDragOverId(null);
 if (src) handleTabDrop(src, s.id);
 }}
 onDragEnd={() => {
 setDragId(null);
 setDragOverId(null);
 }}
 className={clsx(
 'flex items-center gap-1.5 px-2.5 py-1.5 rounded cursor-pointer shrink-0 transition-colors border',
 !canHover && 'py-0.5 pr-0.5',
 isActive
 ? 'bg-accent/15 text-text-primary border-accent/40'
 : 'text-text-muted hover:text-text-primary hover:bg-bg-secondary border-transparent',
 isGrouped && !isActive && 'border-purple-400/50 bg-purple-400/5',
 isGrouped && isActive && 'border-purple-400/70',
 isDropTarget && 'ring-2 ring-accent/70 bg-accent/10',
 dragId === s.id && 'opacity-50',
 )}
 title={canHover
 ? (isGrouped
 ? (t('shell.tabHintGrouped') || 'Drop another tab here to add it · Ctrl+Click to remove from split')
 : (t('shell.tabHint') || 'Click to activate · Drag onto another tab to split · Ctrl+Click to toggle split'))
 : undefined}
 onClick={(e) => {
 if (e.ctrlKey || e.metaKey) {
 e.preventDefault();
 toggleGrouped(s.id);
 // Also activate the clicked tab so the user sees the
 // effect immediately: grouping a tab switches to it
 // (and therefore to grid mode if the group now has 2+).
 setActive(s.id);
 } else {
 setActive(s.id);
 }
 }}
 >
 <span className={clsx('w-2 h-2 rounded-full', statusColor.replace('text-', 'bg-'))} />
 <span className="text-sm font-medium max-w-[200px] truncate max-md:max-w-[120px]">{s.deviceName}</span>
 <span className="text-[11px] text-text-muted/80">{PROTOCOL_LABEL[s.protocol]}</span>
 {isGrouped && (
 <span className="text-[10px] text-purple-400" title={t('shell.inSplit') || 'In split group'}>◎</span>
 )}
 {canHover ? (
 <>
 {isDeadStatus && (
 <button
 onClick={(e) => { e.stopPropagation(); handleReconnect(s.id); }}
 className="p-0.5 rounded hover:bg-accent/20 text-text-muted hover:text-accent"
 title={t('shell.reconnect') || 'Reconnect'}
 aria-label={t('shell.reconnect') || 'Reconnect'}
 >
 <RotateCcw className="w-3.5 h-3.5" />
 </button>
 )}
 <button
 onClick={(e) => { e.stopPropagation(); handleDisconnect(s.id); }}
 className="p-0.5 rounded hover:bg-red-500/20 text-text-muted hover:text-red-400"
 title={closeLabel}
 aria-label={closeLabel}
 >
 <X className="w-3.5 h-3.5" />
 </button>
 </>
 ) : (
 // stopPropagation: menu clicks (portal) must not also hit the
 // tab's own onClick through the React tree.
 <span className="flex" onClick={(e) => e.stopPropagation()}>
 <ActionMenu
 items={tabMenuItems}
 label={t('shell.tabActions', { name: s.deviceName }) || `Actions for ${s.deviceName}`}
 sheetTitle={`${s.deviceName} · ${PROTOCOL_LABEL[s.protocol]}`}
 triggerSize="sm"
 />
 </span>
 )}
 </div>
 );
 })}

 {/* Add-new-session button */}
 <button
 onClick={() => { void openPicker(); }}
 title={t('shell.openAnother') || 'Open another remote session'}
 aria-label={t('shell.openAnother') || 'Open another remote session'}
 className={clsx('p-1 text-text-muted hover:text-accent hover:bg-accent/10 rounded transition-colors shrink-0', TOUCH_BTN)}
 >
 <Plus className="w-4 h-4" />
 </button>
 </div>

 <div className="flex items-center gap-1 shrink-0">
 {activeSession?.errorMsg && (
 <span className="text-xs text-red-400 truncate max-w-xs hidden md:block">
 {activeSession.errorMsg}
 </span>
 )}
 {/* Copy whole buffer (or current selection) — always available
 when there's an active session. In group mode each tile has
 its own Copy button too. (Phone: in the "⋯" menu.) */}
 {!isPhone && activeSession && !isGroupMode && (
 <button
 onClick={() => copyTerminal(activeSession.id)}
 title={t('shell.copyToClipboard') || 'Copy terminal contents to clipboard'}
 aria-label={t('shell.copyToClipboard') || 'Copy terminal contents to clipboard'}
 className={clsx('p-1.5 text-text-muted hover:text-text-primary hover:bg-bg-secondary rounded transition-colors', TOUCH_BTN)}
 >
 <Copy className="w-4 h-4" />
 </button>
 )}
 {/* Broadcast input — only meaningful in split group with 2+ tiles.
 When on, every keystroke fans out to every grouped terminal:
 the parallel-admin killer feature for "run the same command
 on N similar boxes". */}
 {isGroupMode && (
 <button
 onClick={() => setBroadcast((v) => !v)}
 title={broadcast
 ? (t('shell.broadcastOn') || 'Broadcast ON — keystrokes go to every grouped terminal')
 : (t('shell.broadcastOff') || 'Broadcast OFF — keystrokes go to the focused terminal only')}
 aria-label={t('shell.broadcast') || 'Broadcast'}
 aria-pressed={broadcast}
 className={clsx(
 'flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors border coarse:min-h-10',
 broadcast
 ? 'bg-purple-400/15 text-purple-300 border-purple-400/50'
 : 'text-text-muted hover:text-text-primary hover:bg-bg-secondary border-transparent',
 )}
 >
 <Radio className={clsx('w-3.5 h-3.5', broadcast && 'animate-pulse')} />
 <span className="hidden sm:inline">{t('shell.broadcast') || 'Broadcast'}</span>
 </button>
 )}
 {/* Ungroup all — visible whenever 2+ tabs are grouped. Cheaper
 than Ctrl+Clicking each tab individually. (Phone: "⋯" menu.) */}
 {!isPhone && groupedIds.length >= 2 && (
 <button
 onClick={() => useRemoteShellStore.getState().clearGroup()}
 title={t('shell.clearSplit') || 'Clear split group'}
 aria-label={t('shell.clearSplit') || 'Clear split group'}
 className={clsx('p-1.5 text-text-muted hover:text-text-primary hover:bg-bg-secondary rounded transition-colors', TOUCH_BTN)}
 >
 <Ungroup className="w-4 h-4" />
 </button>
 )}
 <button
 onClick={() => setShowKeys((v) => !v)}
 title={showKeys ? (t('shell.hideKeys') || 'Hide virtual keys') : (t('shell.showKeys') || 'Show virtual keys')}
 aria-label={showKeys ? (t('shell.hideKeys') || 'Hide virtual keys') : (t('shell.showKeys') || 'Show virtual keys')}
 aria-pressed={showKeys}
 className={clsx(
 'p-1.5 rounded transition-colors',
 TOUCH_BTN,
 showKeys ? 'bg-accent/15 text-accent' : 'text-text-muted hover:text-text-primary hover:bg-bg-secondary',
 )}
 >
 <Keyboard className="w-4 h-4" />
 </button>
 {!isPhone && fullscreenSupported && (
 <button
 onClick={toggleFullscreen}
 title={isFullscreen ? (t('shell.exitFullscreen') || 'Exit fullscreen') : (t('shell.enterFullscreen') || 'Enter fullscreen')}
 aria-label={isFullscreen ? (t('shell.exitFullscreen') || 'Exit fullscreen') : (t('shell.enterFullscreen') || 'Enter fullscreen')}
 className={clsx(
 'p-1.5 rounded transition-colors',
 TOUCH_BTN,
 isFullscreen
 ? 'bg-accent/15 text-accent'
 : 'text-text-muted hover:text-text-primary hover:bg-bg-secondary',
 )}
 >
 <Maximize2 className="w-4 h-4" />
 </button>
 )}
 {isPhone && (
 <ActionMenu
 items={phoneMenuItems}
 label={t('ui.moreActions') || 'More actions'}
 triggerSize="md"
 />
 )}
 <button
 onClick={() => setOpen(false)}
 title={t('shell.minimize') || 'Minimize (stays alive in background)'}
 aria-label={t('shell.minimize') || 'Minimize (stays alive in background)'}
 className={clsx('p-1.5 text-text-muted hover:text-text-primary hover:bg-bg-secondary rounded transition-colors', TOUCH_BTN)}
 >
 <Minus className="w-4 h-4" />
 </button>
 {!isPhone && activeSession && (
 <button
 onClick={() => handleDisconnect(activeSession.id)}
 title={closeLabel}
 aria-label={closeLabel}
 className="flex items-center gap-1.5 px-2 py-1 text-xs bg-red-500/10 text-red-400 border border-red-500/20 rounded hover:bg-red-500/20 transition-colors coarse:min-h-10"
 >
 <X className="w-3.5 h-3.5" />
 <span className="hidden sm:inline">{t('common.close') || 'Close'}</span>
 </button>
 )}
 </div>
 </div>

 {/* ── Terminal container(s) ── */}
 {isGroupMode ? (
 (() => {
 // Tile the grouped terminals in a near-square grid. Phones stack
 // them in one column (a 2×2 grid of 180 px terminals is unusable).
 const n = visibleIds.length;
 const cols = isPhone ? 1 : Math.ceil(Math.sqrt(n));
 return (
 <div
 className="flex-1 overflow-hidden p-1 grid gap-1"
 style={{
 minHeight: 0,
 gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
 gridAutoRows: '1fr',
 }}
 >
 {visibleIds.map((id) => {
 const session = sessions.find((s) => s.id === id);
 if (!session) return null;
 const isActiveTile = id === activeId;
 const statusColor =
 session.status === 'connected' ? 'bg-green-400' :
 session.status === 'connecting' ? 'bg-yellow-400' :
 session.status === 'error' ? 'bg-red-400' :
 'bg-gray-400';
 const isDead = session.status === 'error' || session.status === 'disconnected';
 return (
 // Flex column instead of absolute+pt-5. With absolute+padding the
 // xterm canvas overran the tile bottom (last 1–2 rows clipped) on
 // certain aspect ratios because fit-addon and the canvas
 // renderer disagree about whether padding is content. A clean
 // header (shrink-0) + flex-1 terminal area is reliable.
 <div
 key={id}
 className={clsx(
 'flex flex-col rounded border overflow-hidden cursor-pointer min-h-0',
 isActiveTile ? 'border-accent/60' : 'border-transparent',
 )}
 onClick={() => setActive(id)}
 >
 <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-bg-primary/90 shrink-0 coarse:py-0.5">
 <span className={clsx('w-2 h-2 rounded-full shrink-0', statusColor)} />
 <span className="text-xs font-medium text-text-primary truncate flex-1" title={session.deviceName}>
 {session.deviceName}
 </span>
 <span className="text-[11px] text-text-muted shrink-0">{PROTOCOL_LABEL[session.protocol]}</span>
 {broadcast && (
 <Radio className="w-3.5 h-3.5 text-purple-300 animate-pulse shrink-0" />
 )}
 {isDead && (
 <button
 onClick={(e) => { e.stopPropagation(); handleReconnect(id); }}
 title={t('shell.reconnect') || 'Reconnect'}
 aria-label={t('shell.reconnect') || 'Reconnect'}
 className={clsx('p-0.5 rounded hover:bg-accent/20 text-text-muted hover:text-accent shrink-0', TOUCH_BTN)}
 >
 <RotateCcw className="w-3.5 h-3.5" />
 </button>
 )}
 <button
 onClick={(e) => { e.stopPropagation(); copyTerminal(id); }}
 title={t('shell.copyThis') || "Copy this terminal's contents"}
 aria-label={t('shell.copyThis') || "Copy this terminal's contents"}
 className={clsx('p-0.5 rounded hover:bg-bg-secondary text-text-muted hover:text-text-primary shrink-0', TOUCH_BTN)}
 >
 <Copy className="w-3.5 h-3.5" />
 </button>
 <button
 onClick={(e) => { e.stopPropagation(); toggleGrouped(id); }}
 title={t('shell.removeFromSplit') || 'Remove from split group'}
 aria-label={t('shell.removeFromSplit') || 'Remove from split group'}
 className={clsx('p-0.5 rounded hover:bg-bg-secondary text-text-muted hover:text-text-primary shrink-0', TOUCH_BTN)}
 >
 <Minus className="w-3.5 h-3.5" />
 </button>
 </div>
 <div
 className="flex-1 min-h-0"
 ref={(el) => {
 if (el) tileRefs.current.set(id, el);
 else tileRefs.current.delete(id);
 }}
 />
 </div>
 );
 })}
 </div>
 );
 })()
 ) : (
 <div ref={containerRef} className="flex-1 overflow-hidden p-1" style={{ minHeight: 0 }} />
 )}

 {/* Virtual keys. The wrapper keeps the focus in the terminal: pressing
 a key must not blur xterm's textarea (on touch that closed and
 re-opened the soft keyboard on every key). 40 px keys on touch. */}
 {showKeys && (
 <div
 className="shrink-0 coarse:[&_button]:min-h-10 coarse:[&_button]:min-w-10"
 onMouseDown={(e) => e.preventDefault()}
 onPointerDown={(e) => { if (e.pointerType !== 'mouse') e.preventDefault(); }}
 >
 <VirtualKeyPanel onKey={sendRawToActive} />
 </div>
 )}

 {/* ── Device picker modal (+) ────────────────────────────────────── */}
 {pickerOpen && (() => {
 const recent = getRecent();
 const recentMap = new Map(recent.map((id, i) => [id, i]));
 const q = pickerSearch.trim().toLowerCase();
 const filtered = pickerDevices
 .filter((d) => isAgentReachable(d.status))
 .filter((d) => {
 if (!q) return true;
 const name = (d.displayName || d.hostname || '').toLowerCase();
 const host = (d.hostname || '').toLowerCase();
 return name.includes(q) || host.includes(q);
 })
 .sort((a, b) => {
 const ra = recentMap.get(a.id) ?? Infinity;
 const rb = recentMap.get(b.id) ?? Infinity;
 if (ra !== rb) return ra - rb;
 return (a.displayName || a.hostname || '').localeCompare(b.displayName || b.hostname || '');
 });
 const capped = q ? filtered : filtered.slice(0, 10);
 return (
 <div
 className="fixed inset-0 z-[200] flex items-start justify-center bg-black/60 backdrop-blur-sm pt-24 max-sm:items-stretch max-sm:pt-0"
 onClick={() => setPickerOpen(false)}
 >
 <div
 className="bg-bg-secondary rounded-xl shadow-2xl w-full max-w-lg mx-4 flex flex-col max-h-[70dvh] max-sm:mx-0 max-sm:h-dvh max-sm:max-h-dvh max-sm:max-w-none max-sm:rounded-none max-sm:pt-safe max-sm:pb-safe"
 onClick={(e) => e.stopPropagation()}
 role="dialog"
 aria-modal="true"
 aria-label={t('shell.pickerTitle') || 'Open remote session'}
 >
 <div className="px-4 py-3 flex items-center gap-2">
 <Plus className="w-4 h-4 text-accent" />
 <span className="text-sm font-semibold text-text-primary">{t('shell.pickerTitle') || 'Open remote session'}</span>
 <button
 onClick={() => setPickerOpen(false)}
 aria-label={t('common.close') || 'Close'}
 className={clsx('ml-auto p-1 text-text-muted hover:text-text-primary rounded', TOUCH_BTN)}
 >
 <X className="w-4 h-4" />
 </button>
 </div>
 <div className="px-4 py-3 ">
 <input
 type="text"
 // Touch: no autofocus — the soft keyboard would cover the
 // recent-devices list the user most likely wants to tap.
 autoFocus={!coarse}
 value={pickerSearch}
 onChange={(e) => setPickerSearch(e.target.value)}
 placeholder={t('shell.searchDevices') || 'Search devices...'}
 aria-label={t('shell.searchDevices') || 'Search devices...'}
 autoCapitalize="off"
 autoCorrect="off"
 spellCheck={false}
 enterKeyHint="search"
 className="w-full px-3 py-2 text-sm bg-bg-tertiary rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
 />
 {!q && (
 <p className="text-[10px] text-text-muted mt-1 ml-1">
 {t('shell.showingRecent', { count: capped.length })
 || `Showing ${capped.length} most recent · type to search all`}
 </p>
 )}
 </div>
 <div className="flex-1 overflow-y-auto overscroll-contain">
 {pickerLoading ? (
 <div className="p-6 text-center text-sm text-text-muted">{t('shell.loadingDevices') || 'Loading devices...'}</div>
 ) : capped.length === 0 ? (
 <div className="p-6 text-center text-sm text-text-muted">
 {q ? (t('shell.noMatch') || 'No devices match your search') : (t('shell.noDevices') || 'No devices available')}
 </div>
 ) : (
 capped.map((d) => {
 const protocols: ShellProtocol[] =
 d.osType === 'windows' ? ['cmd', 'powershell'] : ['ssh'];
 const inPrivacy = !!d.privacyModeEnabled;
 return (
 <div
 key={d.id}
 className={clsx(
 'flex items-center gap-3 px-4 py-2.5 /30 last:border-b-0',
 inPrivacy ? 'opacity-60' : 'hover:bg-bg-tertiary/50',
 )}
 >
 <div className="flex-1 min-w-0">
 <div className="text-sm text-text-primary truncate flex items-center gap-2" title={d.displayName || d.hostname}>
 <span className="truncate">{d.displayName || d.hostname}</span>
 {inPrivacy && (
 <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded-full bg-orange-400/10 text-orange-400 border border-orange-400/30">
 {t('shell.privacyBadge') || 'privacy'}
 </span>
 )}
 </div>
 <div className="text-[10px] text-text-muted">
 {d.osName || d.osType} · {d.ipLocal || d.ipPublic || (t('shell.noIp') || 'no IP')}
 </div>
 </div>
 <div className="flex gap-1 shrink-0">
 {protocols.map((p) => (
 <button
 key={p}
 disabled={inPrivacy}
 onClick={() => {
 if (inPrivacy) return;
 openNew(d.id, d.displayName || d.hostname || '', p);
 setPickerOpen(false);
 }}
 title={inPrivacy ? (t('shell.privacyBlocked') || 'Privacy mode is active — unlock Remote on the device detail page first') : undefined}
 className="text-xs px-2.5 py-1 rounded text-text-muted hover:text-accent hover:border-accent/40 hover:bg-accent/5 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:text-text-muted disabled:hover:border-transparent disabled:hover:bg-transparent transition-colors coarse:min-h-10 coarse:px-3 coarse:bg-bg-tertiary"
 >
 {PROTOCOL_LABEL[p]}
 </button>
 ))}
 </div>
 </div>
 );
 })
 )}
 </div>
 </div>
 </div>
 );
 })()}
 </div>
 );
}
