import { db } from '../db';
import path from 'path';
import fs from 'fs/promises';
import type { Report, ReportOutput, ReportSection } from '@obliance/shared';
import { config } from '../config';
import { logger } from '../utils/logger';
import { renderReportHtml } from './reportRenderer';
import { launchChromium } from '../utils/chromium';

class ReportService {
  // Persist under the mounted CUSTOM_DIR volume (/custom), NOT process.cwd()
  // — otherwise generated reports live in the container's ephemeral layer and
  // downloads 404 after any restart/upgrade.
  private outputDir = path.join(config.customDir, 'reports');

  rowToReport(row: any): Report {
    return {
      id: row.id, tenantId: row.tenant_id, name: row.name, description: row.description,
      type: row.type, format: row.format, scopeType: row.scope_type, scopeId: row.scope_id,
      sections: row.sections || [], filters: row.filters || {},
      scheduleCron: row.schedule_cron, timezone: row.timezone,
      isEnabled: row.is_enabled, lastGeneratedAt: row.last_generated_at,
      createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }

  rowToOutput(row: any): ReportOutput {
    return {
      id: row.id,
      reportId: row.report_id,
      tenantId: row.tenant_id,
      status: row.status,
      filePath: row.file_path ?? null,
      fileSizeBytes: row.file_size_bytes != null ? Number(row.file_size_bytes) : null,
      rowCount: row.row_count ?? null,
      errorMessage: row.error_message ?? null,
      expiresAt: row.expires_at ?? null,
      generatedAt: row.generated_at ?? null,
      createdAt: row.created_at,
    };
  }

  async getReports(tenantId: number) {
    const rows = await db('reports').where({ tenant_id: tenantId }).orderBy('name');
    return rows.map(this.rowToReport.bind(this));
  }

  async updateReport(reportId: number, tenantId: number, data: Partial<Report>) {
    const updates: Record<string, unknown> = { updated_at: new Date() };
    if (data.name !== undefined)        updates.name = data.name;
    if (data.description !== undefined) updates.description = data.description;
    if (data.type !== undefined)        updates.type = data.type;
    if (data.format !== undefined)      updates.format = data.format;
    if (data.scopeType !== undefined)   updates.scope_type = data.scopeType;
    if (data.scopeId !== undefined)     updates.scope_id = data.scopeId;
    if (data.sections !== undefined)    updates.sections = JSON.stringify(data.sections);
    if (data.filters !== undefined)     updates.filters = JSON.stringify(data.filters);
    if (data.scheduleCron !== undefined) updates.schedule_cron = data.scheduleCron;
    if (data.timezone !== undefined)    updates.timezone = data.timezone;
    if (data.isEnabled !== undefined)   updates.is_enabled = data.isEnabled;
    const [row] = await db('reports').where({ id: reportId, tenant_id: tenantId }).update(updates).returning('*');
    return row ? this.rowToReport(row) : null;
  }

  async createReport(tenantId: number, data: Partial<Report> & { name: string; createdBy?: number }) {
    const [row] = await db('reports').insert({
      tenant_id: tenantId, name: data.name, description: data.description,
      type: data.type || 'fleet', format: data.format || 'pdf',
      scope_type: data.scopeType || 'tenant', scope_id: data.scopeId,
      sections: JSON.stringify(data.sections || ['hardware','software','updates','compliance']),
      filters: JSON.stringify(data.filters || {}),
      schedule_cron: data.scheduleCron, timezone: data.timezone || 'UTC',
      is_enabled: data.isEnabled !== false, created_by: data.createdBy,
    }).returning('*');
    return this.rowToReport(row);
  }

  async generateReport(reportId: number, tenantId: number): Promise<ReportOutput> {
    const report = await db('reports').where({ id: reportId, tenant_id: tenantId }).first();
    if (!report) throw new Error('Report not found');

    // Create output record
    const [output] = await db('report_outputs').insert({
      report_id: reportId, tenant_id: tenantId, status: 'generating',
    }).returning('*');

    // Generate async
    this.generateAsync(report, output.id).catch(() => {});

    return this.rowToOutput(output);
  }

  private async generateAsync(report: any, outputId: number) {
    try {
      await fs.mkdir(this.outputDir, { recursive: true });

      const data = await this.collectData(report);
      const tenantRow = await db('tenants').where({ id: report.tenant_id }).first();
      const tenantName = tenantRow?.name || `Tenant #${report.tenant_id}`;
      const filename = `report_${report.id}_${Date.now()}.${this.extForFormat(report.format)}`;
      const filePath = path.join(this.outputDir, filename);

      // string (json/csv/html) or Buffer (pdf/excel) — fs.writeFile handles both.
      let content: string | Buffer;
      switch (report.format) {
        case 'json':  content = JSON.stringify(data, null, 2); break;
        case 'csv':   content = this.toCSV(data); break;
        case 'html':  content = renderReportHtml(data, report, { tenantName }); break;
        case 'excel': content = await this.toXlsx(data, report); break;
        case 'pdf':   content = await this.toPdf(data, report, tenantName); break;
        default:      content = JSON.stringify(data, null, 2);
      }

      await fs.writeFile(filePath, content);
      const stat = await fs.stat(filePath);

      await db('report_outputs').where({ id: outputId }).update({
        status: 'ready', file_path: filePath,
        file_size_bytes: stat.size,
        generated_at: new Date(),
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      });

      await db('reports').where({ id: report.id }).update({ last_generated_at: new Date() });
    } catch (err: any) {
      await db('report_outputs').where({ id: outputId }).update({
        status: 'error', error_message: err?.message || 'Unknown error',
      });
    }
  }

  // Map the logical report format to the on-disk extension. Matters because
  // the download route (res.download) derives the Content-Type from the file
  // extension — a .excel or extensionless file downloads with the wrong MIME
  // and won't open in Excel/Acrobat.
  private extForFormat(format: string): string {
    switch (format) {
      case 'excel': return 'xlsx';
      case 'pdf':   return 'pdf';
      case 'html':  return 'html';
      case 'csv':   return 'csv';
      case 'json':  return 'json';
      default:      return 'txt';
    }
  }

  // jsonb columns come back from pg already parsed to objects/arrays; be
  // defensive for the odd text column by attempting a parse.
  private jval(v: any): any {
    if (v == null) return null;
    if (typeof v === 'string') { try { return JSON.parse(v); } catch { return null; } }
    return v;
  }

  // First real IPv4 addresses of a NIC list — drop IPv6, loopback and
  // link-local (169.254.x) so the report shows the machine's usable IP.
  private primaryIps(nics: any): string {
    if (!Array.isArray(nics)) return '';
    const ips: string[] = [];
    for (const n of nics) {
      for (const a of n?.addresses || []) {
        if (typeof a !== 'string' || a.includes(':')) continue;   // skip IPv6
        if (a.startsWith('169.254') || a.startsWith('127.')) continue; // link-local/loopback
        if (!ips.includes(a)) ips.push(a);
      }
    }
    return ips.join(', ');
  }

  // Sum disk capacities (bytes) → whole GB. disks[] entries carry `size`.
  private sumDiskGb(disks: any): number | null {
    if (!Array.isArray(disks) || disks.length === 0) return null;
    let bytes = 0;
    for (const d of disks) bytes += Number(d?.size ?? d?.sizeBytes ?? d?.capacity ?? 0) || 0;
    return bytes > 0 ? Math.round(bytes / 1073741824) : null;
  }

  // RAM total (GB): prefer live metrics (memory.totalMb, precise) then the
  // static inventory (memory.total bytes).
  private ramGb(mem: any, mt: any): number | null {
    const liveMb = mt?.memory?.totalMb;
    if (liveMb) return Math.round(Number(liveMb) / 1024);
    if (mem?.total) return Math.round(Number(mem.total) / 1073741824);
    return null;
  }

  // Disk capacity (GB): sum of live volume totals (reliable; static physical
  // `disks` is empty on most VMs) then fall back to static disk sizes.
  private diskGb(staticDisks: any, mt: any): number | null {
    const live = Array.isArray(mt?.disks) ? mt.disks : [];
    if (live.length) {
      const gb = live.reduce((s: number, dk: any) => s + (Number(dk.totalGb) || 0), 0);
      if (gb > 0) return Math.round(gb);
    }
    return this.sumDiskGb(staticDisks);
  }

  // Standardised OS label — "Windows Server 2022 Standard (21H2)" rather than
  // the raw jsonb. Falls back to the device row's os_version/os_type.
  private osLabel(os: any, d: any): string {
    const edition = String(os?.edition || '').replace(/^Microsoft\s+/i, '').trim();
    const ver = os?.displayVersion || '';
    if (edition) return ver ? `${edition} (${ver})` : edition;
    if (d?.os_version) return String(d.os_version);
    return d?.os_type ? String(d.os_type) : '';
  }

  // MAC(s) of the NIC(s) carrying a usable IPv4 (skip purely virtual/link-local).
  private primaryMacs(nics: any): string {
    if (!Array.isArray(nics)) return '';
    const macs: string[] = [];
    for (const n of nics) {
      const hasV4 = (n?.addresses || []).some((a: any) =>
        typeof a === 'string' && !a.includes(':') && !a.startsWith('169.254') && !a.startsWith('127.'));
      if (hasV4 && n?.mac && !macs.includes(n.mac)) macs.push(n.mac);
    }
    return macs.join(', ');
  }

  // Full parsed hardware for one server — feeds the "detailed" per-server cards.
  private buildHwDetail(d: any, r: any, mt: any, nameMap: Map<number, string>) {
    const cpu = this.jval(r?.cpu) || {};
    const mem = this.jval(r?.memory) || {};
    const os = this.jval(r?.os) || {};
    const nics = this.jval(r?.network_interfaces) || [];
    const gpu = this.jval(r?.gpu) || [];
    const mobo = this.jval(r?.motherboard) || {};
    const bios = this.jval(r?.bios) || {};
    const staticDisks = this.jval(r?.disks) || [];
    const live = Array.isArray(mt?.disks) ? mt.disks : [];
    return {
      device: nameMap.get(d.id) || `#${d.id}`,
      status: d.status,
      os: this.osLabel(os, d),
      osBuild: os?.buildNumber ? String(os.buildNumber) : '',
      cpu: cpu.model || '',
      cores: cpu.cores ?? null,
      threads: cpu.threads ?? null,
      speed: cpu.speed ?? null,
      ramGb: this.ramGb(mem, mt),
      ramSlots: Array.isArray(mem?.slots)
        ? mem.slots.filter((s: any) => Number(s?.size) > 0)
            .map((s: any) => ({ bank: s.bank || '', sizeGb: Math.round(Number(s.size) / 1073741824), type: s.type || '' }))
        : [],
      volumes: live.map((dk: any) => ({
        mount: dk.mount || '', totalGb: Math.round(Number(dk.totalGb) || 0),
        usedGb: Math.round(Number(dk.usedGb) || 0), pct: Math.round(Number(dk.percent) || 0),
      })).filter((v: any) => v.totalGb > 0),
      physicalDisks: Array.isArray(staticDisks)
        ? staticDisks.map((dk: any) => ({ model: dk.model || dk.device || '', sizeGb: Math.round(Number(dk.size || 0) / 1073741824), type: dk.type || '' }))
            .filter((x: any) => x.sizeGb > 0)
        : [],
      nics: Array.isArray(nics)
        ? nics.map((n: any) => ({
            name: n.name || '', mac: n.mac || '',
            ips: (n.addresses || []).filter((a: any) => typeof a === 'string' && !a.includes(':') && !a.startsWith('169.254') && !a.startsWith('127.')),
          })).filter((n: any) => n.name || n.ips.length)
        : [],
      gpu: Array.isArray(gpu) ? gpu.map((g: any) => String(g.name || '')).filter(Boolean) : [],
      motherboard: `${mobo.manufacturer || ''} ${mobo.model || ''}`.trim(),
      bios: `${bios.vendor || ''} ${bios.version || ''}`.trim(),
      scannedAt: r?.scanned_at || null,
    };
  }

  // Render a single cell value as text (CSV fallback / legacy). DB rows carry
  // JSON columns (objects/arrays) and Dates — stringify them so we never
  // emit "[object Object]".
  private cellValue(v: any): string {
    if (v == null) return '';
    if (v instanceof Date) return v.toISOString();
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }

  // Excel's hard per-cell limit. exceljs does NOT enforce it, so an oversized
  // cell (e.g. a whole compliance `results` jsonb blob) silently truncates on
  // open in Excel — cap it explicitly with a visible marker instead.
  private static readonly XLSX_CELL_MAX = 32767;

  // Cell value for the xlsx path — keep native number/boolean/Date types so
  // Excel treats numeric/date columns as sortable/summable numbers/dates
  // instead of "number stored as text". Only objects get stringified; strings
  // are passed through (no risky string→number coercion) but length-capped.
  private xlsxCell(v: any): string | number | boolean | Date {
    if (v == null) return '';
    if (v instanceof Date) return v;
    if (typeof v === 'number' || typeof v === 'boolean') return v;
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return s.length > ReportService.XLSX_CELL_MAX
      ? s.slice(0, ReportService.XLSX_CELL_MAX - 15) + '…[truncated]'
      : s;
  }

  // Render the rich report document to a real PDF via the system Chromium
  // (launchChromium resolves the executable + container-safe flags — same as
  // the device/hyperv PDF exports). Returns the PDF bytes; browser always closed.
  private async toPdf(data: Record<string, any>, report: any, tenantName: string): Promise<Buffer> {
    const html = renderReportHtml(data, report, { tenantName });
    const browser = await launchChromium();
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'domcontentloaded' });
      const pdf = await page.pdf({
        format: 'A4', landscape: true,
        margin: { top: '15mm', bottom: '15mm', left: '10mm', right: '10mm' },
        printBackground: true,
      });
      return Buffer.from(pdf);
    } finally {
      await browser.close();
    }
  }

  // Excel worksheet name rules: <=31 chars, none of []:*?/\, and unique
  // within the workbook. Sanitize + de-dup so exceljs never throws on a
  // section name.
  private sheetName(raw: string, used: Set<string>): string {
    let base = (raw || 'Sheet').replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Sheet';
    let name = base;
    let i = 2;
    while (used.has(name.toLowerCase())) {
      const suffix = ` (${i++})`;
      name = base.slice(0, 31 - suffix.length) + suffix;
    }
    used.add(name.toLowerCase());
    return name;
  }

  private async toXlsx(data: Record<string, any>, report: any): Promise<Buffer> {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Obliance';
    wb.created = new Date();

    const used = new Set<string>();
    let sheetsAdded = 0;
    for (const [section, rows] of Object.entries(data)) {
      if (!Array.isArray(rows) || rows.length === 0) continue;
      const ws = wb.addWorksheet(this.sheetName(section, used));
      const headers = Object.keys(rows[0]);
      ws.columns = headers.map((h) => ({ header: h, key: h, width: Math.min(40, Math.max(12, h.length + 2)) }));
      ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
      for (const row of rows) {
        const rec: Record<string, string | number | boolean | Date> = {};
        for (const h of headers) rec[h] = this.xlsxCell(row[h]);
        ws.addRow(rec);
      }
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
      sheetsAdded++;
    }

    // A workbook MUST have at least one sheet or Excel rejects the file.
    if (sheetsAdded === 0) {
      const ws = wb.addWorksheet('Report');
      ws.addRow([`${report.name} — no data for the selected scope`]);
    }

    const buffer = await wb.xlsx.writeBuffer();
    return Buffer.from(buffer as any);
  }

  private async collectData(report: any) {
    const sections: Record<string, any> = {};
    const sections_list: ReportSection[] = report.sections || [];

    let deviceIds: number[] = [];

    if (report.scope_type === 'device' && report.scope_id) {
      deviceIds = [report.scope_id];
    } else if (report.scope_type === 'group' && report.scope_id) {
      const descendants = await db('device_group_closure')
        .where({ ancestor_id: report.scope_id }).pluck('descendant_id');
      const devices = await db('devices').where({ tenant_id: report.tenant_id }).whereIn('group_id', descendants).pluck('id');
      deviceIds = devices;
    } else {
      const devices = await db('devices').where({ tenant_id: report.tenant_id }).pluck('id');
      deviceIds = devices;
    }

    const devices = await db('devices').where({ tenant_id: report.tenant_id }).whereIn('id', deviceIds);
    const deviceName = new Map<number, string>(devices.map((d: any) => [d.id, d.display_name || d.hostname || `#${d.id}`]));
    sections.devices = devices.map((d: any) => ({
      id: d.id, hostname: d.hostname, displayName: d.display_name,
      status: d.status, osType: d.os_type, osVersion: d.os_version,
      lastSeen: d.last_seen_at,
    }));

    const wantHw = sections_list.includes('hardware');
    const wantNet = sections_list.includes('network');
    const wantDetail = sections_list.includes('inventory_detail');
    if (wantHw || wantNet || wantDetail) {
      // device_inventory_hardware keeps ONE ROW PER SCAN (not upserted) → a
      // long-lived device accumulates thousands of near-identical rows. We want
      // the CURRENT state, so keep only the LATEST scan per device. Disk/RAM
      // capacity is read from live metrics (the static `disks` array is often
      // empty on VMs); everything is parsed into clean columns — never raw JSON
      // nor the Windows product key.
      const hwRows = await db('device_inventory_hardware')
        .whereIn('device_id', deviceIds)
        .orderBy('scanned_at', 'desc');
      const latest = new Map<number, any>();
      for (const r of hwRows) if (!latest.has(r.device_id)) latest.set(r.device_id, r);
      const metricsById = new Map<number, any>(devices.map((d: any) => [d.id, this.jval(d.latest_metrics) || {}]));

      // Flat inventory table — one row per server, columns chosen by which of
      // hardware / network was requested (aggregated into a SINGLE table).
      if (wantHw || wantNet) {
        sections.hardware = devices.map((d: any) => {
          const r = latest.get(d.id);
          const cpu = this.jval(r?.cpu) || {};
          const mem = this.jval(r?.memory) || {};
          const os = this.jval(r?.os) || {};
          const nics = this.jval(r?.network_interfaces) || [];
          const mt = metricsById.get(d.id) || {};
          const row: any = { device: deviceName.get(d.id) || `#${d.id}` };
          if (wantHw) {
            row.cpu = cpu.model || '';
            row.cores = cpu.cores ?? null;
            row.threads = cpu.threads ?? null;
            row.ram_gb = this.ramGb(mem, mt);
            row.disk_gb = this.diskGb(this.jval(r?.disks), mt);
            row.os = this.osLabel(os, d);
          }
          if (wantNet) {
            row.ipv4 = this.primaryIps(nics);
            row.mac = this.primaryMacs(nics);
            row.nics = Array.isArray(nics) ? nics.length : 0;
          }
          row.scanned_at = r?.scanned_at ?? null;
          return row;
        });
      }

      // Detailed per-server breakdown (only when the box is checked) — full
      // parsed hardware for the cards the renderer draws below the table.
      if (wantDetail) {
        sections.hardwareDetail = devices.map((d: any) =>
          this.buildHwDetail(d, latest.get(d.id), metricsById.get(d.id) || {}, deviceName));
      }
    }

    if (sections_list.includes('software')) {
      const sw = await db('device_inventory_software')
        .whereIn('device_id', deviceIds)
        .orderBy('name');
      sections.software = sw.map((s: any) => ({
        device: deviceName.get(s.device_id) || `#${s.device_id}`,
        name: s.name, version: s.version, publisher: s.publisher,
        install_date: s.install_date, source: s.source,
        // device_id → exact COUNT(DISTINCT device) per app in the catalog
        // (hidden from generic tables via HIDDEN_COLS; the software section
        // uses its own catalog renderer, not detailTable).
        device_id: s.device_id,
      }));
    }

    if (sections_list.includes('updates')) {
      const updates = await db('device_updates')
        .where({ tenant_id: report.tenant_id })
        .whereIn('device_id', deviceIds)
        .whereIn('status', ['available', 'approved', 'failed']);
      sections.updates = updates.map((u: any) => ({
        device: deviceName.get(u.device_id) || `#${u.device_id}`,
        title: u.title, severity: u.severity, status: u.status,
        category: u.category, requires_reboot: u.requires_reboot,
        // keep raw fields the renderer's metrics read (device_id/severity/requires_reboot)
        device_id: u.device_id,
      }));
    }

    if (sections_list.includes('compliance')) {
      const compliance = await db('compliance_results')
        .where({ tenant_id: report.tenant_id })
        .whereIn('device_id', deviceIds)
        .orderBy('checked_at', 'desc');
      // compliance_results is INSERT-per-scan (full history), like hardware —
      // keep only the LATEST row per (device, policy) or the table/exports fill
      // with duplicate historical scans and the count is wrong.
      const seenCp = new Set<string>();
      const latestCp = compliance.filter((c: any) => {
        const k = `${c.device_id}:${c.policy_id}`;
        if (seenCp.has(k)) return false;
        seenCp.add(k);
        return true;
      });
      // Attach hostname for the detail table but KEEP device_id/policy_id/
      // compliance_score/results — the renderer's metrics read those.
      sections.compliance = latestCp.map((c: any) => ({
        device: deviceName.get(c.device_id) || `#${c.device_id}`,
        compliance_score: c.compliance_score,
        checked_at: c.checked_at,
        device_id: c.device_id, policy_id: c.policy_id, results: c.results,
      }));
    }

    if (sections_list.includes('scripts_history')) {
      const execs = await db('script_executions')
        .where({ tenant_id: report.tenant_id })
        .whereIn('device_id', deviceIds)
        .orderBy('triggered_at', 'desc')
        .limit(500);
      // NEVER export script_snapshot (full source), parameter_values (may hold
      // secrets), stdout or stderr — a report is a shareable artifact. Only the
      // script NAME + outcome.
      sections.scriptHistory = execs.map((e: any) => ({
        device: deviceName.get(e.device_id) || `#${e.device_id}`,
        script: (this.jval(e.script_snapshot) || {}).name || '',
        status: e.status,
        exit_code: e.exit_code,
        triggered_at: e.triggered_at,
      }));
    }

    return sections;
  }

  // RFC-4180 field: always quote and double any internal quote. cellValue()
  // first turns objects/arrays/Dates into a flat string, so a nested cell (e.g.
  // compliance.results, hardwareDetail arrays) becomes ONE quoted field — its
  // internal commas no longer split the row. (JSON.stringify alone left array/
  // object cells unquoted at the CSV level, corrupting column alignment.)
  private csvField(v: any): string {
    return `"${this.cellValue(v).replace(/"/g, '""')}"`;
  }

  private toCSV(data: Record<string, any>): string {
    const lines: string[] = [];
    for (const [section, rows] of Object.entries(data)) {
      if (!Array.isArray(rows) || !rows.length) continue;
      lines.push(`## ${section}`);
      const headers = Object.keys(rows[0]);
      lines.push(headers.map((h) => this.csvField(h)).join(','));
      for (const row of rows) {
        lines.push(headers.map((h) => this.csvField(row[h])).join(','));
      }
      lines.push('');
    }
    return lines.join('\n');
  }

  async getOutputs(reportId: number, tenantId: number) {
    const rows = await db('report_outputs')
      .where({ report_id: reportId, tenant_id: tenantId })
      .orderBy('created_at', 'desc')
      .limit(20);
    return rows.map((r) => this.rowToOutput(r));
  }

  // Manually cancel an output stuck in 'generating'. The generation runs
  // fire-and-forget (generateAsync().catch()), so if the server process
  // dies mid-generation the row never resolves. `report_status` has no
  // 'cancelled' value — we mark it 'error' with a clear message so the
  // existing error rendering (badge + message) shows why it stopped.
  // Only 'generating' rows can be cancelled: a finished 'ready' output
  // must be deleted via deleteReport, not silently flipped to error.
  async cancelOutput(outputId: number, tenantId: number): Promise<ReportOutput | null> {
    const [row] = await db('report_outputs')
      .where({ id: outputId, tenant_id: tenantId, status: 'generating' })
      .update({ status: 'error', error_message: 'Cancelled by user' })
      .returning('*');
    return row ? this.rowToOutput(row) : null;
  }

  // Startup + periodic sweep: any output left in 'generating' for longer
  // than the cutoff is orphaned (the process that would have completed it
  // is gone — a restart/redeploy killed the in-flight generateAsync).
  // Without this a stuck row polls "generating" forever and survives every
  // rebuild. Real generations finish in seconds, so a 15-min floor never
  // races a legitimate in-flight job.
  async sweepStaleGenerating(maxAgeMinutes = 15): Promise<number> {
    const cutoff = new Date(Date.now() - maxAgeMinutes * 60 * 1000);
    const n = await db('report_outputs')
      .where('status', 'generating')
      .where('created_at', '<', cutoff)
      .update({ status: 'error', error_message: 'Generation interrupted (server restart or timeout)' });
    if (n > 0) logger.info(`[reports] Swept ${n} stale 'generating' report output(s)`);
    return n;
  }

  async deleteReport(id: number, tenantId: number) {
    const outputs = await db('report_outputs').where({ report_id: id, tenant_id: tenantId });
    for (const o of outputs) {
      if (o.file_path) fs.unlink(o.file_path).catch(() => {});
    }
    await db('reports').where({ id, tenant_id: tenantId }).delete();
  }
}

export const reportService = new ReportService();
