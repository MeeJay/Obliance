import { useState } from 'react';
import { Download, FileJson, FileSpreadsheet } from 'lucide-react';
import type { DiscoveredDevice } from '@obliance/shared';
import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { StyledCheckbox } from '@/components/devices/StyledCheckbox';
import { Modal } from '@/components/common/Modal';
import { saveText } from '@/utils/download';

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
 const [saving, setSaving] = useState(false);

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
 case 'ip': return 'IP';
 case 'hostname': return t('discovery.hostname') || 'Hostname';
 case 'mac': return 'MAC';
 case 'ouiVendor': return t('discovery.vendor') || 'Vendor';
 case 'deviceType': return t('discovery.type') || 'Type';
 case 'osGuess': return 'OS';
 case 'ports': return t('discovery.ports') || 'Ports';
 case 'subnet': return t('discovery.export.subnet') || 'Subnet';
 case 'isManaged': return t('discovery.status') || 'Status';
 case 'firstSeen': return t('discovery.firstSeen') || 'First Seen';
 case 'lastSeen': return t('discovery.lastSeen') || 'Last Seen';
 }
 };

 const valueFor = (row: DiscoveredDevice, f: FieldKey): string => {
 switch (f) {
 case 'ip': return row.ip;
 case 'hostname': return row.hostname ?? '';
 case 'mac': return row.mac ?? '';
 case 'ouiVendor': return row.ouiVendor ?? '';
 case 'deviceType': return row.deviceType;
 case 'osGuess': return row.osGuess ?? '';
 case 'ports': return (row.ports ?? []).join(' ');
 case 'subnet': return row.subnet ?? '';
 case 'isManaged': return row.isManaged ? 'managed' : 'unmanaged';
 case 'firstSeen': return row.firstSeen;
 case 'lastSeen': return row.lastSeen;
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

 // Shared helper: native saveFile in the Android shell (a blob: URL cannot
 // be handed to DownloadManager), deferred-revoke anchor in a browser. The
 // modal only closes once the file was actually handed over.
 const handleDownload = async () => {
 if (orderedFields.length === 0 || rows.length === 0 || saving) return;
 const { content, mime, filename } = build();
 setSaving(true);
 const ok = await saveText(content, filename, mime);
 setSaving(false);
 if (ok) onClose();
 else toast.error(t('common.error'));
 };

 return (
 <Modal
 open
 onClose={onClose}
 size="md"
 className="bg-bg-primary"
 title={<>
 <span className="block truncate">{t('discovery.export.title') || 'Export discovered devices'}</span>
 <span className="block truncate text-xs font-normal text-text-muted mt-0.5">
 {t('discovery.export.subtitle', { count: rows.length }) ||
 `${rows.length} row(s) ready to export`}
 </span>
 </>}
 bodyClassName="p-5 space-y-4"
 footerClassName="px-5"
 footer={<>
 <span className="mr-auto text-xs text-text-muted">
 {t('discovery.export.countHint', { rows: rows.length, cols: orderedFields.length }) ||
 `${rows.length} row(s) · ${orderedFields.length} column(s)`}
 </span>
 <button
 onClick={handleDownload}
 disabled={rows.length === 0 || orderedFields.length === 0 || saving}
 className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-accent text-white rounded-lg hover:bg-accent/80 disabled:opacity-50 transition-colors coarse:min-h-10 coarse:px-4"
 >
 <Download className="w-3.5 h-3.5" />
 {t('common.download') || 'Download'}
 </button>
 </>}
 >
 {/* Format tabs */}
 <div>
 <label className="block text-xs font-medium text-text-muted mb-1.5">
 {t('discovery.export.format') || 'Format'}
 </label>
 <div className="flex items-center gap-2">
 <button
 onClick={() => setFormat('csv')}
 aria-pressed={format === 'csv'}
 className={clsx(
 'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors coarse:min-h-10 coarse:px-4',
 format === 'csv'
 ? 'bg-accent text-white border-accent'
 : 'bg-bg-secondary text-text-muted border-transparent hover:text-text-primary',
 )}
 >
 <FileSpreadsheet className="w-3.5 h-3.5" />
 CSV
 </button>
 <button
 onClick={() => setFormat('json')}
 aria-pressed={format === 'json'}
 className={clsx(
 'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors coarse:min-h-10 coarse:px-4',
 format === 'json'
 ? 'bg-accent text-white border-accent'
 : 'bg-bg-secondary text-text-muted border-transparent hover:text-text-primary',
 )}
 >
 <FileJson className="w-3.5 h-3.5" />
 JSON
 </button>
 </div>
 </div>

 {/* Field picker */}
 <div>
 <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
 <label className="block text-xs font-medium text-text-muted">
 {t('discovery.export.fields') || 'Columns'}
 </label>
 <div className="flex items-center gap-2 text-[11px] coarse:text-xs">
 <button
 onClick={() => setFields(new Set(ALL_FIELDS))}
 className="text-accent hover:underline coarse:min-h-10 coarse:px-2"
 >
 {t('common.selectAll') || 'Select all'}
 </button>
 <span className="text-text-muted/40">·</span>
 <button
 onClick={() => setFields(new Set())}
 className="text-accent hover:underline coarse:min-h-10 coarse:px-2"
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
 className="flex items-center gap-2 px-2 py-1 rounded hover:bg-bg-secondary cursor-pointer text-xs text-text-primary coarse:min-h-10 coarse:text-sm"
 >
 <StyledCheckbox
 checked={fields.has(f)}
 onChange={() => { /* handled by wrapper */ }}
 />
 <span className="min-w-0 break-words">{labelFor(f)}</span>
 </div>
 ))}
 </div>
 </div>
 </Modal>
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
 case 'ip': return row.ip;
 case 'hostname': return row.hostname;
 case 'mac': return row.mac;
 case 'ouiVendor': return row.ouiVendor;
 case 'deviceType': return row.deviceType;
 case 'osGuess': return row.osGuess;
 case 'ports': return row.ports ?? [];
 case 'subnet': return row.subnet;
 case 'isManaged': return row.isManaged;
 case 'firstSeen': return row.firstSeen;
 case 'lastSeen': return row.lastSeen;
 }
}
