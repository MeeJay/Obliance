import { useState, useEffect } from 'react';
import { Monitor, Download, FolderOpen, Loader2, CheckCircle, AlertCircle, ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// ── Native desktop-app Go bindings ───────────────────────────────────────────
// These are injected by the Obliance Desktop overlay (Go + webview) when
// the UI runs inside it. When undefined we're in a regular browser and
// fall back to a plain <a href=...> download.

type NativeWindow = Window & {
  __obliance_is_native_app?: boolean;
  __go_getDownloadDir?: () => Promise<string>;
  __go_chooseDownloadDir?: () => Promise<string>;
  __go_downloadFile?: (relUrl: string, filename: string) => Promise<string>;
};

const nw = typeof window !== 'undefined' ? (window as NativeWindow) : null;
const isNativeApp = !!nw?.__obliance_is_native_app;

// ── Version payload the server hands out ────────────────────────────────────

interface VersionInfo {
  version: string;
  downloadUrl: string;
  releasedAt?: string;
  releaseNotes?: string;
}

// ── Component ────────────────────────────────────────────────────────────────

export function DownloadPage() {
  const { t } = useTranslation();

  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
  const [versionError, setVersionError] = useState(false);

  const [downloadDir, setDownloadDir] = useState<string>('');
  const [downloading, setDownloading] = useState(false);
  const [downloadedPath, setDownloadedPath] = useState<string | null>(null);
  const [dlError, setDlError] = useState<string | null>(null);

  // Pull the latest version from the public endpoint.
  useEffect(() => {
    fetch('/api/oblireach-desktop/version')
      .then((r) => r.ok ? r.json() : Promise.reject(r.status))
      .then((info: VersionInfo) => setVersionInfo(info))
      .catch(() => setVersionError(true));
  }, []);

  // Native-app download dir
  useEffect(() => {
    if (!isNativeApp || !nw?.__go_getDownloadDir) return;
    nw.__go_getDownloadDir().then(setDownloadDir).catch(() => {});
  }, []);

  const handleChangeDir = async () => {
    const go = nw?.__go_chooseDownloadDir;
    if (!go) return;
    try { setDownloadDir(await go()); } catch { /* user cancelled */ }
  };

  const handleDownload = async () => {
    if (!versionInfo) return;
    setDlError(null);
    if (isNativeApp && nw?.__go_downloadFile) {
      setDownloading(true);
      try {
        const dest = await nw.__go_downloadFile(versionInfo.downloadUrl, 'OblireachDesktop.msi');
        setDownloadedPath(dest);
        setTimeout(() => setDownloadedPath(null), 6000);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg !== 'cancelled') setDlError(msg);
        if (nw?.__go_getDownloadDir) {
          nw.__go_getDownloadDir().then(setDownloadDir).catch(() => {});
        }
      } finally {
        setDownloading(false);
      }
    } else {
      // Plain browser: trigger a normal download via the MSI endpoint.
      window.location.href = versionInfo.downloadUrl;
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      {/* Header */}
      <div className="mb-10 text-center">
        <div className="mb-4 flex justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/10 text-accent">
            <Download size={32} />
          </div>
        </div>
        <h1 className="mb-2 text-3xl font-bold text-text-primary">
          {t('download.title') || 'Oblireach Desktop'}
        </h1>
        <p className="text-text-secondary">
          {t('download.description') ||
            'A native desktop client for viewing your ObliReach remote sessions without a browser tab.'}
        </p>
      </div>

      {/* Download folder row — native app only */}
      {isNativeApp && (
        <div className="mb-6 flex items-center gap-3 rounded-lg border border-border bg-bg-secondary px-4 py-3 text-sm">
          <FolderOpen size={15} className="text-text-muted shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="text-text-secondary">{t('download.downloadFolder') || 'Download folder: '}</span>
            {downloadDir
              ? <span className="font-mono text-text-primary break-all">{downloadDir}</span>
              : <span className="text-text-muted italic">{t('download.downloadFolderPlaceholder') || 'not set — will prompt on first download'}</span>
            }
          </div>
          <button
            onClick={handleChangeDir}
            className="shrink-0 rounded-md border border-border px-3 py-1 text-xs text-text-secondary hover:bg-bg-tertiary transition-colors"
          >
            {t('download.changeFolder') || 'Change'}
          </button>
        </div>
      )}

      {/* Main download card — single platform (Windows MSI) today */}
      <div className="rounded-xl border border-border bg-bg-secondary p-5">
        <div className="mb-4 flex items-center gap-2.5 text-text-primary">
          <Monitor size={22} className="text-text-secondary" />
          <div className="flex-1">
            <div className="font-semibold">{t('download.windows') || 'Windows'}</div>
            <div className="text-xs text-text-muted mt-0.5">
              {versionInfo ? (
                <>
                  v{versionInfo.version}
                  {versionInfo.releasedAt && (
                    <> · {t('download.released') || 'released'} {new Date(versionInfo.releasedAt).toLocaleDateString()}</>
                  )}
                </>
              ) : versionError ? (
                <span className="text-red-400">
                  {t('download.versionUnavailable') || 'Version info unavailable — the server may still be building the release.'}
                </span>
              ) : (
                t('download.loading') || 'Loading version…'
              )}
            </div>
          </div>
        </div>

        {dlError && (
          <div className="mb-3 flex items-center gap-1.5 text-xs text-red-400">
            <AlertCircle size={12} />
            <span className="truncate">{dlError}</span>
          </div>
        )}

        <button
          onClick={handleDownload}
          disabled={!versionInfo || downloading}
          className="w-full flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-colors"
        >
          {downloading ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              {t('common.downloading') || 'Downloading…'}
            </>
          ) : downloadedPath ? (
            <>
              <CheckCircle size={16} />
              {t('common.saved') || 'Saved'}
            </>
          ) : (
            <>
              <Download size={16} />
              {t('download.installerButton') || 'Download installer (.msi)'}
            </>
          )}
        </button>

        {downloadedPath && isNativeApp && (
          <p className="mt-2 text-xs text-text-muted font-mono break-all">
            {downloadedPath}
          </p>
        )}
      </div>

      {/* Release notes */}
      {versionInfo?.releaseNotes && (
        <div className="mt-6 rounded-xl border border-border bg-bg-secondary p-5">
          <div className="mb-2 text-sm font-semibold text-text-primary">
            {t('download.releaseNotes') || 'Release notes'}
          </div>
          <pre className="whitespace-pre-wrap text-xs text-text-secondary font-mono">
            {versionInfo.releaseNotes}
          </pre>
        </div>
      )}

      {/* What it does */}
      <div className="mt-6 rounded-xl border border-border bg-bg-secondary p-5">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-text-primary">
          <ExternalLink size={14} />
          {t('download.whatItIs') || 'What you get'}
        </div>
        <ul className="space-y-2 text-sm text-text-secondary">
          <li className="flex gap-2">
            <span className="mt-0.5 shrink-0 text-accent">•</span>
            {t('download.feature.native') || 'Native Windows viewer for ObliReach sessions — no browser overhead.'}
          </li>
          <li className="flex gap-2">
            <span className="mt-0.5 shrink-0 text-accent">•</span>
            {t('download.feature.notifs') || 'System tray + desktop notifications when remote sessions change state.'}
          </li>
          <li className="flex gap-2">
            <span className="mt-0.5 shrink-0 text-accent">•</span>
            {t('download.feature.autoupdate') ||
              'In-app update prompt when a new version ships (you stay in control — no silent updates).'}
          </li>
        </ul>
      </div>
    </div>
  );
}
