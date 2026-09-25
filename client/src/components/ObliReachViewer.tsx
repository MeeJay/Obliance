/**
 * ObliReachViewer — native screen-streaming viewer for the Oblireach protocol.
 *
 * Architecture
 * ────────────
 * Opens a single WebSocket to the built-in Obliance relay (or standalone relay).
 *
 * ● Binary frames → [1 byte type][payload]
 * Type 0x02 = H.264 NAL units (Annex B) → WebCodecs VideoDecoder → canvas
 *
 * ● Text frames = JSON control messages (bidirectional).
 *
 * Codec: H.264 via the WebCodecs API (VideoDecoder).
 * Chrome 94+, Edge 94+, Firefox 130+ (hardware-accelerated decode).
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { Monitor, X, Maximize2, Keyboard, RefreshCw, AlertTriangle, Wifi, Lock, Unlock, MessageCircle, Circle, Camera, Volume2, VolumeX, Command, ShieldAlert, MoreHorizontal, ClipboardPaste, ClipboardCopy, MousePointer2, Hand, Minimize2, ChevronDown, ChevronUp, Copy } from 'lucide-react';
import { clsx } from 'clsx';
import { useNativeTopOffset } from '@/hooks/useNativeTopOffset';
import { useIsCoarsePointer, matchesMedia, MEDIA } from '@/hooks/useMediaQuery';
import { useNativeBack } from '@/hooks/useNativeBack';
import { isAndroidApp } from '@/native/bridge';
import { saveBlob } from '@/utils/download';
import { copyText, readClipboardText } from '@/utils/clipboard';
import { promptDialog } from '@/components/common/ConfirmDialog';
import { Modal } from '@/components/common/Modal';
import { useRemotePointer, type TouchInputMode } from '@/components/remote/useRemotePointer';
import { RemoteKeyBar, KeyChip } from '@/components/remote/RemoteKeyBar';
import { SoftKeyboardInput, type SoftKeyboardHandle } from '@/components/remote/SoftKeyboardInput';
import { ReachToolsSheet } from '@/components/remote/ReachToolsSheet';
import { useKeyboardInset } from '@/components/remote/useKeyboardInset';
import {
 ESSENTIAL_KEYS, NAVIGATION_KEYS, KEY_TO_CODE, MODIFIER_CODES, NO_MODIFIERS,
 activeModifiers, codeForChar, hasModifier,
 type KeyBarKey, type ModifierKey, type Modifiers,
} from '@/components/remote/remoteKeys';

// ── Frame type constants ──────────────────────────────────────────────────────
const FRAME_H264 = 0x02;

// System-key chords sendable from the viewer. Each entry is a list of
// physical key codes (DOM KeyboardEvent.code) pressed together. The agent
// maps these via codeToVK so they hit the remote by position. These are the
// browser-reserved combos a viewer can't type directly (the OS swallows Win+*
// / Alt+Tab / Ctrl+Shift+Esc before the page sees them).
// `id` keys the translated title (reach.chord.<id>); labels are key names.
const SYSTEM_KEY_CHORDS: Array<{ id: string; label: string; codes: string[]; title: string; group: 'win' | 'window' | 'misc' }> = [
 { id: 'win', label: 'Win', codes: ['MetaLeft'], title: 'Windows key — Start menu', group: 'win' },
 { id: 'winD', label: 'Win+D', codes: ['MetaLeft', 'KeyD'], title: 'Show / hide desktop', group: 'win' },
 { id: 'winE', label: 'Win+E', codes: ['MetaLeft', 'KeyE'], title: 'Open File Explorer', group: 'win' },
 { id: 'winR', label: 'Win+R', codes: ['MetaLeft', 'KeyR'], title: 'Run dialog', group: 'win' },
 { id: 'winI', label: 'Win+I', codes: ['MetaLeft', 'KeyI'], title: 'Settings', group: 'win' },
 { id: 'winL', label: 'Win+L', codes: ['MetaLeft', 'KeyL'], title: 'Lock the session', group: 'win' },
 { id: 'winTab', label: 'Win+Tab', codes: ['MetaLeft', 'Tab'], title: 'Task view', group: 'win' },
 { id: 'winUp', label: 'Win+↑', codes: ['MetaLeft', 'ArrowUp'], title: 'Maximize window', group: 'win' },
 { id: 'winDown', label: 'Win+↓', codes: ['MetaLeft', 'ArrowDown'], title: 'Restore / minimize window', group: 'win' },
 { id: 'altTab', label: 'Alt+Tab', codes: ['AltLeft', 'Tab'], title: 'Switch window', group: 'window' },
 { id: 'altF4', label: 'Alt+F4', codes: ['AltLeft', 'F4'], title: 'Close active window', group: 'window' },
 { id: 'taskMgr', label: 'Task Mgr', codes: ['ControlLeft', 'ShiftLeft', 'Escape'], title: 'Ctrl+Shift+Esc — Task Manager', group: 'window' },
 { id: 'ctrlEsc', label: 'Ctrl+Esc', codes: ['ControlLeft', 'Escape'], title: 'Start menu (Ctrl+Esc)', group: 'window' },
 { id: 'esc', label: 'Esc', codes: ['Escape'], title: 'Escape', group: 'misc' },
 { id: 'prtSc', label: 'PrtSc', codes: ['PrintScreen'], title: 'Print Screen (full screen capture on remote)', group: 'misc' },
 { id: 'menu', label: 'Menu', codes: ['ContextMenu'], title: 'Context-menu key', group: 'misc' },
 { id: 'pause', label: 'Pause', codes: ['Pause'], title: 'Pause / Break', group: 'misc' },
];

const CODECS: Array<{ id: string; label: string }> = [
 { id: 'h264', label: 'H.264' },
 { id: 'h265', label: 'H.265' },
 { id: 'vp9', label: 'VP9' },
 { id: 'av1', label: 'AV1' },
 { id: 'jpeg', label: 'JPEG' },
];

const TOUCH_MODE_KEY = 'obliance.reach.touchMode';

function loadTouchMode(): TouchInputMode {
 try { return localStorage.getItem(TOUCH_MODE_KEY) === 'trackpad' ? 'trackpad' : 'direct'; } catch { return 'direct'; }
}

const modifierFlags = (m: Modifiers) => ({ ctrl: m.ctrl, alt: m.alt, shift: m.shift, meta: m.meta });

// ── Types ─────────────────────────────────────────────────────────────────────

type ConnStatus = 'connecting' | 'waiting' | 'streaming' | 'disconnected' | 'error' | 'reconnecting';

export interface ObliReachViewerProps {
 /** Obliance session token (hex, 64 chars). Used to build the WS URL. */
 sessionToken: string | null;
 /** Human-readable device name shown in the toolbar. */
 deviceName: string;
 /** Short-lived HMAC viewer token — only required for standalone relay. */
 viewerToken?: string;
 /** Base URL of the standalone Oblireach relay server (e.g. "wss://relay.example.com").
 * If absent, falls back to the built-in Obliance WebSocket relay. */
 relayHost?: string;
 /** Called when the user clicks Disconnect. */
 onClose: () => void;
 /** User's preferred codec (from profile preferences). If the codec is
 * unavailable on the agent, falls back to JPEG automatically. */
 preferredCodec?: string;
 /** Called when the user clicks the Chat button in the toolbar. */
 onChatToggle?: () => void;
 /** Whether the chat panel is currently open (controls button highlight). */
 chatOpen?: boolean;
 /** Whether chat notification sound is enabled. */
 chatSoundEnabled?: boolean;
 /** Toggle chat sound on/off. */
 onChatSoundToggle?: () => void;
 /** Called when the viewer wants to auto-reconnect after an unexpected
 * WS close (e.g. Winlogon→user-session transition after the operator
 * logs the target in via the CAD screen). The parent should create a
 * new remote session with the same deviceId + wtsSessionId and update
 * the `sessionToken` prop so this component re-opens a fresh WS.
 * Throwing disables further retries. Absent prop disables auto-reconnect
 * entirely (viewer just stays on 'disconnected'). */
 onReconnect?: () => Promise<void>;
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
 onChatToggle,
 chatOpen: chatOpenProp,
 chatSoundEnabled,
 onChatSoundToggle,
 onReconnect,
}: ObliReachViewerProps) {
 const canvasRef = useRef<HTMLCanvasElement>(null);
 const containerRef = useRef<HTMLDivElement>(null);
 const wsRef = useRef<WebSocket | null>(null);
 const decoderRef = useRef<VideoDecoder | null>(null);
 const rafRef = useRef<number>(0);

 // Auto-reconnect state — survives re-renders and useEffect re-runs so a
 // burst of quick close→reconnect→close doesn't reset the counter. Reset
 // to 0 on a successful ws.onopen below.
 const reconnectAttemptsRef = useRef(0);
 const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
 const MAX_RECONNECT_ATTEMPTS = 5;
 const RECONNECT_DELAY_MS = 2000;

 const [status, setStatus] = useState<ConnStatus>('connecting');
 const [errorMsg, setErrorMsg] = useState('');
 const [agentDims, setAgentDims] = useState({ w: 1920, h: 1080 });
 const [fps, setFps] = useState(0);
 const [codecId, setCodecId] = useState('h264'); // technical id: h264, h265, vp9, jpeg
 const [bitrate, setBitrate] = useState(0);
 const [isFullscreen, setIsFullscreen] = useState(false);
 const [monitors, setMonitors] = useState<Array<{index:number;name:string;x:number;y:number;width:number;height:number}>>([]);
 const [activeMonitor, setActiveMonitor] = useState(0);
 const [inputBlocked, setInputBlocked] = useState(false);
 const [isRecording, setIsRecording] = useState(false);
 const [audioEnabled, setAudioEnabled] = useState(true); // enabled by default when available
 const [hasAudio, setHasAudio] = useState(false);
 const [sysKeysOpen, setSysKeysOpen] = useState(false);
 const audioCtxRef = useRef<AudioContext | null>(null);
 const audioRateRef = useRef(48000);
 const audioEnabledRef = useRef(audioEnabled);
 useEffect(() => { audioEnabledRef.current = audioEnabled; }, [audioEnabled]);
 const mediaRecorderRef = useRef<MediaRecorder | null>(null);
 const recordedChunks = useRef<Blob[]>([]);
 const codecLabel: Record<string,string> = { h264: 'H.264', h265: 'H.265', vp9: 'VP9', av1: 'AV1', jpeg: 'JPEG' };
 const codec = codecLabel[codecId] || codecId.toUpperCase();
 const nativeTop = useNativeTopOffset();
 const { t } = useTranslation();

 // ── Touch / mobile state (docs/obli-mobile.md §5) ─────────────────────────
 const isCoarse = useIsCoarsePointer();
 const isCoarseRef = useRef(isCoarse);
 isCoarseRef.current = isCoarse;
 const inAndroidApp = isAndroidApp();
 const keyboardInset = useKeyboardInset(isCoarse);
 const rootRef = useRef<HTMLDivElement>(null);
 const softKbRef = useRef<SoftKeyboardHandle>(null);
 const [softKbOpen, setSoftKbOpen] = useState(false);
 const [keyBarOpen, setKeyBarOpen] = useState(true);
 const [toolsOpen, setToolsOpen] = useState(false);
 const [touchMode, setTouchModeState] = useState<TouchInputMode>(loadTouchMode);
 const setTouchMode = useCallback((m: TouchInputMode) => {
 setTouchModeState(m);
 try { localStorage.setItem(TOUCH_MODE_KEY, m); } catch { /* private mode */ }
 }, []);
 // Modifiers latched from the key bar: applied to the next key, typed character or tap.
 const [latched, setLatchedState] = useState<Modifiers>(NO_MODIFIERS);
 const latchedRef = useRef<Modifiers>(NO_MODIFIERS);
 const setLatched = useCallback((m: Modifiers) => { latchedRef.current = m; setLatchedState(m); }, []);
 const touchModCodesRef = useRef<string[]>([]);
 const [inactivityWarn, setInactivityWarn] = useState(false);
 const inactivityWarnRef = useRef(false);
 useEffect(() => { inactivityWarnRef.current = inactivityWarn; }, [inactivityWarn]);
 // Remote clipboard text waiting for a user gesture to be copied locally.
 const [remoteClip, setRemoteClip] = useState<string | null>(null);
 const awaitingClipRef = useRef(false);
 const hasAudioRef = useRef(false);
 useEffect(() => { hasAudioRef.current = hasAudio; }, [hasAudio]);
 const lastMouseRef = useRef<{ x: number; y: number } | null>(null);

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
 canvas.width = width;
 canvas.height = height;
 const ctx = canvas.getContext('2d');
 if (!ctx) return;

 if (typeof VideoDecoder === 'undefined') {
 setStatus('error');
 setErrorMsg(t('reach.err.webcodecs', 'WebCodecs not supported in this browser (Chrome/Edge 94+, Firefox 130+).'));
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
 setErrorMsg(t('reach.err.decoder', 'Decoder error: {{msg}}', { msg: String((err as Error).message ?? err) }));
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
 codedWidth: width,
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

 ws.onopen = () => {
 if (!active) return;
 setStatus('waiting');
 // Successful connect — clear any pending retry state.
 reconnectAttemptsRef.current = 0;
 if (reconnectTimerRef.current) {
 clearTimeout(reconnectTimerRef.current);
 reconnectTimerRef.current = null;
 }
 };
 ws.onclose = (ev) => {
 if (!active) return;
 // Kick off auto-reconnect. The parent implements onReconnect by
 // calling remoteApi.startSession again and updating sessionToken —
 // which flips wsUrl and re-runs this effect on a fresh WS. This is
 // TeamViewer/RustDesk's behaviour after the Winlogon→user-session
 // transition tears the tunnel down on login.
 if (onReconnect && reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
 reconnectAttemptsRef.current++;
 const n = reconnectAttemptsRef.current;
 console.log(`[reach] ws close code=${ev.code} wasClean=${ev.wasClean} — scheduling reconnect ${n}/${MAX_RECONNECT_ATTEMPTS}`);
 setStatus('reconnecting');
 setErrorMsg(t('reach.reconnectingN', 'Reconnecting ({{n}}/{{max}})...', { n, max: MAX_RECONNECT_ATTEMPTS }));
 reconnectTimerRef.current = setTimeout(() => {
 reconnectTimerRef.current = null;
 onReconnect().catch((e) => {
 console.error('[reach] onReconnect threw, giving up:', e);
 if (active) {
 setStatus('disconnected');
 setErrorMsg('');
 }
 });
 }, RECONNECT_DELAY_MS);
 } else {
 setStatus('disconnected');
 }
 };
 ws.onerror = () => {
 if (!active) return;
 // Don't flip to 'error' if a reconnect is already scheduled — onclose
 // will fire right after and set 'reconnecting' which is more
 // informative for the operator.
 if (!onReconnect || reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
 setStatus('error');
 setErrorMsg(t('reach.err.ws', 'WebSocket connection failed'));
 }
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

 if (frameType === 0x06 && audioEnabledRef.current) {
 // Audio frame — PCM 16-bit mono LE
 if (!audioCtxRef.current) {
 try { audioCtxRef.current = new AudioContext({ sampleRate: audioRateRef.current }); } catch {}
 }
 const ctx = audioCtxRef.current;
 if (ctx) {
 const pcm16 = new Int16Array(buf.slice(1));
 const audioBuffer = ctx.createBuffer(1, pcm16.length, audioRateRef.current);
 const channel = audioBuffer.getChannelData(0);
 for (let i = 0; i < pcm16.length; i++) channel[i] = pcm16[i] / 32768;
 const source = ctx.createBufferSource();
 source.buffer = audioBuffer;
 source.connect(ctx.destination);
 source.start();
 }
 return;
 }

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
 // Cancel any pending auto-reconnect from the OLD effect run. The new
 // effect (triggered by sessionToken change) starts with a fresh
 // counter unless the reconnect itself scheduled this re-run.
 if (reconnectTimerRef.current) {
 clearTimeout(reconnectTimerRef.current);
 reconnectTimerRef.current = null;
 }
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
 case 'clipboard_content': {
 // Remote clipboard → local clipboard
 const text: string = (msg as any).text;
 if (text) {
 if (awaitingClipRef.current) {
 // Explicit "Copy from remote": show the text so the local copy
 // happens inside a user gesture (mobile browsers / WebView refuse
 // clipboard writes from a WebSocket callback).
 awaitingClipRef.current = false;
 setRemoteClip(text);
 } else {
 copyText(text).then((ok) => { if (!ok && isCoarseRef.current) setRemoteClip(text); });
 }
 }
 break;
 }
 case 'inactivity_warning':
 setErrorMsg(t('reach.inactivityWarning', 'Session will disconnect in {{seconds}}s due to inactivity', { seconds: (msg as any).seconds || 30 }));
 setInactivityWarn(true);
 break;
 case 'inactivity_timeout':
 setStatus('disconnected');
 setErrorMsg(t('reach.inactivityTimeout', 'Session disconnected due to inactivity'));
 setInactivityWarn(false);
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
 if ((msg as any).audioAvail) { setHasAudio(true); audioRateRef.current = (msg as any).audioRate || 48000; }
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
 setErrorMsg(t('reach.err.codec', 'Unsupported codec: {{codec}}', { codec: m.codec ?? 'unknown' }));
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
 setErrorMsg((msg as any).message || t('reach.err.relay', 'Relay error'));
 break;
 }
 }, [initDecoder]);

 // ── Input forwarding ──────────────────────────────────────────────────────
 const sendJson = useCallback((obj: object) => {
 const ws = wsRef.current;
 const o = obj as { type?: string; action?: string; x?: number; y?: number };
 if (o.type === 'mouse' && o.action !== 'scroll' && typeof o.x === 'number' && typeof o.y === 'number') {
 lastMouseRef.current = { x: o.x, y: o.y };
 }
 if (ws?.readyState === WebSocket.OPEN) {
 ws.send(JSON.stringify(obj));
 // Any input resets the relay's inactivity timer: drop the warning
 // banner shown over the screen (touch screens / narrow windows) instead
 // of leaving it over the remote's title bars for the rest of the session.
 if (inactivityWarnRef.current && (o.type === 'mouse' || o.type === 'key')
 && (isCoarseRef.current || !matchesMedia(MEDIA.sm))) {
 inactivityWarnRef.current = false;
 setInactivityWarn(false);
 setErrorMsg('');
 }
 }
 }, []);

 // ── Touch helpers ─────────────────────────────────────────────────────────
 // Take (and clear) the modifiers latched in the key bar.
 const consumeLatched = useCallback((): Modifiers => {
 const m = latchedRef.current;
 if (hasModifier(m)) setLatched(NO_MODIFIERS);
 return m;
 }, [setLatched]);

 // Remote audio needs an AudioContext created / resumed inside a user
 // gesture on mobile (autoplay policy): do it on the first taps and on the
 // audio toggle.
 const ensureAudio = useCallback(() => {
 if (!hasAudioRef.current || !audioEnabledRef.current) return;
 if (!audioCtxRef.current) {
 try { audioCtxRef.current = new AudioContext({ sampleRate: audioRateRef.current }); } catch { return; }
 }
 const ctx = audioCtxRef.current;
 if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
 }, []);

 // Latched modifiers wrap a touch click (Ctrl+click, Shift+click…).
 const handleTouchButton = useCallback((phase: 'down' | 'up') => {
 if (phase === 'down') {
 const m = consumeLatched();
 const codes = activeModifiers(m).map((k) => MODIFIER_CODES[k]);
 touchModCodesRef.current = codes;
 for (const code of codes) sendJson({ type: 'key', action: 'down', code, key: '', ...modifierFlags(m) });
 } else {
 const codes = touchModCodesRef.current;
 touchModCodesRef.current = [];
 for (const code of [...codes].reverse()) sendJson({ type: 'key', action: 'up', code, key: '', ...modifierFlags(NO_MODIFIERS) });
 }
 }, [consumeLatched, sendJson]);

 const handleTouchStart = useCallback(() => {
 ensureAudio();
 // Keep hardware (Bluetooth) keyboards working after a tap, but never
 // steal the focus from the soft-keyboard field (that would close it).
 if (!softKbRef.current?.isFocused()) rootRef.current?.focus({ preventScroll: true });
 }, [ensureAudio]);

 // Mouse: unchanged forwarding. Touch: gestures (tap, long-press, two-finger
 // scroll, pinch zoom, trackpad mode) — see components/remote/useRemotePointer.
 const pointer = useRemotePointer({
 canvasRef,
 agentDims,
 send: sendJson,
 // Trackpad mode is a touch-screen option: a fine-pointer session (e.g. a
 // docked 2-in-1 that saved "trackpad" earlier) never gets its static cursor.
 touchMode: isCoarse ? touchMode : 'direct',
 onTouchButton: handleTouchButton,
 onTouchStart: handleTouchStart,
 });

 const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
 // Keys typed in portalled overlays (tools sheet) are not for the remote.
 if (!rootRef.current?.contains(e.target as Node)) return;
 // Soft keyboards send keyCode 229 / 'Unidentified' while composing: the
 // hidden text field turns those into text (SoftKeyboardInput).
 if (e.key === 'Unidentified' || e.keyCode === 229 || e.nativeEvent.isComposing) return;
 e.preventDefault();
 // Intercept Ctrl+V to sync clipboard to remote
 if ((e.ctrlKey || e.metaKey) && e.code === 'KeyV') {
 readClipboardText().then(text => {
 if (text) sendJson({ type: 'clipboard_set', text });
 }).catch(() => {});
 }
 // Intercept Ctrl+C to request clipboard from remote
 if ((e.ctrlKey || e.metaKey) && e.code === 'KeyC') {
 sendJson({ type: 'clipboard_get' });
 }
 // Soft keyboards report named keys (Enter, Backspace…) without a code.
 const code = e.code || KEY_TO_CODE[e.key] || '';
 sendJson({ type: 'key', action: 'down', code, key: e.key,
 ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey });
 }, [sendJson]);

 const handleKeyUp = useCallback((e: React.KeyboardEvent) => {
 if (!rootRef.current?.contains(e.target as Node)) return;
 if (e.key === 'Unidentified' || e.keyCode === 229 || e.nativeEvent.isComposing) return;
 e.preventDefault();
 const code = e.code || KEY_TO_CODE[e.key] || '';
 sendJson({ type: 'key', action: 'up', code, key: e.key,
 ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey });
 }, [sendJson]);

 const handleCtrlAltDel = useCallback(() => {
 const keys = [
 { code: 'ControlLeft', ctrl: true },
 { code: 'AltLeft', ctrl: true, alt: true },
 { code: 'Delete', ctrl: true, alt: true },
 ];
 for (const k of keys) sendJson({ type: 'key', action: 'down', ...k });
 setTimeout(() => {
 for (const k of [...keys].reverse()) sendJson({ type: 'key', action: 'up', ...k });
 }, 50);
 }, [sendJson]);

 // Send an arbitrary chord by physical key code. Presses every code down in
 // order, then releases in reverse — exactly how a real key combo fires.
 // `key:''` forces the agent's physical-code path (codeToVK) so combos map
 // by position, immune to the browser's keyboard layout (Win+R lands on the
 // remote's R regardless of AZERTY/QWERTZ). The modifier flags are derived
 // from the codes so the agent's SAS detection + any flag-based logic stay
 // consistent.
 const sendKeyChord = useCallback((codes: string[]) => {
 if (!codes.length) return;
 const mods = {
 ctrl: codes.some((c) => c.startsWith('Control')),
 alt: codes.some((c) => c.startsWith('Alt')),
 shift: codes.some((c) => c.startsWith('Shift')),
 meta: codes.some((c) => c.startsWith('Meta')),
 };
 for (const code of codes) {
 sendJson({ type: 'key', action: 'down', code, key: '', ...mods });
 }
 setTimeout(() => {
 for (const code of [...codes].reverse()) {
 sendJson({ type: 'key', action: 'up', code, key: '', ...mods });
 }
 }, 40);
 setSysKeysOpen(false);
 }, [sendJson]);

 const handleFullscreen = useCallback(() => {
 // Touch screens: a remote desktop is landscape — try to lock the
 // orientation once fullscreen (only allowed there; ignored elsewhere).
 const orientation = (typeof screen !== 'undefined' ? screen.orientation : undefined) as
 (ScreenOrientation & { lock?: (o: string) => Promise<void> }) | undefined;
 if (!isFullscreen) {
 const p = document.documentElement.requestFullscreen?.();
 p?.then?.(() => {
 if (isCoarseRef.current) orientation?.lock?.('landscape')?.catch?.(() => {});
 })?.catch?.(() => {});
 } else {
 try { if (isCoarseRef.current) orientation?.unlock?.(); } catch { /* not locked */ }
 document.exitFullscreen?.()?.catch?.(() => {});
 }
 setIsFullscreen(!isFullscreen);
 }, [isFullscreen]);

 // Keep the fullscreen state in sync when the browser leaves fullscreen by
 // itself (Esc, F11, WebView without fullscreen support).
 useEffect(() => {
 const onChange = () => setIsFullscreen(!!document.fullscreenElement);
 document.addEventListener('fullscreenchange', onChange);
 return () => document.removeEventListener('fullscreenchange', onChange);
 }, []);

 const handleClose = useCallback(() => {
 if (mediaRecorderRef.current?.state === 'recording') {
 mediaRecorderRef.current.stop();
 }
 try { audioCtxRef.current?.close(); } catch {}
 audioCtxRef.current = null;
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

 const handleScreenshot = useCallback(() => {
 const canvas = canvasRef.current;
 if (!canvas) return;
 canvas.toBlob((blob) => {
 if (!blob) return;
 saveBlob(blob, `oblireach-screenshot-${new Date().toISOString().replace(/[:.]/g, '-')}.png`, 'image/png')
 .then((ok) => { if (!ok) toast.error(t('reach.saveFailed', 'Could not save the file')); });
 }, 'image/png');
 }, [t]);

 const handleToggleRecording = useCallback(() => {
 if (isRecording) {
 // Stop recording
 mediaRecorderRef.current?.stop();
 setIsRecording(false);
 } else {
 // Start recording
 const canvas = canvasRef.current;
 if (!canvas) return;
 try {
 const stream = canvas.captureStream(15);
 const mr = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 5_000_000 });
 recordedChunks.current = [];
 mr.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.current.push(e.data); };
 mr.onstop = () => {
 const blob = new Blob(recordedChunks.current, { type: 'video/webm' });
 recordedChunks.current = [];
 saveBlob(blob, `oblireach-recording-${new Date().toISOString().replace(/[:.]/g, '-')}.webm`, 'video/webm')
 .then((ok) => { if (!ok) toast.error(t('reach.saveFailed', 'Could not save the file')); });
 };
 mr.start(1000); // collect data every second
 mediaRecorderRef.current = mr;
 setIsRecording(true);
 } catch (e) {
 console.error('Recording failed:', e);
 }
 }
 }, [isRecording, t]);

 // ── Soft keyboard / key bar (touch) ───────────────────────────────────────
 const pressKey = useCallback((code: string) => {
 const m = consumeLatched();
 sendKeyChord([...activeModifiers(m).map((k) => MODIFIER_CODES[k]), code]);
 }, [consumeLatched, sendKeyChord]);

 const typePlain = useCallback((text: string) => {
 const flags = modifierFlags(NO_MODIFIERS);
 for (const ch of Array.from(text)) {
 sendJson({ type: 'key', action: 'down', code: '', key: ch, ...flags });
 sendJson({ type: 'key', action: 'up', code: '', key: ch, ...flags });
 }
 }, [sendJson]);

 // Characters go through the agent's layout-aware `key` path; a latched
 // modifier applies to the first one (Ctrl+C, Alt+F…).
 const typeText = useCallback((text: string) => {
 const m = consumeLatched();
 if (!hasModifier(m)) { typePlain(text); return; }
 const [first, ...rest] = Array.from(text);
 const modCodes = activeModifiers(m).map((k) => MODIFIER_CODES[k]);
 const code = codeForChar(first);
 if (code) {
 sendKeyChord([...modCodes, code]);
 } else {
 const flags = modifierFlags(m);
 for (const c of modCodes) sendJson({ type: 'key', action: 'down', code: c, key: '', ...flags });
 sendJson({ type: 'key', action: 'down', code: '', key: first, ...flags });
 sendJson({ type: 'key', action: 'up', code: '', key: first, ...flags });
 for (const c of [...modCodes].reverse()) sendJson({ type: 'key', action: 'up', code: c, key: '', ...modifierFlags(NO_MODIFIERS) });
 }
 // After the chord's release (sendKeyChord releases after 40 ms).
 if (rest.length) setTimeout(() => typePlain(rest.join('')), 60);
 }, [consumeLatched, sendJson, sendKeyChord, typePlain]);

 const handleBarKey = useCallback((k: KeyBarKey) => {
 if (k.code) pressKey(k.code);
 else if (k.text) typeText(k.text);
 }, [pressKey, typeText]);

 const toggleModifier = useCallback((m: ModifierKey) => {
 setLatched({ ...latchedRef.current, [m]: !latchedRef.current[m] });
 }, [setLatched]);

 const toggleSoftKeyboard = useCallback(() => {
 const kb = softKbRef.current;
 if (!kb) return;
 if (kb.isFocused()) {
 kb.blur();
 } else {
 setKeyBarOpen(true);
 kb.focus();
 }
 }, []);

 // ── Clipboard (buttons: Ctrl+V / Ctrl+C need a hardware keyboard) ──────────
 const handlePasteToRemote = useCallback(async () => {
 let text = await readClipboardText();
 if (text === null) {
 // Clipboard read refused (WebView / permission): let the user paste by hand.
 text = await promptDialog({
 title: t('reach.pasteToRemote', 'Paste to remote'),
 message: t('reach.pasteManually', 'Paste the text to send to the remote clipboard.'),
 multiline: true,
 required: true,
 confirmLabel: t('reach.send', 'Send'),
 });
 }
 if (!text) return;
 sendJson({ type: 'clipboard_set', text });
 // Give the agent time to set its clipboard, then paste there.
 setTimeout(() => sendKeyChord(['ControlLeft', 'KeyV']), 150);
 toast.success(t('reach.pasted', 'Clipboard sent to the remote'));
 }, [sendJson, sendKeyChord, t]);

 const handleCopyFromRemote = useCallback(() => {
 awaitingClipRef.current = true;
 sendKeyChord(['ControlLeft', 'KeyC']);
 setTimeout(() => sendJson({ type: 'clipboard_get' }), 300);
 // Nothing came back: stop waiting so a later auto-sync is not shown as a sheet.
 setTimeout(() => { awaitingClipRef.current = false; }, 5000);
 }, [sendJson, sendKeyChord]);

 const copyRemoteClip = useCallback(async () => {
 if (remoteClip === null) return;
 const ok = await copyText(remoteClip);
 if (ok) {
 toast.success(t('common.copied', 'Copied!'));
 setRemoteClip(null);
 } else {
 toast.error(t('reach.copyFailed', 'Copy failed — select the text and copy it manually'));
 }
 }, [remoteClip, t]);

 const stayConnected = useCallback(() => {
 const p = lastMouseRef.current ?? { x: Math.round(agentDims.w / 2), y: Math.round(agentDims.h / 2) };
 sendJson({ type: 'mouse', action: 'move', x: p.x, y: p.y });
 setInactivityWarn(false);
 setErrorMsg('');
 }, [agentDims, sendJson]);

 // Android back closes the viewer (and ends the session) instead of
 // navigating the page underneath. Stacked sheets close first.
 useNativeBack(() => { handleClose(); return true; }, true);

 // Mobile browsers (outside the Android app): the system back gesture would
 // change the route and unmount the viewer without ending the session. While
 // the viewer is open, keep a same-URL history entry on top and treat popping
 // it as Disconnect. Touch screens only — desktop history is untouched.
 const trapBrowserBack = isCoarse && !inAndroidApp;
 const handleCloseRef = useRef(handleClose);
 handleCloseRef.current = handleClose;
 useEffect(() => {
 if (!trapBrowserBack) return;
 const MARK = '__obliReachViewer';
 let pushed = false;
 let popped = false;
 // Deferred so a StrictMode mount → unmount → mount never pushes twice
 // (and never runs the history.back() below against the second entry).
 const timer = window.setTimeout(() => {
 const prev = window.history.state;
 window.history.pushState({ ...(prev && typeof prev === 'object' ? prev : {}), [MARK]: true }, '');
 pushed = true;
 }, 0);
 const onPop = () => {
 if (!pushed || popped) return;
 popped = true;
 handleCloseRef.current();
 };
 window.addEventListener('popstate', onPop);
 return () => {
 window.clearTimeout(timer);
 window.removeEventListener('popstate', onPop);
 // Closed from the UI: drop our entry — only while it is still the
 // current one (a route change has already replaced it).
 const cur = window.history.state as Record<string, unknown> | null;
 if (pushed && !popped && cur && cur[MARK]) window.history.back();
 };
 }, [trapBrowserBack]);

 // Unmounted without handleClose (route change, parent state): still
 // finalize an active recording — its onstop saves the file instead of
 // silently discarding it — and release the audio context.
 useEffect(() => () => {
 const mr = mediaRecorderRef.current;
 if (mr && mr.state === 'recording') {
 try { mr.stop(); } catch { /* already stopped */ }
 }
 try { audioCtxRef.current?.close(); } catch { /* already closed */ }
 audioCtxRef.current = null;
 }, []);

 // Lets the app shell hide its floating widgets while a remote screen is open.
 useEffect(() => {
 const root = document.documentElement;
 root.dataset.remoteViewer = 'open';
 return () => { delete root.dataset.remoteViewer; };
 }, []);

 // ── Status config ─────────────────────────────────────────────────────────
 const statusCfg: Record<ConnStatus, { label: string; color: string; spin?: boolean }> = {
 connecting: { label: t('reach.status.connecting', 'Connecting…'), color: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30', spin: true },
 waiting: { label: t('reach.status.waiting', 'Waiting…'), color: 'text-blue-400 bg-blue-400/10 border-blue-400/30', spin: true },
 streaming: { label: t('reach.status.streaming', 'Streaming'), color: 'text-green-400 bg-green-400/10 border-green-400/30' },
 reconnecting: { label: t('reach.status.reconnecting', 'Reconnecting…'), color: 'text-orange-400 bg-orange-400/10 border-orange-400/30', spin: true },
 disconnected: { label: t('reach.status.disconnected', 'Disconnected'), color: 'text-gray-400 bg-gray-400/10 border-gray-400/30' },
 error: { label: t('reach.status.error', 'Error'), color: 'text-red-400 bg-red-400/10 border-red-400/30' },
 };
 const sc = statusCfg[status];
 const streaming = status === 'streaming';
 const chordGroupLabel = (g: 'win' | 'window' | 'misc') =>
 g === 'win' ? t('reach.chordGroup.win', 'Windows') : g === 'window' ? t('reach.chordGroup.window', 'Windows & apps') : t('reach.chordGroup.misc', 'Misc');
 const chords = SYSTEM_KEY_CHORDS.map((k) => ({ ...k, title: t(`reach.chord.${k.id}`, k.title) }));
 const touchKeys: KeyBarKey[] = [...ESSENTIAL_KEYS, ...NAVIGATION_KEYS];
 // 40 px targets on touch screens (desktop sizes unchanged).
 const TB = 'coarse:min-h-10 coarse:min-w-10 coarse:justify-center';
 const toggleAudio = () => {
 const next = !audioEnabled;
 setAudioEnabled(next);
 if (next) { audioEnabledRef.current = true; ensureAudio(); }
 };
 // Toolbar buttons used while typing must not blur the soft-keyboard field.
 const keepFocus = {
 onPointerDown: (e: React.PointerEvent) => { if (e.pointerType !== 'mouse') e.preventDefault(); },
 onMouseDown: (e: React.MouseEvent) => { if (isCoarseRef.current) e.preventDefault(); },
 };

 // ── Render ────────────────────────────────────────────────────────────────
 return (
 <div
 ref={rootRef}
 className="fixed inset-x-0 bottom-0 z-50 flex flex-col bg-black pt-safe px-safe"
 style={keyboardInset > 0 ? { top: nativeTop, bottom: keyboardInset } : { top: nativeTop }}
 onKeyDown={handleKeyDown}
 onKeyUp={handleKeyUp}
 tabIndex={-1}
 >
 {/* ── Toolbar ── */}
 <div className="flex items-center justify-between px-3 py-1.5 bg-bg-primary shrink-0 gap-3 max-lg:flex-wrap max-lg:gap-y-1 coarse:flex-wrap coarse:gap-y-1">
 <div className="flex items-center gap-2 min-w-0 max-md:flex-1 max-md:basis-0">
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

 {/* Right cluster: one row on desktop. Below lg (and on any touch
 screen) it may shrink to the toolbar width so its own flex-wrap
 applies — with shrink-0 it kept its max-content width and pushed
 Disconnect off-screen. On phones and touch tablets the secondary
 controls live in the "⋯" tools sheet. */}
 <div className="flex items-center gap-1 shrink-0 max-lg:flex-wrap max-lg:justify-end max-lg:ml-auto max-lg:shrink max-lg:min-w-0 coarse:flex-wrap coarse:justify-end coarse:ml-auto coarse:shrink coarse:min-w-0">
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
 <div className="relative rounded bg-bg-tertiary max-md:hidden max-lg:coarse:hidden" style={{ width: boxW, height: Math.max(boxH, 20) }} title={t('reach.selectMonitor', 'Select monitor')}>
 {monitors.map(m => {
 const l = ((m.x - minX) / totalW) * 100;
 const top = ((m.y - minY) / totalH) * 100;
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
 : 'bg-bg-secondary/60 border-transparent/60 text-text-muted hover:bg-accent/10'
 )}
 style={{ left: `${l}%`, top: `${top}%`, width: `${w}%`, height: `${h}%` }}
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
 title={t('reach.codec', 'Video codec')}
 aria-label={t('reach.codec', 'Video codec')}
 className="px-2 py-1 text-xs bg-bg-secondary text-text-muted rounded hover:text-text-primary transition-colors cursor-pointer max-md:hidden max-lg:coarse:hidden coarse:min-h-10"
 >
 {CODECS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
 </select>
 )}

 {/* ── Input block toggle ── */}
 {status === 'streaming' && (
 <button
 onClick={handleInputBlock}
 title={inputBlocked ? t('reach.unblockInput', 'Unblock remote user input') : t('reach.blockInput', 'Block remote user input')}
 className={clsx(
 'flex items-center gap-1.5 px-2 py-1 text-xs border rounded transition-colors max-md:hidden max-lg:coarse:hidden', TB,
 inputBlocked
 ? 'bg-orange-500/20 text-orange-400 border-orange-500/30 hover:bg-orange-500/30'
 : 'bg-bg-secondary text-text-muted border-transparent hover:text-text-primary hover:bg-bg-tertiary'
 )}
 >
 {inputBlocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
 <span className="hidden sm:inline">{inputBlocked ? t('reach.blocked', 'Blocked') : t('reach.block', 'Block')}</span>
 </button>
 )}

 {/* ── Chat toggle ── */}
 {onChatToggle && (
 <button
 onClick={onChatToggle}
 title={chatOpenProp ? t('reach.hideChat', 'Hide chat') : t('reach.chatWithUser', 'Chat with user')}
 className={clsx(
 'flex items-center gap-1.5 px-2 py-1 text-xs border rounded transition-colors max-md:hidden', TB,
 chatOpenProp
 ? 'bg-blue-500/20 text-blue-400 border-blue-500/30'
 : 'bg-bg-secondary text-text-muted border-transparent hover:text-text-primary hover:bg-bg-tertiary'
 )}
 >
 <MessageCircle className="w-3.5 h-3.5" />
 <span className="hidden sm:inline">{t('reach.chat', 'Chat')}</span>
 </button>
 )}

 {/* ── Chat sound toggle ── */}
 {onChatSoundToggle && (
 <button
 onClick={onChatSoundToggle}
 title={chatSoundEnabled ? t('reach.muteChat', 'Mute chat notifications') : t('reach.unmuteChat', 'Unmute chat notifications')}
 aria-label={chatSoundEnabled ? t('reach.muteChat', 'Mute chat notifications') : t('reach.unmuteChat', 'Unmute chat notifications')}
 className={clsx(
 'p-1.5 rounded transition-colors max-md:hidden max-lg:coarse:hidden', TB,
 chatSoundEnabled
 ? 'text-text-muted hover:text-text-primary hover:bg-bg-secondary'
 : 'text-red-400 bg-red-500/10'
 )}
 >
 {chatSoundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
 </button>
 )}

 {/* ── Audio toggle ── */}
 {status === 'streaming' && hasAudio && (
 <button
 onClick={toggleAudio}
 title={audioEnabled ? t('reach.muteAudio', 'Mute remote audio') : t('reach.enableAudio', 'Enable remote audio')}
 aria-label={audioEnabled ? t('reach.muteAudio', 'Mute remote audio') : t('reach.enableAudio', 'Enable remote audio')}
 className={clsx(
 'p-1.5 rounded transition-colors max-md:hidden max-lg:coarse:hidden', TB,
 audioEnabled
 ? 'text-accent hover:text-accent/70'
 : 'text-text-muted hover:text-text-primary hover:bg-bg-secondary'
 )}
 >
 {audioEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
 </button>
 )}

 {/* ── Screenshot ── */}
 {status === 'streaming' && (
 <button onClick={handleScreenshot} title={t('reach.screenshot', 'Take screenshot')} aria-label={t('reach.screenshot', 'Take screenshot')}
 className={clsx('p-1.5 text-text-muted hover:text-text-primary hover:bg-bg-secondary rounded transition-colors max-md:hidden max-lg:coarse:hidden', TB)}>
 <Camera className="w-4 h-4" />
 </button>
 )}

 {/* ── Record toggle ── */}
 {status === 'streaming' && (
 <button
 onClick={handleToggleRecording}
 title={isRecording ? t('reach.stopRecording', 'Stop recording') : t('reach.record', 'Record session')}
 className={clsx(
 'flex items-center gap-1.5 px-2 py-1 text-xs border rounded transition-colors max-md:hidden', TB,
 // Touch tablets: in the tools sheet, but kept visible while recording.
 !isRecording && 'max-lg:coarse:hidden',
 isRecording
 ? 'bg-red-500/20 text-red-400 border-red-500/30 animate-pulse'
 : 'bg-bg-secondary text-text-muted border-transparent hover:text-text-primary hover:bg-bg-tertiary'
 )}
 >
 <Circle className={clsx('w-3.5 h-3.5', isRecording && 'fill-red-400')} />
 <span className="hidden sm:inline">{isRecording ? t('reach.stop', 'Stop') : t('reach.recordShort', 'Record')}</span>
 </button>
 )}

 {/* ── Soft keyboard (touch screens) ── */}
 {isCoarse && streaming && (
 <button
 {...keepFocus}
 onClick={toggleSoftKeyboard}
 aria-pressed={softKbOpen}
 aria-label={softKbOpen ? t('reach.hideKeyboard', 'Hide keyboard') : t('reach.showKeyboard', 'Show keyboard')}
 className={clsx(
 'flex items-center gap-1.5 px-2 py-1 text-xs rounded transition-colors', TB,
 softKbOpen ? 'bg-accent/15 text-accent' : 'bg-bg-secondary text-text-muted',
 )}
 >
 <Keyboard className="w-3.5 h-3.5" />
 <span className="hidden sm:inline">{t('reach.keyboard', 'Keyboard')}</span>
 </button>
 )}

 <button
 {...keepFocus}
 onClick={handleCtrlAltDel}
 disabled={status !== 'streaming'}
 title={t('reach.sendCad', 'Send Ctrl+Alt+Del')}
 aria-label={t('reach.sendCad', 'Send Ctrl+Alt+Del')}
 className={clsx('flex items-center gap-1.5 px-2 py-1 text-xs bg-bg-secondary text-text-muted rounded hover:text-text-primary hover:bg-bg-tertiary disabled:opacity-40 transition-colors', TB)}
 >
 <Keyboard className="w-3.5 h-3.5 coarse:hidden" />
 <ShieldAlert className="w-3.5 h-3.5 hidden coarse:block" />
 <span className="hidden sm:inline">Ctrl+Alt+Del</span>
 </button>

 {/* ── System keys — Windows/Alt/system combos the browser swallows ── */}
 <div className="relative max-md:hidden max-lg:coarse:hidden">
 <button
 onClick={() => setSysKeysOpen((v) => !v)}
 disabled={status !== 'streaming'}
 title={t('reach.systemKeysHint', 'Send system keys (Win, Alt+Tab, Task Manager…)')}
 className={clsx(
 'flex items-center gap-1.5 px-2 py-1 text-xs rounded transition-colors disabled:opacity-40', TB,
 sysKeysOpen
 ? 'bg-accent/15 text-accent'
 : 'bg-bg-secondary text-text-muted hover:text-text-primary hover:bg-bg-tertiary',
 )}
 >
 <Command className="w-3.5 h-3.5" />
 <span className="hidden sm:inline">{t('reach.systemKeys', 'System keys')}</span>
 </button>
 {sysKeysOpen && status === 'streaming' && (
 <>
 <div className="fixed inset-0 z-40" onClick={() => setSysKeysOpen(false)} />
 <div className="absolute right-0 top-full mt-1 z-50 w-72 max-w-[calc(100vw-1rem)] bg-bg-secondary rounded-lg shadow-2xl p-2 space-y-2 coarse:max-h-[70dvh] coarse:overflow-y-auto coarse:overscroll-contain">
 {(['win', 'window', 'misc'] as const).map((g) => {
 const keys = chords.filter((k) => k.group === g);
 if (keys.length === 0) return null;
 const heading = chordGroupLabel(g);
 return (
 <div key={g}>
 <div className="px-1 pb-1 text-[10px] font-mono uppercase tracking-wider text-text-muted">{heading}</div>
 <div className="flex flex-wrap gap-1">
 {keys.map((k) => (
 <button
 key={k.label}
 onClick={() => sendKeyChord(k.codes)}
 title={k.title}
 className="px-2 py-1 text-[11px] font-mono font-semibold bg-bg-tertiary rounded hover:bg-accent/10 hover:text-accent transition-colors coarse:min-h-10"
 >
 {k.label}
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

 {/* Fullscreen: not offered in the Android app, where the viewer already fills the window. */}
 {!inAndroidApp && (
 <button
 onClick={handleFullscreen}
 title={isFullscreen ? t('reach.exitFullscreen', 'Exit fullscreen') : t('reach.fullscreen', 'Fullscreen')}
 aria-label={isFullscreen ? t('reach.exitFullscreen', 'Exit fullscreen') : t('reach.fullscreen', 'Fullscreen')}
 className={clsx('p-1.5 text-text-muted hover:text-text-primary hover:bg-bg-secondary rounded transition-colors max-md:hidden', TB)}
 >
 <Maximize2 className="w-4 h-4" />
 </button>
 )}

 {/* ── Tools sheet trigger (phones; touch tablets too: labelled
 tools + zoom buttons, the toolbar icons only have a title) ── */}
 <button
 onClick={() => setToolsOpen(true)}
 aria-label={t('reach.tools', 'Session tools')}
 aria-haspopup="dialog"
 className={clsx(isCoarse ? 'lg:hidden' : 'md:hidden', 'flex items-center px-2 py-1 text-xs bg-bg-secondary text-text-muted rounded transition-colors', TB)}
 >
 <MoreHorizontal className="w-4 h-4" />
 </button>

 <button
 onClick={handleClose}
 title={t('reach.disconnect', 'Disconnect')}
 aria-label={t('reach.disconnect', 'Disconnect')}
 className={clsx('flex items-center gap-1.5 px-2 py-1 text-xs bg-red-500/10 text-red-400 border border-red-500/20 rounded hover:bg-red-500/20 transition-colors', TB)}
 >
 <X className="w-3.5 h-3.5" />
 <span className="hidden sm:inline">{t('reach.disconnect', 'Disconnect')}</span>
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
 className="max-w-full max-h-full object-contain cursor-crosshair touch-none-canvas"
 style={{ display: 'block', ...pointer.style }}
 {...pointer.handlers}
 />
 {/* Trackpad mode: where the next tap will click. */}
 {pointer.cursorStyle && (
 <div style={pointer.cursorStyle} aria-hidden="true" className="z-10 drop-shadow">
 <MousePointer2 className="w-5 h-5 text-white fill-black/60" />
 </div>
 )}
 </div>

 {/* Phones (and touch tablets): the toolbar hides / truncates status
 text — surface errors and the inactivity warning over the screen
 instead, with a "Stay connected" action. */}
 {errorMsg && streaming && (
 <div role="status" className={clsx('absolute top-2 inset-x-2 z-10 flex items-center gap-2 rounded-lg bg-bg-secondary/95 px-3 py-2 text-xs text-red-400 shadow-lg', !isCoarse && 'sm:hidden')}>
 <AlertTriangle className="w-4 h-4 shrink-0" />
 <span className="min-w-0 flex-1">{errorMsg}</span>
 {inactivityWarn && (
 <button onClick={stayConnected} className="shrink-0 min-h-10 rounded-md bg-accent px-3 text-xs font-medium text-white">
 {t('reach.stayConnected', 'Stay connected')}
 </button>
 )}
 </div>
 )}
 {status === 'disconnected' && (
 <div className={clsx('absolute inset-0 flex flex-col items-center justify-center gap-3 text-center p-8', !isCoarse && 'sm:hidden')}>
 <p className="text-text-primary font-medium">{sc.label}</p>
 {errorMsg && <p className="text-sm text-text-muted max-w-md">{errorMsg}</p>}
 <button
 onClick={handleClose}
 className="mt-2 min-h-11 px-4 py-2 bg-bg-secondary text-text-primary rounded-lg transition-colors text-sm"
 >
 {t('common.close', 'Close')}
 </button>
 </div>
 )}

 {status === 'error' && (
 <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center p-8">
 <AlertTriangle className="w-12 h-12 text-red-400" />
 <p className="text-text-primary font-medium">{t('reach.connectionFailed', 'Connection failed')}</p>
 <p className="text-sm text-text-muted max-w-md">{errorMsg || t('reach.unknownError', 'An unknown error occurred.')}</p>
 <button
 onClick={handleClose}
 className="mt-2 px-4 py-2 bg-bg-secondary text-text-primary rounded-lg hover:bg-bg-tertiary transition-colors text-sm coarse:min-h-11"
 >
 {t('common.close', 'Close')}
 </button>
 </div>
 )}

 {(status === 'connecting' || status === 'waiting' || status === 'reconnecting') && (
 <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-center p-8 bg-[#0d0f14]">
 <RefreshCw className="w-10 h-10 text-accent animate-spin" />
 <p className="text-text-primary font-medium">
 {status === 'waiting'
 ? t('reach.waitingAgent', 'Waiting for agent to connect…')
 : status === 'reconnecting'
 ? t('reach.status.reconnecting', 'Reconnecting…')
 : t('reach.connectingRelay', 'Connecting to relay…')}
 </p>
 <p className="text-sm text-text-muted">
 {status === 'waiting'
 ? t('reach.waitingAgentHint', 'The wake-up command has been sent. The Oblireach agent will connect within 30 s.')
 : status === 'reconnecting'
 ? (errorMsg || t('reach.reconnectingHint', 'The target session transitioned (e.g. after login) — redialling automatically.'))
 : t('reach.connectingHint', 'Establishing encrypted tunnel…')}
 </p>
 </div>
 )}

 {/* Hidden field that brings up the soft keyboard (touch screens). */}
 {isCoarse && (
 <SoftKeyboardInput
 ref={softKbRef}
 label={t('reach.keyboardInput', 'Remote keyboard input')}
 onText={typeText}
 onKey={pressKey}
 onFocusChange={setSoftKbOpen}
 />
 )}
 </div>

 {/* ── Touch key bar: modifiers, keys a soft keyboard lacks, clipboard ── */}
 {isCoarse && streaming && (keyBarOpen ? (
 <RemoteKeyBar
 modifiers={['ctrl', 'alt', 'shift', 'meta']}
 latched={latched}
 onToggleModifier={toggleModifier}
 keys={touchKeys}
 onKey={handleBarKey}
 letterRow
 ariaLabel={t('remoteKeys.bar', 'Keys')}
 leading={
 <KeyChip
 active={softKbOpen}
 onClick={toggleSoftKeyboard}
 aria-label={softKbOpen ? t('reach.hideKeyboard', 'Hide keyboard') : t('reach.showKeyboard', 'Show keyboard')}
 >
 <Keyboard className="w-4 h-4" />
 </KeyChip>
 }
 trailing={
 <>
 <KeyChip tone="accent" onClick={handleCtrlAltDel} aria-label={t('reach.sendCad', 'Send Ctrl+Alt+Del')}>
 <ShieldAlert className="w-4 h-4" />
 <span>Ctrl+Alt+Del</span>
 </KeyChip>
 <KeyChip onClick={handlePasteToRemote} aria-label={t('reach.pasteToRemote', 'Paste to remote')}>
 <ClipboardPaste className="w-4 h-4" />
 </KeyChip>
 <KeyChip onClick={handleCopyFromRemote} aria-label={t('reach.copyFromRemote', 'Copy from remote')}>
 <ClipboardCopy className="w-4 h-4" />
 </KeyChip>
 <KeyChip
 active={touchMode === 'trackpad'}
 onClick={() => setTouchMode(touchMode === 'trackpad' ? 'direct' : 'trackpad')}
 aria-label={touchMode === 'trackpad'
 ? t('reach.touchModeTrackpad', 'Touch: trackpad (relative cursor)')
 : t('reach.touchModeDirect', 'Touch: direct (tap where you click)')}
 >
 {touchMode === 'trackpad' ? <MousePointer2 className="w-4 h-4" /> : <Hand className="w-4 h-4" />}
 </KeyChip>
 {pointer.isZoomed && (
 <KeyChip onClick={pointer.resetView} aria-label={t('reach.fit', 'Fit')}>
 <Minimize2 className="w-4 h-4" />
 </KeyChip>
 )}
 <KeyChip onClick={() => setKeyBarOpen(false)} aria-label={t('remoteKeys.hide', 'Hide keys')}>
 <ChevronDown className="w-4 h-4" />
 </KeyChip>
 </>
 }
 />
 ) : (
 <div className="shrink-0 flex justify-end bg-bg-secondary px-2 py-1 pb-safe">
 <KeyChip onClick={() => setKeyBarOpen(true)} aria-label={t('remoteKeys.show', 'Show keys')}>
 <Keyboard className="w-4 h-4" />
 <ChevronUp className="w-4 h-4" />
 </KeyChip>
 </div>
 ))}

 {/* ── Phone tools sheet (everything the phone toolbar has no room for) ── */}
 <ReachToolsSheet
 open={toolsOpen}
 onClose={() => setToolsOpen(false)}
 streaming={streaming}
 monitors={monitors}
 activeMonitor={activeMonitor}
 onMonitor={handleMonitorSwitch}
 codecId={codecId}
 codecs={CODECS}
 onCodec={handleCodecSwitch}
 zoom={isCoarse ? { zoomed: pointer.isZoomed, onZoomIn: () => pointer.zoomBy(1.5), onZoomOut: () => pointer.zoomBy(1 / 1.5), onReset: pointer.resetView } : null}
 inputBlocked={inputBlocked}
 onToggleInputBlock={handleInputBlock}
 touchMode={isCoarse ? touchMode : null}
 onTouchMode={setTouchMode}
 onCtrlAltDel={handleCtrlAltDel}
 systemChords={chords}
 chordGroupLabel={chordGroupLabel}
 onChord={sendKeyChord}
 onPaste={handlePasteToRemote}
 onCopy={handleCopyFromRemote}
 chat={onChatToggle ? { open: !!chatOpenProp, onToggle: onChatToggle } : null}
 chatSound={onChatSoundToggle ? { enabled: !!chatSoundEnabled, onToggle: onChatSoundToggle } : null}
 audio={hasAudio ? { enabled: audioEnabled, onToggle: toggleAudio } : null}
 onScreenshot={handleScreenshot}
 recording={isRecording}
 onToggleRecording={handleToggleRecording}
 fullscreen={inAndroidApp ? null : { active: isFullscreen, onToggle: handleFullscreen }}
 />

 {/* ── Remote clipboard (copy needs a user gesture on mobile) ── */}
 <Modal
 open={remoteClip !== null}
 onClose={() => setRemoteClip(null)}
 title={t('reach.remoteClipboard', 'Remote clipboard')}
 icon={<ClipboardCopy className="w-4 h-4 text-accent" />}
 phoneLayout="sheet"
 footer={
 <>
 <button
 onClick={() => setRemoteClip(null)}
 className="px-4 py-2 text-sm rounded-lg text-text-muted hover:text-text-primary transition-colors coarse:min-h-11"
 >
 {t('common.close', 'Close')}
 </button>
 <button
 onClick={copyRemoteClip}
 className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-accent text-white hover:bg-accent/90 transition-colors coarse:min-h-11"
 >
 <Copy className="w-4 h-4" />
 {t('common.copy', 'Copy')}
 </button>
 </>
 }
 >
 <textarea
 readOnly
 value={remoteClip ?? ''}
 aria-label={t('reach.remoteClipboard', 'Remote clipboard')}
 onFocus={(e) => e.currentTarget.select()}
 className="w-full h-40 p-3 rounded-lg bg-bg-tertiary text-text-primary font-mono text-xs resize-none focus:outline-none"
 />
 </Modal>
 </div>
 );
}
