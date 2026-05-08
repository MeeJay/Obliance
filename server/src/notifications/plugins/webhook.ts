import type { NotificationPlugin, NotificationPayload } from '../types';
import { assertPublicHttpUrl } from '../../utils/ssrfGuard';

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

    // SSRF guard — prevent admins (or a compromised tenant) from
    // pointing a webhook at internal infrastructure (Redis, Kubelet,
    // 169.254.169.254 cloud metadata, etc).
    const url = await assertPublicHttpUrl(String(config.url));
    const res = await fetch(url.toString(), {
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
