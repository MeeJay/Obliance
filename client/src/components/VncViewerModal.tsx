import { useEffect, useRef, useState } from 'react';
import { Monitor, X, Maximize2, Keyboard, RefreshCw, AlertTriangle } from 'lucide-react';
import type { RemoteSession } from '@obliance/shared';
import { clsx } from 'clsx';

interface VncViewerModalProps {
  session: RemoteSession;
  onClose: () => void;
}

type ConnStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export function VncViewerModal({ session, onClose }: VncViewerModalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<any>(null);
  const [status, setStatus] = useState<ConnStatus>('connecting');
  const [errorMsg, setErrorMsg] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Browser-side WebSocket URL for this session tunnel
  const wsUrl = (() => {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/api/remote/tunnel/${session.sessionToken}`;
  })();

  const deviceName =
    (session as any).device?.displayName ||
    (session as any).device?.hostname ||
    `Device #${session.deviceId}`;

  useEffect(() => {
    if (!containerRef.current) return;

    let active = true;

    import('@novnc/novnc').then(({ default: RFB }) => {
    try {
      const rfb = new RFB(containerRef.current!, wsUrl, {
        scaleViewport: true,
        showDotCursor: true,
      });

      rfb.addEventListener('connect', () => {
        if (active) setStatus('connected');
      });

      rfb.addEventListener('disconnect', (e: CustomEvent<{ clean: boolean }>) => {
        if (active) {
          setStatus('disconnected');
          if (!e.detail?.clean) setErrorMsg('Connection lost unexpectedly');
        }
      });

      rfb.addEventListener('credentialsrequired', () => {
        // Send empty password — most self-hosted VNC instances have no password
        rfb.sendCredentials({ password: '' });
      });

      rfb.addEventListener('securityfailure', (e: CustomEvent<{ status: number; reason?: string }>) => {
        if (active) {
          setStatus('error');
          setErrorMsg(`Security failure: ${e.detail?.reason ?? 'unknown'}`);
        }
      });

      rfbRef.current = rfb;
    } catch (err) {
      console.error('[VncViewerModal] init error:', err);
      if (active) { setStatus('error'); setErrorMsg('Failed to initialise VNC viewer'); }
    }
    }).catch((err) => {
      console.error('[VncViewerModal] failed to load noVNC:', err);
      if (active) { setStatus('error'); setErrorMsg('Failed to load VNC library'); }
    });

    return () => {
      active = false;
      if (rfbRef.current) {
        try { rfbRef.current.disconnect(); } catch {}
        rfbRef.current = null;
      }
    };
  }, [wsUrl]);

  const handleClose = () => {
    if (rfbRef.current) {
      try { rfbRef.current.disconnect(); } catch {}
      rfbRef.current = null;
    }
    onClose();
  };

  const handleCtrlAltDel = () => {
    try { rfbRef.current?.sendCtrlAltDel(); } catch {}
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
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      {/* ── Toolbar ── */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-bg-primary border-b border-border shrink-0 gap-3">
        {/* Left: device + status */}
        <div className="flex items-center gap-2 min-w-0">
          <Monitor className="w-4 h-4 text-text-muted shrink-0" />
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

        {/* Right: toolbar buttons */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={handleCtrlAltDel}
            disabled={status !== 'connected'}
            title="Send Ctrl+Alt+Del"
            className="flex items-center gap-1.5 px-2 py-1 text-xs bg-bg-secondary text-text-muted border border-border rounded hover:text-text-primary hover:bg-bg-tertiary disabled:opacity-40 transition-colors"
          >
            <Keyboard className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Ctrl+Alt+Del</span>
          </button>

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

      {/* ── VNC canvas ── */}
      {status === 'error' ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center p-8">
          <AlertTriangle className="w-12 h-12 text-red-400" />
          <p className="text-text-primary font-medium">VNC connection failed</p>
          <p className="text-sm text-text-muted max-w-md">{errorMsg || 'An unknown error occurred.'}</p>
          <button
            onClick={handleClose}
            className="mt-2 px-4 py-2 bg-bg-secondary text-text-primary border border-border rounded-lg hover:bg-bg-tertiary transition-colors text-sm"
          >
            Close
          </button>
        </div>
      ) : (
        <div
          ref={containerRef}
          className="flex-1 overflow-hidden bg-black [&>:first-child]:w-full [&>:first-child]:h-full"
        />
      )}
    </div>
  );
}
