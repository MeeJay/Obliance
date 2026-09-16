// ---------------------------------------------------------------------------
// Report renderer — turns the collected report `data` (the generic
// section→rows map produced by report.service.collectData) into a real,
// print-quality HTML document: KPI counters, SVG donut/gauge charts, severity
// bars, styled detail tables and a tenant signature footer.
//
// Everything is SELF-CONTAINED (inline SVG + inline CSS, no CDN / external
// asset) so it renders identically in a browser (HTML export) and inside the
// bundled headless Chromium used for the PDF export (playwright page.pdf()).
// A strict offline context can't fetch anything, so charts are hand-built SVG.
// ---------------------------------------------------------------------------

interface RenderOpts {
  tenantName: string;
}

// ── palettes ────────────────────────────────────────────────────────────────

const STATUS_META: Record<string, { label: string; color: string }> = {
  online:            { label: 'Online',            color: '#10b981' },
  warning:           { label: 'Warning',           color: '#f59e0b' },
  critical:          { label: 'Critical',          color: '#ef4444' },
  updating:          { label: 'Updating',          color: '#3b82f6' },
  update_error:      { label: 'Update error',      color: '#dc2626' },
  offline:           { label: 'Offline',           color: '#9ca3af' },
  maintenance:       { label: 'Maintenance',       color: '#8b5cf6' },
  suspended:         { label: 'Suspended',         color: '#71717a' },
  pending:           { label: 'Pending',           color: '#eab308' },
  pending_uninstall: { label: 'Pending uninstall', color: '#f97316' },
};

const OS_META: Record<string, { label: string; color: string }> = {
  windows: { label: 'Windows', color: '#0078d4' },
  macos:   { label: 'macOS',   color: '#374151' },
  linux:   { label: 'Linux',   color: '#f59e0b' },
  other:   { label: 'Other',   color: '#9ca3af' },
};

const SEV_META: Record<string, { label: string; color: string }> = {
  critical:  { label: 'Critical',  color: '#ef4444' },
  important: { label: 'Important', color: '#f59e0b' },
  moderate:  { label: 'Moderate',  color: '#eab308' },
  optional:  { label: 'Optional',  color: '#3b82f6' },
  unknown:   { label: 'Unknown',   color: '#9ca3af' },
};

// Devices in these states are actually reachable (the box answered a recent
// push). 'warning'/'critical' encode metric severity, NOT disconnection —
// filtering on status='online' alone under-counts the live fleet. This is the
// canonical live set used everywhere else (device.service connected filter,
// dashboard KPIs, the collectors); 'update_error' is intentionally EXCLUDED —
// the product buckets it with offline, so we must too or the report's
// availability number contradicts the dashboard.
const REACHABLE = new Set(['online', 'warning', 'critical', 'updating']);

const ACCENT = '#6366f1';
const INK = '#0f172a';
const MUTED = '#64748b';

// ── small helpers ────────────────────────────────────────────────────────────

const esc = (s: any): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

const cell = (v: any): string => {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().replace('T', ' ').slice(0, 19);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

const pct = (n: number): number => (isFinite(n) ? Math.round(n) : 0);
const num = (n: number): string => (n || 0).toLocaleString('en-US');

// ── chart primitives (pure SVG) ──────────────────────────────────────────────

/** Circular progress ring with a big centered % — reads as a gauge/counter. */
function ring(value: number, color: string, label: string): string {
  const size = 132, stroke = 13, r = (size - stroke) / 2, c = size / 2;
  const C = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, value)) / 100;
  const dash = C * p;
  // Only draw the value arc when there is one, and use a butt cap: a round cap
  // on a zero-length dash renders as a full-width dot (a phantom sliver at 0%),
  // and on small values it over-extends each end, inflating e.g. 1% visually.
  const valueArc = dash > 0
    ? `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}"
    stroke-dasharray="${dash.toFixed(2)} ${(C - dash).toFixed(2)}" stroke-linecap="butt"
    transform="rotate(-90 ${c} ${c})"/>`
    : '';
  return `<div class="chart-card">
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="#e5e7eb" stroke-width="${stroke}"/>
  ${valueArc}
  <text x="${c}" y="${c}" text-anchor="middle" dominant-baseline="central"
    font-size="30" font-weight="700" fill="${INK}">${pct(value)}%</text>
</svg>
<div class="chart-title">${esc(label)}</div>
</div>`;
}

/** Multi-segment donut with a legend. `total` label sits in the hole. */
function donut(title: string, segments: Array<{ label: string; value: number; color: string }>, centerLabel: string): string {
  const size = 132, stroke = 24, r = (size - stroke) / 2, c = size / 2;
  const C = 2 * Math.PI * r;
  const active = segments.filter((s) => s.value > 0);
  const total = active.reduce((s, x) => s + x.value, 0);

  let arcs: string;
  if (total <= 0) {
    arcs = `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="#e5e7eb" stroke-width="${stroke}"/>`;
  } else {
    let offset = 0;
    arcs = active.map((s) => {
      const dash = C * (s.value / total);
      const seg = `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${s.color}" stroke-width="${stroke}"
        stroke-dasharray="${dash.toFixed(2)} ${(C - dash).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}"
        transform="rotate(-90 ${c} ${c})"/>`;
      offset += dash;
      return seg;
    }).join('');
  }

  const legend = segments.filter((s) => s.value > 0).map((s) =>
    `<div class="lg-row"><span class="lg-dot" style="background:${s.color}"></span>${esc(s.label)}<span class="lg-val">${num(s.value)}</span></div>`
  ).join('') || `<div class="lg-row" style="color:${MUTED}">No data</div>`;

  return `<div class="chart-card wide">
<div class="chart-title">${esc(title)}</div>
<div class="donut-wrap">
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="#f1f5f9" stroke-width="${stroke}"/>
  ${arcs}
  <text x="${c}" y="${c - 8}" text-anchor="middle" dominant-baseline="central" font-size="26" font-weight="700" fill="${INK}">${esc(centerLabel)}</text>
  <text x="${c}" y="${c + 14}" text-anchor="middle" dominant-baseline="central" font-size="10" fill="${MUTED}">total</text>
</svg>
<div class="legend">${legend}</div>
</div>
</div>`;
}

/** Horizontal severity/count bars (HTML/CSS — crisp at any print scale). */
function bars(title: string, rows: Array<{ label: string; value: number; color: string }>): string {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const body = rows.map((r) =>
    `<div class="bar-row">
      <span class="bar-label">${esc(r.label)}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${(r.value / max) * 100}%;background:${r.color}"></div></div>
      <span class="bar-val">${num(r.value)}</span>
    </div>`
  ).join('');
  return `<div class="chart-card wide">
<div class="chart-title">${esc(title)}</div>
<div class="bars">${body || `<div style="color:${MUTED};font-size:11px">No data</div>`}</div>
</div>`;
}

function kpi(value: string, label: string, sub: string, color: string): string {
  return `<div class="kpi">
<div class="kpi-val" style="color:${color}">${esc(value)}</div>
<div class="kpi-label">${esc(label)}</div>
${sub ? `<div class="kpi-sub">${esc(sub)}</div>` : ''}
</div>`;
}

// ── metric computation ────────────────────────────────────────────────────────

function computeMetrics(data: Record<string, any>) {
  const devices: any[] = Array.isArray(data.devices) ? data.devices : [];
  const total = devices.length;

  const statusCounts: Record<string, number> = {};
  const osCounts: Record<string, number> = {};
  let reachable = 0;
  for (const d of devices) {
    const st = String(d.status ?? 'offline');
    statusCounts[st] = (statusCounts[st] || 0) + 1;
    if (REACHABLE.has(st)) reachable++;
    const os = String(d.osType ?? 'other');
    osCounts[os] = (osCounts[os] || 0) + 1;
  }
  const reachablePct = total ? (reachable / total) * 100 : 0;

  // Compliance — latest row per (device, policy). complianceAvg is the mean
  // across all latest (device,policy) scores; the "≥90%" KPI is per DEVICE
  // (average of that device's policy scores), not per policy — otherwise one
  // passing policy would mark a device compliant while its other policies fail.
  const compRows: any[] = Array.isArray(data.compliance) ? data.compliance : [];
  const seenPolicy = new Set<string>();
  let scoreSum = 0, scoreN = 0;
  let rulePass = 0, ruleFail = 0, ruleWarn = 0, ruleOther = 0;
  const perDevice = new Map<number, { sum: number; n: number }>();
  for (const r of compRows) {
    const key = `${r.device_id}:${r.policy_id}`;
    if (seenPolicy.has(key)) continue; // rows arrive checked_at DESC → first = latest
    seenPolicy.add(key);
    // Number(null)===0 and Number('')===0 both pass isFinite, so a missing
    // score would be counted as a real 0% — reject null/'' explicitly first.
    const raw = r.compliance_score;
    if (raw != null && raw !== '') {
      const score = Number(raw);
      if (Number.isFinite(score)) {
        scoreSum += score; scoreN++;
        const agg = perDevice.get(r.device_id) ?? { sum: 0, n: 0 };
        agg.sum += score; agg.n++;
        perDevice.set(r.device_id, agg);
      }
    }
    const results = Array.isArray(r.results) ? r.results : [];
    for (const rule of results) {
      switch (rule?.status) {
        case 'pass': rulePass++; break;
        case 'fail': case 'error': ruleFail++; break;
        case 'warning': ruleWarn++; break;
        default: ruleOther++;
      }
    }
  }
  let compliantDeviceCount = 0;
  for (const { sum, n } of perDevice.values()) {
    if (n > 0 && sum / n >= 90) compliantDeviceCount++;
  }
  const complianceAvg = scoreN ? scoreSum / scoreN : 0;
  const hasCompliance = compRows.length > 0;

  // Updates — counts by severity, reboot-needed devices.
  const updRows: any[] = Array.isArray(data.updates) ? data.updates : [];
  const sevCounts: Record<string, number> = {};
  const rebootDevices = new Set<number>();
  for (const u of updRows) {
    const sev = String(u.severity ?? 'unknown');
    sevCounts[sev] = (sevCounts[sev] || 0) + 1;
    if (u.requires_reboot) rebootDevices.add(u.device_id);
  }
  const hasUpdates = updRows.length > 0;
  const criticalUpdates = (sevCounts.critical || 0) + (sevCounts.important || 0);

  const softwareRows: any[] = Array.isArray(data.software) ? data.software : [];

  return {
    total, reachable, reachablePct, statusCounts, osCounts,
    hasCompliance, complianceAvg, compliantDevices: compliantDeviceCount, scoredDevices: perDevice.size,
    rulePass, ruleFail, ruleWarn, ruleOther,
    hasUpdates, updateTotal: updRows.length, sevCounts, criticalUpdates, rebootDevices: rebootDevices.size,
    softwareTotal: softwareRows.length,
  };
}

// ── detail tables ─────────────────────────────────────────────────────────────

const ROW_CAP = 500; // keep the PDF sane; full data lives in CSV/XLSX exports

function detailTable(section: string, rows: any[]): string {
  if (!Array.isArray(rows) || rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const shown = rows.slice(0, ROW_CAP);
  const head = headers.map((h) => `<th>${esc(h)}</th>`).join('');
  const body = shown.map((row) =>
    `<tr>${headers.map((h) => `<td>${esc(cell(row[h]))}</td>`).join('')}</tr>`
  ).join('');
  const more = rows.length > ROW_CAP
    ? `<div class="tbl-more">+ ${num(rows.length - ROW_CAP)} more rows — see the CSV/Excel export for the full dataset</div>` : '';
  return `<h2>${esc(sectionTitle(section))} <span class="count">${num(rows.length)}</span></h2>
<table class="detail"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>${more}`;
}

function sectionTitle(section: string): string {
  const map: Record<string, string> = {
    devices: 'Devices', hardware: 'Hardware inventory', software: 'Software inventory',
    updates: 'Pending updates', compliance: 'Compliance results', scriptHistory: 'Script execution history',
  };
  return map[section] || section;
}

// ── document assembly ─────────────────────────────────────────────────────────

export function renderReportHtml(data: Record<string, any>, report: any, opts: RenderOpts): string {
  const m = computeMetrics(data);
  const generatedAt = new Date();

  // KPI row — always device totals; conditional cards for the sections present.
  const kpis: string[] = [
    kpi(num(m.total), 'Devices', 'in scope', ACCENT),
    kpi(num(m.reachable), 'Reachable', `${pct(m.reachablePct)}% of fleet`, '#10b981'),
    kpi(num(m.total - m.reachable), 'Offline', `${pct(100 - m.reachablePct)}% of fleet`, '#9ca3af'),
  ];
  if (m.hasCompliance) kpis.push(kpi(`${pct(m.complianceAvg)}%`, 'Compliance', `${num(m.compliantDevices)}/${num(m.scoredDevices)} devices ≥90%`, m.complianceAvg >= 90 ? '#10b981' : m.complianceAvg >= 70 ? '#f59e0b' : '#ef4444'));
  if (m.hasUpdates) {
    kpis.push(kpi(num(m.updateTotal), 'Pending updates', `${num(m.criticalUpdates)} critical/important`, m.criticalUpdates > 0 ? '#ef4444' : '#3b82f6'));
    kpis.push(kpi(num(m.rebootDevices), 'Reboot needed', 'devices', m.rebootDevices > 0 ? '#f59e0b' : '#10b981'));
  }
  if (m.softwareTotal) kpis.push(kpi(num(m.softwareTotal), 'Software items', 'installed', MUTED));

  // Charts.
  const charts: string[] = [];
  charts.push(ring(m.reachablePct, m.reachablePct >= 80 ? '#10b981' : m.reachablePct >= 50 ? '#f59e0b' : '#ef4444', 'Fleet availability'));
  if (m.hasCompliance) {
    charts.push(ring(m.complianceAvg, m.complianceAvg >= 90 ? '#10b981' : m.complianceAvg >= 70 ? '#f59e0b' : '#ef4444', 'Compliance score'));
  }
  charts.push(donut('Device status',
    Object.entries(m.statusCounts).map(([k, v]) => ({ label: STATUS_META[k]?.label || k, value: v, color: STATUS_META[k]?.color || MUTED })),
    num(m.total)));
  charts.push(donut('Operating systems',
    Object.entries(m.osCounts).map(([k, v]) => ({ label: OS_META[k]?.label || k, value: v, color: OS_META[k]?.color || MUTED })),
    num(m.total)));
  if (m.hasUpdates) {
    charts.push(bars('Updates by severity',
      Object.keys(SEV_META).filter((k) => m.sevCounts[k]).map((k) => ({ label: SEV_META[k].label, value: m.sevCounts[k], color: SEV_META[k].color }))));
  }
  if (m.hasCompliance && (m.rulePass + m.ruleFail + m.ruleWarn + m.ruleOther) > 0) {
    charts.push(donut('Compliance checks', [
      { label: 'Pass', value: m.rulePass, color: '#10b981' },
      { label: 'Fail', value: m.ruleFail, color: '#ef4444' },
      { label: 'Warning', value: m.ruleWarn, color: '#f59e0b' },
      { label: 'Other', value: m.ruleOther, color: '#9ca3af' },
    ], num(m.rulePass + m.ruleFail + m.ruleWarn + m.ruleOther)));
  }

  // Detail tables — every non-empty section, in a stable order.
  const order = ['devices', 'hardware', 'software', 'updates', 'compliance', 'scriptHistory'];
  const seen = new Set(order);
  const sections = [...order, ...Object.keys(data).filter((k) => !seen.has(k))];
  const details = sections.map((s) => detailTable(s, data[s])).filter(Boolean).join('\n');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(report.name)}</title>
<style>
* { box-sizing: border-box; }
body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; color: ${INK}; margin: 0; font-size: 11px; }
.page { padding: 24px 28px; }

/* Header / cover */
.hdr { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid ${ACCENT}; padding-bottom: 14px; margin-bottom: 20px; }
.brand { display: flex; align-items: center; gap: 10px; }
.brand-mark { width: 30px; height: 30px; border-radius: 8px; background: linear-gradient(135deg, ${ACCENT}, #8b5cf6); display: inline-block; position: relative; }
.brand-mark::after { content: ""; position: absolute; inset: 9px; border-radius: 3px; background: #fff; }
.brand-name { font-size: 18px; font-weight: 800; letter-spacing: -0.4px; }
.brand-sub { font-size: 9px; color: ${MUTED}; text-transform: uppercase; letter-spacing: 1.5px; }
.hdr-right { text-align: right; }
.rpt-title { font-size: 20px; font-weight: 700; margin: 0 0 4px; }
.rpt-meta { font-size: 9.5px; color: ${MUTED}; line-height: 1.6; }
.rpt-meta b { color: ${INK}; }

/* KPI cards */
.kpis { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 18px; }
.kpi { flex: 1 1 130px; min-width: 130px; border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px 14px; background: #fff; page-break-inside: avoid; }
.kpi-val { font-size: 26px; font-weight: 800; line-height: 1; }
.kpi-label { font-size: 11px; font-weight: 600; margin-top: 5px; }
.kpi-sub { font-size: 9px; color: ${MUTED}; margin-top: 2px; }

/* Charts */
.section-h { font-size: 13px; font-weight: 700; margin: 4px 0 10px; color: ${INK}; }
.charts { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 22px; }
.chart-card { border: 1px solid #e5e7eb; border-radius: 10px; padding: 14px; background: #fff; text-align: center; page-break-inside: avoid; flex: 0 0 auto; }
.chart-card.wide { flex: 1 1 240px; min-width: 220px; text-align: left; }
.chart-title { font-size: 11px; font-weight: 700; color: ${INK}; margin-bottom: 8px; }
.donut-wrap { display: flex; align-items: center; gap: 14px; }
.legend { flex: 1; }
.lg-row { display: flex; align-items: center; font-size: 10px; padding: 2px 0; color: #334155; }
.lg-dot { width: 9px; height: 9px; border-radius: 2px; margin-right: 6px; display: inline-block; }
.lg-val { margin-left: auto; font-weight: 700; color: ${INK}; }
.bars { display: flex; flex-direction: column; gap: 7px; margin-top: 4px; }
.bar-row { display: flex; align-items: center; gap: 8px; font-size: 10px; }
.bar-label { width: 68px; flex: 0 0 68px; color: #334155; }
.bar-track { flex: 1; height: 12px; background: #f1f5f9; border-radius: 6px; overflow: hidden; }
.bar-fill { height: 100%; border-radius: 6px; }
.bar-val { width: 34px; flex: 0 0 34px; text-align: right; font-weight: 700; }

/* Detail tables */
h2 { font-size: 13px; margin: 20px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #e5e7eb; page-break-after: avoid; }
h2 .count { color: #fff; background: ${ACCENT}; font-size: 9px; font-weight: 700; padding: 1px 7px; border-radius: 9px; vertical-align: middle; }
table.detail { width: 100%; border-collapse: collapse; font-size: 8.5px; margin-bottom: 6px; }
table.detail th, table.detail td { border: 1px solid #e5e7eb; padding: 3px 6px; text-align: left; vertical-align: top; word-break: break-word; }
table.detail th { background: #1e293b; color: #fff; font-weight: 600; white-space: nowrap; }
table.detail tr:nth-child(even) td { background: #f8fafc; }
table.detail tr { page-break-inside: avoid; }
.tbl-more { font-size: 9px; color: ${MUTED}; font-style: italic; margin-bottom: 10px; }

/* Signature footer */
.sig { margin-top: 26px; padding-top: 12px; border-top: 2px solid #e5e7eb; display: flex; justify-content: space-between; align-items: flex-end; font-size: 9.5px; color: ${MUTED}; page-break-inside: avoid; }
.sig-name { font-size: 12px; font-weight: 700; color: ${INK}; }
.sig-line { border-top: 1px solid #94a3b8; width: 180px; margin-top: 24px; padding-top: 3px; }
</style></head><body>
<div class="page">

  <div class="hdr">
    <div class="brand">
      <span class="brand-mark"></span>
      <div>
        <div class="brand-name">Obliance</div>
        <div class="brand-sub">RMM Report</div>
      </div>
    </div>
    <div class="hdr-right">
      <div class="rpt-title">${esc(report.name)}</div>
      <div class="rpt-meta">
        Prepared for <b>${esc(opts.tenantName)}</b><br>
        Type: <b>${esc(report.type)}</b> · Scope: <b>${esc(report.scope_type)}</b><br>
        Generated <b>${generatedAt.toISOString().replace('T', ' ').slice(0, 16)} UTC</b>
      </div>
    </div>
  </div>

  <div class="section-h">Executive summary</div>
  <div class="kpis">${kpis.join('')}</div>

  <div class="section-h">Fleet analytics</div>
  <div class="charts">${charts.join('')}</div>

  ${details ? `<div class="section-h">Detail</div>${details}` : ''}

  <div class="sig">
    <div>
      <div class="sig-name">${esc(opts.tenantName)}</div>
      <div>This report was generated automatically by Obliance RMM.</div>
      <div>Report “${esc(report.name)}” · ${generatedAt.toISOString().slice(0, 10)}</div>
    </div>
    <div style="text-align:right">
      <div class="sig-line">Authorized signature</div>
    </div>
  </div>

</div>
</body></html>`;
}
