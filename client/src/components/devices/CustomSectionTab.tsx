import { useEffect, useRef, useState } from 'react';
import { Loader2, TerminalSquare } from 'lucide-react';
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
 * Custom Section Tab — read-only terminal that streams the live output
 * of a server-side command for as long as the tab is mounted. Leaving
 * the tab (navigation, tab switch, component unmount) closes the stream
 * and kills the process on the agent.
 */
export function CustomSectionTab({ deviceId, section }: Props) {
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
      disableStdin: true,      // read-only
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
    <div className="bg-bg-secondary border border-border rounded-xl overflow-hidden flex flex-col">
      <div className="px-4 py-3 border-b border-border flex items-center gap-2">
        <TerminalSquare className="w-4 h-4 text-accent shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-text-primary truncate">{section.name}</div>
          <div className="text-xs text-text-muted font-mono truncate" title={section.command}>{section.command}</div>
        </div>
        <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${
          status === 'live'    ? 'text-green-400 bg-green-400/10 border-green-400/30' :
          status === 'closed'  ? 'text-gray-400 bg-gray-400/10 border-gray-400/30' :
          status === 'error'   ? 'text-red-400 bg-red-400/10 border-red-400/30' :
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
