import { useEffect, useRef, useState } from 'react';
import { Loader2, TerminalSquare, FileCode2, FileDown } from 'lucide-react';
import toast from 'react-hot-toast';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import { getSocket } from '@/socket/socketClient';
import type { CustomSection } from '@obliance/shared';

interface Props {
 deviceId: number;
 section: CustomSection;
}

/**
 * Custom Section Tab — read-only viewer that streams the live output
 * of a server-side command for as long as the tab is mounted. Leaving
 * the tab (navigation, tab switch, component unmount) closes the stream
 * and kills the process on the agent.
 *
 * Two render modes:
 * - 'terminal' (default): xterm.js console for ANSI-rich live output.
 * - 'html': accumulates the entire stdout and renders it inside a
 * sandboxed iframe so PowerShell `ConvertTo-Html` (and similar) can
 * drive a styled dashboard panel. The iframe sandbox blocks scripts,
 * forms, popups — only static HTML/CSS renders.
 */
export function CustomSectionTab({ deviceId, section }: Props) {
 const renderMode = section.renderMode ?? 'terminal';
 if (renderMode === 'html') {
 return <CustomSectionHtmlPanel deviceId={deviceId} section={section} />;
 }
 return <CustomSectionTerminalPanel deviceId={deviceId} section={section} />;
}

function CustomSectionTerminalPanel({ deviceId, section }: Props) {
 const containerRef = useRef<HTMLDivElement>(null);
 const termRef = useRef<Terminal | null>(null);
 const fitRef = useRef<FitAddon | null>(null);
 const streamIdRef = useRef<string | null>(null);
 const [status, setStatus] = useState<'connecting' | 'live' | 'closed' | 'error'>('connecting');
 const [errorMsg, setErrorMsg] = useState<string | null>(null);

 useEffect(() => {
 if (!containerRef.current) return;

 const term = new Terminal({
 fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
 fontSize: 13,
 theme: {
 background: '#0f1419',
 foreground: '#e6e1cf',
 cursor: '#0f1419',
 },
 disableStdin: true, // read-only
 convertEol: true,
 scrollback: 5000,
 });
 const fit = new FitAddon();
 term.loadAddon(fit);
 term.open(containerRef.current);
 termRef.current = term;
 fitRef.current = fit;
 try { fit.fit(); } catch {}

 const cols = term.cols || 120;
 const rows = term.rows || 30;

 const socket = getSocket();
 if (!socket) {
 setStatus('error');
 setErrorMsg('Socket not connected');
 return;
 }

 const onOutput = (msg: { streamId: string; data: string }) => {
 if (!streamIdRef.current || msg.streamId !== streamIdRef.current) return;
 try {
 const bin = atob(msg.data);
 term.write(bin);
 if (status !== 'live') setStatus('live');
 } catch {}
 };
 const onClosed = (msg: { streamId: string; code?: number }) => {
 if (msg.streamId !== streamIdRef.current) return;
 setStatus('closed');
 term.write(`\r\n\x1b[90m--- process ended${msg.code != null ? ` (exit ${msg.code})` : ''} ---\x1b[0m\r\n`);
 };
 socket.on('CUSTOM_SECTION_OUTPUT', onOutput);
 socket.on('CUSTOM_SECTION_CLOSED', onClosed);

 socket.emit(
 'CUSTOM_SECTION_OPEN',
 { deviceId, sectionId: section.id, cols, rows },
 (res: { streamId?: string; error?: string }) => {
 if (res?.error || !res?.streamId) {
 setStatus('error');
 setErrorMsg(res?.error || 'Failed to open stream');
 return;
 }
 streamIdRef.current = res.streamId;
 },
 );

 // Resize handling
 const handleResize = () => {
 try {
 fit.fit();
 if (streamIdRef.current && socket) {
 socket.emit('CUSTOM_SECTION_RESIZE', {
 streamId: streamIdRef.current,
 cols: term.cols,
 rows: term.rows,
 });
 }
 } catch {}
 };
 const ro = new ResizeObserver(handleResize);
 ro.observe(containerRef.current);

 return () => {
 ro.disconnect();
 socket.off('CUSTOM_SECTION_OUTPUT', onOutput);
 socket.off('CUSTOM_SECTION_CLOSED', onClosed);
 if (streamIdRef.current) {
 socket.emit('CUSTOM_SECTION_CLOSE', { streamId: streamIdRef.current });
 }
 term.dispose();
 termRef.current = null;
 streamIdRef.current = null;
 };
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [deviceId, section.id]);

 return (
 <div className="bg-bg-secondary rounded-xl overflow-hidden flex flex-col">
 <div className="px-4 py-3 flex items-center gap-2">
 <TerminalSquare className="w-4 h-4 text-accent shrink-0" />
 <div className="flex-1 min-w-0">
 <div className="text-sm font-semibold text-text-primary truncate">{section.name}</div>
 <div className="text-xs text-text-muted font-mono truncate" title={section.command}>{section.command}</div>
 </div>
 <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${
 status === 'live' ? 'text-green-400 bg-green-400/10 border-green-400/30' :
 status === 'closed' ? 'text-gray-400 bg-gray-400/10 border-gray-400/30' :
 status === 'error' ? 'text-red-400 bg-red-400/10 border-red-400/30' :
 'text-blue-400 bg-blue-400/10 border-blue-400/30'
 }`}>
 {status === 'connecting' && <Loader2 className="w-2.5 h-2.5 animate-spin inline mr-1" />}
 {status}
 </span>
 </div>
 {errorMsg && (
 <div className="px-4 py-2 text-xs text-red-400 bg-red-400/5 border-b border-red-400/20">
 {errorMsg}
 </div>
 )}
 <div
 ref={containerRef}
 className="p-2"
 style={{ background: '#0f1419', height: 'calc(100vh - 340px)', minHeight: '400px' }}
 />
 </div>
 );
}

/**
 * HTML render mode — accumulates the entire script's stdout into a single
 * UTF-8 buffer, then drops it into a sandboxed iframe via `srcDoc`.
 *
 * Why iframe over inline innerHTML / DOMPurify:
 * - `sandbox="allow-same-origin"` (no `allow-scripts`) blocks every
 * script tag the document might contain, even if we missed something
 * a sanitizer would have caught. Static HTML + CSS still renders.
 * - Same-origin lets the parent read `contentDocument.body.scrollHeight`
 * so we can auto-grow the iframe to fit the whole document instead
 * of forcing an internal scrollbar inside another scrollbar.
 * - No new dependency to add (no DOMPurify, no Sanitize-HTML).
 *
 * The buffer is flushed to the iframe on every chunk; for very large
 * documents this could thrash, so we debounce updates to once every
 * 250 ms once the document grows past 64 KB.
 */
function CustomSectionHtmlPanel({ deviceId, section }: Props) {
 const streamIdRef = useRef<string | null>(null);
 const bufferRef = useRef<string>('');
 const [status, setStatus] = useState<'connecting' | 'live' | 'closed' | 'error' | 'waiting'>('connecting');
 const [errorMsg, setErrorMsg] = useState<string | null>(null);
 const [renderTick, setRenderTick] = useState(0);
 const flushTimerRef = useRef<number | null>(null);
 /** Cycle counter — bumped after the cooldown elapses so the open
 * effect re-runs and a fresh stream is created. Auto-refresh is
 * effectively a "wait for close + N seconds, then ++cycle" loop;
 * the same effect therefore handles both the initial run and every
 * refresh, with no separate plumbing. */
 const [cycle, setCycle] = useState(0);
 const refreshTimerRef = useRef<number | null>(null);
 /** Countdown shown in the status pill while we wait between runs. */
 const [secondsUntilRefresh, setSecondsUntilRefresh] = useState<number | null>(null);
 const countdownTimerRef = useRef<number | null>(null);

 // Read auto-refresh config from the latest section snapshot. Saving
 // the section while the tab is open updates this on the next mount;
 // we don't watch it inside the running effect to keep things simple.
 const autoRefreshEnabled = !!section.autoRefreshEnabled;
 const autoRefreshSec = Math.max(1, Math.round(Number(section.autoRefreshIntervalSeconds ?? 30)));

 // Flush helper — re-paints the iframe from `bufferRef`. Debounced
 // when the buffer grows past 64 KB so a fast-streaming script doesn't
 // re-parse the whole document on every chunk.
 const scheduleFlush = () => {
 const big = bufferRef.current.length > 64 * 1024;
 if (flushTimerRef.current != null) return;
 const delay = big ? 250 : 30;
 flushTimerRef.current = window.setTimeout(() => {
 flushTimerRef.current = null;
 setRenderTick((t) => t + 1);
 }, delay);
 };

 useEffect(() => {
 const socket = getSocket();
 if (!socket) {
 setStatus('error');
 setErrorMsg('Socket not connected');
 return;
 }
 // A new cycle starts. We DON'T clear the buffer here: that would
 // unmount the iframe content for the brief moment between "stream
 // open requested" and "first chunk arrived", causing visible
 // flicker every refresh. Instead we mark it as stale and let the
 // first onOutput chunk wipe it before appending — the iframe
 // keeps showing the previous document up until the new content
 // is ready to swap in.
 let staleBuffer = bufferRef.current.length > 0;
 setStatus('connecting');
 setErrorMsg(null);

 const onOutput = (msg: { streamId: string; data: string }) => {
 if (!streamIdRef.current || msg.streamId !== streamIdRef.current) return;
 try {
 // Server delivers chunks base64-encoded — decode and append as
 // UTF-8. atob() yields a binary string; decoding with TextDecoder
 // keeps multi-byte characters intact.
 const bin = atob(msg.data);
 const bytes = new Uint8Array(bin.length);
 for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
 const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
 // First chunk of the new cycle: drop the stale previous-run
 // content so the new document replaces it cleanly.
 if (staleBuffer) {
 bufferRef.current = '';
 staleBuffer = false;
 }
 bufferRef.current += text;
 setStatus('live');
 scheduleFlush();
 } catch {}
 };
 const onClosed = (msg: { streamId: string; code?: number }) => {
 if (msg.streamId !== streamIdRef.current) return;
 // Force a final paint in case a chunk was still pending.
 if (flushTimerRef.current != null) { window.clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
 setRenderTick((t) => t + 1);
 // Schedule the next cycle when auto-refresh is on. The cycle
 // counter bumps after `autoRefreshSec` ms, which re-triggers the
 // outer effect (cleanup → fresh open). A countdown ticker
 // updates the status pill so the user sees "refresh in 27s".
 if (autoRefreshEnabled) {
 setStatus('waiting');
 setSecondsUntilRefresh(autoRefreshSec);
 let remaining = autoRefreshSec;
 countdownTimerRef.current = window.setInterval(() => {
 remaining -= 1;
 setSecondsUntilRefresh(Math.max(0, remaining));
 }, 1000);
 refreshTimerRef.current = window.setTimeout(() => {
 if (countdownTimerRef.current != null) { window.clearInterval(countdownTimerRef.current); countdownTimerRef.current = null; }
 setSecondsUntilRefresh(null);
 setCycle((c) => c + 1);
 }, autoRefreshSec * 1000);
 } else {
 setStatus('closed');
 }
 };
 socket.on('CUSTOM_SECTION_OUTPUT', onOutput);
 socket.on('CUSTOM_SECTION_CLOSED', onClosed);

 socket.emit(
 'CUSTOM_SECTION_OPEN',
 // PTY makes no sense for HTML output (terminal control sequences
 // would corrupt the document) — explicitly request a non-PTY
 // pipe so the agent gets clean stdout regardless of section flags.
 { deviceId, sectionId: section.id, cols: 0, rows: 0, ptyOverride: false },
 (res: { streamId?: string; error?: string }) => {
 if (res?.error || !res?.streamId) {
 setStatus('error');
 setErrorMsg(res?.error || 'Failed to open stream');
 return;
 }
 streamIdRef.current = res.streamId;
 },
 );

 return () => {
 if (flushTimerRef.current != null) { window.clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
 if (refreshTimerRef.current != null) { window.clearTimeout(refreshTimerRef.current); refreshTimerRef.current = null; }
 if (countdownTimerRef.current != null) { window.clearInterval(countdownTimerRef.current); countdownTimerRef.current = null; }
 socket.off('CUSTOM_SECTION_OUTPUT', onOutput);
 socket.off('CUSTOM_SECTION_CLOSED', onClosed);
 if (streamIdRef.current) {
 socket.emit('CUSTOM_SECTION_CLOSE', { streamId: streamIdRef.current });
 }
 streamIdRef.current = null;
 };
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [deviceId, section.id, cycle, autoRefreshEnabled, autoRefreshSec]);

 /**
 * Export the iframe's current content as a PDF via the browser's
 * native print dialog. The user picks "Save as PDF" in the
 * destination dropdown — no extra dependency, no server roundtrip,
 * faithful rendering with whatever fonts/colours/CSS the dashboard
 * defines (including any `@media print` overrides the script
 * happens to ship with).
 *
 * Called on the iframe's contentWindow rather than from inside the
 * iframe itself — sandboxed iframes block `print()` without
 * `allow-modals`, but the parent has no such restriction. We
 * `focus()` first to make sure print() targets that frame and not
 * the host page.
 */
 const handleExportPdf = () => {
 const iframe = iframeRef.current;
 if (!iframe) return;
 try {
 iframe.contentWindow?.focus();
 iframe.contentWindow?.print();
 } catch (err) {
 console.error('PDF export failed', err);
 toast.error('Could not open the print dialog');
 }
 };

 // Anti-flicker rendering: the iframe is mounted ONCE and never
 // unmounts. On every refresh tick we patch its DOM in place
 // (`documentElement.innerHTML = …`) instead of swapping `srcDoc`,
 // which would force a full document reload — visible white flash,
 // lost scroll position, layout reflow, painful at 1Hz refresh.
 // Same-origin sandbox lets the parent reach into contentDocument
 // safely; the missing `allow-scripts` keeps any <script> the dump
 // contains inert (sanitised by absence, not by parsing).
 const iframeRef = useRef<HTMLIFrameElement>(null);
 const iframeInitedRef = useRef(false);
 /** Stylesheet shared by every render — written once into the iframe
 * on first mount, never touched again. The script's HTML is
 * injected as the body content (or as documentElement.innerHTML
 * when it's a full <html>...</html> document) so styles persist
 * across refreshes without re-parsing. */
 const baseStyles = `
 :root { color-scheme: dark; }
 body {
 margin: 0;
 padding: 16px;
 font-family: ui-sans-serif, -apple-system, system-ui, "Segoe UI", Helvetica, Arial, sans-serif;
 font-size: 13px;
 line-height: 1.55;
 background: #0f1419;
 color: #e6e1cf;
 }
 a { color: #7dd3fc; }
 table { border-collapse: collapse; margin: 8px 0; }
 th, td { border: 1px solid #334155; padding: 6px 10px; }
 th { background: #1e293b; text-align: left; }
 code, pre { font-family: ui-monospace, Menlo, Consolas, monospace; }
 pre { background: #1e293b; padding: 8px; border-radius: 6px; overflow-x: auto; }
 `;
 // Patch the iframe DOM whenever renderTick changes. First call
 // primes the document with our boilerplate (head + empty body);
 // every subsequent call replaces only the body's innerHTML so the
 // `<style>` block survives intact.
 useEffect(() => {
 const iframe = iframeRef.current;
 if (!iframe) return;
 const doc = iframe.contentDocument;
 if (!doc) return;
 if (!iframeInitedRef.current) {
 doc.open();
 doc.write(`<!doctype html><html><head><meta charset="utf-8"><style>${baseStyles}</style></head><body></body></html>`);
 doc.close();
 iframeInitedRef.current = true;
 }
 const html = bufferRef.current;
 if (!html) return;
 const looksLikeFullHtml = /<\s*html[\s>]/i.test(html.slice(0, 4096));
 try {
 if (looksLikeFullHtml) {
 // Replace everything inside <html> in one assignment — head
 // and body update together, no document reload. This keeps
 // any <link rel="stylesheet"> / <style> the dump brings.
 const inner = /<html[^>]*>([\s\S]*?)<\/html>/i.exec(html);
 doc.documentElement.innerHTML = inner ? inner[1] : html;
 } else {
 // Fragment — leave the boilerplate <head>/<style> alone, swap
 // body content. Our base styles persist across refreshes.
 doc.body.innerHTML = html;
 }
 } catch { /* contentDocument may be cross-origin during teardown */ }
 // Reading renderTick keeps it active in the dep list so the
 // patch fires on every flush.
 void renderTick;
 }, [renderTick, baseStyles]);

 return (
 <div className="bg-bg-secondary rounded-xl overflow-hidden flex flex-col">
 <div className="px-4 py-3 flex items-center gap-2">
 <FileCode2 className="w-4 h-4 text-purple-400 shrink-0" />
 <div className="flex-1 min-w-0">
 <div className="text-sm font-semibold text-text-primary truncate">{section.name}</div>
 <div className="text-xs text-text-muted truncate">
 HTML render · {bufferRef.current.length.toLocaleString()} bytes
 {autoRefreshEnabled && <> · auto-refresh every {autoRefreshSec}s</>}
 </div>
 </div>
 {/* Manual refresh button — kept mounted at all auto-refresh
 cadences ≥ 5s so it doesn't pop in/out every cycle and
 shift neighbouring controls. Disabled while a refresh is
 in flight (the click would race the in-progress run).
 Below 5s it's removed entirely: the cycle is too short
 for manual interaction to make sense and rendering it
 would still cause a visible flicker on the disabled
 transition every second. */}
 {autoRefreshEnabled && autoRefreshSec >= 5 && (
 <button
 onClick={() => {
 if (refreshTimerRef.current != null) { window.clearTimeout(refreshTimerRef.current); refreshTimerRef.current = null; }
 if (countdownTimerRef.current != null) { window.clearInterval(countdownTimerRef.current); countdownTimerRef.current = null; }
 setSecondsUntilRefresh(null);
 setCycle((c) => c + 1);
 }}
 disabled={status === 'connecting' || status === 'live'}
 title="Refresh now"
 className="text-[10px] px-2 py-0.5 rounded-full border border-purple-400/30 bg-purple-400/10 text-purple-400 hover:bg-purple-400/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
 Refresh now
 </button>
 )}
 {/* Export PDF — disabled until the first chunk has landed,
 otherwise the print dialog would render an empty page. */}
 <button
 onClick={handleExportPdf}
 disabled={bufferRef.current.length === 0}
 title="Open the print dialog (pick 'Save as PDF' as the destination)"
 className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-bg-tertiary text-text-primary hover:border-accent/40 hover:text-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
 <FileDown className="w-3 h-3" /> Export PDF
 </button>
 {/* Fixed-width status pill so the text swap
 'live' ↔ 'connecting' ↔ 'refresh in Ns' doesn't ripple
 into the neighbouring buttons. tabular-nums keeps the
 countdown digits aligned monospace-style. */}
 <span
 style={{ minWidth: 96 }}
 className={`text-[10px] px-2 py-0.5 rounded-full border font-medium tabular-nums text-center inline-flex items-center justify-center ${
 status === 'live' ? 'text-green-400 bg-green-400/10 border-green-400/30' :
 status === 'closed' ? 'text-gray-400 bg-gray-400/10 border-gray-400/30' :
 status === 'error' ? 'text-red-400 bg-red-400/10 border-red-400/30' :
 status === 'waiting' ? 'text-purple-400 bg-purple-400/10 border-purple-400/30' :
 'text-blue-400 bg-blue-400/10 border-blue-400/30'
 }`}>
 {status === 'connecting' && <Loader2 className="w-2.5 h-2.5 animate-spin inline mr-1" />}
 {status === 'waiting' && secondsUntilRefresh != null
 ? `refresh in ${secondsUntilRefresh}s`
 : status}
 </span>
 </div>
 {errorMsg && (
 <div className="px-4 py-2 text-xs text-red-400 bg-red-400/5 border-b border-red-400/20">
 {errorMsg}
 </div>
 )}
 {/* The iframe is mounted ONCE and stays in the DOM for the life
 of the panel — refreshes patch its contentDocument in place
 via the effect above, no srcDoc swap, no flicker. The
 loading placeholder is overlaid on top until the first
 chunk arrives. */}
 <div className="relative" style={{ height: 'calc(100vh - 340px)', minHeight: '400px' }}>
 <iframe
 ref={iframeRef}
 // sandbox="allow-same-origin" disables script execution, form
 // submission, popups, and top-level navigation. allow-same-
 // origin lets the parent reach into contentDocument so we can
 // patch its DOM directly across refreshes (no reload, no
 // flash). Scripts the dump contains stay inert.
 sandbox="allow-same-origin"
 className="w-full h-full bg-[#0f1419]"
 style={{ border: 'none' }}
 />
 {bufferRef.current.length === 0 && status === 'connecting' && (
 <div className="absolute inset-0 flex items-center justify-center text-text-muted text-sm bg-[#0f1419]">
 <Loader2 className="w-4 h-4 animate-spin mr-2" /> Waiting for first output…
 </div>
 )}
 </div>
 </div>
 );
}
