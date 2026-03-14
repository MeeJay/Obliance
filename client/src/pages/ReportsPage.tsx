import { useEffect, useState, useCallback } from 'react';
import { Plus, FileText, Download, RefreshCw, Edit, Trash2, Play, Clock, CheckCircle, AlertCircle, Loader, ChevronDown, ChevronUp } from 'lucide-react';
import { reportApi } from '@/api/report.api';
import type { Report, ReportOutput, ReportType, ReportFormat, ReportSection } from '@obliance/shared';
import toast from 'react-hot-toast';
import { clsx } from 'clsx';

const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  fleet: 'Fleet Overview',
  compliance: 'Compliance',
  scripts: 'Script Executions',
  updates: 'Updates',
  software: 'Software Inventory',
  custom: 'Custom',
};

const REPORT_FORMAT_LABELS: Record<ReportFormat, string> = {
  json: 'JSON',
  csv: 'CSV',
  pdf: 'PDF',
  excel: 'Excel',
  html: 'HTML',
};

const REPORT_SECTION_LABELS: Record<ReportSection, string> = {
  hardware: 'Hardware',
  software: 'Software',
  updates: 'Updates',
  compliance: 'Compliance',
  scripts_history: 'Script History',
  network: 'Network',
};

const REPORT_TYPES: ReportType[] = ['fleet', 'compliance', 'scripts', 'updates', 'software', 'custom'];
const REPORT_FORMATS: ReportFormat[] = ['pdf', 'csv', 'excel', 'html', 'json'];
const REPORT_SECTIONS: ReportSection[] = ['hardware', 'software', 'updates', 'compliance', 'scripts_history', 'network'];

interface ReportFormData {
  name: string;
  description: string;
  type: ReportType;
  format: ReportFormat;
  scopeType: 'tenant' | 'group' | 'device';
  scopeId: number | null;
  sections: ReportSection[];
  scheduleCron: string;
  timezone: string;
  isEnabled: boolean;
}

const defaultForm: ReportFormData = {
  name: '',
  description: '',
  type: 'fleet',
  format: 'pdf',
  scopeType: 'tenant',
  scopeId: null,
  sections: ['hardware', 'software', 'updates'],
  scheduleCron: '',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  isEnabled: true,
};

function StatusBadge({ status }: { status: ReportOutput['status'] }) {
  const config = {
    generating: { label: 'Generating', color: 'text-blue-400 bg-blue-400/10 border-blue-400/30', icon: Loader, pulse: true },
    ready: { label: 'Ready', color: 'text-green-400 bg-green-400/10 border-green-400/30', icon: CheckCircle, pulse: false },
    error: { label: 'Error', color: 'text-red-400 bg-red-400/10 border-red-400/30', icon: AlertCircle, pulse: false },
  }[status];

  const Icon = config.icon;
  return (
    <span className={clsx('text-xs px-2 py-0.5 rounded-full border font-medium flex items-center gap-1 w-fit', config.color)}>
      <Icon className={clsx('w-3 h-3', config.pulse && 'animate-spin')} />
      {config.label}
    </span>
  );
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(val: string | null): string {
  if (!val) return '—';
  return new Date(val).toLocaleString();
}

export function ReportsPage() {
  const [reports, setReports] = useState<Report[]>([]);
  const [outputsByReport, setOutputsByReport] = useState<Record<number, ReportOutput[]>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingReport, setEditingReport] = useState<Report | null>(null);
  const [form, setForm] = useState<ReportFormData>(defaultForm);
  const [isSaving, setIsSaving] = useState(false);
  const [generatingId, setGeneratingId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [filterType, setFilterType] = useState<string>('');

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const reportList = await reportApi.list();
      setReports(reportList);
    } catch {
      toast.error('Failed to load reports');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const loadOutputs = async (reportId: number) => {
    try {
      const outputs = await reportApi.listOutputs(reportId);
      setOutputsByReport(prev => ({ ...prev, [reportId]: outputs }));
    } catch {
      // ignore
    }
  };

  const handleToggleExpand = async (reportId: number) => {
    if (expandedId === reportId) {
      setExpandedId(null);
    } else {
      setExpandedId(reportId);
      await loadOutputs(reportId);
    }
  };

  const handleOpenCreate = () => {
    setForm(defaultForm);
    setEditingReport(null);
    setShowForm(true);
  };

  const handleOpenEdit = (report: Report) => {
    setForm({
      name: report.name,
      description: report.description ?? '',
      type: report.type,
      format: report.format,
      scopeType: report.scopeType,
      scopeId: report.scopeId,
      sections: report.sections,
      scheduleCron: report.scheduleCron ?? '',
      timezone: report.timezone,
      isEnabled: report.isEnabled,
    });
    setEditingReport(report);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Report name is required'); return; }
    setIsSaving(true);
    try {
      const payload = {
        name: form.name,
        description: form.description || null,
        type: form.type,
        format: form.format,
        scopeType: form.scopeType,
        scopeId: form.scopeId,
        sections: form.sections,
        scheduleCron: form.scheduleCron || null,
        timezone: form.timezone,
        isEnabled: form.isEnabled,
        filters: {},
        tenantId: 0,
      };
      if (editingReport) {
        await reportApi.update(editingReport.id, payload);
        toast.success('Report updated');
      } else {
        await reportApi.create(payload as any);
        toast.success('Report created');
      }
      setShowForm(false);
      setEditingReport(null);
      await load();
    } catch {
      toast.error('Failed to save report');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this report?')) return;
    try {
      await reportApi.delete(id);
      toast.success('Report deleted');
      if (expandedId === id) setExpandedId(null);
      await load();
    } catch {
      toast.error('Failed to delete report');
    }
  };

  const handleGenerate = async (report: Report) => {
    setGeneratingId(report.id);
    try {
      await reportApi.generate(report.id);
      toast.success('Report generation started');
      await loadOutputs(report.id);
      if (expandedId !== report.id) {
        setExpandedId(report.id);
      }
    } catch {
      toast.error('Failed to generate report');
    } finally {
      setGeneratingId(null);
    }
  };

  const handleDownload = (outputId: number) => {
    const url = reportApi.getDownloadUrl(outputId);
    window.open(url, '_blank');
  };

  const toggleSection = (section: ReportSection) => {
    setForm(prev => ({
      ...prev,
      sections: prev.sections.includes(section)
        ? prev.sections.filter(s => s !== section)
        : [...prev.sections, section],
    }));
  };

  const filteredReports = filterType ? reports.filter(r => r.type === filterType) : reports;

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Reports</h1>
          <p className="text-sm text-text-muted mt-0.5">Generate and download fleet reports</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="p-2 text-text-muted hover:text-text-primary hover:bg-bg-secondary rounded-lg transition-colors">
            <RefreshCw className={clsx('w-4 h-4', isLoading && 'animate-spin')} />
          </button>
          <button
            onClick={handleOpenCreate}
            className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg hover:bg-accent/80 text-sm transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Report
          </button>
        </div>
      </div>

      {/* Report form */}
      {showForm && (
        <div className="bg-bg-secondary border border-border rounded-xl p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-text-primary">{editingReport ? 'Edit Report' : 'New Report'}</h2>
            <div className="flex gap-2">
              <button
                onClick={() => { setShowForm(false); setEditingReport(null); }}
                className="px-4 py-2 text-sm text-text-muted hover:text-text-primary border border-border rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="px-4 py-2 text-sm bg-accent text-white rounded-lg hover:bg-accent/80 disabled:opacity-50 transition-colors"
              >
                {isSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-text-muted uppercase">Name *</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-text-muted uppercase">Type</label>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value as ReportType })}
                className="w-full px-3 py-2 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
              >
                {REPORT_TYPES.map(t => <option key={t} value={t}>{REPORT_TYPE_LABELS[t]}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-text-muted uppercase">Format</label>
              <div className="flex gap-2 flex-wrap">
                {REPORT_FORMATS.map(fmt => (
                  <button
                    key={fmt}
                    onClick={() => setForm({ ...form, format: fmt })}
                    className={clsx(
                      'px-3 py-1.5 text-sm rounded-lg border transition-colors',
                      form.format === fmt ? 'bg-accent/10 border-accent text-accent' : 'border-border text-text-muted hover:border-accent/50 hover:text-text-primary',
                    )}
                  >
                    {REPORT_FORMAT_LABELS[fmt]}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-text-muted uppercase">Scope</label>
              <select
                value={form.scopeType}
                onChange={(e) => setForm({ ...form, scopeType: e.target.value as 'tenant' | 'group' | 'device', scopeId: null })}
                className="w-full px-3 py-2 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
              >
                <option value="tenant">Entire tenant</option>
                <option value="group">Device group</option>
                <option value="device">Specific device</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-text-muted uppercase">Schedule (cron)</label>
              <input
                value={form.scheduleCron}
                onChange={(e) => setForm({ ...form, scheduleCron: e.target.value })}
                placeholder="e.g. 0 8 * * 1 (optional)"
                className="w-full px-3 py-2 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent font-mono"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-text-muted uppercase">Timezone</label>
              <input
                value={form.timezone}
                onChange={(e) => setForm({ ...form, timezone: e.target.value })}
                className="w-full px-3 py-2 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
              />
            </div>
            <div className="space-y-1 md:col-span-2">
              <label className="text-xs font-medium text-text-muted uppercase">Description</label>
              <input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="w-full px-3 py-2 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-text-muted uppercase">Sections</label>
            <div className="flex flex-wrap gap-2">
              {REPORT_SECTIONS.map(section => (
                <button
                  key={section}
                  onClick={() => toggleSection(section)}
                  className={clsx(
                    'px-3 py-1.5 text-xs rounded-lg border transition-colors',
                    form.sections.includes(section) ? 'bg-accent/10 border-accent text-accent' : 'border-border text-text-muted hover:border-accent/50 hover:text-text-primary',
                  )}
                >
                  {REPORT_SECTION_LABELS[section]}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-4 pt-2 border-t border-border">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.isEnabled}
                onChange={(e) => setForm({ ...form, isEnabled: e.target.checked })}
                className="rounded"
              />
              <span className="text-sm text-text-primary">Enabled (for scheduled runs)</span>
            </label>
          </div>
        </div>
      )}

      {/* Filter */}
      <div className="flex items-center gap-3">
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="px-3 py-1.5 text-sm bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent"
        >
          <option value="">All types</option>
          {REPORT_TYPES.map(t => <option key={t} value={t}>{REPORT_TYPE_LABELS[t]}</option>)}
        </select>
        <span className="text-sm text-text-muted">{filteredReports.length} report{filteredReports.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Reports list */}
      {isLoading ? (
        <div className="flex items-center justify-center h-48">
          <RefreshCw className="w-5 h-5 animate-spin text-text-muted" />
        </div>
      ) : filteredReports.length === 0 ? (
        <div className="p-12 text-center text-text-muted bg-bg-secondary border border-border rounded-xl">
          <FileText className="w-10 h-10 mx-auto mb-3 opacity-50" />
          <p className="font-medium text-text-primary mb-1">No reports yet</p>
          <p className="text-sm">Create reports to generate fleet insights and export data.</p>
          <button
            onClick={handleOpenCreate}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg hover:bg-accent/80 text-sm transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Report
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredReports.map((report) => {
            const expanded = expandedId === report.id;
            const outputs = outputsByReport[report.id] ?? [];
            return (
              <div key={report.id} className="bg-bg-secondary border border-border rounded-xl overflow-hidden">
                <div className="flex items-center gap-4 px-4 py-3">
                  <div className="p-2 rounded-lg bg-accent/10">
                    <FileText className="w-4 h-4 text-accent" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-text-primary">{report.name}</span>
                      <span className="text-xs px-2 py-0.5 bg-bg-tertiary border border-border rounded-full text-text-muted">
                        {REPORT_TYPE_LABELS[report.type]}
                      </span>
                      <span className="text-xs px-2 py-0.5 bg-bg-tertiary border border-border rounded-full text-text-muted">
                        {REPORT_FORMAT_LABELS[report.format]}
                      </span>
                      {report.scheduleCron && (
                        <span className="text-xs px-2 py-0.5 bg-bg-tertiary border border-border rounded-full text-text-muted flex items-center gap-1">
                          <Clock className="w-2.5 h-2.5" />
                          {report.scheduleCron}
                        </span>
                      )}
                    </div>
                    {report.description && <p className="text-xs text-text-muted mt-0.5 truncate">{report.description}</p>}
                    <p className="text-xs text-text-muted mt-0.5">
                      Last generated: {formatDate(report.lastGeneratedAt)} · Scope: {report.scopeType}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleGenerate(report)}
                      disabled={generatingId === report.id}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-accent/10 text-accent border border-accent/30 rounded-lg hover:bg-accent/20 disabled:opacity-50 transition-colors"
                      title="Generate report"
                    >
                      {generatingId === report.id ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Play className="w-3.5 h-3.5" />
                      )}
                      Generate
                    </button>
                    <button
                      onClick={() => handleToggleExpand(report.id)}
                      className="p-1.5 text-text-muted hover:text-text-primary hover:bg-bg-tertiary rounded transition-colors"
                      title="View outputs"
                    >
                      {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={() => handleOpenEdit(report)}
                      className="p-1.5 text-text-muted hover:text-text-primary hover:bg-bg-tertiary rounded transition-colors"
                    >
                      <Edit className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(report.id)}
                      className="p-1.5 text-text-muted hover:text-red-400 hover:bg-red-400/10 rounded transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {expanded && (
                  <div className="border-t border-border bg-bg-tertiary/50">
                    {outputs.length === 0 ? (
                      <div className="px-4 py-6 text-center text-text-muted">
                        <p className="text-sm">No outputs yet. Click Generate to create the first output.</p>
                      </div>
                    ) : (
                      <div className="divide-y divide-border">
                        <div className="grid grid-cols-4 gap-4 px-4 py-2 text-xs font-medium text-text-muted uppercase">
                          <span>Generated</span>
                          <span>Status</span>
                          <span>Size</span>
                          <span className="text-right">Actions</span>
                        </div>
                        {outputs.map((output) => (
                          <div key={output.id} className="grid grid-cols-4 gap-4 px-4 py-3 items-center">
                            <span className="text-xs text-text-primary">{formatDate(output.generatedAt)}</span>
                            <StatusBadge status={output.status} />
                            <span className="text-xs text-text-muted">
                              {formatBytes(output.fileSizeBytes)}
                              {output.rowCount !== null && <span className="ml-1">· {output.rowCount} rows</span>}
                            </span>
                            <div className="flex justify-end gap-2">
                              {output.status === 'ready' && output.filePath && (
                                <button
                                  onClick={() => handleDownload(output.id)}
                                  className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-green-500/20 text-green-400 border border-green-500/30 rounded hover:bg-green-500/30 transition-colors"
                                >
                                  <Download className="w-3 h-3" />
                                  Download
                                </button>
                              )}
                              {output.status === 'error' && output.errorMessage && (
                                <span className="text-xs text-red-400 truncate max-w-xs" title={output.errorMessage}>
                                  {output.errorMessage}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
