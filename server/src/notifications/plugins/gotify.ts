import type { NotificationPlugin, NotificationPayload } from '../types';
import { statusIcon } from '../statusIcons';

export const gotifyPlugin: NotificationPlugin = {
  type: 'gotify',
  name: 'Gotify',
  description: 'Send via Gotify push notification server',
  configFields: [
    { key: 'serverUrl', label: 'Server URL', type: 'url', required: true, placeholder: 'https://gotify.example.com' },
    { key: 'appToken', label: 'Application Token', type: 'password', required: true },
    { key: 'priority', label: 'Priority (0-10)', type: 'number', placeholder: '5' },
  ],

  async send(config, payload) {
    const icon = statusIcon(payload.newStatus);
    const prefix = payload.appName || 'Obliance';
    const url = `${String(config.serverUrl).replace(/\/$/, '')}/message`;

    const res = await fetch(`${url}?token=${config.appToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: `[${prefix}] ${icon} ${payload.monitorName}`,
        message: `${payload.oldStatus} → ${payload.newStatus}${payload.message ? `\n${payload.message}` : ''}`,
        priority: Number(config.priority) || 5,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Gotify returned ${res.status}`);
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
