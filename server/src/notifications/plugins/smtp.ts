import type { NotificationPlugin, NotificationPayload } from '../types';
import nodemailer from 'nodemailer';
import { statusIcon } from '../statusIcons';

// SECURITY: HTML-escape user-controlled strings before they land in the
// email body. Device names / monitor names / arbitrary message text
// are admin-editable AND originate from agents, so any of them can
// contain `<script>` or attribute-breaking quotes. Without this, a
// device renamed to `<img src=x onerror=…>` triggers in any mail
// client that renders HTML on receipt.
function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// URLs end up in `href`. We allow http/https only and strip everything
// else (including `javascript:`, `data:`, etc) → fall back to # to
// keep the link clickable but inert.
function safeHref(url: string): string {
  const u = String(url).trim();
  if (/^https?:\/\//i.test(u)) return escapeHtml(u);
  return '#';
}

export const smtpPlugin: NotificationPlugin = {
  type: 'smtp',
  name: 'Email (SMTP)',
  description: 'Send email notifications via a global SMTP server',
  configFields: [
    { key: 'smtpServerId', label: 'SMTP Server', type: 'smtp_server_select', required: true },
    { key: 'fromOverride', label: 'From Address Override', type: 'text', required: false, placeholder: 'Leave blank to use server default' },
    { key: 'to', label: 'To Address(es)', type: 'email_list', required: true, placeholder: 'admin@example.com' },
  ],

  // config here is the RESOLVED config (host/port/etc injected by resolveChannelConfig)
  async send(config, payload) {
    const icon = statusIcon(payload.newStatus);
    const transport = nodemailer.createTransport({
      host: String(config.host),
      port: Number(config.port),
      secure: Boolean(config.secure),
      auth: {
        user: String(config.username),
        pass: String(config.password),
      },
    });

    await transport.sendMail({
      from: String(config.from),
      to: String(config.to),
      subject: `${icon} ${payload.monitorName} is ${payload.newStatus.toUpperCase()}`,
      text: [
        `Monitor: ${payload.monitorName}`,
        `Status: ${payload.oldStatus} → ${payload.newStatus}`,
        payload.message ? `Message: ${payload.message}` : '',
        payload.monitorUrl ? `URL: ${payload.monitorUrl}` : '',
        `Time: ${payload.timestamp}`,
      ].filter(Boolean).join('\n'),
      html: [
        `<h2>${escapeHtml(icon)} ${escapeHtml(payload.monitorName)}</h2>`,
        `<p><strong>Status:</strong> ${escapeHtml(payload.oldStatus)} → <strong>${escapeHtml(payload.newStatus.toUpperCase())}</strong></p>`,
        payload.message ? `<p>${escapeHtml(payload.message)}</p>` : '',
        payload.monitorUrl ? `<p><a href="${safeHref(payload.monitorUrl)}">${escapeHtml(payload.monitorUrl)}</a></p>` : '',
        `<p><small>${escapeHtml(payload.timestamp)}</small></p>`,
      ].filter(Boolean).join('\n'),
    });
  },

  async sendTest(config) {
    await this.send(config, {
      monitorName: 'Test Monitor',
      oldStatus: 'up',
      newStatus: 'down',
      message: 'Test from Obliance',
      timestamp: new Date().toISOString(),
    });
  },
};
