import 'xterm/css/xterm.css';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { Terminal as TerminalIcon, X, Maximize2, RefreshCw, AlertTriangle, Keyboard } from 'lucide-react';
import type { RemoteSession } from '@obliance/shared';
import { clsx } from 'clsx';
import { useNativeTopOffset } from '@/hooks/useNativeTopOffset';
import { useIsCoarsePointer } from '@/hooks/useMediaQuery';
import { useNativeBack } from '@/hooks/useNativeBack';
import { isAndroidApp, isTouchDevice } from '@/native/bridge';
import { VirtualKeyPanel, useTerminalLatch } from '@/components/VirtualKeyPanel';
import { useKeyboardInset } from '@/components/remote/useKeyboardInset';

interface SshTerminalModalProps {
 /** Null while the tunnel is being established — modal shows a connecting overlay. */
 session: RemoteSession | null;
 deviceName: string;
 onClose: () => void;
}

type ConnStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

// 40 px targets on touch screens (desktop sizes unchanged).
const TB = 'coarse:min-h-10 coarse:min-w-10 coarse:flex coarse:items-center coarse:justify-center';

export function SshTerminalModal({ session, deviceName, onClose }: SshTerminalModalProps) {
 const { t } = useTranslation();
 const containerRef = useRef<HTMLDivElement>(null);
 const termRef = useRef<any>(null);
 const fitRef = useRef<any>(null);
 const wsRef = useRef<WebSocket | null>(null);
 // Set to true when the user explicitly clicks Disconnect so that the
 // subsequent ws.onclose event does not trigger a second onClose() call.
 const userClosedRef = useRef(false);
 const [status, setStatus] = useState<ConnStatus>('connecting');
 const [errorMsg, setErrorMsg] = useState('');
 const [isFullscreen, setIsFullscreen] = useState(false);
 // Touch screens have no F-keys / Esc / Ctrl: show the key bar by default there.
 const [showKeys, setShowKeys] = useState(() => isTouchDevice());
 const nativeTop = useNativeTopOffset();
 const coarse = useIsCoarsePointer();
 const keyboardInset = useKeyboardInset(coarse);
 const inAndroidApp = isAndroidApp();
 // Latched Ctrl / Alt from the key bar also apply to the next typed character.
 const latch = useTerminalLatch();
 const latchRef = useRef(latch);
 latchRef.current = latch;

 // Send a raw byte sequence to the SSH WebSocket. Used by the virtual
 // key panel to inject F-keys and other browser-reserved keys that xterm
 // never gets a chance to see.
 const sendRawToShell = (sequence: string) => {
 const ws = wsRef.current;
 if (ws && ws.readyState === WebSocket.OPEN) {
 ws.send(new TextEncoder().encode(sequence));
 }
 // Keep focus on the terminal so the user can keep typing immediately.
 // Not on touch: the key bar never takes the focus, and a focus() here
 // would re-open a soft keyboard the user just dismissed.
 if (!isTouchDevice()) {
 try { termRef.current?.focus(); } catch {}
 }
 };

 // Derive the WS URL only when we have a session token.
 const wsUrl = session?.sessionToken
 ? (() => {
 const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
 return `${proto}//${window.location.host}/api/remote/tunnel/${session.sessionToken}`;
 })()
 : null;

 // ── 60-second tunnel-establishment timeout ──────────────────────────────────
 // If the server never emits REMOTE_TUNNEL_READY we show an error so the user
 // isn't left staring at a spinner indefinitely.
 useEffect(() => {
 if (session) return; // tunnel already ready — no need for timeout
 const timer = setTimeout(() => {
 setStatus('error');
 setErrorMsg(t('sshTerminal.tunnelTimeout', 'Tunnel establishment timed out — the agent did not respond within 60 s'));
 }, 60_000);
 return () => clearTimeout(timer);
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [session]);

 // ── xterm + WebSocket — fires only when wsUrl is known ──────────────────────
 useEffect(() => {
 if (!wsUrl || !containerRef.current) return;
 let active = true;

 const term = new XTerm({
 theme: {
 background: '#0d0f14',
 foreground: '#e2e8f0',
 cursor: '#7c6af7',
 selectionBackground: '#7c6af730',
 },
 fontFamily: '"Cascadia Code", "Fira Code", "JetBrains Mono", monospace',
 fontSize: 14,
 cursorBlink: true,
 allowTransparency: false,
 convertEol: true,
 });

 const fit = new FitAddon();
 term.loadAddon(fit);
 term.open(containerRef.current);
 fit.fit();
 termRef.current = term;
 fitRef.current = fit;

 // WebSocket connection
 const ws = new WebSocket(wsUrl);
 ws.binaryType = 'arraybuffer';
 wsRef.current = ws;

 ws.onopen = () => {
 if (active) setStatus('connected');
 sendResize(ws, term.cols, term.rows);
 };

 ws.onmessage = (ev) => {
 // Skip JSON control messages from the relay (e.g. {"type":"paired"})
 if (typeof ev.data === 'string' && ev.data.startsWith('{')) return;
 const data = ev.data instanceof ArrayBuffer
 ? new Uint8Array(ev.data)
 : ev.data;
 term.write(data);
 };

 ws.onerror = () => {
 if (active) { setStatus('error'); setErrorMsg(t('sshTerminal.wsFailed', 'WebSocket connection failed')); }
 };

 ws.onclose = (ev) => {
 if (!active) return;
 if (userClosedRef.current) return; // user already clicked Disconnect — modal is closing
 if (ev.wasClean) {
 // Shell process exited cleanly (user typed `exit`, `logout`, etc.).
 // Treat it the same as clicking the Disconnect button.
 termRef.current?.dispose();
 onClose();
 } else {
 setStatus('error');
 setErrorMsg(t('sshTerminal.connectionLost', 'Connection lost — the tunnel was closed unexpectedly'));
 }
 };

 // Keyboard input → WebSocket (a latched Ctrl / Alt modifies the next character)
 term.onData((data: string) => {
 if (ws.readyState === WebSocket.OPEN) {
 ws.send(new TextEncoder().encode(latchRef.current.transformInput(data)));
 }
 });

 // Terminal resize → send resize message to agent
 term.onResize(({ cols, rows }: { cols: number; rows: number }) => {
 if (ws.readyState === WebSocket.OPEN) {
 sendResize(ws, cols, rows);
 }
 });

 // Resize observer + the soft keyboard (visual viewport) on touch screens.
 const refit = () => { try { fit.fit(); } catch {} };
 const ro = new ResizeObserver(refit);
 if (containerRef.current) ro.observe(containerRef.current);
 const vv = window.visualViewport;
 vv?.addEventListener('resize', refit);

 return () => {
 active = false;
 ro.disconnect();
 vv?.removeEventListener('resize', refit);
 wsRef.current?.close();
 termRef.current?.dispose();
 };
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [wsUrl]);

 // Keep the fullscreen state in sync when the browser leaves fullscreen by itself.
 useEffect(() => {
 const onChange = () => setIsFullscreen(!!document.fullscreenElement);
 document.addEventListener('fullscreenchange', onChange);
 return () => document.removeEventListener('fullscreenchange', onChange);
 }, []);

 const handleClose = () => {
 userClosedRef.current = true; // prevent ws.onclose from calling onClose() a second time
 wsRef.current?.close();
 termRef.current?.dispose();
 onClose();
 };

 // Android back closes the terminal instead of navigating the page underneath.
 useNativeBack(() => { handleClose(); return true; }, true);

 const handleFullscreen = () => {
 if (!isFullscreen) {
 document.documentElement.requestFullscreen?.()?.catch?.(() => {});
 } else {
 document.exitFullscreen?.()?.catch?.(() => {});
 }
 setIsFullscreen(!isFullscreen);
 };

 const statusConfig: Record<ConnStatus, { label: string; color: string }> = {
 connecting: { label: t('sshTerminal.status.connecting', 'Connecting…'), color: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30' },
 connected: { label: t('sshTerminal.status.connected', 'Connected'), color: 'text-green-400 bg-green-400/10 border-green-400/30' },
 disconnected: { label: t('sshTerminal.status.disconnected', 'Disconnected'), color: 'text-gray-400 bg-gray-400/10 border-gray-400/30' },
 error: { label: t('sshTerminal.status.error', 'Error'), color: 'text-red-400 bg-red-400/10 border-red-400/30' },
 };
 const sc = statusConfig[status];
 const keysLabel = showKeys ? t('sshTerminal.hideKeys', 'Hide virtual keys') : t('sshTerminal.showKeys', 'Show virtual keys (F1-F12, Ctrl combos...)');

 return (
 <div
 className="fixed inset-x-0 bottom-0 z-50 flex flex-col bg-[#0d0f14] pt-safe px-safe"
 style={keyboardInset > 0 ? { top: nativeTop, bottom: keyboardInset } : { top: nativeTop }}
 >
 {/* ── Toolbar ── */}
 <div className="flex items-center justify-between px-3 py-1.5 bg-bg-primary shrink-0 gap-3">
 <div className="flex items-center gap-2 min-w-0">
 <TerminalIcon className="w-4 h-4 text-text-muted shrink-0" />
 <span className="text-sm font-medium text-text-primary truncate">{deviceName}</span>
 <span className={clsx('text-xs px-2 py-0.5 rounded-full border whitespace-nowrap flex items-center gap-1', sc.color)}>
 {status === 'connecting' && <RefreshCw className="w-3 h-3 animate-spin" />}
 {status === 'error' && <AlertTriangle className="w-3 h-3" />}
 {sc.label}
 </span>
 {errorMsg && (
 <span className="text-xs text-red-400 truncate hidden sm:block">{errorMsg}</span>
 )}
 </div>

 <div className="flex items-center gap-1 shrink-0">
 <button
 onClick={() => setShowKeys((v) => !v)}
 onPointerDown={(e) => { if (e.pointerType !== 'mouse') e.preventDefault(); }}
 title={keysLabel}
 aria-label={keysLabel}
 aria-pressed={showKeys}
 className={clsx(
 'p-1.5 rounded transition-colors', TB,
 showKeys
 ? 'bg-accent/15 text-accent'
 : 'text-text-muted hover:text-text-primary hover:bg-bg-secondary',
 )}
 >
 <Keyboard className="w-4 h-4" />
 </button>
 {/* The Android app has no Fullscreen API: the terminal already fills the window. */}
 {!inAndroidApp && (
 <button
 onClick={handleFullscreen}
 title={isFullscreen ? t('sshTerminal.exitFullscreen', 'Exit fullscreen') : t('sshTerminal.fullscreen', 'Fullscreen')}
 aria-label={isFullscreen ? t('sshTerminal.exitFullscreen', 'Exit fullscreen') : t('sshTerminal.fullscreen', 'Fullscreen')}
 className={clsx('p-1.5 text-text-muted hover:text-text-primary hover:bg-bg-secondary rounded transition-colors', TB)}
 >
 <Maximize2 className="w-4 h-4" />
 </button>
 )}

 <button
 onClick={handleClose}
 title={t('sshTerminal.disconnect', 'Disconnect')}
 aria-label={t('sshTerminal.disconnect', 'Disconnect')}
 className={clsx('flex items-center gap-1.5 px-2 py-1 text-xs bg-red-500/10 text-red-400 border border-red-500/20 rounded hover:bg-red-500/20 transition-colors', TB)}
 >
 <X className="w-3.5 h-3.5" />
 <span className="hidden sm:inline">{t('sshTerminal.disconnect', 'Disconnect')}</span>
 </button>
 </div>
 </div>

 {/* ── Content ── */}
 {status === 'error' ? (
 <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center p-8">
 <AlertTriangle className="w-12 h-12 text-red-400" />
 <p className="text-text-primary font-medium">{t('sshTerminal.failed', 'Shell connection failed')}</p>
 <p className="text-sm text-text-muted max-w-md">{errorMsg || t('sshTerminal.unknownError', 'An unknown error occurred.')}</p>
 <button
 onClick={handleClose}
 className="mt-2 px-4 py-2 bg-bg-secondary text-text-primary rounded-lg hover:bg-bg-tertiary transition-colors text-sm coarse:min-h-11"
 >
 {t('common.close', 'Close')}
 </button>
 </div>
 ) : !wsUrl ? (
 /* Tunnel establishing overlay — shown before REMOTE_TUNNEL_READY */
 <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center p-8">
 <RefreshCw className="w-10 h-10 text-accent animate-spin" />
 <p className="text-text-primary font-medium">{t('sshTerminal.establishing', 'Establishing tunnel…')}</p>
 <p className="text-sm text-text-muted">{t('sshTerminal.waitingAgent', 'Waiting for agent to connect back to the server')}</p>
 </div>
 ) : (
 <>
 <div
 ref={containerRef}
 className="flex-1 overflow-hidden p-1"
 style={{ minHeight: 0 }}
 />
 {showKeys && (
 <VirtualKeyPanel
 onKey={sendRawToShell}
 latch={latch}
 applicationCursor={() => termRef.current?.modes?.applicationCursorKeysMode ?? null}
 onKeyboard={() => { try { termRef.current?.focus(); } catch {} }}
 />
 )}
 </>
 )}
 </div>
 );
}

// Send a terminal resize as a WebSocket TEXT frame (opcode 0x1).
// The agent tells control messages (text = JSON) from shell stdin (binary = raw
// bytes) by frame type — no prefix byte needed, no encoding ambiguity.
function sendResize(ws: WebSocket, cols: number, rows: number) {
 try {
 ws.send(JSON.stringify({ type: 'resize', cols, rows }));
 } catch {}
}
