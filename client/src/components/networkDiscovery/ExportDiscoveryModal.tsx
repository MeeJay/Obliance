import { useState } from 'react';
import { X, Download, FileJson, FileSpreadsheet } from 'lucide-react';
import type { DiscoveredDevice } from '@obliance/shared';
import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';
import { StyledCheckbox } from '@/components/devices/StyledCheckbox';

interface Props {
  rows: DiscoveredDevice[];
  onClose: () => void;
}

// The set of exportable fields mirrors the DB columns in migration 042
// plus a few derived values (vendor, subnet). Order here drives both the
// checkbox list and the CSV column order.
type FieldKey =
  | 'ip' | 'hostname' | 'mac' | 'ouiVendor' | 'deviceType' | 'osGuess'
  | 'ports' | 'subnet' | 'isManaged' | 'firstSeen' | 'lastSeen';

const ALL_FIELDS: FieldKey[] = [
  'ip', 'hostname', 'mac', 'ouiVendor', 'deviceType', 'osGuess',
  'ports', 'subnet', 'isManaged', 'firstSeen', 'lastSeen',
];

const DEFAULT_FIELDS: FieldKey[] = [
  'ip', 'hostname', 'mac', 'ouiVendor', 'deviceType', 'osGuess',
  'ports', 'isManaged', 'lastSeen',
];

type Format = 'csv' | 'json';

export function ExportDiscoveryModal({ rows, onClose }: Props) {
  const { t } = useTranslation();
  const [fields, setFields] = useState<Set<FieldKey>>(new Set(DEFAULT_FIELDS));
  const [format, setFormat] = useState<Format>('csv');

  const toggle = (f: FieldKey) => {
    setFields((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f); else next.add(f);
      return next;
    });
  };

  const labelFor = (f: FieldKey): string => {
    // Reuse the existing translation keys from the discovery page so we
    // don't duplicate the list.
    switch (f) {
      case 'ip':         return 'IP';
      case 'hostname':   return t('discovery.hostname') || 'Hostname';
      case 'mac':        return 'MAC';
      case 'ouiVendor':  return t('discovery.vendor') || 'Vendor';
      case 'deviceType': return t('discovery.type') || 'Type';
      case 'osGuess':    return 'OS';
      case 'ports':      return t('discovery.ports') || 'Ports';
      case 'subnet':     return t('discovery.export.subnet') || 'Subnet';
      case 'isManaged':  return t('discovery.status') || 'Status';
      case 'firstSeen':  return t('discovery.firstSeen') || 'First Seen';
      case 'lastSeen':   return t('discovery.lastSeen') || 'Last Seen';
    }
  };

  const valueFor = (row: DiscoveredDevice, f: FieldKey): string => {
    switch (f) {
      case 'ip':         return row.ip;
      case 'hostname':   return row.hostname ?? '';
      case 'mac':        return row.mac ?? '';
      case 'ouiVendor':  return row.ouiVendor ?? '';
      case 'deviceType': return row.deviceType;
      case 'osGuess':    return row.osGuess ?? '';
      case 'ports':      return (row.ports ?? []).join(' ');
      case 'subnet':     return row.subnet ?? '';
      case 'isManaged':  return row.isManaged ? 'managed' : 'unmanaged';
      case 'firstSeen':  return row.firstSeen;
      case 'lastSeen':   return row.lastSeen;
    }
  };

  const orderedFields = ALL_FIELDS.filter((f) => fields.has(f));

  const build = (): { content: string; mime: string; filename: string } => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    if (format === 'json') {
      const data = rows.map((r) =>
        Object.fromEntries(orderedFields.map((f) => [f, valueForJson(r, f)])),
      );
      return {
        content: JSON.stringify(data, null, 2),
        mime: 'application/json',
        filename: `obliance-discovery-${stamp}.json`,
      };
    }
    // CSV — RFC 4180-ish: double-quote every cell, double any embedded quote.
    const header = orderedFields.map(labelFor).map(csvCell).join(',');
    const body = rows.map((r) =>
      orderedFields.map((f) => csvCell(valueFor(r, f))).join(','),
    ).join('\r\n');
    return {
      content: header + '\r\n' + body + '\r\n',
      mime: 'text/csv;charset=utf-8',
      filename: `obliance-discovery-${stamp}.csv`,
    };
  };

  const handleDownload = () => {
    if (orderedFields.length === 0 || rows.length === 0) return;
    const { content, mime, filename } = build();
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="bg-bg-primary border border-border rounded-xl w-full max-w-lg max-h-[85vh] flex flex-col shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border flex-shrink-0">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">
              {t('discovery.export.title') || 'Export discovered devices'}
            </h3>
            <p className="text-xs text-text-muted mt-0.5">
              {t('discovery.export.subtitle', { count: rows.length }) ||
                `${rows.length} row(s) ready to export`}
            </p>
          </div>
          <button onClick={onClose} className="p-1 text-text-muted hover:text-text-primary rounded">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Format tabs */}
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">
              {t('discovery.export.format') || 'Format'}
            </label>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setFormat('csv')}
                className={clsx(
                  'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors',
                  format === 'csv'
                    ? 'bg-accent text-white border-accent'
                    : 'bg-bg-secondary text-text-muted border-border hover:text-text-primary',
                )}
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                CSV
              </button>
              <button
                onClick={() => setFormat('json')}
                className={clsx(
                  'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors',
                  format === 'json'
                    ? 'bg-accent text-white border-accent'
                    : 'bg-bg-secondary text-text-muted border-border hover:text-text-primary',
                )}
              >
                <FileJson className="w-3.5 h-3.5" />
                JSON
              </button>
            </div>
          </div>

          {/* Field picker */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-medium text-text-muted">
                {t('discovery.export.fields') || 'Columns'}
              </label>
              <div className="flex items-center gap-2 text-[11px]">
                <button
                  onClick={() => setFields(new Set(ALL_FIELDS))}
                  className="text-accent hover:underline"
                >
                  {t('common.selectAll') || 'Select all'}
                </button>
                <span className="text-text-muted/40">·</span>
                <button
                  onClick={() => setFields(new Set())}
                  className="text-accent hover:underline"
                >
                  {t('common.none') || 'None'}
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {ALL_FIELDS.map((f) => (
                <div
                  key={f}
                  onClick={() => toggle(f)}
                  className="flex items-center gap-2 px-2 py-1 rounded hover:bg-bg-secondary cursor-pointer text-xs text-text-primary"
                >
                  <StyledCheckbox
                    checked={fields.has(f)}
                    onChange={() => { /* handled by wrapper */ }}
                  />
                  <span>{labelFor(f)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-t border-border flex-shrink-0">
          <span className="text-xs text-text-muted">
            {t('discovery.export.countHint', { rows: rows.length, cols: orderedFields.length }) ||
              `${rows.length} row(s) · ${orderedFields.length} column(s)`}
          </span>
          <button
            onClick={handleDownload}
            disabled={rows.length === 0 || orderedFields.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-accent text-white rounded-lg hover:bg-accent/80 disabled:opacity-50 transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            {t('common.download') || 'Download'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function csvCell(raw: string): string {
  const s = raw == null ? '' : String(raw);
  // Always quote — simpler and Excel-safe with commas, newlines, quotes.
  return '"' + s.replace(/"/g, '""') + '"';
}

function valueForJson(row: DiscoveredDevice, f: FieldKey): unknown {
  switch (f) {
    case 'ip':         return row.ip;
    case 'hostname':   return row.hostname;
    case 'mac':        return row.mac;
    case 'ouiVendor':  return row.ouiVendor;
    case 'deviceType': return row.deviceType;
    case 'osGuess':    return row.osGuess;
    case 'ports':      return row.ports ?? [];
    case 'subnet':     return row.subnet;
    case 'isManaged':  return row.isManaged;
    case 'firstSeen':  return row.firstSeen;
    case 'lastSeen':   return row.lastSeen;
  }
}
