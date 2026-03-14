import type { NotificationPlugin, NotificationPayload } from '../types';
import { statusIcon } from '../statusIcons';

export const freemobilePlugin: NotificationPlugin = {
  type: 'freemobile',
  name: 'Free Mobile SMS',
  description: 'Send SMS via Free Mobile API (France)',
  configFields: [
    { key: 'userId', label: 'User ID', type: 'text', required: true, placeholder: '12345678' },
    { key: 'apiKey', label: 'API Key', type: 'password', required: true },
  ],

  async send(config, payload) {
    const icon = statusIcon(payload.newStatus);
    const prefix = payload.appName || 'Obliance';
    const msg = `[${prefix}] ${icon} ${payload.monitorName}: ${payload.oldStatus} → ${payload.newStatus}${payload.message ? ` - ${payload.message}` : ''}`;

    const params = new URLSearchParams({
      user: String(config.userId),
      pass: String(config.apiKey),
      msg,
    });

    const res = await fetch(`https://smsapi.free-mobile.fr/sendmsg?${params}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Free Mobile returned ${res.status}`);
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
