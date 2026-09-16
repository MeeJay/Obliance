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

// The real Obliance "O" mark (same SVG as the app favicon), inlined so it
// renders in the offline PDF context. Gradient IDs renamed to ASCII to avoid
// any encoding surprises in the render pipeline.
const OBLI_LOGO = `<svg viewBox="0 0 122.88 122.88" width="34" height="34" role="img" aria-label="Obliance">
<defs>
<linearGradient id="obliG1" x1="100.79" y1="22.04" x2="51.77" y2="110.5" gradientUnits="userSpaceOnUse">
<stop offset=".11" stop-color="#c2001b"/><stop offset=".56" stop-color="#d28c7f"/><stop offset=".65" stop-color="#c0695f"/><stop offset=".87" stop-color="#941210"/><stop offset=".91" stop-color="#8b0000"/>
</linearGradient>
<linearGradient id="obliG2" x1="20.66" y1="114.33" x2="63.21" y2="-2.64" gradientUnits="userSpaceOnUse">
<stop offset=".08" stop-color="#c2001b"/><stop offset=".17" stop-color="#c41328"/><stop offset=".34" stop-color="#c9444b"/><stop offset=".56" stop-color="#d28c7f"/><stop offset=".59" stop-color="#cc8175"/><stop offset=".87" stop-color="#9d2421"/><stop offset="1" stop-color="#8b0000"/>
</linearGradient>
</defs>
<path fill="url(#obliG1)" d="M122.88,61.44c0,33.93-27.51,61.44-61.44,61.44h-.08c-20.87-10.92-35.66-31.91-37.87-56.52,2.47,19.24,19.25,33.99,39.34,33.23,19.73-.75,35.83-16.78,36.66-36.5.65-15.47-7.91-29.02-20.65-35.6-.33-.17-.66-.34-1-.49-.66-.33-1.33-.62-2.02-.91-4.46-1.82-9.35-2.83-14.47-2.83-1.13,0-2.25.05-3.36.15-2.6.22-5.13.72-7.56,1.44-.17.05-.35.1-.51.16-.17.05-.35.1-.51.16t.03-.03s.02-.02.03-.03c.02-.02.03-.03.05-.05.04-.04.09-.09.16-.16.06-.06.13-.13.21-.2.16-.15.35-.33.58-.53,0,0,.03-.02.03-.03.23-.2.49-.43.79-.69.78-.66,1.78-1.46,2.98-2.32.97-.68,2.06-1.41,3.28-2.15.6-.36,1.25-.72,1.92-1.09.25-.13.51-.27.77-.4.39-.2.78-.4,1.19-.6.41-.19.82-.39,1.24-.58.4-.17.8-.35,1.22-.51.22-.09.43-.17.66-.26.27-.1.53-.21.8-.3.18-.07.37-.14.56-.2.4-.14.8-.28,1.22-.41.03-.02.06-.03.09-.03.53-.16,1.07-.32,1.61-.47.4-.11.79-.21,1.2-.3,1.01-.24,2.05-.45,3.12-.61.39-.06.78-.11,1.18-.16.08,0,.16-.02.23-.03.44-.05.89-.09,1.34-.13h0c4.18-.13,10.67.22,17.98,2.89,8.65,3.17,14.03,8.44,17.36,12.27,1.29,1.48,2.69,2.96,3.74,4.61,1.92,3.02,4.1,6.91,5.49,11.72,0,0,2.4,8.34,2.4,17.04Z"/>
<path fill="url(#obliG2)" d="M23.2,60.34c-.02.36-.03.73-.03,1.1,0,1.65.1,3.27.31,4.86,0,.02,0,.03,0,.05v.04c2.23,24.59,17.01,45.57,37.87,56.48-15.23-.02-29.16-5.58-39.89-14.78C8.19,96.72-.17,79.76,0,60.84.3,29.35,24.71,3.31,55.45.3h0c1.98-.21,3.99-.3,6.01-.3,9.64,0,18.77,2.23,26.89,6.19-3.38-.85-21.87-5.11-39.49,6.12-12.5,7.97-16.61,22.22-18.35,26.59-4.42,6.03-7.1,13.4-7.32,21.39v.04Z"/>
</svg>`;

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

// GB → human capacity (TB above 1024 GB).
const capacity = (gb: number): string =>
  gb >= 1024 ? `${(gb / 1024).toFixed(gb >= 10240 ? 0 : 1)} TB` : `${num(Math.round(gb))} GB`;

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

  // Hardware — already curated (one parsed row per device) in collectData.
  const hwRows: any[] = Array.isArray(data.hardware) ? data.hardware : [];
  let totalCores = 0, totalRamGb = 0, totalDiskGb = 0;
  for (const h of hwRows) {
    totalCores += Number(h.cores) || 0;
    totalRamGb += Number(h.ram_gb) || 0;
    totalDiskGb += Number(h.disk_gb) || 0;
  }
  const hasHardware = hwRows.length > 0;

  return {
    total, reachable, reachablePct, statusCounts, osCounts,
    hasCompliance, complianceAvg, compliantDevices: compliantDeviceCount, scoredDevices: perDevice.size,
    rulePass, ruleFail, ruleWarn, ruleOther,
    hasUpdates, updateTotal: updRows.length, sevCounts, criticalUpdates, rebootDevices: rebootDevices.size,
    softwareTotal: softwareRows.length,
    hasHardware, totalCores, totalRamGb, totalDiskGb,
  };
}

// ── detail tables ─────────────────────────────────────────────────────────────

const ROW_CAP = 500;   // keep the PDF sane; full data lives in CSV/XLSX exports
const CELL_MAX = 220;  // hard cap per cell so one blob can't span pages

// Columns never rendered in detail tables: raw payload dumps, jsonb arrays that
// belong in charts (results), internal ids duplicated by a hostname column, and
// SENSITIVE fields (product keys) that must never leak into a shared report.
const HIDDEN_COLS = new Set([
  'raw', 'results', 'sections', 'filters',
  'device_id', 'policy_id', 'tenant_id',
  'windowsKey', 'officeKey', 'install_location', 'description',
]);

// Human column headers (fallback: snake_case → spaced). Covers the curated
// hardware/software/updates/compliance/devices columns.
const COLUMN_LABELS: Record<string, string> = {
  id: 'ID', device: 'Server', hostname: 'Hostname', displayName: 'Display name',
  status: 'Status', osType: 'OS', osVersion: 'OS version', lastSeen: 'Last seen',
  cpu: 'CPU', cores: 'Cores', threads: 'Threads', ram_gb: 'RAM (GB)', disk_gb: 'Disk (GB)',
  ipv4: 'IP address', mac: 'MAC', nics: 'Adapters', os: 'OS', scanned_at: 'Scanned',
  name: 'Name', version: 'Version', publisher: 'Publisher', install_date: 'Installed', source: 'Source',
  title: 'Update', severity: 'Severity', category: 'Category', requires_reboot: 'Reboot',
  compliance_score: 'Score (%)', checked_at: 'Checked',
  script: 'Script', exit_code: 'Exit code', triggered_at: 'Triggered',
};
const colLabel = (h: string): string => COLUMN_LABELS[h] || h.replace(/_/g, ' ');

function detailTable(section: string, rows: any[]): string {
  if (!Array.isArray(rows) || rows.length === 0) return '';
  const headers = Object.keys(rows[0]).filter((h) => !HIDDEN_COLS.has(h));
  if (headers.length === 0) return '';
  const shown = rows.slice(0, ROW_CAP);
  const head = headers.map((h) => `<th>${esc(colLabel(h))}</th>`).join('');
  const body = shown.map((row) => {
    const tds = headers.map((h) => {
      const raw = cell(row[h]);
      const val = raw.length > CELL_MAX ? raw.slice(0, CELL_MAX) + '…' : raw;
      return `<td>${esc(val)}</td>`;
    }).join('');
    return `<tr>${tds}</tr>`;
  }).join('');
  const more = rows.length > ROW_CAP
    ? `<div class="tbl-more">+ ${num(rows.length - ROW_CAP)} more rows — see the CSV/Excel export for the full dataset</div>` : '';
  return `<h2>${esc(sectionTitle(section))} <span class="count">${num(rows.length)}</span></h2>
<table class="detail"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>${more}`;
}

function sectionTitle(section: string): string {
  const map: Record<string, string> = {
    devices: 'Devices', hardware: 'Inventory', software: 'Software inventory',
    updates: 'Pending updates', compliance: 'Compliance results', scriptHistory: 'Script execution history',
  };
  return map[section] || section;
}

// Report "content" chips shown in the header — reflect what the user checked.
const SECTION_LABELS: Record<string, string> = {
  hardware: 'Hardware', network: 'Network', software: 'Software',
  updates: 'Updates', compliance: 'Compliance', scripts_history: 'Scripts', inventory_detail: 'Detailed',
};

// ── per-server detailed hardware cards ────────────────────────────────────────

function hardwareDetailBlocks(rows: any[]): string {
  if (!Array.isArray(rows) || rows.length === 0) return '';
  const line = (label: string, val: string) =>
    val ? `<div class="d-line"><span class="d-key">${esc(label)}</span><span class="d-val">${esc(val)}</span></div>` : '';
  const cards = rows.map((h) => {
    const cpu = h.cpu ? `${h.cpu}${h.cores != null ? ` — ${h.cores} cores / ${h.threads ?? '?'} threads` : ''}${h.speed ? ` @ ${h.speed} GHz` : ''}` : '';
    const ram = h.ramGb != null
      ? `${h.ramGb} GB${h.ramSlots?.length ? ` (${h.ramSlots.map((s: any) => `${s.sizeGb} GB${s.type && s.type !== 'Unknown' ? ' ' + s.type : ''}`).join(' + ')})` : ''}`
      : '';
    // Build RAW strings — `line()` escapes once. (Pre-escaping here would
    // double-escape, printing literal &amp; for a disk model like "WDC & Co".)
    const vols = (h.volumes || []).map((v: any) => `${v.mount} ${v.usedGb}/${v.totalGb} GB (${v.pct}%)`).join(' · ');
    const pdisks = (h.physicalDisks || []).map((d: any) => `${d.model} ${d.sizeGb} GB${d.type ? ' ' + d.type : ''}`).join(' · ');
    const disk = vols || pdisks;
    const nics = (h.nics || []).map((n: any) =>
      `<div class="d-sub">${esc(n.name)}${n.mac ? ` · <span class="mono">${esc(n.mac)}</span>` : ''}${n.ips?.length ? ` · ${esc(n.ips.join(', '))}` : ''}</div>`).join('');
    return `<div class="dcard">
<div class="dcard-h">${esc(h.device)}${h.status ? ` <span class="dstatus" style="color:${STATUS_META[h.status]?.color || MUTED}">${esc(STATUS_META[h.status]?.label || h.status)}</span>` : ''}</div>
<div class="dgrid">
${line('OS', h.os + (h.osBuild ? ` · build ${h.osBuild}` : ''))}
${line('CPU', cpu)}
${line('RAM', ram)}
${line('Storage', disk)}
${line('Motherboard', h.motherboard)}
${line('BIOS', h.bios)}
${h.gpu?.length ? line('GPU', h.gpu.join(', ')) : ''}
</div>
${nics ? `<div class="d-nics"><span class="d-key">Network</span>${nics}</div>` : ''}
</div>`;
  }).join('');
  return `<h2>Detailed inventory <span class="count">${num(rows.length)}</span></h2><div class="dcards">${cards}</div>`;
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
  if (m.totalCores > 0) kpis.push(kpi(num(m.totalCores), 'CPU cores', 'across fleet', ACCENT));
  if (m.totalRamGb > 0) kpis.push(kpi(capacity(m.totalRamGb), 'RAM', 'total installed', '#8b5cf6'));
  if (m.totalDiskGb > 0) kpis.push(kpi(capacity(m.totalDiskGb), 'Storage', 'total capacity', '#0ea5e9'));
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

  // Detail tables — every non-empty section, in a stable order. The per-server
  // detailed cards (hardwareDetail) are drawn right after the flat inventory
  // table, not as a generic table.
  const order = ['devices', 'hardware', 'software', 'updates', 'compliance', 'scriptHistory'];
  const skip = new Set([...order, 'hardwareDetail']);
  const parts: string[] = [];
  for (const s of [...order, ...Object.keys(data).filter((k) => !skip.has(k))]) {
    const t = detailTable(s, data[s]);
    if (t) parts.push(t);
    if (s === 'hardware') {
      const cards = hardwareDetailBlocks(data.hardwareDetail);
      if (cards) parts.push(cards);
    }
  }
  const details = parts.join('\n');

  // Header "content" chips reflect exactly what the user checked.
  const content = Array.isArray(report.sections)
    ? report.sections.map((s: string) => SECTION_LABELS[s] || s).join(' · ')
    : '';

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(report.name)}</title>
<style>
* { box-sizing: border-box; }
body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; color: ${INK}; margin: 0; font-size: 11px; }
.page { padding: 24px 28px; }

/* Header / cover */
.hdr { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid ${ACCENT}; padding-bottom: 14px; margin-bottom: 20px; }
.brand { display: flex; align-items: center; gap: 10px; }
.brand svg { display: block; flex: 0 0 auto; }
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

/* Detailed per-server cards */
.dcards { display: flex; flex-direction: column; gap: 10px; margin-bottom: 8px; }
.dcard { border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px 14px; background: #fff; page-break-inside: avoid; }
.dcard-h { font-size: 12px; font-weight: 700; color: ${INK}; margin-bottom: 8px; padding-bottom: 5px; border-bottom: 1px solid #f1f5f9; }
.dstatus { font-size: 9px; font-weight: 700; }
.dgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 24px; }
.d-line { display: flex; font-size: 10px; padding: 1.5px 0; }
.d-key { flex: 0 0 92px; color: ${MUTED}; font-weight: 600; }
.d-val { flex: 1; color: #1e293b; word-break: break-word; }
.d-nics { margin-top: 6px; font-size: 10px; }
.d-nics .d-key { display: block; margin-bottom: 2px; }
.d-sub { color: #334155; padding: 1px 0 1px 8px; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }

/* Signature footer */
.sig { margin-top: 26px; padding-top: 12px; border-top: 2px solid #e5e7eb; display: flex; justify-content: space-between; align-items: flex-end; font-size: 9.5px; color: ${MUTED}; page-break-inside: avoid; }
.sig-name { font-size: 12px; font-weight: 700; color: ${INK}; }
.sig-line { border-top: 1px solid #94a3b8; width: 180px; margin-top: 24px; padding-top: 3px; }
</style></head><body>
<div class="page">

  <div class="hdr">
    <div class="brand">
      ${OBLI_LOGO}
      <div>
        <div class="brand-name">Obliance</div>
        <div class="brand-sub">RMM Report</div>
      </div>
    </div>
    <div class="hdr-right">
      <div class="rpt-title">${esc(report.name)}</div>
      <div class="rpt-meta">
        Prepared for <b>${esc(opts.tenantName)}</b><br>
        Scope: <b>${esc(report.scope_type)}</b>${content ? ` · Content: <b>${esc(content)}</b>` : ''}<br>
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
