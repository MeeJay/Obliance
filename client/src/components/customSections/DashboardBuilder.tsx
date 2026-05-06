// ─────────────────────────────────────────────────────────────────────────────
// Dashboard builder — modal that turns a sample command/file output into
// a self-contained sh / ps1 script for a custom section.
//
// Three steps in one modal:
//   1. Source — command vs file, runtime, sample paste.
//   2. Fields — auto-mapped from the sample, user picks/labels each.
//   3. Layout — group fields into hero-row / stat-grid / pill-row / table.
//
// On confirm, the generated script is handed back to the caller via
// `onInsert` so the form can drop it into the section's `command` field.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Wand2, X, FileText, Terminal, Plus, GripVertical, Trash2, Check, ChevronRight, ChevronDown } from 'lucide-react';
import { clsx } from 'clsx';
import {
  automap,
  type FieldCandidate,
  type SourceFormat,
} from '@/utils/dashboardAutomap';
import {
  generateScript,
  type BuilderState,
  type BuilderField,
  type BuilderBlock,
  type BlockKind,
  type BuilderRuntime,
  type ColorRule,
  type FieldColor,
} from '@/utils/dashboardCodegen';

interface Props {
  /** Current runtime selected in the parent form — pre-fills the builder. */
  runtime: BuilderRuntime;
  /** Existing command in the form, used as a sample when the user wants
   *  to round-trip a previously-generated dashboard. */
  initialCommand?: string;
  /** Section name — pre-fills the dashboard title shown in the header. */
  initialTitle?: string;
  onClose: () => void;
  /** Called with the freshly generated script body. The parent typically
   *  writes it into the section's `command` textarea. */
  onInsert: (generated: string, runtime: BuilderRuntime) => void;
}

export function DashboardBuilder({ runtime, initialCommand, initialTitle, onClose, onInsert }: Props) {
  // ── Step 1 state — Source ────────────────────────────────────────────────
  const [activeRuntime, setActiveRuntime] = useState<BuilderRuntime>(runtime);
  const [sourceKind, setSourceKind] = useState<'command' | 'file'>('command');
  const [command, setCommand] = useState<string>(initialCommand ?? '');
  const [filePath, setFilePath] = useState<string>('');
  const [fileMode, setFileMode] = useState<'all' | 'tail' | 'head'>('tail');
  const [fileLines, setFileLines] = useState<number>(50);

  // ── Step 2 state — Sample + format + auto-mapping ───────────────────────
  const [sample, setSample] = useState<string>('');
  const [format, setFormat] = useState<SourceFormat>('auto');
  const [csvDelimiter, setCsvDelimiter] = useState<string | undefined>(undefined);
  const [regexPattern, setRegexPattern] = useState<string>('');
  const [regexFlags, setRegexFlags] = useState<string>('');
  const automapResult = useMemo(
    () => automap(sample, { format, csvDelimiter, regexPattern, regexFlags }),
    [sample, format, csvDelimiter, regexPattern, regexFlags],
  );
  // Picked candidates — set of ids the user wants in the dashboard. Default
  // to "all detected" the first time a sample is parsed so the user has a
  // working draft they can prune.
  const [pickedIds, setPickedIds] = useState<Set<string>>(new Set());
  // Per-field user overrides keyed by candidate id (label, type).
  const [overrides, setOverrides] = useState<Record<string, Partial<BuilderField>>>({});
  // Auto-pick all fresh candidates whenever the automap output changes.
  useEffect(() => {
    setPickedIds((prev) => {
      const known = new Set(automapResult.candidates.map((c) => c.id));
      // Drop ids that no longer exist after a format change.
      const next = new Set([...prev].filter((id) => known.has(id)));
      // First pass after a fresh sample → pick all.
      if (next.size === 0 && automapResult.candidates.length > 0 && Object.keys(overrides).length === 0) {
        for (const c of automapResult.candidates) next.add(c.id);
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [automapResult]);

  // ── Step 3 state — Layout blocks ────────────────────────────────────────
  const [blocks, setBlocks] = useState<BuilderBlock[]>([]);
  const [title, setTitle] = useState<string>(initialTitle ?? '');
  // Stable per-section history key — used by the codegen to scope tmp
  // files per (section, field) so multiple HTML dashboards on the same
  // device don't share state.
  const [useMemoHistoryKey] = useState(() => `s${Math.random().toString(36).slice(2, 10)}`);

  // Reset blocks when the user switches format — old block ids would be
  // pointing at fields that no longer exist.
  useEffect(() => { setBlocks([]); }, [format, sample]);

  // Default layout suggestion: when the user reaches step 3 with no blocks
  // and at least one picked candidate, pre-fill ONE auto-suggested layout
  // grouped by the candidates' parent section. Numerics → stat-grid;
  // bools → pill-row; CSV table → single table block.
  const suggestLayout = () => {
    const picked = automapResult.candidates.filter((c) => pickedIds.has(c.id));
    if (picked.length === 0) return;
    const ts = (id: string) => overrides[id]?.type ?? automapResult.candidates.find((c) => c.id === id)?.detectedType;
    if (automapResult.format === 'csv-header' || automapResult.format === 'csv-noheader') {
      const tableFields = picked.map((c) => c.id);
      setBlocks([{ id: bid(), kind: 'table', title: 'Data', fieldIds: tableFields }]);
      return;
    }
    // JSON / lines → split by section.
    const grouped = new Map<string, FieldCandidate[]>();
    for (const c of picked) {
      const key = c.parentSection || '_root';
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(c);
    }
    const out: BuilderBlock[] = [];
    for (const [section, list] of grouped) {
      // Pick a kind based on majority type: bools → pill, numbers → stat-grid.
      const numeric = list.filter((c) => ['number', 'integer', 'duration'].includes(ts(c.id) as string));
      const bools   = list.filter((c) => ts(c.id) === 'bool');
      if (numeric.length >= list.length * 0.6 && numeric.length >= 2) {
        out.push({ id: bid(), kind: 'stat-grid', title: humanize(section), fieldIds: numeric.map((c) => c.id) });
        const rest = list.filter((c) => !numeric.includes(c));
        if (rest.length > 0) out.push({ id: bid(), kind: 'pill-row', fieldIds: rest.map((c) => c.id) });
      } else if (bools.length === list.length) {
        out.push({ id: bid(), kind: 'pill-row', title: humanize(section), fieldIds: list.map((c) => c.id) });
      } else {
        out.push({ id: bid(), kind: 'stat-grid', title: humanize(section), fieldIds: list.map((c) => c.id) });
      }
    }
    setBlocks(out);
  };
  // Auto-suggest once when picked changes after a fresh sample.
  useEffect(() => {
    if (blocks.length === 0 && pickedIds.size > 0) suggestLayout();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickedIds]);

  // ── Build the BuilderState passed to the codegen ────────────────────────
  const builderState: BuilderState = useMemo(() => {
    const fields: Record<string, BuilderField> = {};
    for (const c of automapResult.candidates) {
      if (!pickedIds.has(c.id)) continue;
      const ov = overrides[c.id] ?? {};
      fields[c.id] = {
        id: c.id,
        path: c.path,
        label: ov.label ?? c.suggestedLabel,
        type: (ov.type ?? c.detectedType) as BuilderField['type'],
        isInArray: c.isInArray,
      };
    }
    return {
      runtime: activeRuntime,
      source: {
        kind: sourceKind,
        command: sourceKind === 'command' ? command : undefined,
        filePath: sourceKind === 'file' ? filePath : undefined,
        fileMode: sourceKind === 'file' ? fileMode : undefined,
        fileLines: sourceKind === 'file' ? fileLines : undefined,
      },
      format: (automapResult.format === 'auto' ? 'json' : automapResult.format) as BuilderState['format'],
      csvDelimiter: automapResult.csv?.delimiter,
      kvSeparator: automapResult.kvSeparator,
      regexPattern: format === 'regex' ? regexPattern : undefined,
      regexFlags: format === 'regex' ? regexFlags : undefined,
      fields,
      blocks,
      title: title || undefined,
      historyKey: useMemoHistoryKey,
    };
  }, [activeRuntime, sourceKind, command, filePath, fileMode, fileLines, automapResult, pickedIds, overrides, blocks, title, format, regexPattern, regexFlags]);

  const generated = useMemo(() => {
    if (Object.keys(builderState.fields).length === 0 || builderState.blocks.length === 0) return '';
    try { return generateScript(builderState); } catch { return ''; }
  }, [builderState]);

  // ── Layout helpers ──────────────────────────────────────────────────────
  const addBlock = (kind: BlockKind) => {
    setBlocks((prev) => [...prev, { id: bid(), kind, title: '', fieldIds: [] }]);
  };
  const removeBlock = (id: string) => setBlocks((prev) => prev.filter((b) => b.id !== id));
  const moveBlock = (id: string, dir: -1 | 1) => {
    setBlocks((prev) => {
      const idx = prev.findIndex((b) => b.id === id);
      if (idx < 0) return prev;
      const target = idx + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  };
  const toggleFieldInBlock = (blockId: string, fieldId: string) => {
    setBlocks((prev) => prev.map((b) => {
      if (b.id !== blockId) return b;
      const has = b.fieldIds.includes(fieldId);
      return { ...b, fieldIds: has ? b.fieldIds.filter((x) => x !== fieldId) : [...b.fieldIds, fieldId] };
    }));
  };
  const renameBlock = (id: string, title: string) => {
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, title } : b)));
  };

  // ── Step 1+2 collapse state — saves a lot of vertical space once a
  //    sample is parsed and the user is mostly editing layout.
  const [openStep, setOpenStep] = useState<1 | 2 | 3>(1);
  useEffect(() => {
    // Auto-advance once the user has a sample + at least one picked field.
    if (sample.trim().length > 0 && pickedIds.size > 0 && openStep === 1) setOpenStep(2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sample, pickedIds]);

  const modal = (
    <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-bg-secondary border border-border rounded-xl w-full max-w-6xl max-h-[92vh] flex flex-col shadow-2xl"
           onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-border flex items-center gap-3">
          <Wand2 className="w-5 h-5 text-purple-400" />
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-text-primary">Dashboard builder</h2>
            <p className="text-[11px] text-text-muted">
              Generate a self-contained {activeRuntime === 'powershell' ? 'PowerShell' : 'bash'} script that fetches your data and renders an Obliance-branded HTML dashboard.
            </p>
          </div>
          <button onClick={onClose} className="p-1 text-text-muted hover:text-text-primary">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* ── Step 1 — Source ────────────────────────────────────────── */}
          <Section
            n={1} open={openStep === 1} onToggle={() => setOpenStep(openStep === 1 ? 3 : 1)}
            title="Source"
            summary={sourceKind === 'command'
              ? (command ? `command: ${command.split('\n')[0].slice(0, 60)}${command.length > 60 ? '…' : ''}` : 'no command')
              : `file: ${filePath || '—'} (${fileMode === 'all' ? 'all' : `${fileMode} ${fileLines}`})`}
          >
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setSourceKind('command')}
                className={clsx('p-2.5 text-left rounded-lg border transition-colors', sourceKind === 'command' ? 'bg-accent/10 border-accent text-accent' : 'border-border text-text-muted hover:border-accent/50')}>
                <div className="flex items-center gap-2 text-sm font-semibold"><Terminal className="w-4 h-4" /> Command</div>
                <div className="text-[10px] mt-0.5">curl, mining-CLI status, kubectl, anything that prints to stdout.</div>
              </button>
              <button type="button" onClick={() => setSourceKind('file')}
                className={clsx('p-2.5 text-left rounded-lg border transition-colors', sourceKind === 'file' ? 'bg-accent/10 border-accent text-accent' : 'border-border text-text-muted hover:border-accent/50')}>
                <div className="flex items-center gap-2 text-sm font-semibold"><FileText className="w-4 h-4" /> File</div>
                <div className="text-[10px] mt-0.5">Read all / last N / first N lines from a path on the device.</div>
              </button>
            </div>
            <div className="mt-3">
              <label className="text-[11px] text-text-muted uppercase">Runtime</label>
              <div className="flex gap-2 mt-1">
                {(['sh', 'powershell'] as const).map((r) => (
                  <button key={r} type="button" onClick={() => setActiveRuntime(r)}
                    className={clsx('px-3 py-1 text-xs rounded-full border', activeRuntime === r ? 'bg-accent/10 border-accent text-accent' : 'border-border text-text-muted hover:border-accent/50')}>
                    {r === 'sh' ? 'bash / sh' : 'powershell'}
                  </button>
                ))}
              </div>
            </div>
            {sourceKind === 'command' ? (
              <div className="mt-3">
                <label className="text-[11px] text-text-muted uppercase">Command</label>
                <textarea value={command} onChange={(e) => setCommand(e.target.value)}
                  rows={2}
                  placeholder={activeRuntime === 'powershell' ? 'Invoke-RestMethod http://localhost:8080/status' : 'curl -sf http://127.0.0.1:17899/summary'}
                  className="w-full mt-1 px-3 py-2 text-sm bg-bg-tertiary border border-border rounded-lg focus:outline-none focus:border-accent font-mono whitespace-pre" />
              </div>
            ) : (
              <div className="mt-3 space-y-2">
                <label className="text-[11px] text-text-muted uppercase">File path</label>
                <input value={filePath} onChange={(e) => setFilePath(e.target.value)}
                  placeholder={activeRuntime === 'powershell' ? 'C:\\Logs\\miner.log' : '/var/log/miner/stats.log'}
                  className="w-full px-3 py-2 text-sm bg-bg-tertiary border border-border rounded-lg focus:outline-none focus:border-accent font-mono" />
                <div className="flex items-center gap-2">
                  {(['tail', 'head', 'all'] as const).map((m) => (
                    <button key={m} type="button" onClick={() => setFileMode(m)}
                      className={clsx('px-3 py-1 text-xs rounded-full border', fileMode === m ? 'bg-accent/10 border-accent text-accent' : 'border-border text-text-muted hover:border-accent/50')}>
                      {m === 'all' ? 'whole file' : m === 'tail' ? 'last N lines' : 'first N lines'}
                    </button>
                  ))}
                  {fileMode !== 'all' && (
                    <input type="number" min={1} max={1000} value={fileLines} onChange={(e) => setFileLines(parseInt(e.target.value, 10) || 50)}
                      className="w-20 px-2 py-1 text-xs bg-bg-tertiary border border-border rounded focus:outline-none focus:border-accent" />
                  )}
                </div>
              </div>
            )}
          </Section>

          {/* ── Step 2 — Sample + auto-mapping ─────────────────────────── */}
          <Section
            n={2} open={openStep === 2} onToggle={() => setOpenStep(openStep === 2 ? 3 : 2)}
            title="Sample output"
            summary={automapResult.candidates.length > 0
              ? `${automapResult.format} · ${automapResult.candidates.length} field${automapResult.candidates.length > 1 ? 's' : ''} detected · ${pickedIds.size} kept`
              : 'paste an example output to auto-detect fields'}
          >
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <label className="text-[11px] text-text-muted uppercase">Format</label>
                <select value={format} onChange={(e) => setFormat(e.target.value as SourceFormat)}
                  className="text-xs bg-bg-tertiary border border-border rounded px-2 py-1 text-text-primary focus:outline-none focus:border-accent">
                  <option value="auto">Auto-detect</option>
                  <option value="json">JSON</option>
                  <option value="jsonlines">JSON Lines (one obj/line)</option>
                  <option value="kv">key=value / key:value</option>
                  <option value="csv-header">CSV with header</option>
                  <option value="csv-noheader">CSV without header</option>
                  <option value="regex">Regex (named groups)</option>
                  <option value="lines">Raw lines</option>
                </select>
                {(automapResult.format === 'csv-header' || automapResult.format === 'csv-noheader') && (
                  <>
                    <label className="text-[11px] text-text-muted uppercase ml-3">Delimiter</label>
                    <select value={csvDelimiter ?? automapResult.csv?.delimiter ?? ','} onChange={(e) => setCsvDelimiter(e.target.value)}
                      className="text-xs bg-bg-tertiary border border-border rounded px-2 py-1 text-text-primary focus:outline-none focus:border-accent">
                      <option value=",">,</option>
                      <option value=";">;</option>
                      <option value={'\t'}>tab</option>
                      <option value="|">|</option>
                    </select>
                  </>
                )}
              </div>
              {/* Regex pattern + flags input — only shown when format='regex'.
                  The named groups are auto-discovered from the pattern and
                  emerge as candidate fields the moment a match is found
                  against the sample. */}
              {format === 'regex' && (
                <div className="flex items-center gap-2 flex-wrap p-2 border border-border rounded bg-bg-tertiary/30">
                  <span className="text-[11px] text-text-muted uppercase">Pattern</span>
                  <input
                    value={regexPattern}
                    onChange={(e) => setRegexPattern(e.target.value)}
                    placeholder="^(?<host>\\S+)\\s+(?<status>\\w+)\\s+(?<rate>\\d+)"
                    className="flex-1 px-2 py-1 text-xs bg-bg-primary border border-border rounded font-mono text-text-primary focus:outline-none focus:border-accent"
                  />
                  <span className="text-[11px] text-text-muted uppercase">Flags</span>
                  <input
                    value={regexFlags}
                    onChange={(e) => setRegexFlags(e.target.value.replace(/[^gimsx]/g, ''))}
                    placeholder="gim"
                    className="w-16 px-2 py-1 text-xs bg-bg-primary border border-border rounded font-mono text-text-primary focus:outline-none focus:border-accent"
                  />
                  <span className="text-[10px] text-text-muted/70">
                    Use <code className="font-mono">(?&lt;name&gt;…)</code> for each value to extract.
                  </span>
                </div>
              )}
              <textarea value={sample} onChange={(e) => setSample(e.target.value)}
                rows={6}
                placeholder={'Paste a real output sample here. The builder walks JSON, splits CSV, or treats the rest as raw lines.'}
                className="w-full px-3 py-2 text-xs bg-bg-tertiary border border-border rounded-lg focus:outline-none focus:border-accent font-mono whitespace-pre" />
              {automapResult.candidates.length > 0 && (
                <div className="border border-border rounded-lg overflow-hidden">
                  <div className="px-3 py-1.5 bg-bg-tertiary/40 border-b border-border text-[11px] font-mono uppercase text-text-muted flex items-center justify-between">
                    <span>Detected fields · {automapResult.format}</span>
                    <div className="flex items-center gap-3 text-[10px]">
                      <button onClick={() => setPickedIds(new Set(automapResult.candidates.map((c) => c.id)))} className="text-accent hover:underline">all</button>
                      <button onClick={() => setPickedIds(new Set())} className="text-text-muted hover:text-text-primary">none</button>
                    </div>
                  </div>
                  <div className="max-h-[260px] overflow-y-auto">
                    {automapResult.candidates.map((c) => {
                      const checked = pickedIds.has(c.id);
                      const ov = overrides[c.id] ?? {};
                      const effectiveType = (ov.type ?? c.detectedType) as BuilderField['type'];
                      const isNumeric = effectiveType === 'number' || effectiveType === 'integer' || effectiveType === 'duration';
                      const rules = ov.colorRules ?? [];
                      const updateOverride = (patch: Partial<BuilderField>) => setOverrides((prev) => ({ ...prev, [c.id]: { ...prev[c.id], ...patch } }));
                      return (
                        <div key={c.id} className={clsx('border-b border-border/40 last:border-b-0', checked && 'bg-accent/5')}>
                          <div className="px-3 py-1.5 flex items-center gap-2 text-xs">
                            <input type="checkbox" checked={checked} onChange={() => {
                              setPickedIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(c.id)) next.delete(c.id); else next.add(c.id);
                                return next;
                              });
                            }} className="accent-accent" />
                            <span className="font-mono text-[10px] text-text-muted shrink-0 w-[180px] truncate" title={c.path}>{c.path}</span>
                            <input
                              value={ov.label ?? c.suggestedLabel}
                              onChange={(e) => updateOverride({ label: e.target.value })}
                              className="flex-1 px-1.5 py-0.5 bg-bg-primary border border-border rounded text-text-primary focus:outline-none focus:border-accent" />
                            <select
                              value={effectiveType}
                              onChange={(e) => updateOverride({ type: e.target.value as BuilderField['type'] })}
                              className="bg-bg-primary border border-border rounded px-1.5 py-0.5 text-[11px] text-text-primary focus:outline-none focus:border-accent">
                              <option value="number">number</option>
                              <option value="integer">integer</option>
                              <option value="string">string</option>
                              <option value="bool">bool</option>
                              <option value="date">date</option>
                              <option value="time">time</option>
                              <option value="datetime">datetime</option>
                              <option value="duration">duration (s)</option>
                            </select>
                            <span className="text-[10px] text-text-muted/70 truncate max-w-[100px]" title={c.sampleValue}>{c.sampleValue}</span>
                          </div>
                          {/* Extras row — visible only for picked fields. Holds the
                              history toggle (numeric only) + the colour rules
                              editor. Kept inline for now; once the rule list
                              gets richer we can move to a popover. */}
                          {checked && (
                            <div className="px-3 pb-1.5 flex items-center gap-3 flex-wrap">
                              {isNumeric && (
                                <label className="inline-flex items-center gap-1.5 text-[11px] text-text-muted cursor-pointer">
                                  <input type="checkbox" checked={!!ov.trackHistory} onChange={(e) => updateOverride({ trackHistory: e.target.checked, historyMaxSamples: ov.historyMaxSamples ?? 60 })}
                                    className="accent-purple-400" />
                                  <span>track history (sparkline)</span>
                                  {ov.trackHistory && (
                                    <input type="number" min={5} max={500} value={ov.historyMaxSamples ?? 60}
                                      onChange={(e) => updateOverride({ historyMaxSamples: parseInt(e.target.value, 10) || 60 })}
                                      className="w-14 px-1.5 py-0.5 bg-bg-primary border border-border rounded text-[10px] text-text-primary focus:outline-none focus:border-accent ml-1" />
                                  )}
                                </label>
                              )}
                              <div className="inline-flex items-center gap-1.5">
                                <span className="text-[11px] text-text-muted">color when:</span>
                                {rules.map((r, i) => (
                                  <ColorRulePill key={i} rule={r}
                                    onChange={(next) => {
                                      const arr = [...rules]; arr[i] = next;
                                      updateOverride({ colorRules: arr });
                                    }}
                                    onRemove={() => {
                                      const arr = rules.filter((_, j) => j !== i);
                                      updateOverride({ colorRules: arr });
                                    }} />
                                ))}
                                <button type="button"
                                  onClick={() => updateOverride({ colorRules: [...rules, { when: isNumeric ? 'gt' : 'eq', value: isNumeric ? 0 : '', color: 'red' }] })}
                                  className="text-[11px] px-1.5 py-0.5 rounded border border-border bg-bg-tertiary text-text-muted hover:text-text-primary hover:border-accent/40">
                                  + rule
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </Section>

          {/* ── Step 3 — Layout ────────────────────────────────────────── */}
          <Section
            n={3} open={openStep === 3} onToggle={() => setOpenStep(3)}
            title="Layout"
            summary={blocks.length === 0 ? 'no blocks yet' : `${blocks.length} block${blocks.length > 1 ? 's' : ''}`}
          >
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <label className="text-[11px] text-text-muted uppercase">Title</label>
                <input value={title} onChange={(e) => setTitle(e.target.value)}
                  placeholder="Qubic Mining Monitor"
                  className="flex-1 px-2 py-1 text-xs bg-bg-tertiary border border-border rounded text-text-primary focus:outline-none focus:border-accent" />
                <button type="button" onClick={suggestLayout}
                  className="px-2 py-1 text-[11px] rounded border border-purple-400/30 bg-purple-400/10 text-purple-400 hover:bg-purple-400/20">
                  Auto layout
                </button>
              </div>
              {blocks.map((b, i) => (
                <BlockEditor key={b.id} block={b} index={i} total={blocks.length}
                  candidates={automapResult.candidates}
                  pickedIds={pickedIds}
                  overrides={overrides}
                  onRename={(t) => renameBlock(b.id, t)}
                  onMove={(d) => moveBlock(b.id, d)}
                  onRemove={() => removeBlock(b.id)}
                  onToggleField={(fid) => toggleFieldInBlock(b.id, fid)}
                />
              ))}
              <div className="flex items-center gap-1.5 flex-wrap pt-1">
                <span className="text-[10px] text-text-muted uppercase mr-2">Add block</span>
                {(['hero-row', 'stat-grid', 'pill-row', 'table', 'sparkline-card', 'pre'] as const).map((k) => (
                  <button key={k} onClick={() => addBlock(k)}
                    className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded border border-border bg-bg-tertiary text-text-muted hover:text-text-primary hover:border-accent/40">
                    <Plus className="w-3 h-3" /> {k}
                  </button>
                ))}
              </div>
            </div>
          </Section>

          {/* ── Generated script preview ────────────────────────────────── */}
          {generated && (
            <div className="border border-border rounded-lg overflow-hidden">
              <div className="px-3 py-1.5 bg-bg-tertiary/40 border-b border-border text-[11px] font-mono uppercase text-text-muted">
                Generated script — {activeRuntime === 'powershell' ? 'PowerShell' : 'bash'}
              </div>
              <pre className="max-h-[260px] overflow-auto px-3 py-2 text-[11px] font-mono text-text-secondary whitespace-pre">{generated}</pre>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-border flex items-center justify-between">
          <span className="text-[11px] text-text-muted">
            {generated
              ? 'Click Insert to drop the script into the section.'
              : 'Configure source, paste a sample, pick fields, and add at least one layout block.'}
          </span>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-[12px] bg-bg-tertiary text-text-muted hover:text-text-primary rounded">
              Cancel
            </button>
            <button
              onClick={() => onInsert(generated, activeRuntime)}
              disabled={!generated}
              className="px-3 py-1.5 text-[12px] bg-accent text-white rounded hover:bg-accent/80 disabled:opacity-50 inline-flex items-center gap-1.5">
              <Check className="w-3.5 h-3.5" /> Insert into command
            </button>
          </div>
        </div>
      </div>
    </div>
  );
  return createPortal(modal, document.body);
}

// ── Reusable collapsible section header ─────────────────────────────────────
function Section({
  n, title, summary, open, onToggle, children,
}: {
  n: number;
  title: string;
  summary: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button type="button" onClick={onToggle}
        className="w-full px-3 py-2 bg-bg-tertiary/30 border-b border-border flex items-center gap-2 text-left hover:bg-bg-tertiary/60 transition-colors">
        {open ? <ChevronDown className="w-3.5 h-3.5 text-text-muted shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-text-muted shrink-0" />}
        <span className="text-[10px] font-mono text-text-muted/70 shrink-0">STEP {n}</span>
        <span className="text-sm font-semibold text-text-primary">{title}</span>
        <span className="ml-auto text-[10px] text-text-muted truncate">{summary}</span>
      </button>
      {open && <div className="p-3">{children}</div>}
    </div>
  );
}

// ── Per-block editor — header + field selector grid ─────────────────────────
function BlockEditor({
  block, index, total, candidates, pickedIds, overrides,
  onRename, onMove, onRemove, onToggleField,
}: {
  block: BuilderBlock;
  index: number; total: number;
  candidates: FieldCandidate[];
  pickedIds: Set<string>;
  overrides: Record<string, Partial<BuilderField>>;
  onRename: (title: string) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onToggleField: (id: string) => void;
}) {
  const pickedCandidates = candidates.filter((c) => pickedIds.has(c.id));
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="px-3 py-1.5 bg-bg-tertiary/30 border-b border-border flex items-center gap-2">
        <GripVertical className="w-3.5 h-3.5 text-text-muted/70" />
        <span className="text-[10px] font-mono uppercase text-purple-400 shrink-0">{block.kind}</span>
        <input value={block.title ?? ''} onChange={(e) => onRename(e.target.value)}
          placeholder="optional title"
          className="flex-1 bg-transparent border-none text-xs text-text-primary placeholder-text-muted/50 focus:outline-none" />
        <span className="text-[10px] text-text-muted/70">{block.fieldIds.length} field{block.fieldIds.length > 1 ? 's' : ''}</span>
        <button onClick={() => onMove(-1)} disabled={index === 0} className="p-1 text-text-muted hover:text-text-primary disabled:opacity-30" title="Move up">↑</button>
        <button onClick={() => onMove(1)} disabled={index === total - 1} className="p-1 text-text-muted hover:text-text-primary disabled:opacity-30" title="Move down">↓</button>
        <button onClick={onRemove} className="p-1 text-text-muted hover:text-red-400" title="Remove block"><Trash2 className="w-3.5 h-3.5" /></button>
      </div>
      <div className="p-2 grid grid-cols-2 gap-1">
        {pickedCandidates.length === 0
          ? <div className="text-[11px] text-text-muted col-span-2 italic px-1">No picked fields — go back to step 2 and check at least one.</div>
          : pickedCandidates.map((c) => {
              const checked = block.fieldIds.includes(c.id);
              const label = overrides[c.id]?.label ?? c.suggestedLabel;
              return (
                <label key={c.id} className={clsx(
                  'flex items-center gap-2 px-2 py-1 text-[11px] rounded cursor-pointer transition-colors',
                  checked ? 'bg-accent/10 border border-accent/30' : 'border border-transparent hover:bg-bg-tertiary',
                )}>
                  <input type="checkbox" checked={checked} onChange={() => onToggleField(c.id)} className="accent-accent" />
                  <span className="text-text-primary truncate flex-1">{label}</span>
                  <span className="text-[9px] font-mono text-text-muted/60 truncate max-w-[80px]" title={c.path}>{c.path}</span>
                </label>
              );
            })}
      </div>
    </div>
  );
}

// ── Inline colour-rule editor ───────────────────────────────────────────────
// Compact pill that fits on the field row alongside the history toggle.
// One rule per pill; the rule list builds up by clicking "+ rule" on the
// parent row. Order matters at codegen time (first match wins).
function ColorRulePill({ rule, onChange, onRemove }: { rule: ColorRule; onChange: (r: ColorRule) => void; onRemove: () => void }) {
  const operatorNeedsValue = rule.when !== 'truthy' && rule.when !== 'falsy';
  return (
    <span className={clsx(
      'inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-mono',
      rule.color === 'green'  && 'border-green-400/40 bg-green-400/10 text-green-400',
      rule.color === 'amber'  && 'border-amber-400/40 bg-amber-400/10 text-amber-400',
      rule.color === 'red'    && 'border-red-400/40 bg-red-400/10 text-red-400',
      rule.color === 'blue'   && 'border-blue-400/40 bg-blue-400/10 text-blue-400',
      rule.color === 'purple' && 'border-purple-400/40 bg-purple-400/10 text-purple-400',
      rule.color === 'muted'  && 'border-border bg-bg-tertiary text-text-muted',
    )}>
      <select value={rule.when} onChange={(e) => onChange({ ...rule, when: e.target.value as ColorRule['when'] })}
        className="bg-transparent border-none focus:outline-none text-[10px] cursor-pointer pr-0.5">
        <option value="eq">=</option>
        <option value="neq">≠</option>
        <option value="gt">&gt;</option>
        <option value="gte">≥</option>
        <option value="lt">&lt;</option>
        <option value="lte">≤</option>
        <option value="contains">contains</option>
        <option value="truthy">truthy</option>
        <option value="falsy">falsy</option>
      </select>
      {operatorNeedsValue && (
        <input value={String(rule.value ?? '')}
          onChange={(e) => onChange({ ...rule, value: e.target.value })}
          className="w-12 bg-transparent border-none focus:outline-none text-[10px] font-mono" />
      )}
      <span>→</span>
      <select value={rule.color} onChange={(e) => onChange({ ...rule, color: e.target.value as FieldColor })}
        className="bg-transparent border-none focus:outline-none text-[10px] cursor-pointer">
        <option value="red">red</option>
        <option value="amber">amber</option>
        <option value="green">green</option>
        <option value="blue">blue</option>
        <option value="purple">purple</option>
        <option value="muted">muted</option>
      </select>
      <button type="button" onClick={onRemove} className="opacity-60 hover:opacity-100" title="Remove">✕</button>
    </span>
  );
}

// ── Local helpers ───────────────────────────────────────────────────────────
function bid(): string { return `b_${Math.random().toString(36).slice(2, 9)}`; }
function humanize(s: string): string {
  return s.replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\b\w/g, (c) => c.toUpperCase());
}
