import type { NotificationPlugin, NotificationPayload } from '../types';

export const webhookPlugin: NotificationPlugin = {
  type: 'webhook',
  name: 'Webhook',
  description: 'Send JSON POST to a URL',
  configFields: [
    { key: 'url', label: 'Webhook URL', type: 'url', required: true, placeholder: 'https://...' },
    { key: 'secret', label: 'Secret Header (optional)', type: 'password', placeholder: 'Bearer token or secret' },
  ],

  async send(config, payload) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (config.secret) headers['Authorization'] = String(config.secret);

    const res = await fetch(String(config.url), {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Webhook returned ${res.status}`);
  },

  async sendTest(config) {
    await this.send(config, {
      monitorName: 'Test Monitor',
      oldStatus: 'up',
      newStatus: 'down',
      message: 'This is a test notification from Obliance',
      timestamp: new Date().toISOString(),
    });
  },
};
