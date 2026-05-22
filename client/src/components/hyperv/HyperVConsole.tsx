import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Monitor, X, RefreshCw, Maximize2 } from 'lucide-react';
import { clsx } from 'clsx';
import { hypervApi } from '@/api/hyperv.api';
import { getSocket } from '@/socket/socketClient';

// Layer-A console: a read-only VMware-style framebuffer preview driven by
// Hyper-V's GetVirtualSystemThumbnailImage. The agent posts PNG frames; we
// poll a fresh frame every ~2s and also listen for the live socket relay.
// Full interactive console (RDP-over-VMBus) is layer B — not wired here.

function useConsoleFrame(hostDeviceId: number, vmId: string, active: boolean, width: number, height: number) {
  const [src, setSrc] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const lastFrameAt = useRef(0);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const socket = getSocket();
    const onFrame = (p: { hostDeviceId: number; vmId: string; pngBase64: string }) => {
      if (cancelled || p.hostDeviceId !== hostDeviceId || p.vmId !== vmId) return;
      lastFrameAt.current = Date.now();
      setStale(false);
      setSrc(`data:image/png;base64,${p.pngBase64}`);
    };
    socket?.on('HYPERV_THUMBNAIL', onFrame);

    const tick = async () => {
      try {
        const { cached } = await hypervApi.requestThumbnail(hostDeviceId, vmId, width, height);
        if (!cancelled && cached?.pngBase64 && Date.now() - lastFrameAt.current > 1500) {
          setSrc(`data:image/png;base64,${cached.pngBase64}`);
        }
      } catch { /* ignore */ }
      // Mark stale if no fresh frame for >6s (host offline / VM off).
      if (!cancelled && lastFrameAt.current > 0 && Date.now() - lastFrameAt.current > 6000) setStale(true);
    };
    tick();
    const iv = setInterval(tick, 2000);
    return () => { cancelled = true; socket?.off('HYPERV_THUMBNAIL', onFrame); clearInterval(iv); };
  }, [hostDeviceId, vmId, active, width, height]);

  return { src, stale };
}

/** Inline preview panel shown when a VM row is expanded. */
export function HyperVConsolePreview({ hostDeviceId, vmId, onOpenFull }: { hostDeviceId: number; vmId: string; onOpenFull: () => void }) {
  const { t } = useTranslation();
  const { src, stale } = useConsoleFrame(hostDeviceId, vmId, true, 640, 480);
  return (
    <div className="relative bg-black rounded-lg overflow-hidden flex items-center justify-center" style={{ aspectRatio: '4 / 3', maxHeight: 360 }}>
      {src ? (
        <img src={src} alt="VM console" className={clsx('max-w-full max-h-full object-contain', stale && 'opacity-50')} />
      ) : (
        <div className="flex flex-col items-center gap-2 text-text-muted py-8">
          <RefreshCw className="w-5 h-5 animate-spin" />
          <span className="text-xs">{t('hyperv.consoleLoading') || 'Capturing console…'}</span>
        </div>
      )}
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
  const { src, stale } = useConsoleFrame(hostDeviceId, vmId, true, 1024, 768);
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
        {src ? (
          <img src={src} alt="VM console" className={clsx('max-w-full max-h-full object-contain', stale && 'opacity-50')} />
        ) : (
          <div className="flex flex-col items-center gap-3 text-text-muted">
            <RefreshCw className="w-8 h-8 animate-spin" />
            <span className="text-sm">{t('hyperv.consoleLoading') || 'Capturing console…'}</span>
          </div>
        )}
      </div>
      <div className="px-3 py-1.5 text-[11px] text-text-muted bg-bg-primary shrink-0">
        {t('hyperv.consoleHintB') || 'Read-only framebuffer preview. Interactive console (keyboard/mouse) is coming with the full RDP console.'}
      </div>
    </div>,
    document.body,
  );
}
