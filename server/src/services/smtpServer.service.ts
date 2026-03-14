import { db } from '../db';
import nodemailer from 'nodemailer';
import type { SmtpServer } from '@obliance/shared';

interface SmtpServerRow {
  id: number;
  name: string;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  from_address: string;
  tenant_id: number | null;
  created_at: Date;
  updated_at: Date;
}

function rowToServer(row: SmtpServerRow): SmtpServer {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    host: row.host,
    port: row.port,
    secure: row.secure,
    username: row.username,
    fromAddress: row.from_address,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export const smtpServerService = {
  async list(tenantId?: number): Promise<SmtpServer[]> {
    const query = db<SmtpServerRow>('smtp_servers').orderBy('name');
    if (tenantId !== undefined) {
      query.where({ tenant_id: tenantId });
    } else {
      query.whereNull('tenant_id');
    }
    const rows = await query;
    return rows.map(rowToServer);
  },

  async getById(id: number): Promise<SmtpServerRow | null> {
    const row = await db<SmtpServerRow>('smtp_servers').where({ id }).first();
    return row || null;
  },

  async create(data: {
    name: string;
    host: string;
    port: number;
    secure: boolean;
    username: string;
    password: string;
    fromAddress: string;
    tenantId?: number;
  }): Promise<SmtpServer> {
    const [row] = await db<SmtpServerRow>('smtp_servers')
      .insert({
        name: data.name,
        host: data.host,
        port: data.port,
        secure: data.secure,
        username: data.username,
        password: data.password,
        from_address: data.fromAddress,
        tenant_id: data.tenantId ?? null,
      })
      .returning('*');
    return rowToServer(row);
  },

  async update(id: number, data: Partial<{
    name: string;
    host: string;
    port: number;
    secure: boolean;
    username: string;
    password: string;
    fromAddress: string;
  }>): Promise<SmtpServer | null> {
    const update: Record<string, unknown> = { updated_at: new Date() };
    if (data.name !== undefined) update.name = data.name;
    if (data.host !== undefined) update.host = data.host;
    if (data.port !== undefined) update.port = data.port;
    if (data.secure !== undefined) update.secure = data.secure;
    if (data.username !== undefined) update.username = data.username;
    if (data.password !== undefined) update.password = data.password;
    if (data.fromAddress !== undefined) update.from_address = data.fromAddress;

    const [row] = await db<SmtpServerRow>('smtp_servers').where({ id }).update(update).returning('*');
    return row ? rowToServer(row) : null;
  },

  async delete(id: number): Promise<boolean> {
    const count = await db('smtp_servers').where({ id }).del();
    return count > 0;
  },

  async test(id: number): Promise<void> {
    const row = await this.getById(id);
    if (!row) throw new Error('SMTP server not found');

    const transport = nodemailer.createTransport({
      host: row.host,
      port: row.port,
      secure: row.secure,
      auth: { user: row.username, pass: row.password },
    });

    await transport.verify();
  },

  /** Build a nodemailer transport config from a server row */
  async getTransportConfig(id: number): Promise<{ host: string; port: number; secure: boolean; username: string; password: string; fromAddress: string } | null> {
    const row = await this.getById(id);
    if (!row) return null;
    return {
      host: row.host,
      port: row.port,
      secure: row.secure,
      username: row.username,
      password: row.password,
      fromAddress: row.from_address,
    };
  },
};
