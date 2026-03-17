import { useEffect, useRef, useState } from 'react';
import { Terminal, X, Maximize2, RefreshCw, AlertTriangle } from 'lucide-react';
import type { RemoteSession } from '@obliance/shared';
import { clsx } from 'clsx';

interface SshTerminalModalProps {
  /** Null while the tunnel is being established — modal shows a connecting overlay. */
  session: RemoteSession | null;
  deviceName: string;
  onClose: () => void;
}

type ConnStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export function SshTerminalModal({ session, deviceName, onClose }: SshTerminalModalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<any>(null);
  const fitRef = useRef<any>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<ConnStatus>('connecting');
  const [errorMsg, setErrorMsg] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);

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
      setErrorMsg('Tunnel establishment timed out — the agent did not respond within 60 s');
    }, 60_000);
    return () => clearTimeout(timer);
  }, [session]);

  // ── xterm + WebSocket — fires only when wsUrl is known ──────────────────────
  useEffect(() => {
    if (!wsUrl || !containerRef.current) return;
    let active = true;

    Promise.all([
      import('xterm').then(m => m.Terminal),
      import('xterm-addon-fit').then(m => m.FitAddon),
    ]).then(([Terminal, FitAddon]) => {
      if (!active || !containerRef.current) return;

      const term = new Terminal({
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
        const data = ev.data instanceof ArrayBuffer
          ? new Uint8Array(ev.data)
          : ev.data;
        term.write(data);
      };

      ws.onerror = () => {
        if (active) { setStatus('error'); setErrorMsg('WebSocket connection failed'); }
      };

      ws.onclose = (ev) => {
        if (active) {
          setStatus(ev.wasClean ? 'disconnected' : 'error');
          if (!ev.wasClean) setErrorMsg('Connection lost — the tunnel was closed unexpectedly');
        }
      };

      // Keyboard input → WebSocket
      term.onData((data: string) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(new TextEncoder().encode(data));
        }
      });

      // Terminal resize → send resize message to agent
      term.onResize(({ cols, rows }: { cols: number; rows: number }) => {
        if (ws.readyState === WebSocket.OPEN) {
          sendResize(ws, cols, rows);
        }
      });

      // Resize observer
      const ro = new ResizeObserver(() => { try { fit.fit(); } catch {} });
      if (containerRef.current) ro.observe(containerRef.current);

      return () => { ro.disconnect(); };
    }).catch((err) => {
      console.error('[SshTerminalModal] failed to load xterm:', err);
      if (active) { setStatus('error'); setErrorMsg('Failed to load terminal library'); }
    });

    return () => {
      active = false;
      wsRef.current?.close();
      termRef.current?.dispose();
    };
  }, [wsUrl]);

  const handleClose = () => {
    wsRef.current?.close();
    termRef.current?.dispose();
    onClose();
  };

  const handleFullscreen = () => {
    if (!isFullscreen) {
      document.documentElement.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
    setIsFullscreen(!isFullscreen);
  };

  const statusConfig: Record<ConnStatus, { label: string; color: string }> = {
    connecting:   { label: 'Connecting…',  color: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30' },
    connected:    { label: 'Connected',    color: 'text-green-400 bg-green-400/10 border-green-400/30'   },
    disconnected: { label: 'Disconnected', color: 'text-gray-400 bg-gray-400/10 border-gray-400/30'      },
    error:        { label: 'Error',        color: 'text-red-400 bg-red-400/10 border-red-400/30'         },
  };
  const sc = statusConfig[status];

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#0d0f14]">
      {/* ── Toolbar ── */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-bg-primary border-b border-border shrink-0 gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Terminal className="w-4 h-4 text-text-muted shrink-0" />
          <span className="text-sm font-medium text-text-primary truncate">{deviceName}</span>
          <span className={clsx('text-xs px-2 py-0.5 rounded-full border whitespace-nowrap flex items-center gap-1', sc.color)}>
            {status === 'connecting' && <RefreshCw className="w-3 h-3 animate-spin" />}
            {status === 'error'      && <AlertTriangle className="w-3 h-3" />}
            {sc.label}
          </span>
          {errorMsg && (
            <span className="text-xs text-red-400 truncate hidden sm:block">{errorMsg}</span>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={handleFullscreen}
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            className="p-1.5 text-text-muted hover:text-text-primary hover:bg-bg-secondary rounded transition-colors"
          >
            <Maximize2 className="w-4 h-4" />
          </button>

          <button
            onClick={handleClose}
            title="Disconnect"
            className="flex items-center gap-1.5 px-2 py-1 text-xs bg-red-500/10 text-red-400 border border-red-500/20 rounded hover:bg-red-500/20 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Disconnect</span>
          </button>
        </div>
      </div>

      {/* ── Content ── */}
      {status === 'error' ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center p-8">
          <AlertTriangle className="w-12 h-12 text-red-400" />
          <p className="text-text-primary font-medium">Shell connection failed</p>
          <p className="text-sm text-text-muted max-w-md">{errorMsg || 'An unknown error occurred.'}</p>
          <button
            onClick={handleClose}
            className="mt-2 px-4 py-2 bg-bg-secondary text-text-primary border border-border rounded-lg hover:bg-bg-tertiary transition-colors text-sm"
          >
            Close
          </button>
        </div>
      ) : !wsUrl ? (
        /* Tunnel establishing overlay — shown before REMOTE_TUNNEL_READY */
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center p-8">
          <RefreshCw className="w-10 h-10 text-accent animate-spin" />
          <p className="text-text-primary font-medium">Establishing tunnel…</p>
          <p className="text-sm text-text-muted">Waiting for agent to connect back to the server</p>
        </div>
      ) : (
        <div
          ref={containerRef}
          className="flex-1 overflow-hidden p-1"
          style={{ minHeight: 0 }}
        />
      )}
    </div>
  );
}

// Send a terminal resize event as a special JSON message the agent can handle.
// Format: 0xFF prefix byte + JSON → agent reads this to resize the PTY.
function sendResize(ws: WebSocket, cols: number, rows: number) {
  try {
    const msg = JSON.stringify({ type: 'resize', cols, rows });
    ws.send(new TextEncoder().encode('\xff' + msg));
  } catch {}
}
