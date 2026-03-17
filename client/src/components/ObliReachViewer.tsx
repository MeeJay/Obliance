/**
 * ObliReachViewer — native screen-streaming viewer for the Oblireach protocol.
 *
 * Copy this file into D:\Obliance\client\src\components\ to integrate it.
 *
 * Architecture
 * ────────────
 * The component opens a single WebSocket to the relay endpoint
 * (either the built-in Obliance relay or the standalone Oblireach relay server).
 *
 * ● Binary frames from agent → decode as JPEG → render on <canvas>
 *   Frame format: [1 byte type][N bytes payload]
 *   Type 0x01 = JPEG (v1)
 *   Type 0x02 = reserved H.264 NAL unit (future)
 *
 * ● Text frames = JSON control messages (bidirectional).
 *
 * Input events (pointer + keyboard) are serialised as JSON text frames
 * and sent directly over the same WebSocket connection.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { Monitor, X, Maximize2, Keyboard, RefreshCw, AlertTriangle, Wifi } from 'lucide-react';
import { clsx } from 'clsx';

// ── Frame type constants ──────────────────────────────────────────────────────
const FRAME_JPEG  = 0x01;
// const FRAME_H264 = 0x02; // future
// const FRAME_OPUS = 0x03; // future

// ── Types ─────────────────────────────────────────────────────────────────────

type ConnStatus = 'connecting' | 'waiting' | 'streaming' | 'disconnected' | 'error';

interface ObliReachViewerProps {
  /** Obliance session token (hex, 64 chars). Used to build the WS URL. */
  sessionToken: string | null;
  /** Human-readable device name shown in the toolbar. */
  deviceName: string;
  /** Short-lived HMAC viewer token issued by /api/remote/relay/issue-viewer-token.
   *  Only required when using the standalone Oblireach relay server.
   *  Leave empty to use the built-in Obliance WebSocket relay. */
  viewerToken?: string;
  /** Base URL of the standalone Oblireach relay server (e.g. "wss://relay.example.com").
   *  If absent, falls back to the built-in Obliance relay. */
  relayHost?: string;
  /** Called when the user clicks Disconnect. */
  onClose: () => void;
}

// ── Control message JSON shapes ────────────────────────────────────────────────

interface InitMsg   { type: 'init';   width: number; height: number; fps: number }
interface ResizeMsg { type: 'resize'; width: number; height: number }
type AgentMsg = InitMsg | ResizeMsg | { type: string };

// ─────────────────────────────────────────────────────────────────────────────

export function ObliReachViewer({
  sessionToken,
  deviceName,
  viewerToken,
  relayHost,
  onClose,
}: ObliReachViewerProps) {
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef        = useRef<WebSocket | null>(null);
  const bitmapQueue  = useRef<ImageBitmap[]>([]);
  const rafRef       = useRef<number>(0);

  const [status, setStatus]     = useState<ConnStatus>('connecting');
  const [errorMsg, setErrorMsg] = useState('');
  const [agentDims, setAgentDims] = useState({ w: 1920, h: 1080 });
  const [fps, setFps]           = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // FPS counter
  const fpsCountRef  = useRef(0);
  const fpsTimerRef  = useRef<ReturnType<typeof setInterval>>(null as any);

  // ── Build WS URL ─────────────────────────────────────────────────────────────
  const wsUrl = (() => {
    if (!sessionToken) return null;

    if (relayHost && viewerToken) {
      // Standalone Oblireach relay
      const base = relayHost.replace(/\/$/, '');
      return `${base}/relay/ws?role=viewer&token=${encodeURIComponent(viewerToken)}`;
    }

    // Built-in Obliance relay (existing infrastructure, no viewerToken needed)
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/api/remote/tunnel/${sessionToken}`;
  })();

  // ── Connect / disconnect ──────────────────────────────────────────────────
  useEffect(() => {
    if (!wsUrl) return;

    let active = true;
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => {
      if (!active) return;
      setStatus('waiting');
    };

    ws.onclose = () => {
      if (!active) return;
      setStatus('disconnected');
    };

    ws.onerror = () => {
      if (!active) return;
      setStatus('error');
      setErrorMsg('WebSocket connection failed');
    };

    ws.onmessage = (ev) => {
      if (!active) return;

      if (typeof ev.data === 'string') {
        // JSON control frame
        try {
          const msg = JSON.parse(ev.data) as AgentMsg;
          handleControlMsg(msg);
        } catch {}
        return;
      }

      // Binary frame: [1 byte type][N bytes payload]
      const buf = ev.data as ArrayBuffer;
      if (buf.byteLength < 2) return;
      const view = new Uint8Array(buf);
      const frameType = view[0];

      if (frameType === FRAME_JPEG) {
        const jpegBytes = buf.slice(1);
        decodeAndQueue(jpegBytes);
      }
    };

    // FPS counter
    fpsTimerRef.current = setInterval(() => {
      setFps(fpsCountRef.current);
      fpsCountRef.current = 0;
    }, 1000);

    return () => {
      active = false;
      ws.close();
      wsRef.current = null;
      cancelAnimationFrame(rafRef.current);
      clearInterval(fpsTimerRef.current);
      bitmapQueue.current.forEach(b => b.close());
      bitmapQueue.current = [];
    };
  }, [wsUrl]);

  const handleControlMsg = useCallback((msg: AgentMsg) => {
    switch (msg.type) {
      case 'waiting':
        setStatus('waiting');
        break;
      case 'paired':
        setStatus('streaming');
        startRenderLoop();
        break;
      case 'init': {
        const m = msg as InitMsg;
        setAgentDims({ w: m.width, h: m.height });
        setStatus('streaming');
        startRenderLoop();
        break;
      }
      case 'resize': {
        const m = msg as ResizeMsg;
        setAgentDims({ w: m.width, h: m.height });
        break;
      }
      case 'peer_disconnected':
        setStatus('disconnected');
        break;
      case 'error':
        setStatus('error');
        setErrorMsg((msg as any).message || 'Relay error');
        break;
    }
  }, []);

  // ── Decode JPEG and push to render queue ──────────────────────────────────
  const decodeAndQueue = useCallback((jpegBuf: ArrayBuffer) => {
    const blob = new Blob([jpegBuf], { type: 'image/jpeg' });
    createImageBitmap(blob).then((bitmap) => {
      fpsCountRef.current++;
      // Keep max 2 decoded frames in the queue to avoid memory buildup
      if (bitmapQueue.current.length >= 2) {
        const old = bitmapQueue.current.shift();
        old?.close();
      }
      bitmapQueue.current.push(bitmap);
    }).catch(() => {});
  }, []);

  // ── Render loop ───────────────────────────────────────────────────────────
  const startRenderLoop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw);
      const bitmap = bitmapQueue.current.shift();
      if (!bitmap) return;
      // Scale canvas to fit container while preserving aspect ratio
      canvas.width  = bitmap.width;
      canvas.height = bitmap.height;
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
    };

    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(draw);
  }, []);

  // ── Input forwarding ──────────────────────────────────────────────────────
  const sendJson = useCallback((obj: object) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  }, []);

  // Convert pointer coords from canvas space → agent screen space
  const toAgentCoords = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = agentDims.w / rect.width;
    const sy = agentDims.h / rect.height;
    return {
      x: Math.round((e.clientX - rect.left) * sx),
      y: Math.round((e.clientY - rect.top)  * sy),
    };
  }, [agentDims]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const { x, y } = toAgentCoords(e);
    sendJson({ type: 'mouse', action: 'move', x, y });
  }, [toAgentCoords, sendJson]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const { x, y } = toAgentCoords(e);
    const button = e.button === 0 ? 1 : e.button === 1 ? 2 : 3;
    sendJson({ type: 'mouse', action: 'down', button, x, y });
  }, [toAgentCoords, sendJson]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const { x, y } = toAgentCoords(e);
    const button = e.button === 0 ? 1 : e.button === 1 ? 2 : 3;
    sendJson({ type: 'mouse', action: 'up', button, x, y });
  }, [toAgentCoords, sendJson]);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const { x, y } = (() => {
      const rect = e.currentTarget.getBoundingClientRect();
      return {
        x: Math.round((e.clientX - rect.left) * agentDims.w / rect.width),
        y: Math.round((e.clientY - rect.top)  * agentDims.h / rect.height),
      };
    })();
    const delta = e.deltaY > 0 ? -1 : 1;
    sendJson({ type: 'mouse', action: 'scroll', delta, x, y });
  }, [agentDims, sendJson]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    e.preventDefault();
    sendJson({
      type: 'key', action: 'down', code: e.code,
      ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey,
    });
  }, [sendJson]);

  const handleKeyUp = useCallback((e: React.KeyboardEvent) => {
    e.preventDefault();
    sendJson({
      type: 'key', action: 'up', code: e.code,
      ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey,
    });
  }, [sendJson]);

  const handleCtrlAltDel = useCallback(() => {
    const keys = [
      { code: 'ControlLeft', ctrl: true },
      { code: 'AltLeft',     ctrl: true, alt: true },
      { code: 'Delete',      ctrl: true, alt: true },
    ];
    for (const k of keys) sendJson({ type: 'key', action: 'down', ...k });
    setTimeout(() => {
      for (const k of [...keys].reverse()) sendJson({ type: 'key', action: 'up', ...k });
    }, 50);
  }, [sendJson]);

  const handleFullscreen = useCallback(() => {
    if (!isFullscreen) {
      document.documentElement.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
    setIsFullscreen(!isFullscreen);
  }, [isFullscreen]);

  const handleClose = useCallback(() => {
    wsRef.current?.close();
    onClose();
  }, [onClose]);

  // ── Status config ─────────────────────────────────────────────────────────
  const statusCfg: Record<ConnStatus, { label: string; color: string; spin?: boolean }> = {
    connecting:   { label: 'Connecting…',   color: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30', spin: true },
    waiting:      { label: 'Waiting…',      color: 'text-blue-400   bg-blue-400/10   border-blue-400/30',   spin: true },
    streaming:    { label: 'Streaming',      color: 'text-green-400  bg-green-400/10  border-green-400/30'  },
    disconnected: { label: 'Disconnected',   color: 'text-gray-400   bg-gray-400/10   border-gray-400/30'   },
    error:        { label: 'Error',          color: 'text-red-400    bg-red-400/10    border-red-400/30'    },
  };
  const sc = statusCfg[status];

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black"
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      tabIndex={-1}
    >
      {/* ── Toolbar ── */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-bg-primary border-b border-border shrink-0 gap-3">
        {/* Left */}
        <div className="flex items-center gap-2 min-w-0">
          <Monitor className="w-4 h-4 text-text-muted shrink-0" />
          <span className="text-sm font-medium text-text-primary truncate">{deviceName}</span>

          <span className={clsx('text-xs px-2 py-0.5 rounded-full border whitespace-nowrap flex items-center gap-1', sc.color)}>
            {sc.spin && <RefreshCw className="w-3 h-3 animate-spin" />}
            {status === 'error' && <AlertTriangle className="w-3 h-3" />}
            {status === 'streaming' && <Wifi className="w-3 h-3" />}
            {sc.label}
          </span>

          {status === 'streaming' && (
            <span className="text-xs text-text-muted hidden sm:block">
              {agentDims.w}×{agentDims.h} · {fps} fps
            </span>
          )}

          {errorMsg && (
            <span className="text-xs text-red-400 truncate hidden sm:block">{errorMsg}</span>
          )}
        </div>

        {/* Right */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={handleCtrlAltDel}
            disabled={status !== 'streaming'}
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

      {/* ── Content ── */}
      {status === 'error' ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center p-8">
          <AlertTriangle className="w-12 h-12 text-red-400" />
          <p className="text-text-primary font-medium">Connection failed</p>
          <p className="text-sm text-text-muted max-w-md">{errorMsg || 'An unknown error occurred.'}</p>
          <button
            onClick={handleClose}
            className="mt-2 px-4 py-2 bg-bg-secondary text-text-primary border border-border rounded-lg hover:bg-bg-tertiary transition-colors text-sm"
          >
            Close
          </button>
        </div>
      ) : (status === 'connecting' || status === 'waiting') ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center p-8 bg-[#0d0f14]">
          <RefreshCw className="w-10 h-10 text-accent animate-spin" />
          <p className="text-text-primary font-medium">
            {status === 'waiting' ? 'Waiting for agent to connect…' : 'Connecting to relay…'}
          </p>
          <p className="text-sm text-text-muted">
            {status === 'waiting'
              ? 'The wake-up command has been sent to the device.'
              : 'Establishing encrypted tunnel…'}
          </p>
        </div>
      ) : (
        <div
          ref={containerRef}
          className="flex-1 overflow-hidden bg-black flex items-center justify-center"
        >
          <canvas
            ref={canvasRef}
            className="max-w-full max-h-full object-contain cursor-crosshair"
            style={{ display: 'block' }}
            onPointerMove={handlePointerMove}
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            onWheel={handleWheel}
            onContextMenu={e => e.preventDefault()}
          />
        </div>
      )}
    </div>
  );
}
