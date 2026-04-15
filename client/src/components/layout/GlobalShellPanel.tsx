import 'xterm/css/xterm.css';
import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import {
  Terminal as TerminalIcon, X, Maximize2, Minus, Plus,
  AlertTriangle, Keyboard,
} from 'lucide-react';
import { clsx } from 'clsx';
import { VirtualKeyPanel } from '@/components/VirtualKeyPanel';
import { useRemoteShellStore, type ShellSession, type ShellProtocol } from '@/store/remoteShellStore';
import { useDeviceStore } from '@/store/deviceStore';
import { remoteApi } from '@/api/remote.api';
import { getSocket } from '@/socket/socketClient';
import { useNativeTopOffset } from '@/hooks/useNativeTopOffset';
import toast from 'react-hot-toast';

// Per-session runtime state held in refs (xterm, ws, fit) — zustand can't
// store class instances cleanly so we keep them out-of-band keyed by session id.
interface Runtime {
  term: XTerm;
  fit: FitAddon;
  ws: WebSocket | null;
  /** DOM element the terminal is currently attached to (null before first attach) */
  attachedTo: HTMLElement | null;
}

const PROTOCOL_LABEL: Record<ShellProtocol, string> = {
  ssh: 'SSH',
  cmd: 'CMD',
  powershell: 'PowerShell',
};

function buildWsUrl(sessionToken: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/api/remote/tunnel/${sessionToken}`;
}

function sendResize(ws: WebSocket, cols: number, rows: number) {
  try { ws.send(JSON.stringify({ type: 'resize', cols, rows })); } catch {}
}

export function GlobalShellPanel() {
  const { sessions, activeId, isOpen } = useRemoteShellStore();
  const removeSession = useRemoteShellStore((s) => s.removeSession);
  const setActive = useRemoteShellStore((s) => s.setActive);
  const setOpen = useRemoteShellStore((s) => s.setOpen);
  const setStatus = useRemoteShellStore((s) => s.setStatus);
  const addSession = useRemoteShellStore((s) => s.addSession);
  const getDeviceList = useDeviceStore((s) => s.getDeviceList);

  const containerRef = useRef<HTMLDivElement>(null);
  const runtimes = useRef<Map<string, Runtime>>(new Map());
  const [showKeys, setShowKeys] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const nativeTop = useNativeTopOffset();

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
      fontSize: 14,
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
    ws.onerror = () => setStatus(session.id, 'error', 'WebSocket connection failed');
    ws.onclose = (ev) => {
      if (ev.wasClean) setStatus(session.id, 'disconnected');
      else setStatus(session.id, 'error', 'Connection lost');
    };

    term.onData((data: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(new TextEncoder().encode(data));
      }
    });
    term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) sendResize(ws, cols, rows);
    });

    const rt: Runtime = { term, fit, ws, attachedTo: null };
    runtimes.current.set(session.id, rt);
    return rt;
  }, [setStatus]);

  // ── Attach/detach the active terminal to the DOM container ──────────────
  useEffect(() => {
    if (!isOpen || !activeId || !containerRef.current) return;
    const session = sessions.find((s) => s.id === activeId);
    if (!session) return;
    const rt = ensureRuntime(session);

    // Detach all other terminals from their current DOM parent. They keep
    // their buffer (xterm's scrollback is preserved across open() calls).
    for (const [id, r] of runtimes.current) {
      if (id !== activeId && r.attachedTo) {
        try {
          // xterm doesn't expose a detach; we empty the container div.
          r.attachedTo.replaceChildren();
        } catch {}
        r.attachedTo = null;
      }
    }

    // Attach the active one. xterm supports opening on a new container even
    // after being created — it clears any prior DOM and re-attaches.
    try {
      rt.term.open(containerRef.current);
      rt.fit.fit();
      rt.term.focus();
      rt.attachedTo = containerRef.current;
    } catch (err) {
      console.error('shell attach failed', err);
    }
  }, [activeId, isOpen, sessions, ensureRuntime]);

  // ── Resize observer on the container ────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(() => {
      if (!activeId) return;
      const rt = runtimes.current.get(activeId);
      try { rt?.fit.fit(); } catch {}
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [activeId, isOpen]);

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
  }, [sessions]);

  // ── Send raw bytes to the active session (used by the VirtualKeyPanel) ──
  const sendRawToActive = useCallback((sequence: string) => {
    if (!activeId) return;
    const rt = runtimes.current.get(activeId);
    if (rt?.ws && rt.ws.readyState === WebSocket.OPEN) {
      rt.ws.send(new TextEncoder().encode(sequence));
    }
    try { rt?.term.focus(); } catch {}
  }, [activeId]);

  // ── Disconnect the current session ──────────────────────────────────────
  const handleDisconnect = (id: string) => {
    const rt = runtimes.current.get(id);
    try { rt?.ws?.close(); } catch {}
    try { rt?.term.dispose(); } catch {}
    runtimes.current.delete(id);
    removeSession(id);
  };

  // ── Open a new session on a chosen device/protocol ──────────────────────
  const openNew = async (deviceId: number, deviceName: string, protocol: ShellProtocol) => {
    try {
      const session = await remoteApi.startSession(deviceId, protocol);
      // The server emits REMOTE_TUNNEL_READY when the agent is actually
      // connected. Listen once for it and then add the session.
      const socket = getSocket();
      const add = () => addSession({
        id: session.sessionToken,
        deviceId,
        deviceName,
        protocol,
        sessionToken: session.sessionToken,
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
    } catch {
      toast.error(`Failed to start ${protocol} session`);
    }
    setPickerOpen(false);
  };

  if (sessions.length === 0) return null;

  const activeSession = sessions.find((s) => s.id === activeId);

  // ── Minimized pill (floating) ────────────────────────────────────────────
  if (!isOpen) {
    return (
      <button
        onClick={() => setOpen(true)}
        title={`${sessions.length} remote shell session${sessions.length > 1 ? 's' : ''}`}
        className="fixed bottom-4 right-4 z-50 flex items-center gap-2 px-3 py-2 rounded-full bg-accent text-white shadow-lg hover:bg-accent/90 transition-colors"
      >
        <TerminalIcon className="w-4 h-4" />
        <span className="text-sm font-medium">
          {sessions.length} shell{sessions.length > 1 ? 's' : ''}
        </span>
        {sessions.some((s) => s.status === 'error') && (
          <AlertTriangle className="w-3.5 h-3.5 text-red-300" />
        )}
      </button>
    );
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 flex flex-col bg-[#0d0f14]" style={{ top: nativeTop }}>
      {/* ── Toolbar ── */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-bg-primary border-b border-border shrink-0 gap-3">
        <div className="flex items-center gap-2 min-w-0 overflow-x-auto scrollbar-thin">
          <TerminalIcon className="w-4 h-4 text-text-muted shrink-0" />

          {/* Tabs */}
          {sessions.map((s) => {
            const isActive = s.id === activeId;
            const statusColor =
              s.status === 'connected'    ? 'text-green-400' :
              s.status === 'connecting'   ? 'text-yellow-400' :
              s.status === 'error'        ? 'text-red-400' :
                                             'text-gray-400';
            return (
              <div
                key={s.id}
                className={clsx(
                  'flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer shrink-0 transition-colors',
                  isActive
                    ? 'bg-accent/15 text-text-primary'
                    : 'text-text-muted hover:text-text-primary hover:bg-bg-secondary',
                )}
                onClick={() => setActive(s.id)}
              >
                <span className={clsx('w-1.5 h-1.5 rounded-full', statusColor.replace('text-', 'bg-'))} />
                <span className="text-xs font-medium max-w-[160px] truncate">{s.deviceName}</span>
                <span className="text-[10px] text-text-muted/80">{PROTOCOL_LABEL[s.protocol]}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDisconnect(s.id); }}
                  className="p-0.5 rounded hover:bg-red-500/20 text-text-muted hover:text-red-400"
                  title="Disconnect"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })}

          {/* Add-new-session button */}
          <div className="relative shrink-0">
            <button
              onClick={() => setPickerOpen((v) => !v)}
              title="Open another remote session"
              className="p-1 text-text-muted hover:text-accent hover:bg-accent/10 rounded transition-colors"
            >
              <Plus className="w-4 h-4" />
            </button>
            {pickerOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setPickerOpen(false)} />
                <div className="absolute left-0 top-full mt-1 w-64 max-h-80 overflow-y-auto bg-bg-secondary border border-border rounded-lg shadow-xl z-20 p-1">
                  <div className="px-2 py-1 text-[10px] text-text-muted uppercase tracking-wider">
                    Open on device
                  </div>
                  {getDeviceList()
                    .filter((d) => d.status === 'online')
                    .map((d) => {
                      const protocols: ShellProtocol[] =
                        d.osType === 'windows' ? ['cmd', 'powershell'] : ['ssh'];
                      return (
                        <div key={d.id} className="px-2 py-1 hover:bg-bg-tertiary rounded">
                          <div className="text-xs text-text-primary truncate" title={d.displayName || d.hostname}>
                            {d.displayName || d.hostname}
                          </div>
                          <div className="flex gap-1 mt-0.5">
                            {protocols.map((p) => (
                              <button
                                key={p}
                                onClick={() => openNew(d.id, d.displayName || d.hostname || '', p)}
                                className="text-[10px] px-2 py-0.5 rounded border border-border text-text-muted hover:text-accent hover:border-accent/40"
                              >
                                {PROTOCOL_LABEL[p]}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {activeSession?.errorMsg && (
            <span className="text-xs text-red-400 truncate max-w-xs hidden md:block">
              {activeSession.errorMsg}
            </span>
          )}
          <button
            onClick={() => setShowKeys((v) => !v)}
            title={showKeys ? 'Hide virtual keys' : 'Show virtual keys'}
            className={clsx(
              'p-1.5 rounded transition-colors',
              showKeys ? 'bg-accent/15 text-accent' : 'text-text-muted hover:text-text-primary hover:bg-bg-secondary',
            )}
          >
            <Keyboard className="w-4 h-4" />
          </button>
          <button
            onClick={() => document.documentElement.requestFullscreen?.()}
            title="Fullscreen"
            className="p-1.5 text-text-muted hover:text-text-primary hover:bg-bg-secondary rounded transition-colors"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
          <button
            onClick={() => setOpen(false)}
            title="Minimize (stays alive in background)"
            className="p-1.5 text-text-muted hover:text-text-primary hover:bg-bg-secondary rounded transition-colors"
          >
            <Minus className="w-4 h-4" />
          </button>
          {activeSession && (
            <button
              onClick={() => handleDisconnect(activeSession.id)}
              title="Disconnect active session"
              className="flex items-center gap-1.5 px-2 py-1 text-xs bg-red-500/10 text-red-400 border border-red-500/20 rounded hover:bg-red-500/20 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Disconnect</span>
            </button>
          )}
        </div>
      </div>

      {/* ── Terminal container ── */}
      <div ref={containerRef} className="flex-1 overflow-hidden p-1" style={{ minHeight: 0 }} />

      {showKeys && <VirtualKeyPanel onKey={sendRawToActive} />}
    </div>
  );
}
