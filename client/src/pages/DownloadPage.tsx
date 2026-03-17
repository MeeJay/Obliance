import { useState, useEffect } from 'react';
import { Monitor, Apple, Download, ExternalLink, FolderOpen, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// ── Native desktop-app Go bindings ───────────────────────────────────────────
// These are injected by the Go overlay into window when running inside Obliance.

type NativeWindow = Window & {
  __obliance_is_native_app?: boolean;
  /** Returns the currently saved download folder, or "" if not yet set. */
  __go_getDownloadDir?: () => Promise<string>;
  /** Opens a native OS folder-picker, saves the choice, returns the path. Rejects on cancel. */
  __go_chooseDownloadDir?: () => Promise<string>;
  /** Downloads relUrl from the Obliance server to the saved folder (opens picker if unset). Returns the full path. */
  __go_downloadFile?: (relUrl: string, filename: string) => Promise<string>;
};

const nw = typeof window !== 'undefined' ? (window as NativeWindow) : null;
const isNativeApp = !!nw?.__obliance_is_native_app;

// ── Static data ───────────────────────────────────────────────────────────────

interface DownloadEntry {
  label: string;      // format label, e.g. "Disk Image (.dmg)"
  sublabel: string;   // arch / OS note, e.g. "Apple Silicon (M1–M4)"
  filename: string;
  primary?: boolean;
}

interface Platform {
  name: string;
  icon: React.ReactNode;
  downloads: DownloadEntry[];
}


// ── Component ─────────────────────────────────────────────────────────────────

export function DownloadPage() {
  const { t } = useTranslation();

  const PLATFORMS: Platform[] = [
    {
      name: t('download.windows'),
      icon: <Monitor size={24} />,
      downloads: [
        {
          label: t('download.installer'),
          sublabel: t('download.installerSub'),
          filename: 'ObliToolsSetup.msi',
          primary: true,
        },
        {
          label: t('download.portable'),
          sublabel: t('download.portableSub'),
          filename: 'ObliTools.exe',
        },
      ],
    },
    {
      name: t('download.macos'),
      icon: <Apple size={24} />,
      downloads: [
        {
          label: t('download.dmg'),
          sublabel: t('download.dmgSubArm'),
          filename: 'ObliTools-arm64.dmg',
          primary: true,
        },
        {
          label: t('download.dmg'),
          sublabel: t('download.dmgSubIntel'),
          filename: 'ObliTools-amd64.dmg',
          primary: true,
        },
        {
          label: t('download.zip'),
          sublabel: t('download.dmgSubArm'),
          filename: 'ObliTools-arm64.zip',
        },
        {
          label: t('download.zip'),
          sublabel: t('download.dmgSubIntel'),
          filename: 'ObliTools-amd64.zip',
        },
      ],
    },
  ];

  // Native-app download folder state
  const [downloadDir, setDownloadDir] = useState<string>('');

  // Per-filename loading / success / error state
  const [downloading, setDownloading] = useState<Record<string, boolean>>({});
  const [downloaded, setDownloaded] = useState<Record<string, string>>({});  // filename → saved path
  const [dlErrors, setDlErrors] = useState<Record<string, string>>({});

  // On mount, read the saved download folder from Go config.
  useEffect(() => {
    if (!isNativeApp || !nw?.__go_getDownloadDir) return;
    nw.__go_getDownloadDir()
      .then(dir => setDownloadDir(dir))
      .catch(() => {/* silently ignore */});
  }, []);

  const handleChangeDir = async () => {
    const go = nw?.__go_chooseDownloadDir;
    if (!go) return;
    try {
      const dir = await go();
      setDownloadDir(dir);
    } catch {
      // cancelled — silently ignore
    }
  };

  const handleNativeDownload = async (relUrl: string, filename: string) => {
    const go = nw?.__go_downloadFile;
    if (!go) return;

    setDownloading(prev => ({ ...prev, [filename]: true }));
    setDlErrors(prev => { const n = { ...prev }; delete n[filename]; return n; });

    try {
      const dest = await go(relUrl, filename);
      setDownloaded(prev => ({ ...prev, [filename]: dest }));
      // After 6 s reset the "Saved" badge so the button is usable again.
      setTimeout(() => {
        setDownloaded(prev => { const n = { ...prev }; delete n[filename]; return n; });
      }, 6000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg !== 'cancelled') {
        setDlErrors(prev => ({ ...prev, [filename]: msg }));
      }
      // If the user opened the folder picker and chose a new folder, update the displayed dir.
      if (nw?.__go_getDownloadDir) {
        nw.__go_getDownloadDir().then(dir => setDownloadDir(dir)).catch(() => {});
      }
    } finally {
      setDownloading(prev => { const n = { ...prev }; delete n[filename]; return n; });
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">

      {/* Header */}
      <div className="mb-10 text-center">
        <div className="mb-4 flex justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Download size={32} />
          </div>
        </div>
        <h1 className="mb-2 text-3xl font-bold text-text-primary">{t('download.title')}</h1>
        <p className="text-text-secondary">
          {t('download.description')}
        </p>
      </div>

      {/* Download folder row — shown only inside the native app */}
      {isNativeApp && (
        <div className="mb-6 flex items-center gap-3 rounded-lg border border-border bg-bg-secondary px-4 py-3 text-sm">
          <FolderOpen size={15} className="text-text-muted shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="text-text-secondary">{t('download.downloadFolder')}</span>
            {downloadDir
              ? <span className="font-mono text-text-primary break-all">{downloadDir}</span>
              : <span className="text-text-muted italic">{t('download.downloadFolderPlaceholder')}</span>
            }
          </div>
          <button
            onClick={handleChangeDir}
            className="shrink-0 rounded-md border border-border px-3 py-1 text-xs text-text-secondary hover:bg-bg-hover transition-colors"
          >
            {t('download.changeFolder')}
          </button>
        </div>
      )}

      {/* Feature pills */}
      <div className="mb-10 flex flex-wrap justify-center gap-2">
        {[
          t('download.features.soundAlerts'),
          t('download.features.agentAlerts'),
          t('download.features.noBrowserOverhead'),
          t('download.features.remembersUrl'),
          t('download.features.alwaysUpToDate'),
        ].map((f) => (
          <span
            key={f}
            className="rounded-full border border-border bg-bg-secondary px-3 py-1 text-xs text-text-secondary"
          >
            {f}
          </span>
        ))}
      </div>

      {/* Download cards */}
      <div className="flex flex-col gap-4">
        {PLATFORMS.map((p) => (
          <div
            key={p.name}
            className="rounded-xl border border-border bg-bg-secondary p-5"
          >
            {/* Platform header */}
            <div className="mb-3 flex items-center gap-2.5 text-text-primary">
              <span className="text-text-secondary">{p.icon}</span>
              <span className="font-semibold">{p.name}</span>
            </div>

            {/* Download buttons — 2-column grid, tall buttons */}
            <div className="grid grid-cols-2 gap-2">
              {p.downloads.map((d) => {
                const isLoading = !!downloading[d.filename];
                const isSaved   = !!downloaded[d.filename];
                const hasError  = !!dlErrors[d.filename];

                const base    = 'flex flex-col items-center justify-center gap-1 rounded-lg px-3 py-5 text-center transition-colors disabled:opacity-60 w-full';
                const primary = `${base} bg-accent font-semibold text-white hover:opacity-90`;
                const secondary = `${base} border border-border bg-bg-tertiary text-text-secondary hover:bg-bg-hover hover:text-text-primary`;

                const inner = isLoading ? (
                  <>
                    <Loader2 size={15} className="animate-spin" />
                    <span className="text-xs mt-0.5">{t('common.downloading')}</span>
                  </>
                ) : isSaved ? (
                  <>
                    <CheckCircle size={15} className={d.primary ? 'text-white/80' : 'text-green-400'} />
                    <span className="text-xs mt-0.5">{t('common.saved')}</span>
                  </>
                ) : (
                  <>
                    <Download size={15} />
                    <span className="text-xs font-semibold leading-tight mt-0.5">{d.label}</span>
                    <span className="text-xs leading-tight opacity-60">{d.sublabel}</span>
                  </>
                );

                return (
                  <div key={d.filename} className="flex flex-col">
                    {hasError && isNativeApp && (
                      <div className="mb-1 flex items-center gap-1 text-xs text-red-400">
                        <AlertCircle size={10} />
                        <span className="truncate">{dlErrors[d.filename]}</span>
                      </div>
                    )}
                    {isNativeApp ? (
                      <button
                        onClick={() => handleNativeDownload(`/downloads/${d.filename}`, d.filename)}
                        disabled={isLoading}
                        className={d.primary ? primary : secondary}
                      >
                        {inner}
                      </button>
                    ) : (
                      <a
                        href={`/downloads/${d.filename}`}
                        download={d.filename}
                        className={d.primary ? primary : secondary}
                      >
                        {inner}
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Build-it-yourself note */}
      <div className="mt-8 rounded-xl border border-border bg-bg-secondary p-5">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-text-primary">
          <ExternalLink size={14} />
          {t('download.buildFromSource')}
        </div>
        <p className="text-sm text-text-secondary leading-relaxed">
          {t('download.buildFromSourceDesc')}
          {' '}
          <code className="rounded bg-bg-tertiary px-1.5 py-0.5 text-xs font-mono text-text-primary">desktop-app/</code>{' '}
          It is a Go application using the native OS webview (WebView2 on Windows, WKWebView on macOS).{' '}
          On Windows run{' '}
          <code className="rounded bg-bg-tertiary px-1.5 py-0.5 text-xs font-mono text-text-primary">.\build-windows.ps1</code>{' '}
          (requires WiX v4: <code className="rounded bg-bg-tertiary px-1.5 py-0.5 text-xs font-mono text-text-primary">dotnet tool install --global wix</code>).{' '}
          On macOS run{' '}
          <code className="rounded bg-bg-tertiary px-1.5 py-0.5 text-xs font-mono text-text-primary">./build-mac.sh</code>.
        </p>
      </div>

      {/* How it works */}
      <div className="mt-6 rounded-xl border border-border bg-bg-secondary p-5">
        <div className="mb-3 text-sm font-semibold text-text-primary">{t('download.howItWorks')}</div>
        <ul className="space-y-2 text-sm text-text-secondary">
          <li className="flex gap-2">
            <span className="mt-0.5 shrink-0 text-primary">1.</span>
            {t('download.step1')}
          </li>
          <li className="flex gap-2">
            <span className="mt-0.5 shrink-0 text-primary">2.</span>
            {t('download.step2')}
          </li>
          <li className="flex gap-2">
            <span className="mt-0.5 shrink-0 text-primary">3.</span>
            {t('download.step3')}
          </li>
          <li className="flex gap-2">
            <span className="mt-0.5 shrink-0 text-primary">4.</span>
            {t('download.step4')}
          </li>
          <li className="flex gap-2">
            <span className="mt-0.5 shrink-0 text-primary">5.</span>
            {t('download.step5')}
          </li>
        </ul>
      </div>
    </div>
  );
}
