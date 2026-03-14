import { useState, useRef, useCallback, type ReactNode } from 'react';
import { Download, Upload, FileJson, CheckCircle2, PackageOpen, ExternalLink } from 'lucide-react';
import { Button } from '@/components/common/Button';
import apiClient from '@/api/client';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

// ── Types ─────────────────────────────────────────────────────────────────────

type Section =
  | 'monitorGroups'
  | 'monitors'
  | 'settings'
  | 'notificationChannels'
  | 'agentGroups'
  | 'teams'
  | 'remediationActions'
  | 'remediationBindings';

type ConflictStrategy = 'update' | 'generateNew' | 'ignore';

const ALL_SECTIONS: Section[] = [
  'monitorGroups',
  'monitors',
  'settings',
  'notificationChannels',
  'agentGroups',
  'teams',
  'remediationActions',
  'remediationBindings',
];

// ── Sub-components ────────────────────────────────────────────────────────────

function Toggle({
  checked,
  indeterminate = false,
  onChange,
}: {
  checked:        boolean;
  indeterminate?: boolean;
  onChange:       (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={[
        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent',
        'transition-colors duration-200 focus:outline-none focus-visible:ring-2',
        'focus-visible:ring-accent focus-visible:ring-offset-2',
        checked
          ? 'bg-accent'
          : indeterminate
            ? 'bg-accent/40'
            : 'bg-bg-tertiary border border-border',
      ].join(' ')}
    >
      <span
        className={[
          'pointer-events-none inline-block h-4 w-4 transform rounded-full',
          'bg-white shadow-lg ring-0 transition-transform duration-200',
          checked ? 'translate-x-4' : 'translate-x-0',
        ].join(' ')}
      />
    </button>
  );
}

function SectionSelector({
  sections,
  enabled,
  onToggle,
  onToggleAll,
  descriptions = {},
  extra,
}: {
  sections:      Section[];
  enabled:       Set<Section>;
  onToggle:      (s: Section) => void;
  onToggleAll:   (on: boolean) => void;
  descriptions?: Partial<Record<Section, string>>;
  extra?:        ReactNode;
}) {
  const { t } = useTranslation();

  const SECTION_LABELS: Record<Section, string> = {
    monitorGroups:       t('importExport.monitorGroups'),
    monitors:            t('importExport.monitors'),
    settings:            t('importExport.settingsSection'),
    notificationChannels:t('importExport.notificationChannels'),
    agentGroups:         t('importExport.agentGroups'),
    teams:               t('importExport.teams'),
    remediationActions:  t('importExport.remediationActions'),
    remediationBindings: t('importExport.remediationBindings'),
  };

  const allOn  = sections.length > 0 && sections.every(s => enabled.has(s));
  const someOn = sections.some(s => enabled.has(s));

  return (
    <div className="space-y-1">
      {/* All toggle */}
      <div className="flex items-center justify-between py-2 border-b border-border">
        <span className="text-sm font-medium text-text-primary">{t('importExport.all')}</span>
        <Toggle
          checked={allOn}
          indeterminate={!allOn && someOn}
          onChange={onToggleAll}
        />
      </div>

      {/* Individual sections */}
      {sections.map((s) => (
        <div key={s} className="py-1.5">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm text-text-secondary">{SECTION_LABELS[s]}</span>
              {descriptions[s] && (
                <p className="text-[11px] text-text-muted mt-0.5">{descriptions[s]}</p>
              )}
            </div>
            <Toggle checked={enabled.has(s)} onChange={() => onToggle(s)} />
          </div>
        </div>
      ))}

      {/* Extra content (sub-options) */}
      {extra}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function ImportExportPage() {
  const { t } = useTranslation();

  const SECTION_LABELS: Record<Section, string> = {
    monitorGroups:       t('importExport.monitorGroups'),
    monitors:            t('importExport.monitors'),
    settings:            t('importExport.settingsSection'),
    notificationChannels:t('importExport.notificationChannels'),
    agentGroups:         t('importExport.agentGroups'),
    teams:               t('importExport.teams'),
    remediationActions:  t('importExport.remediationActions'),
    remediationBindings: t('importExport.remediationBindings'),
  };

  const SECTION_DESCRIPTIONS: Partial<Record<Section, string>> = {
    remediationActions:  t('importExport.remediationActionsDesc'),
    remediationBindings: t('importExport.remediationBindingsDesc'),
  };

  const CONFLICT_OPTIONS: { value: ConflictStrategy; label: string; description: string }[] = [
    {
      value:       'update',
      label:       t('importExport.conflictUpdate'),
      description: t('importExport.conflictUpdateDesc'),
    },
    {
      value:       'generateNew',
      label:       t('importExport.conflictCopy'),
      description: t('importExport.conflictCopyDesc'),
    },
    {
      value:       'ignore',
      label:       t('importExport.conflictSkip'),
      description: t('importExport.conflictSkipDesc'),
    },
  ];

  // ── Export state ──
  const [exportSections,       setExportSections]       = useState<Set<Section>>(new Set(ALL_SECTIONS));
  const [exporting,            setExporting]            = useState(false);
  const [includeSSHCredentials,setIncludeSSHCredentials]= useState(false);

  // ── Import state ──
  const [importFile,       setImportFile]       = useState<File | null>(null);
  const [importData,       setImportData]       = useState<Record<string, unknown> | null>(null);
  const [availableSections,setAvailableSections]= useState<Section[]>([]);
  const [importSections,   setImportSections]   = useState<Set<Section>>(new Set());
  const [conflictStrategy, setConflictStrategy] = useState<ConflictStrategy>('update');
  const [importing,        setImporting]        = useState(false);
  const [importResults,    setImportResults]    = useState<
    Record<string, { created: number; updated: number; skipped: number }> | null
  >(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  // ── Export handlers ──────────────────────────────────────────────────────

  const toggleExportSection = useCallback((s: Section) => {
    setExportSections(prev => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s); else next.add(s);
      return next;
    });
  }, []);

  const toggleAllExport = useCallback((on: boolean) => {
    setExportSections(on ? new Set(ALL_SECTIONS) : new Set());
  }, []);

  const handleExport = useCallback(async () => {
    if (exportSections.size === 0) {
      toast.error(t('importExport.selectSection'));
      return;
    }
    setExporting(true);
    try {
      const sections = [...exportSections].join(',');
      const sshParam = exportSections.has('remediationActions') && includeSSHCredentials
        ? '&includeSSHCredentials=true'
        : '';
      const res = await apiClient.get(
        `/admin/export?sections=${encodeURIComponent(sections)}${sshParam}`,
        { responseType: 'blob' },
      );
      const url = URL.createObjectURL(res.data as Blob);
      const a   = document.createElement('a');
      a.href     = url;
      a.download = `obliance-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(t('importExport.exported'));
    } catch {
      toast.error(t('importExport.failedExport'));
    } finally {
      setExporting(false);
    }
  }, [exportSections, includeSSHCredentials, t]);

  // ── Import handlers ──────────────────────────────────────────────────────

  /** Shared file-processing logic used by both click-select and drag-drop */
  const processFile = useCallback((file: File) => {
    setImportFile(file);
    setImportResults(null);

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const json = JSON.parse(ev.target?.result as string) as Record<string, unknown>;
        if (typeof json !== 'object' || Array.isArray(json)) throw new Error('Not an object');

        const available = ALL_SECTIONS.filter(s => Array.isArray(json[s]));
        setAvailableSections(available);
        setImportSections(new Set(available));
        setImportData(json);
      } catch {
        toast.error('Invalid export file — expected Obliance JSON export');
        setImportFile(null);
        setImportData(null);
        setAvailableSections([]);
        setImportSections(new Set());
        // Reset file input so the same file can be re-selected after error
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.readAsText(file);
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    processFile(file);
  }, [processFile]);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.json') && file.type !== 'application/json') {
      toast.error('Please drop a .json file');
      return;
    }
    processFile(file);
  }, [processFile]);

  const toggleImportSection = useCallback((s: Section) => {
    setImportSections(prev => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s); else next.add(s);
      return next;
    });
  }, []);

  const toggleAllImport = useCallback((on: boolean) => {
    setImportSections(on ? new Set(availableSections) : new Set());
  }, [availableSections]);

  const handleImport = useCallback(async () => {
    if (!importData) {
      toast.error(t('importExport.noFile'));
      return;
    }
    if (importSections.size === 0) {
      toast.error(t('importExport.noSections'));
      return;
    }
    setImporting(true);
    setImportResults(null);
    try {
      const res = await apiClient.post('/admin/import', {
        sections:         [...importSections],
        data:             importData,
        conflictStrategy,
      });
      setImportResults(res.data.data);
      toast.success(t('importExport.importOk'));
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? t('importExport.failedImport'));
    } finally {
      setImporting(false);
    }
  }, [importData, importSections, conflictStrategy, t]);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-5xl min-w-0 px-4 py-8">

      {/* Page header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <PackageOpen size={22} className="text-accent" />
          <h1 className="text-2xl font-semibold text-text-primary">{t('importExport.title')}</h1>
        </div>
        <p className="text-sm text-text-muted">
          {t('importExport.description')}
        </p>
        <a
          href="/obliance-import-example.json"
          download="obliance-import-example.json"
          className="mt-2 inline-flex items-center gap-1.5 text-xs text-accent hover:underline"
        >
          <ExternalLink size={11} />
          {t('importExport.downloadTemplate')}
        </a>
      </div>

      {/* ── Export card ── */}
      <div className="mb-6 rounded-xl border border-border bg-bg-secondary p-6">
        <div className="flex items-center gap-2 mb-1">
          <Download size={15} className="text-accent" />
          <h2 className="text-base font-semibold text-text-primary">{t('importExport.exportTitle')}</h2>
        </div>
        <p className="text-xs text-text-muted mb-5">
          {t('importExport.exportDesc')}
        </p>

        <SectionSelector
          sections={ALL_SECTIONS}
          enabled={exportSections}
          onToggle={toggleExportSection}
          onToggleAll={toggleAllExport}
          descriptions={SECTION_DESCRIPTIONS}
          extra={
            exportSections.has('remediationActions') && (
              <div className="ml-4 mt-1 flex items-center justify-between gap-4 rounded-lg border border-border bg-bg-tertiary px-3 py-2.5">
                <div>
                  <span className="text-sm text-text-secondary">{t('importExport.includeSsh')}</span>
                  <p className="text-[11px] text-text-muted mt-0.5">
                    {t('importExport.includeSshDesc')}
                  </p>
                </div>
                <Toggle
                  checked={includeSSHCredentials}
                  onChange={setIncludeSSHCredentials}
                />
              </div>
            )
          }
        />

        <div className="mt-5 flex justify-end">
          <Button
            onClick={handleExport}
            loading={exporting}
            disabled={exportSections.size === 0}
          >
            <Download size={14} className="mr-1.5" />
            {t('importExport.downloadJson')}
          </Button>
        </div>
      </div>

      {/* ── Import card ── */}
      <div className="rounded-xl border border-border bg-bg-secondary p-6">
        <div className="flex items-center gap-2 mb-1">
          <Upload size={15} className="text-accent" />
          <h2 className="text-base font-semibold text-text-primary">{t('importExport.importTitle')}</h2>
        </div>
        <p className="text-xs text-text-muted mb-5">
          {t('importExport.importDesc')}
        </p>

        {/* File drop zone */}
        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={[
            'mb-5 flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed',
            'px-6 py-6 transition-colors',
            isDragging
              ? 'border-accent bg-accent/10 scale-[1.01]'
              : importFile
                ? 'border-accent/50 bg-accent/5'
                : 'border-border bg-bg-tertiary hover:border-accent hover:bg-accent/5',
          ].join(' ')}
        >
          <FileJson size={28} className={importFile || isDragging ? 'text-accent' : 'text-text-muted'} />
          <span className="text-sm text-text-secondary text-center">
            {isDragging
              ? t('importExport.dropzoneActive')
              : importFile
                ? importFile.name
                : t('importExport.dropzone')}
          </span>
          {importFile && (
            <span className="text-xs text-text-muted">
              {(importFile.size / 1024).toFixed(1)} KB
              {availableSections.length > 0 && (
                <> · {t('importExport.sectionsFound', { count: availableSections.length })}</>
              )}
            </span>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>

        {/* Options shown only once a file is loaded */}
        {importData && availableSections.length > 0 && (
          <>
            {/* Section selector */}
            <div className="mb-5">
              <p className="text-xs font-medium text-text-muted uppercase tracking-wider mb-3">
                {t('importExport.sectionsToImport')}
              </p>
              <SectionSelector
                sections={availableSections}
                enabled={importSections}
                onToggle={toggleImportSection}
                onToggleAll={toggleAllImport}
                descriptions={SECTION_DESCRIPTIONS}
              />
            </div>

            {/* Conflict strategy */}
            <div className="mb-5">
              <p className="text-xs font-medium text-text-muted uppercase tracking-wider mb-3">
                {t('importExport.conflictLabel')}
              </p>
              <div className="space-y-2">
                {CONFLICT_OPTIONS.map(opt => (
                  <label
                    key={opt.value}
                    className={[
                      'flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors',
                      conflictStrategy === opt.value
                        ? 'border-accent bg-accent/5'
                        : 'border-border hover:border-accent/40',
                    ].join(' ')}
                  >
                    <input
                      type="radio"
                      name="conflictStrategy"
                      value={opt.value}
                      checked={conflictStrategy === opt.value}
                      onChange={() => setConflictStrategy(opt.value)}
                      className="mt-0.5 accent-accent"
                    />
                    <div>
                      <div className="text-sm font-medium text-text-primary">{opt.label}</div>
                      <div className="text-xs text-text-muted mt-0.5">{opt.description}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex justify-end">
              <Button
                onClick={handleImport}
                loading={importing}
                disabled={importSections.size === 0}
              >
                <Upload size={14} className="mr-1.5" />
                {t('importExport.importBtn')}
              </Button>
            </div>
          </>
        )}

        {/* No sections found */}
        {importData && availableSections.length === 0 && (
          <p className="text-sm text-text-muted text-center py-4">
            {t('importExport.noImportable')}
          </p>
        )}

        {/* Results summary */}
        {importResults && (
          <div className="mt-5 rounded-lg border border-border bg-bg-tertiary p-4">
            <div className="flex items-center gap-2 mb-3 text-green-400">
              <CheckCircle2 size={15} />
              <span className="text-sm font-medium">{t('importExport.importOk')}</span>
            </div>
            <div className="space-y-1.5">
              {Object.entries(importResults).map(([section, r]) => (
                <div key={section} className="flex items-center justify-between text-xs">
                  <span className="text-text-secondary">
                    {SECTION_LABELS[section as Section] ?? section}
                  </span>
                  <span className="text-text-muted tabular-nums">
                    <span className="text-green-400">{t('importExport.statCreated', { count: r.created })}</span>
                    {' · '}
                    <span className="text-blue-400">{t('importExport.statUpdated', { count: r.updated })}</span>
                    {r.skipped > 0 && (
                      <>{' · '}<span className="text-yellow-400">{t('importExport.statSkipped', { count: r.skipped })}</span></>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
