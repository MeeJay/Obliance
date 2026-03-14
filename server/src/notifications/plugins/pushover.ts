import type { NotificationPlugin, NotificationPayload } from '../types';
import { statusIcon } from '../statusIcons';

export const pushoverPlugin: NotificationPlugin = {
  type: 'pushover',
  name: 'Pushover',
  description: 'Send via Pushover push notifications',
  configFields: [
    { key: 'userKey', label: 'User Key', type: 'password', required: true },
    { key: 'appToken', label: 'Application Token', type: 'password', required: true },
    { key: 'priority', label: 'Priority (-2 to 2)', type: 'number', placeholder: '0' },
  ],

  async send(config, payload) {
    const icon = statusIcon(payload.newStatus);
    const prefix = payload.appName || 'Obliance';

    const res = await fetch('https://api.pushover.net/1/messages.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: config.appToken,
        user: config.userKey,
        title: `[${prefix}] ${icon} ${payload.monitorName}`,
        message: `${payload.oldStatus} → ${payload.newStatus}${payload.message ? `\n${payload.message}` : ''}`,
        priority: Number(config.priority) || 0,
        url: payload.monitorUrl || undefined,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Pushover returned ${res.status}`);
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
