import { db } from '../db';
import path from 'path';
import fs from 'fs/promises';
import type { Report, ReportOutput, ReportSection } from '@obliance/shared';

class ReportService {
  private outputDir = path.join(process.cwd(), 'custom', 'reports');

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

  async getReports(tenantId: number) {
    const rows = await db('reports').where({ tenant_id: tenantId }).orderBy('name');
    return rows.map(this.rowToReport.bind(this));
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

    return output;
  }

  private async generateAsync(report: any, outputId: number) {
    try {
      await fs.mkdir(this.outputDir, { recursive: true });

      const data = await this.collectData(report);
      const filename = `report_${report.id}_${Date.now()}.${report.format}`;
      const filePath = path.join(this.outputDir, filename);

      let content: string;
      if (report.format === 'json') {
        content = JSON.stringify(data, null, 2);
      } else if (report.format === 'csv') {
        content = this.toCSV(data);
      } else {
        content = JSON.stringify(data, null, 2); // fallback, PDF/Excel need libs
      }

      await fs.writeFile(filePath, content, 'utf-8');
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
    sections.devices = devices.map((d: any) => ({
      id: d.id, hostname: d.hostname, displayName: d.display_name,
      status: d.status, osType: d.os_type, osVersion: d.os_version,
      lastSeen: d.last_seen_at,
    }));

    if (sections_list.includes('hardware')) {
      const hw = await db('device_inventory_hardware')
        .whereIn('device_id', deviceIds)
        .orderBy('scanned_at', 'desc');
      sections.hardware = hw;
    }

    if (sections_list.includes('software')) {
      const sw = await db('device_inventory_software')
        .whereIn('device_id', deviceIds)
        .orderBy('name');
      sections.software = sw;
    }

    if (sections_list.includes('updates')) {
      const updates = await db('device_updates')
        .where({ tenant_id: report.tenant_id })
        .whereIn('device_id', deviceIds)
        .whereIn('status', ['available', 'approved', 'failed']);
      sections.updates = updates;
    }

    if (sections_list.includes('compliance')) {
      const compliance = await db('compliance_results')
        .where({ tenant_id: report.tenant_id })
        .whereIn('device_id', deviceIds)
        .orderBy('checked_at', 'desc');
      sections.compliance = compliance;
    }

    if (sections_list.includes('scripts_history')) {
      const execs = await db('script_executions')
        .where({ tenant_id: report.tenant_id })
        .whereIn('device_id', deviceIds)
        .orderBy('triggered_at', 'desc')
        .limit(500);
      sections.scriptHistory = execs;
    }

    return sections;
  }

  private toCSV(data: Record<string, any>): string {
    const lines: string[] = [];
    for (const [section, rows] of Object.entries(data)) {
      if (!Array.isArray(rows) || !rows.length) continue;
      lines.push(`## ${section}`);
      const headers = Object.keys(rows[0]);
      lines.push(headers.join(','));
      for (const row of rows) {
        lines.push(headers.map(h => JSON.stringify(row[h] ?? '')).join(','));
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
    return rows;
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
