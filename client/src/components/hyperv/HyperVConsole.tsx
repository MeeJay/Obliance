import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Monitor, X, RefreshCw, Maximize2, AlertTriangle } from 'lucide-react';
import { clsx } from 'clsx';
import { hypervApi } from '@/api/hyperv.api';
import { getSocket } from '@/socket/socketClient';

// Layer-A console: a read-only VMware-style framebuffer preview driven by
// Hyper-V's GetVirtualSystemThumbnailImage. The agent posts PNG frames (or an
// error reason if capture fails); we poll every ~2s and also listen for the
// live socket relay. Full interactive console (RDP-over-VMBus) is layer B.

function useConsoleFrame(hostDeviceId: number, vmId: string, active: boolean, width: number, height: number) {
  const { t } = useTranslation();
  const [src, setSrc] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const startedAt = Date.now();
    let lastFrameAt = 0;
    let deliveredEver = false;
    setSrc(null);
    setStale(false);
    setError(null);

    const socket = getSocket();
    const onFrame = (p: { hostDeviceId: number; vmId: string; pngBase64?: string; error?: string }) => {
      if (cancelled || p.hostDeviceId !== hostDeviceId || p.vmId !== vmId) return;
      if (p.error) {
        // Surface the agent's reason only while we have no live frame.
        if (!lastFrameAt) setError(p.error);
        return;
      }
      if (!p.pngBase64) return;
      lastFrameAt = Date.now();
      setStale(false);
      setError(null);
      setSrc(`data:image/png;base64,${p.pngBase64}`);
    };
    socket?.on('HYPERV_THUMBNAIL', onFrame);

    const tick = async () => {
      try {
        const { delivered, cached } = await hypervApi.requestThumbnail(hostDeviceId, vmId, width, height);
        if (cancelled) return;
        if (delivered) deliveredEver = true;
        if (cached?.pngBase64 && Date.now() - lastFrameAt > 1500) {
          lastFrameAt = Date.now();
          setStale(false);
          setError(null);
          setSrc(`data:image/png;base64,${cached.pngBase64}`);
        }
      } catch { /* network blip — keep trying */ }
      if (cancelled) return;
      // After a grace window with no frame at all, explain why. An
      // agent-reported error (more specific) takes precedence.
      if (!lastFrameAt && Date.now() - startedAt > 8000) {
        setError((prev) => prev ?? (deliveredEver
          ? (t('hyperv.consoleNoFrame') || 'No console frame — the VM may be off, or the agent build lacks console support (rebuild & redeploy the agent).')
          : (t('hyperv.consoleAgentOffline') || 'Host agent not reachable for the live console (its WebSocket channel is disconnected).')));
      }
      if (lastFrameAt > 0 && Date.now() - lastFrameAt > 6000) setStale(true);
    };
    tick();
    const iv = setInterval(tick, 2000);
    return () => { cancelled = true; socket?.off('HYPERV_THUMBNAIL', onFrame); clearInterval(iv); };
  }, [hostDeviceId, vmId, active, width, height, t]);

  return { src, stale, error };
}

function ConsoleBody({ src, stale, error, big }: { src: string | null; stale: boolean; error: string | null; big?: boolean }) {
  const { t } = useTranslation();
  if (src) {
    return <img src={src} alt="VM console" className={clsx('max-w-full max-h-full object-contain', stale && 'opacity-50')} />;
  }
  if (error) {
    return (
      <div className={clsx('flex flex-col items-center gap-2 text-center px-4', big ? 'text-text-muted' : 'text-text-muted py-6')}>
        <AlertTriangle className={clsx('text-orange-400', big ? 'w-8 h-8' : 'w-5 h-5')} />
        <span className={clsx('leading-snug', big ? 'text-sm max-w-md' : 'text-[11px]')}>{error}</span>
      </div>
    );
  }
  return (
    <div className={clsx('flex flex-col items-center gap-2 text-text-muted', big ? 'gap-3' : 'py-8')}>
      <RefreshCw className={clsx('animate-spin', big ? 'w-8 h-8' : 'w-5 h-5')} />
      <span className={big ? 'text-sm' : 'text-xs'}>{t('hyperv.consoleLoading') || 'Capturing console…'}</span>
    </div>
  );
}

/** Inline preview panel shown when a VM row is expanded. */
export function HyperVConsolePreview({ hostDeviceId, vmId, onOpenFull }: { hostDeviceId: number; vmId: string; onOpenFull: () => void }) {
  const { t } = useTranslation();
  const { src, stale, error } = useConsoleFrame(hostDeviceId, vmId, true, 640, 480);
  return (
    <div className="relative bg-black rounded-lg overflow-hidden flex items-center justify-center" style={{ aspectRatio: '4 / 3', maxHeight: 360 }}>
      <ConsoleBody src={src} stale={stale} error={error} />
      <button
        onClick={onOpenFull}
        title={t('hyperv.consoleFull') || 'Full screen'}
        className="absolute top-2 right-2 p-1.5 rounded bg-black/50 text-white/80 hover:text-white hover:bg-black/70 transition-colors"
      >
        <Maximize2 className="w-4 h-4" />
      </button>
      <span className="absolute bottom-1 left-2 text-[9px] text-white/40 font-mono">{t('hyperv.consoleReadOnly') || 'preview · read-only'}</span>
    </div>
  );
}

/** Full-screen read-only console viewer. */
export function HyperVConsoleModal({ hostDeviceId, vmId, vmName, onClose }: { hostDeviceId: number; vmId: string; vmName: string; onClose: () => void }) {
  const { t } = useTranslation();
  const { src, stale, error } = useConsoleFrame(hostDeviceId, vmId, true, 1024, 768);
  return createPortal(
    <div className="fixed inset-0 z-[200] flex flex-col bg-[#0d0f14]">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-bg-primary shrink-0">
        <Monitor className="w-4 h-4 text-text-muted" />
        <span className="text-sm font-medium text-text-primary truncate">{vmName}</span>
        <span className="text-[10px] text-text-muted font-mono px-2 py-0.5 rounded-full border border-border/40">{t('hyperv.consoleReadOnly') || 'preview · read-only'}</span>
        <button onClick={onClose} title={t('common.close') || 'Close'} className="ml-auto flex items-center gap-1.5 px-2 py-1 text-xs bg-red-500/10 text-red-400 border border-red-500/20 rounded hover:bg-red-500/20 transition-colors">
          <X className="w-3.5 h-3.5" /> <span className="hidden sm:inline">{t('common.close') || 'Close'}</span>
        </button>
      </div>
      <div className="flex-1 flex items-center justify-center overflow-hidden p-2">
        <ConsoleBody src={src} stale={stale} error={error} big />
      </div>
      <div className="px-3 py-1.5 text-[11px] text-text-muted bg-bg-primary shrink-0">
        {t('hyperv.consoleHintB') || 'Read-only framebuffer preview. Interactive console (keyboard/mouse) is coming with the full RDP console.'}
      </div>
    </div>,
    document.body,
  );
}
