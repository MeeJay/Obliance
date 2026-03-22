/**
 * ObliReachViewer — native screen-streaming viewer for the Oblireach protocol.
 *
 * Architecture
 * ────────────
 * Opens a single WebSocket to the built-in Obliance relay (or standalone relay).
 *
 * ● Binary frames → [1 byte type][payload]
 *   Type 0x02 = H.264 NAL units (Annex B) → WebCodecs VideoDecoder → canvas
 *
 * ● Text frames = JSON control messages (bidirectional).
 *
 * Codec: H.264 via the WebCodecs API (VideoDecoder).
 *   Chrome 94+, Edge 94+, Firefox 130+ (hardware-accelerated decode).
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { Monitor, X, Maximize2, Keyboard, RefreshCw, AlertTriangle, Wifi, Lock, Unlock } from 'lucide-react';
import { clsx } from 'clsx';
import { useNativeTopOffset } from '@/hooks/useNativeTopOffset';

// ── Frame type constants ──────────────────────────────────────────────────────
const FRAME_H264 = 0x02;

// ── Types ─────────────────────────────────────────────────────────────────────

type ConnStatus = 'connecting' | 'waiting' | 'streaming' | 'disconnected' | 'error';

export interface ObliReachViewerProps {
  /** Obliance session token (hex, 64 chars). Used to build the WS URL. */
  sessionToken: string | null;
  /** Human-readable device name shown in the toolbar. */
  deviceName: string;
  /** Short-lived HMAC viewer token — only required for standalone relay. */
  viewerToken?: string;
  /** Base URL of the standalone Oblireach relay server (e.g. "wss://relay.example.com").
   *  If absent, falls back to the built-in Obliance WebSocket relay. */
  relayHost?: string;
  /** Called when the user clicks Disconnect. */
  onClose: () => void;
  /** User's preferred codec (from profile preferences). If the codec is
   *  unavailable on the agent, falls back to JPEG automatically. */
  preferredCodec?: string;
}

// ── Control message shapes ────────────────────────────────────────────────────

interface InitMsg {
  type: 'init';
  width: number;
  height: number;
  fps: number;
  codec?: string;
  extradata?: string; // base64-encoded AVCC SPS+PPS
}
interface ResizeMsg { type: 'resize'; width: number; height: number }
type AgentMsg = InitMsg | ResizeMsg | { type: string };

// ── H.264 helper: detect IDR keyframe in Annex B stream ─────────────────────

function isH264Keyframe(data: Uint8Array): boolean {
  let i = 0;
  while (i < data.length - 4) {
    if (data[i] === 0 && data[i + 1] === 0) {
      let nalStart = -1;
      if (data[i + 2] === 1) {
        nalStart = i + 3;
        i += 4;
      } else if (data[i + 2] === 0 && data[i + 3] === 1) {
        nalStart = i + 4;
        i += 5;
      } else {
        i++;
        continue;
      }
      if (nalStart < data.length) {
        const nalType = data[nalStart] & 0x1f;
        if (nalType === 5 || nalType === 7 || nalType === 8) return true;
      }
    } else {
      i++;
    }
  }
  return false;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ObliReachViewer({
  sessionToken,
  deviceName,
  viewerToken,
  relayHost,
  onClose,
  preferredCodec,
}: ObliReachViewerProps) {
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef        = useRef<WebSocket | null>(null);
  const decoderRef   = useRef<VideoDecoder | null>(null);
  const rafRef       = useRef<number>(0);

  const [status, setStatus]       = useState<ConnStatus>('connecting');
  const [errorMsg, setErrorMsg]   = useState('');
  const [agentDims, setAgentDims] = useState({ w: 1920, h: 1080 });
  const [fps, setFps]             = useState(0);
  const [codecId, setCodecId]     = useState('h264'); // technical id: h264, h265, vp9, jpeg
  const [bitrate, setBitrate]     = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [monitors, setMonitors] = useState<Array<{index:number;name:string;x:number;y:number;width:number;height:number}>>([]);
  const [activeMonitor, setActiveMonitor] = useState(0);
  const [inputBlocked, setInputBlocked] = useState(false);
  const codecLabel: Record<string,string> = { h264: 'H.264', h265: 'H.265', vp9: 'VP9', av1: 'AV1', jpeg: 'JPEG' };
  const codec = codecLabel[codecId] || codecId.toUpperCase();
  const nativeTop = useNativeTopOffset();

  const fpsCountRef = useRef(0);
  const fpsTimerRef = useRef<ReturnType<typeof setInterval>>(null as any);

  // ── Build WS URL ─────────────────────────────────────────────────────────────
  const wsUrl = (() => {
    if (!sessionToken) return null;
    if (relayHost && viewerToken) {
      return `${relayHost.replace(/\/$/, '')}/relay/ws?role=viewer&token=${encodeURIComponent(viewerToken)}`;
    }
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/api/remote/tunnel/${sessionToken}`;
  })();

  // ── VideoDecoder initialisation ───────────────────────────────────────────
  const initDecoder = useCallback((
    width: number,
    height: number,
    extradata?: string,
  ) => {
    // Close previous decoder
    try { decoderRef.current?.close(); } catch {}
    decoderRef.current = null;

    const canvas = canvasRef.current;
    if (!canvas) return;

    // Size the canvas to the agent resolution so drawImage is 1:1
    canvas.width  = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (typeof VideoDecoder === 'undefined') {
      setStatus('error');
      setErrorMsg('WebCodecs not supported in this browser (Chrome/Edge 94+, Firefox 130+).');
      return;
    }

    const decoder = new VideoDecoder({
      output: (frame: VideoFrame) => {
        fpsCountRef.current++;
        ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
        frame.close();
        // Transition to streaming on first decoded frame
        setStatus((prev) => (prev !== 'streaming' ? 'streaming' : prev));
      },
      error: (err) => {
        console.error('[ObliReach] VideoDecoder error:', err);
        setStatus('error');
        setErrorMsg(`Decoder error: ${(err as Error).message ?? err}`);
      },
    });

    // Build codec config
    // H.264 High Profile Level 5.2 — covers screens up to 2560×1600+ at 60 fps.
    // The agent sends Annex B with inline SPS/PPS; no AVCC description needed.
    let codecStr = 'avc1.640034';
    const description: BufferSource | undefined = undefined;

    if (extradata) {
      // extradata is legacy/reserved — only use it if it looks like a valid
      // AVCC DecoderConfigurationRecord (first byte = configurationVersion = 1).
      try {
        const raw = atob(extradata);
        const buf = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
        if (buf.length >= 4 && buf[0] === 0x01) {
          // Valid AVCC — derive precise codec string from profile/constraints/level.
          const p = buf[1].toString(16).padStart(2, '0');
          const c = buf[2].toString(16).padStart(2, '0');
          const l = buf[3].toString(16).padStart(2, '0');
          codecStr = `avc1.${p}${c}${l}`;
          // description intentionally not set: agent sends Annex B, not AVCC packets.
        }
      } catch { /* malformed extradata — ignore */ }
    }

    const config: VideoDecoderConfig = {
      codec: codecStr,
      codedWidth:  width,
      codedHeight: height,
      optimizeForLatency: true,
      ...(description ? { description } : {}),
    };

    decoder.configure(config);
    decoderRef.current = decoder;
  }, []);

  // ── Connect / disconnect ──────────────────────────────────────────────────
  useEffect(() => {
    if (!wsUrl) return;

    let active = true;
    let tsMicros = 0;

    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen  = () => { if (active) setStatus('waiting'); };
    ws.onclose = () => { if (active) setStatus('disconnected'); };
    ws.onerror = () => {
      if (!active) return;
      setStatus('error');
      setErrorMsg('WebSocket connection failed');
    };

    ws.onmessage = (ev) => {
      if (!active) return;

      if (typeof ev.data === 'string') {
        try { handleControlMsg(JSON.parse(ev.data) as AgentMsg, (w, h, ed) => {
          initDecoder(w, h, ed);
          setAgentDims({ w, h });
        }); } catch {}
        return;
      }

      const buf = ev.data as ArrayBuffer;
      if (buf.byteLength < 2) return;
      const view = new Uint8Array(buf);
      const frameType = view[0];

      if (frameType === 0x01) {
        // JPEG frame — decode with createImageBitmap (no WebCodecs needed)
        const blob = new Blob([buf.slice(1)], { type: 'image/jpeg' });
        createImageBitmap(blob).then((bmp) => {
          const canvas = canvasRef.current;
          if (!canvas) return;
          if (canvas.width !== bmp.width || canvas.height !== bmp.height) {
            canvas.width = bmp.width;
            canvas.height = bmp.height;
            setAgentDims({ w: bmp.width, h: bmp.height });
          }
          const ctx = canvas.getContext('2d');
          if (ctx) ctx.drawImage(bmp, 0, 0);
          bmp.close();
          fpsCountRef.current++;
          setStatus((prev) => (prev !== 'streaming' ? 'streaming' : prev));
        }).catch(() => {});
      } else if (frameType === FRAME_H264 || frameType === 0x03 || frameType === 0x04 || frameType === 0x05) {
        // H.264 (0x02), VP9 (0x03), H.265 (0x04), AV1 (0x05) — all go through WebCodecs VideoDecoder
        const nalData = buf.slice(1);
        const decoder = decoderRef.current;
        if (!decoder || decoder.state !== 'configured') return;

        if (frameType === FRAME_H264) {
          const u8 = new Uint8Array(nalData);
          const keyframe = isH264Keyframe(u8);
          try {
            decoder.decode(new EncodedVideoChunk({
              type: keyframe ? 'key' : 'delta',
              data: nalData,
              timestamp: tsMicros,
            }));
            tsMicros += Math.round(1_000_000 / 15);
          } catch (e) {}
        } else if (frameType === 0x04) {
          // H.265/HEVC: keyframe = NAL type 19 (IDR_W_RADL) or 20 (IDR_N_LP) or 32 (VPS) or 33 (SPS)
          const u8 = new Uint8Array(nalData);
          let isKey = false;
          // Search for Annex B start codes and check NAL type
          for (let j = 0; j < u8.length - 5; j++) {
            if (u8[j] === 0 && u8[j+1] === 0 && ((u8[j+2] === 1) || (u8[j+2] === 0 && u8[j+3] === 1))) {
              const off = u8[j+2] === 1 ? j+3 : j+4;
              if (off < u8.length) {
                const nalType = (u8[off] >> 1) & 0x3f;
                if (nalType >= 16 && nalType <= 21 || nalType === 32 || nalType === 33 || nalType === 34) { isKey = true; break; }
              }
            }
          }
          try {
            decoder.decode(new EncodedVideoChunk({
              type: isKey ? 'key' : 'delta',
              data: nalData,
              timestamp: tsMicros,
            }));
            tsMicros += Math.round(1_000_000 / 15);
          } catch (e) {}
        } else if (frameType === 0x05) {
          // AV1: keyframe detection — check for KEY_FRAME OBU
          // In AV1, a keyframe has show_existing_frame=0 and frame_type=KEY_FRAME
          // Simple heuristic: first frame or large frame = key
          const u8 = new Uint8Array(nalData);
          const isKey = u8.length > 0 && ((u8[0] >> 3) & 0x0f) <= 6; // OBU_SEQUENCE_HEADER or OBU_FRAME
          try {
            decoder.decode(new EncodedVideoChunk({
              type: isKey ? 'key' : 'delta',
              data: nalData,
              timestamp: tsMicros,
            }));
            tsMicros += Math.round(1_000_000 / 15);
          } catch (e) {}
        } else {
          // VP9: keyframe detection via first byte (bit 0 = 0 means keyframe)
          const u8 = new Uint8Array(nalData);
          const isKey = u8.length > 0 && (u8[0] & 0x01) === 0;
          try {
            decoder.decode(new EncodedVideoChunk({
              type: isKey ? 'key' : 'delta',
              data: nalData,
              timestamp: tsMicros,
            }));
            tsMicros += Math.round(1_000_000 / 15);
          } catch (e) {}
        }
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
      try { decoderRef.current?.close(); } catch {}
      decoderRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsUrl]);

  const handleControlMsg = useCallback((
    msg: AgentMsg,
    onInit: (w: number, h: number, extradata?: string) => void,
  ) => {
    switch (msg.type) {
      case 'waiting':
        setStatus('waiting');
        break;
      case 'paired':
        // Agent connected — decoder is initialised when 'init' arrives
        setStatus('waiting');
        break;
      case 'bitrate':
        setBitrate((msg as any).bitrate || 0);
        break;
      case 'input_block_status':
        setInputBlocked((msg as any).blocked ?? false);
        break;
      case 'codec_switch': {
        const c = (msg as any).codec;
        setCodecId(c);
        // Reconfigure VideoDecoder for the new codec
        if (c === 'vp9' || c === 'h264' || c === 'h265' || c === 'av1') {
          try { decoderRef.current?.close(); } catch {}
          const canvas = canvasRef.current;
          if (canvas) {
            const ctx = canvas.getContext('2d');
            if (ctx) {
              const decoder = new VideoDecoder({
                output: (frame: VideoFrame) => {
                  fpsCountRef.current++;
                  ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
                  frame.close();
                  setStatus((prev) => (prev !== 'streaming' ? 'streaming' : prev));
                },
                error: () => {},
              });
              const codecStr = c === 'av1' ? 'av01.0.04M.08' : c === 'vp9' ? 'vp09.00.10.08' : c === 'h265' ? 'hev1.1.6.L93.B0' : 'avc1.640034';
              decoder.configure({
                codec: codecStr,
                codedWidth: agentDims.w,
                codedHeight: agentDims.h,
                optimizeForLatency: true,
              });
              decoderRef.current = decoder;
            }
          }
        }
        break;
      }
      case 'init': {
        const m = msg as InitMsg;
        setCodecId('h264');
        if ((msg as any).monitors) setMonitors((msg as any).monitors);
        if (m.codec === 'h264') {
          onInit(m.width, m.height, m.extradata);
          // If the user has a preferred codec, request a switch after init
          if (preferredCodec && preferredCodec !== 'h264') {
            const ws = wsRef.current;
            if (ws?.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'set_codec', codec: preferredCodec }));
            }
          }
        } else {
          setStatus('error');
          setErrorMsg(`Unsupported codec: ${m.codec ?? 'unknown'}`);
        }
        break;
      }
      case 'resize': {
        const m = msg as ResizeMsg;
        setAgentDims({ w: m.width, h: m.height });
        // Reinitialise decoder at new resolution
        if (decoderRef.current) {
          initDecoder(m.width, m.height);
        }
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
  }, [initDecoder]);

  // ── Input forwarding ──────────────────────────────────────────────────────
  const sendJson = useCallback((obj: object) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  }, []);

  const toAgentCoords = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.round((e.clientX - rect.left) * agentDims.w / rect.width),
      y: Math.round((e.clientY - rect.top)  * agentDims.h / rect.height),
    };
  }, [agentDims]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const { x, y } = toAgentCoords(e);
    sendJson({ type: 'mouse', action: 'move', x, y });
  }, [toAgentCoords, sendJson]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const { x, y } = toAgentCoords(e);
    sendJson({ type: 'mouse', action: 'down', button: e.button, x, y });
  }, [toAgentCoords, sendJson]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const { x, y } = toAgentCoords(e);
    sendJson({ type: 'mouse', action: 'up', button: e.button, x, y });
  }, [toAgentCoords, sendJson]);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.round((e.clientX - rect.left) * agentDims.w / rect.width);
    const y = Math.round((e.clientY - rect.top)  * agentDims.h / rect.height);
    sendJson({ type: 'mouse', action: 'scroll', delta: e.deltaY > 0 ? -1 : 1, x, y });
  }, [agentDims, sendJson]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    e.preventDefault();
    sendJson({ type: 'key', action: 'down', code: e.code, key: e.key,
      ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey });
  }, [sendJson]);

  const handleKeyUp = useCallback((e: React.KeyboardEvent) => {
    e.preventDefault();
    sendJson({ type: 'key', action: 'up', code: e.code, key: e.key,
      ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey });
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

  const handleCodecSwitch = useCallback((newCodec: string) => {
    sendJson({ type: 'set_codec', codec: newCodec });
  }, [sendJson]);

  const handleMonitorSwitch = useCallback((idx: number) => {
    setActiveMonitor(idx);
    sendJson({ type: 'set_monitor', index: idx });
  }, [sendJson]);

  const handleInputBlock = useCallback(() => {
    sendJson({ type: 'set_input_block', block: !inputBlocked });
  }, [sendJson, inputBlocked]);

  // ── Status config ─────────────────────────────────────────────────────────
  const statusCfg: Record<ConnStatus, { label: string; color: string; spin?: boolean }> = {
    connecting:   { label: 'Connecting…',  color: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30', spin: true },
    waiting:      { label: 'Waiting…',     color: 'text-blue-400   bg-blue-400/10   border-blue-400/30',   spin: true },
    streaming:    { label: 'Streaming',    color: 'text-green-400  bg-green-400/10  border-green-400/30'  },
    disconnected: { label: 'Disconnected', color: 'text-gray-400   bg-gray-400/10   border-gray-400/30'   },
    error:        { label: 'Error',        color: 'text-red-400    bg-red-400/10    border-red-400/30'    },
  };
  const sc = statusCfg[status];

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-50 flex flex-col bg-black"
      style={{ top: nativeTop }}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      tabIndex={-1}
    >
      {/* ── Toolbar ── */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-bg-primary border-b border-border shrink-0 gap-3">
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
              {agentDims.w}×{agentDims.h} · {fps} fps · {codec}{bitrate > 0 ? ` · ${(bitrate / 1_000_000).toFixed(1)} Mbps` : ''}
            </span>
          )}

          {errorMsg && (
            <span className="text-xs text-red-400 truncate hidden sm:block">{errorMsg}</span>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {/* ── Monitor selector ── */}
          {status === 'streaming' && monitors.length > 1 && (() => {
            const minX = Math.min(...monitors.map(m => m.x));
            const minY = Math.min(...monitors.map(m => m.y));
            const maxX = Math.max(...monitors.map(m => m.x + m.width));
            const maxY = Math.max(...monitors.map(m => m.y + m.height));
            const totalW = maxX - minX || 1;
            const totalH = maxY - minY || 1;
            const boxW = 100;
            const boxH = Math.round(boxW * totalH / totalW);
            return (
              <div className="relative border border-border rounded bg-bg-tertiary" style={{ width: boxW, height: Math.max(boxH, 20) }} title="Select monitor">
                {monitors.map(m => {
                  const l = ((m.x - minX) / totalW) * 100;
                  const t = ((m.y - minY) / totalH) * 100;
                  const w = (m.width / totalW) * 100;
                  const h = (m.height / totalH) * 100;
                  return (
                    <div
                      key={m.index}
                      onClick={() => handleMonitorSwitch(m.index)}
                      className={clsx(
                        'absolute border cursor-pointer flex items-center justify-center text-[8px] font-bold transition-colors',
                        m.index === activeMonitor
                          ? 'bg-accent/30 border-accent text-accent'
                          : 'bg-bg-secondary/60 border-border/60 text-text-muted hover:bg-accent/10'
                      )}
                      style={{ left: `${l}%`, top: `${t}%`, width: `${w}%`, height: `${h}%` }}
                      title={`${m.name} (${m.width}×${m.height})`}
                    >
                      {m.index + 1}
                    </div>
                  );
                })}
              </div>
            );
          })()}

          {/* ── Codec selector ── */}
          {status === 'streaming' && (
            <select
              value={codecId}
              onChange={e => handleCodecSwitch(e.target.value)}
              title="Video codec"
              className="px-2 py-1 text-xs bg-bg-secondary text-text-muted border border-border rounded hover:text-text-primary transition-colors cursor-pointer"
            >
              <option value="h264">H.264</option>
              <option value="h265">H.265</option>
              <option value="vp9">VP9</option>
              <option value="av1">AV1</option>
              <option value="jpeg">JPEG</option>
            </select>
          )}

          {/* ── Input block toggle ── */}
          {status === 'streaming' && (
            <button
              onClick={handleInputBlock}
              title={inputBlocked ? 'Unblock remote user input' : 'Block remote user input'}
              className={clsx(
                'flex items-center gap-1.5 px-2 py-1 text-xs border rounded transition-colors',
                inputBlocked
                  ? 'bg-orange-500/20 text-orange-400 border-orange-500/30 hover:bg-orange-500/30'
                  : 'bg-bg-secondary text-text-muted border-border hover:text-text-primary hover:bg-bg-tertiary'
              )}
            >
              {inputBlocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">{inputBlocked ? 'Blocked' : 'Block'}</span>
            </button>
          )}

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

      {/* ── Content area (flex-1, relative so overlays are scoped here) ── */}
      <div className="relative flex-1 overflow-hidden bg-black">

        {/* Canvas is always mounted so canvasRef is valid when initDecoder() is called
            during 'waiting' state (before the first frame arrives). Hidden via CSS
            until the decoder produces its first frame (status → 'streaming'). */}
        <div
          ref={containerRef}
          className="absolute inset-0 flex items-center justify-center"
          style={{ display: status === 'streaming' ? 'flex' : 'none' }}
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

        {status === 'error' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center p-8">
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
        )}

        {(status === 'connecting' || status === 'waiting') && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-center p-8 bg-[#0d0f14]">
            <RefreshCw className="w-10 h-10 text-accent animate-spin" />
            <p className="text-text-primary font-medium">
              {status === 'waiting' ? 'Waiting for agent to connect…' : 'Connecting to relay…'}
            </p>
            <p className="text-sm text-text-muted">
              {status === 'waiting'
                ? 'The wake-up command has been sent. The Oblireach agent will connect within 30 s.'
                : 'Establishing encrypted tunnel…'}
            </p>
          </div>
        )}

      </div>
    </div>
  );
}
