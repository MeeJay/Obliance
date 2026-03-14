import React, { useState } from 'react';
import { X, Settings2, Pencil, Check } from 'lucide-react';
import type { DeviceDisplayConfig } from '@obliance/shared';
import { prettifySensorLabel } from '../../utils/sensorLabels';

type Section = 'cpu' | 'ram' | 'gpu' | 'drives' | 'network' | 'temps';

interface Props {
  open: boolean;
  onClose: () => void;
  initialSection: Section;
  config: DeviceDisplayConfig;
  onSave: (config: DeviceDisplayConfig) => Promise<void>;
  onRenameSensor: (key: string, name: string) => Promise<void>;
  availableThreadCount: number;
  availableMounts: string[];
  availableInterfaces: string[];
  availableTemps: string[];
  availableGpuRows: string[];
  sensorDisplayNames: Record<string, string>;
}

const TABS: Array<{ id: Section; label: string }> = [
  { id: 'cpu',     label: 'CPU' },
  { id: 'ram',     label: 'RAM' },
  { id: 'gpu',     label: 'GPU' },
  { id: 'drives',  label: 'Drives' },
  { id: 'network', label: 'Network' },
  { id: 'temps',   label: 'Temperatures' },
];

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
      {children}
    </div>
  );
}

/** Inline toggle switch row — label left, switch right */
function ToggleRow({
  label, checked, onChange,
}: { label: React.ReactNode; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between py-1.5 gap-3">
      <span className="text-sm text-text-secondary min-w-0 flex-1">{label}</span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={[
          'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
          checked ? 'bg-accent' : 'bg-bg-tertiary border border-border',
        ].join(' ')}
      >
        <span className={[
          'inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-4' : 'translate-x-0.5',
        ].join(' ')} />
      </button>
    </div>
  );
}

// ── CPU Tab ───────────────────────────────────────────────────────────────────
function CpuTab({
  draft, onChange, availableThreadCount, availableTemps, sensorDisplayNames,
}: {
  draft: DeviceDisplayConfig;
  onChange: (d: DeviceDisplayConfig) => void;
  availableThreadCount: number;
  availableTemps: string[];
  sensorDisplayNames: Record<string, string>;
}) {
  const physicalCores = Math.ceil(availableThreadCount / 2);
  const hiddenChartMap: Array<{ id: string; label: string }> = [
    { id: 'load-avg', label: 'Load Average' },
    { id: 'temp',     label: 'Temperature' },
    { id: 'freq',     label: 'Frequency' },
  ];

  const toggleCore = (coreIdx: number, visible: boolean) => {
    const next = visible
      ? draft.cpu.hiddenCores.filter(c => c !== coreIdx)
      : [...draft.cpu.hiddenCores, coreIdx];
    onChange({ ...draft, cpu: { ...draft.cpu, hiddenCores: next } });
  };
  const toggleHiddenChart = (chartId: string, visible: boolean) => {
    const next = visible
      ? draft.cpu.hiddenCharts.filter(c => c !== chartId)
      : [...draft.cpu.hiddenCharts, chartId];
    onChange({ ...draft, cpu: { ...draft.cpu, hiddenCharts: next } });
  };

  return (
    <div className="space-y-5">
      <ToggleRow
        label="Group Core / Threads"
        checked={draft.cpu.groupCoreThreads}
        onChange={v => onChange({ ...draft, cpu: { ...draft.cpu, groupCoreThreads: v } })}
      />

      {physicalCores > 0 && (
        <div>
          <SectionHeader>Cores</SectionHeader>
          <div className="space-y-0.5">
            {Array.from({ length: physicalCores }, (_, i) => {
              const visible = !draft.cpu.hiddenCores.includes(i);
              const label = draft.cpu.groupCoreThreads
                ? `C${i}`
                : `C${i} (T${i * 2 + 1} / T${i * 2 + 2})`;
              return (
                <ToggleRow key={i} label={label} checked={visible} onChange={v => toggleCore(i, v)} />
              );
            })}
          </div>
        </div>
      )}

      <div>
        <SectionHeader>Temperature Sensor</SectionHeader>
        <select
          value={draft.cpu.tempSensor ?? ''}
          onChange={e => onChange({ ...draft, cpu: { ...draft.cpu, tempSensor: e.target.value || null } })}
          className="w-full rounded border border-border bg-bg-tertiary text-sm text-text-primary px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-accent"
        >
          <option value="">— Average —</option>
          {availableTemps.map(label => (
            <option key={label} value={label}>{sensorDisplayNames[`temp:${label}`] ?? prettifySensorLabel(label)}</option>
          ))}
        </select>
      </div>

      <div>
        <SectionHeader>Charts</SectionHeader>
        <div className="space-y-0.5">
          {hiddenChartMap.map(({ id, label }) => (
            <ToggleRow
              key={id}
              label={label}
              checked={!draft.cpu.hiddenCharts.includes(id)}
              onChange={v => toggleHiddenChart(id, v)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── RAM Tab ───────────────────────────────────────────────────────────────────
function RamTab({ draft, onChange }: { draft: DeviceDisplayConfig; onChange: (d: DeviceDisplayConfig) => void }) {
  const hiddenChartMap: Array<{ id: string; label: string }> = [
    { id: 'pct',     label: 'Usage %' },
    { id: 'used-mb', label: 'Used (MB)' },
    { id: 'swap',    label: 'Swap' },
  ];
  const toggleHiddenChart = (chartId: string, visible: boolean) => {
    const next = visible
      ? draft.ram.hiddenCharts.filter(c => c !== chartId)
      : [...draft.ram.hiddenCharts, chartId];
    onChange({ ...draft, ram: { ...draft.ram, hiddenCharts: next } });
  };
  return (
    <div className="space-y-5">
      <div>
        <SectionHeader>Rows</SectionHeader>
        <ToggleRow label="Show Used"  checked={!draft.ram.hideUsed}  onChange={v => onChange({ ...draft, ram: { ...draft.ram, hideUsed:  !v } })} />
        <ToggleRow label="Show Free"  checked={!draft.ram.hideFree}  onChange={v => onChange({ ...draft, ram: { ...draft.ram, hideFree:  !v } })} />
        <ToggleRow label="Show Swap"  checked={!draft.ram.hideSwap}  onChange={v => onChange({ ...draft, ram: { ...draft.ram, hideSwap:  !v } })} />
      </div>
      <div>
        <SectionHeader>Charts</SectionHeader>
        <div className="space-y-0.5">
          {hiddenChartMap.map(({ id, label }) => (
            <ToggleRow key={id} label={label} checked={!draft.ram.hiddenCharts.includes(id)} onChange={v => toggleHiddenChart(id, v)} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── GPU Tab ───────────────────────────────────────────────────────────────────
function GpuTab({
  draft, onChange, availableGpuRows,
}: {
  draft: DeviceDisplayConfig;
  onChange: (d: DeviceDisplayConfig) => void;
  availableGpuRows: string[];
}) {
  const hiddenChartMap: Array<{ id: string; label: string }> = [
    { id: 'util', label: 'Utilization' },
    { id: 'vram', label: 'VRAM' },
    { id: 'temp', label: 'Temperature' },
  ];
  const toggleRow = (rowLabel: string, visible: boolean) => {
    const next = visible
      ? draft.gpu.hiddenRows.filter(r => r !== rowLabel)
      : [...draft.gpu.hiddenRows, rowLabel];
    onChange({ ...draft, gpu: { ...draft.gpu, hiddenRows: next } });
  };
  const toggleHiddenChart = (chartId: string, visible: boolean) => {
    const next = visible
      ? draft.gpu.hiddenCharts.filter(c => c !== chartId)
      : [...draft.gpu.hiddenCharts, chartId];
    onChange({ ...draft, gpu: { ...draft.gpu, hiddenCharts: next } });
  };
  return (
    <div className="space-y-5">
      {availableGpuRows.length > 0 && (
        <div>
          <SectionHeader>Rows</SectionHeader>
          <div className="space-y-0.5">
            {availableGpuRows.map(rowLabel => (
              <ToggleRow key={rowLabel} label={rowLabel} checked={!draft.gpu.hiddenRows.includes(rowLabel)} onChange={v => toggleRow(rowLabel, v)} />
            ))}
          </div>
        </div>
      )}
      <div>
        <SectionHeader>Charts</SectionHeader>
        <div className="space-y-0.5">
          {hiddenChartMap.map(({ id, label }) => (
            <ToggleRow key={id} label={label} checked={!draft.gpu.hiddenCharts.includes(id)} onChange={v => toggleHiddenChart(id, v)} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Drives Tab ────────────────────────────────────────────────────────────────
function DrivesTab({
  draft, onChange, availableMounts,
}: {
  draft: DeviceDisplayConfig;
  onChange: (d: DeviceDisplayConfig) => void;
  availableMounts: string[];
}) {
  const [editingMount, setEditingMount] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const toggleMount = (mount: string, visible: boolean) => {
    const next = visible
      ? draft.drives.hiddenMounts.filter(m => m !== mount)
      : [...draft.drives.hiddenMounts, mount];
    onChange({ ...draft, drives: { ...draft.drives, hiddenMounts: next } });
  };
  const applyRename = (mount: string) => {
    const trimmed = renameValue.trim();
    const next = { ...draft.drives.renames };
    if (trimmed && trimmed !== mount) {
      next[mount] = trimmed;
    } else {
      delete next[mount];
    }
    onChange({ ...draft, drives: { ...draft.drives, renames: next } });
    setEditingMount(null);
  };

  return (
    <div className="space-y-5">
      <div>
        <SectionHeader>Mount Points</SectionHeader>
        <div className="space-y-1">
          {availableMounts.map(mount => {
            const visible = !draft.drives.hiddenMounts.includes(mount);
            const currentName = draft.drives.renames[mount] ?? mount;
            const isEditing = editingMount === mount;
            return (
              <div key={mount} className="flex items-center gap-2 py-1">
                {/* Visibility toggle */}
                <button
                  type="button"
                  onClick={() => toggleMount(mount, !visible)}
                  className={[
                    'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
                    visible ? 'bg-accent' : 'bg-bg-tertiary border border-border',
                  ].join(' ')}
                >
                  <span className={[
                    'inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform',
                    visible ? 'translate-x-4' : 'translate-x-0.5',
                  ].join(' ')} />
                </button>
                {isEditing ? (
                  <div className="flex items-center gap-1 flex-1 min-w-0">
                    <input
                      type="text"
                      value={renameValue}
                      autoFocus
                      onChange={e => setRenameValue(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') applyRename(mount);
                        if (e.key === 'Escape') setEditingMount(null);
                      }}
                      className="flex-1 min-w-0 rounded border border-border bg-bg-tertiary px-2 py-0.5 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                    <button onClick={() => applyRename(mount)} className="p-0.5 rounded text-status-up hover:bg-bg-hover shrink-0"><Check size={11} /></button>
                    <button onClick={() => setEditingMount(null)} className="p-0.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover shrink-0"><X size={12} /></button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 flex-1 min-w-0">
                    <span className="text-sm text-text-secondary truncate flex-1 min-w-0">{currentName}</span>
                    {currentName !== mount && (
                      <span className="text-[10px] text-text-muted truncate max-w-[80px]">({mount})</span>
                    )}
                    <button
                      onClick={() => { setEditingMount(mount); setRenameValue(currentName); }}
                      className="p-0.5 rounded text-text-muted hover:text-text-secondary hover:bg-bg-hover shrink-0"
                      title="Rename"
                    >
                      <Pencil size={11} />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <ToggleRow
        label="Combine Read + Write on one chart"
        checked={draft.drives.combineReadWrite}
        onChange={v => onChange({ ...draft, drives: { ...draft.drives, combineReadWrite: v } })}
      />
    </div>
  );
}

// ── Network Tab ───────────────────────────────────────────────────────────────
function NetworkTab({
  draft, onChange, availableInterfaces,
}: {
  draft: DeviceDisplayConfig;
  onChange: (d: DeviceDisplayConfig) => void;
  availableInterfaces: string[];
}) {
  const [editingIface, setEditingIface] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const toggleIface = (name: string, visible: boolean) => {
    const next = visible
      ? draft.network.hiddenInterfaces.filter(i => i !== name)
      : [...draft.network.hiddenInterfaces, name];
    onChange({ ...draft, network: { ...draft.network, hiddenInterfaces: next } });
  };
  const applyRename = (name: string) => {
    const trimmed = renameValue.trim();
    const next = { ...(draft.network.renames ?? {}) };
    if (trimmed && trimmed !== name) {
      next[name] = trimmed;
    } else {
      delete next[name];
    }
    onChange({ ...draft, network: { ...draft.network, renames: next } });
    setEditingIface(null);
  };

  return (
    <div className="space-y-5">
      <div>
        <SectionHeader>Interfaces</SectionHeader>
        <div className="space-y-1">
          {availableInterfaces.map(name => {
            const visible = !draft.network.hiddenInterfaces.includes(name);
            const renames = draft.network.renames ?? {};
            const currentName = renames[name] ?? name;
            const isEditing = editingIface === name;
            return (
              <div key={name} className="flex items-center gap-2 py-1">
                {/* Visibility toggle */}
                <button
                  type="button"
                  onClick={() => toggleIface(name, !visible)}
                  className={[
                    'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
                    visible ? 'bg-accent' : 'bg-bg-tertiary border border-border',
                  ].join(' ')}
                >
                  <span className={[
                    'inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform',
                    visible ? 'translate-x-4' : 'translate-x-0.5',
                  ].join(' ')} />
                </button>
                {isEditing ? (
                  <div className="flex items-center gap-1 flex-1 min-w-0">
                    <input
                      type="text"
                      value={renameValue}
                      autoFocus
                      onChange={e => setRenameValue(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') applyRename(name);
                        if (e.key === 'Escape') setEditingIface(null);
                      }}
                      className="flex-1 min-w-0 rounded border border-border bg-bg-tertiary px-2 py-0.5 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                    <button onClick={() => applyRename(name)} className="p-0.5 rounded text-status-up hover:bg-bg-hover shrink-0"><Check size={11} /></button>
                    <button onClick={() => setEditingIface(null)} className="p-0.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover shrink-0"><X size={12} /></button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 flex-1 min-w-0">
                    <span className="text-sm text-text-secondary truncate flex-1 min-w-0">{currentName}</span>
                    {currentName !== name && (
                      <span className="text-[10px] text-text-muted truncate max-w-[80px]">({name})</span>
                    )}
                    <button
                      onClick={() => { setEditingIface(name); setRenameValue(currentName); }}
                      className="p-0.5 rounded text-text-muted hover:text-text-secondary hover:bg-bg-hover shrink-0"
                      title="Rename"
                    >
                      <Pencil size={11} />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <ToggleRow
        label="Combine IN + OUT on one chart"
        checked={draft.network.combineInOut}
        onChange={v => onChange({ ...draft, network: { ...draft.network, combineInOut: v } })}
      />
    </div>
  );
}

// ── Temps Tab ─────────────────────────────────────────────────────────────────
function TempsTab({
  draft, onChange, availableTemps, sensorDisplayNames, onRenameSensor,
}: {
  draft: DeviceDisplayConfig;
  onChange: (d: DeviceDisplayConfig) => void;
  availableTemps: string[];
  sensorDisplayNames: Record<string, string>;
  onRenameSensor: (key: string, name: string) => Promise<void>;
}) {
  const [editingSensor, setEditingSensor] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [saving, setSaving] = useState(false);

  const toggleTemp = (label: string, visible: boolean) => {
    const next = visible
      ? draft.temps.hiddenLabels.filter(l => l !== label)
      : [...draft.temps.hiddenLabels, label];
    onChange({ ...draft, temps: { ...draft.temps, hiddenLabels: next } });
  };

  const applySensorRename = async (label: string) => {
    const key = `temp:${label}`;
    setSaving(true);
    try {
      await onRenameSensor(key, renameValue.trim());
      setEditingSensor(null);
    } catch { /* ignore */ }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-5">
      <div>
        <SectionHeader>Sensors</SectionHeader>
        <div className="space-y-1">
          {availableTemps.map(label => {
            const key = `temp:${label}`;
            const displayName = sensorDisplayNames[key] ?? prettifySensorLabel(label);
            const visible = !draft.temps.hiddenLabels.includes(label);
            const isEditing = editingSensor === key;
            return (
              <div key={label} className="flex items-center gap-2 py-1">
                {/* Visibility toggle */}
                <button
                  type="button"
                  onClick={() => toggleTemp(label, !visible)}
                  className={[
                    'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
                    visible ? 'bg-accent' : 'bg-bg-tertiary border border-border',
                  ].join(' ')}
                >
                  <span className={[
                    'inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform',
                    visible ? 'translate-x-4' : 'translate-x-0.5',
                  ].join(' ')} />
                </button>
                {isEditing ? (
                  <div className="flex items-center gap-1 flex-1 min-w-0">
                    <input
                      type="text"
                      value={renameValue}
                      autoFocus
                      onChange={e => setRenameValue(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') void applySensorRename(label);
                        if (e.key === 'Escape') setEditingSensor(null);
                      }}
                      className="flex-1 min-w-0 rounded border border-border bg-bg-tertiary px-2 py-0.5 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                    <button onClick={() => void applySensorRename(label)} disabled={saving} className="p-0.5 rounded text-status-up hover:bg-bg-hover shrink-0 disabled:opacity-50"><Check size={11} /></button>
                    <button onClick={() => setEditingSensor(null)} className="p-0.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover shrink-0"><X size={12} /></button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 flex-1 min-w-0">
                    <span className="text-sm text-text-secondary truncate flex-1 min-w-0">{displayName}</span>
                    {displayName !== label && (
                      <span className="text-[10px] text-text-muted truncate max-w-[80px]">({label})</span>
                    )}
                    <button
                      onClick={() => { setEditingSensor(key); setRenameValue(displayName); }}
                      className="p-0.5 rounded text-text-muted hover:text-text-secondary hover:bg-bg-hover shrink-0"
                      title="Rename sensor"
                    >
                      <Pencil size={11} />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────────
export function DeviceDisplayConfigModal({
  open, onClose, initialSection, config, onSave, onRenameSensor,
  availableThreadCount, availableMounts, availableInterfaces,
  availableTemps, availableGpuRows, sensorDisplayNames,
}: Props) {
  const [activeSection, setActiveSection] = useState<Section>(initialSection);
  const [draft, setDraft] = useState<DeviceDisplayConfig>(config);
  const [saving, setSaving] = useState(false);

  // Reset draft + section whenever the modal opens
  React.useEffect(() => {
    if (open) {
      setDraft(config);
      setActiveSection(initialSection);
    }
  }, [open, initialSection]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(draft);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl rounded-xl border border-border bg-bg-primary shadow-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <h2 className="text-base font-semibold text-text-primary flex items-center gap-2">
            <Settings2 size={16} /> Display Configuration
          </h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary text-xl leading-none">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden min-h-0">
          {/* Left sidebar */}
          <div className="w-36 shrink-0 border-r border-border py-3 flex flex-col gap-0.5 px-2 overflow-y-auto">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveSection(tab.id)}
                className={[
                  'w-full text-left px-3 py-2 rounded-lg text-sm transition-colors',
                  activeSection === tab.id
                    ? 'bg-bg-hover text-text-primary'
                    : 'text-text-muted hover:text-text-secondary hover:bg-bg-hover/50',
                ].join(' ')}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Right content */}
          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {activeSection === 'cpu' && (
              <CpuTab
                draft={draft}
                onChange={setDraft}
                availableThreadCount={availableThreadCount}
                availableTemps={availableTemps}
                sensorDisplayNames={sensorDisplayNames}
              />
            )}
            {activeSection === 'ram' && (
              <RamTab draft={draft} onChange={setDraft} />
            )}
            {activeSection === 'gpu' && (
              <GpuTab draft={draft} onChange={setDraft} availableGpuRows={availableGpuRows} />
            )}
            {activeSection === 'drives' && (
              <DrivesTab draft={draft} onChange={setDraft} availableMounts={availableMounts} />
            )}
            {activeSection === 'network' && (
              <NetworkTab draft={draft} onChange={setDraft} availableInterfaces={availableInterfaces} />
            )}
            {activeSection === 'temps' && (
              <TempsTab
                draft={draft}
                onChange={setDraft}
                availableTemps={availableTemps}
                sensorDisplayNames={sensorDisplayNames}
                onRenameSensor={onRenameSensor}
              />
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-border shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-border text-sm text-text-secondary hover:bg-bg-hover transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/90 transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Apply'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default DeviceDisplayConfigModal;
