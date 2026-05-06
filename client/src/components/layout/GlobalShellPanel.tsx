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
import { remoteApi } from '@/api/remote.api';
import { deviceApi } from '@/api/device.api';
import { getSocket } from '@/socket/socketClient';
import { useNativeTopOffset } from '@/hooks/useNativeTopOffset';
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
   *  the terminal's own DOM element instead of re-opening. */
  opened: boolean;
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
  const { sessions, activeId, isOpen, groupedIds } = useRemoteShellStore();
  const removeSession = useRemoteShellStore((s) => s.removeSession);
  const setActive = useRemoteShellStore((s) => s.setActive);
  const setOpen = useRemoteShellStore((s) => s.setOpen);
  const setStatus = useRemoteShellStore((s) => s.setStatus);
  const addSession = useRemoteShellStore((s) => s.addSession);
  const toggleGrouped = useRemoteShellStore((s) => s.toggleGrouped);

  // Devices for the picker. Fetched lazily when the modal opens (full
  // tenant fleet, not bound to whatever is cached in the deviceStore).
  const [pickerDevices, setPickerDevices] = useState<Device[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);

  // Single-view container (used when not in group mode)
  const containerRef = useRef<HTMLDivElement>(null);
  // Tile containers for grid mode: one <div> per grouped session
  const tileRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const runtimes = useRef<Map<string, Runtime>>(new Map());
  const [showKeys, setShowKeys] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const nativeTop = useNativeTopOffset();

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

    const rt: Runtime = { term, fit, ws, attachedTo: null, opened: false };
    runtimes.current.set(session.id, rt);
    return rt;
  }, [setStatus]);

  // ── Attach visible terminals to their DOM containers ────────────────────
  //
  // Visible set:
  //   - single mode : [activeId]
  //   - grid  mode  : every session that's in `groupedIds`
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
    pushRecent(deviceId);
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
            const isGrouped = groupedIds.includes(s.id);
            const statusColor =
              s.status === 'connected'    ? 'text-green-400' :
              s.status === 'connecting'   ? 'text-yellow-400' :
              s.status === 'error'        ? 'text-red-400' :
                                             'text-gray-400';
            return (
              <div
                key={s.id}
                className={clsx(
                  'flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer shrink-0 transition-colors border',
                  isActive
                    ? 'bg-accent/15 text-text-primary border-accent/40'
                    : 'text-text-muted hover:text-text-primary hover:bg-bg-secondary border-transparent',
                  isGrouped && !isActive && 'border-purple-400/50 bg-purple-400/5',
                  isGrouped && isActive && 'border-purple-400/70',
                )}
                title={isGrouped
                  ? 'Ctrl+Click to remove from split group'
                  : 'Click to activate · Ctrl+Click to add to split group'}
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
                <span className={clsx('w-1.5 h-1.5 rounded-full', statusColor.replace('text-', 'bg-'))} />
                <span className="text-xs font-medium max-w-[160px] truncate">{s.deviceName}</span>
                <span className="text-[10px] text-text-muted/80">{PROTOCOL_LABEL[s.protocol]}</span>
                {isGrouped && (
                  <span className="text-[9px] text-purple-400" title="In split group">◎</span>
                )}
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
          <button
            onClick={async () => {
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
                toast.error('Failed to load devices');
                setPickerDevices([]);
              } finally {
                setPickerLoading(false);
              }
            }}
            title="Open another remote session"
            className="p-1 text-text-muted hover:text-accent hover:bg-accent/10 rounded transition-colors shrink-0"
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
            onClick={toggleFullscreen}
            title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            className={clsx(
              'p-1.5 rounded transition-colors',
              isFullscreen
                ? 'bg-accent/15 text-accent'
                : 'text-text-muted hover:text-text-primary hover:bg-bg-secondary',
            )}
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

      {/* ── Terminal container(s) ── */}
      {isGroupMode ? (
        (() => {
          // Tile the grouped terminals in a near-square grid.
          const n = visibleIds.length;
          const cols = Math.ceil(Math.sqrt(n));
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
                return (
                  <div
                    key={id}
                    className={clsx(
                      'relative rounded border overflow-hidden cursor-pointer',
                      isActiveTile ? 'border-accent/60' : 'border-border',
                    )}
                    onClick={() => setActive(id)}
                  >
                    {/* Tile header */}
                    <div className="absolute top-0 left-0 right-0 flex items-center gap-1.5 px-2 py-0.5 bg-bg-primary/80 backdrop-blur border-b border-border/30 z-10">
                      <span className="text-[10px] font-medium text-text-primary truncate flex-1">
                        {session.deviceName}
                      </span>
                      <span className="text-[9px] text-text-muted">{PROTOCOL_LABEL[session.protocol]}</span>
                    </div>
                    <div
                      className="absolute inset-0 pt-5"
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

      {showKeys && <VirtualKeyPanel onKey={sendRawToActive} />}

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
            className="fixed inset-0 z-[200] flex items-start justify-center bg-black/60 backdrop-blur-sm pt-24"
            onClick={() => setPickerOpen(false)}
          >
            <div
              className="bg-bg-secondary border border-border rounded-xl shadow-2xl w-full max-w-lg mx-4 flex flex-col max-h-[70vh]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-4 py-3 border-b border-border flex items-center gap-2">
                <Plus className="w-4 h-4 text-accent" />
                <span className="text-sm font-semibold text-text-primary">Open remote session</span>
                <button
                  onClick={() => setPickerOpen(false)}
                  className="ml-auto p-1 text-text-muted hover:text-text-primary rounded"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="px-4 py-3 border-b border-border">
                <input
                  type="text"
                  autoFocus
                  value={pickerSearch}
                  onChange={(e) => setPickerSearch(e.target.value)}
                  placeholder="Search devices..."
                  className="w-full px-3 py-2 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
                />
                {!q && (
                  <p className="text-[10px] text-text-muted mt-1 ml-1">
                    Showing {capped.length} most recent · type to search all
                  </p>
                )}
              </div>
              <div className="flex-1 overflow-y-auto">
                {pickerLoading ? (
                  <div className="p-6 text-center text-sm text-text-muted">Loading devices...</div>
                ) : capped.length === 0 ? (
                  <div className="p-6 text-center text-sm text-text-muted">
                    {q ? 'No devices match your search' : 'No devices available'}
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
                          'flex items-center gap-3 px-4 py-2.5 border-b border-border/30 last:border-b-0',
                          inPrivacy ? 'opacity-60' : 'hover:bg-bg-tertiary/50',
                        )}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-text-primary truncate flex items-center gap-2" title={d.displayName || d.hostname}>
                            <span className="truncate">{d.displayName || d.hostname}</span>
                            {inPrivacy && (
                              <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded-full bg-orange-400/10 text-orange-400 border border-orange-400/30">
                                privacy
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-text-muted">
                            {d.osName || d.osType} · {d.ipLocal || d.ipPublic || 'no IP'}
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
                              title={inPrivacy ? 'Privacy mode is active — unlock Remote on the device detail page first' : undefined}
                              className="text-xs px-2.5 py-1 rounded border border-border text-text-muted hover:text-accent hover:border-accent/40 hover:bg-accent/5 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:text-text-muted disabled:hover:border-border disabled:hover:bg-transparent transition-colors"
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
