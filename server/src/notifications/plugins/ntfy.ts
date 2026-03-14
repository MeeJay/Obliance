import type { NotificationPlugin, NotificationPayload } from '../types';
import { statusIcon } from '../statusIcons';

export const ntfyPlugin: NotificationPlugin = {
  type: 'ntfy',
  name: 'ntfy',
  description: 'Send via ntfy.sh or self-hosted ntfy',
  configFields: [
    { key: 'serverUrl', label: 'Server URL', type: 'url', required: true, placeholder: 'https://ntfy.sh' },
    { key: 'topic', label: 'Topic', type: 'text', required: true, placeholder: 'my-monitoring' },
    { key: 'token', label: 'Access Token (optional)', type: 'password' },
    { key: 'priority', label: 'Priority (1-5)', type: 'number', placeholder: '3' },
  ],

  async send(config, payload) {
    const icon = statusIcon(payload.newStatus);
    const prefix = payload.appName || 'Obliance';
    const url = `${String(config.serverUrl).replace(/\/$/, '')}/${config.topic}`;
    const headers: Record<string, string> = { 'Content-Type': 'text/plain' };
    if (config.token) headers['Authorization'] = `Bearer ${config.token}`;

    const priority = String(config.priority || '3');
    headers['X-Priority'] = priority;
    headers['X-Title'] = `[${prefix}] ${icon} ${payload.monitorName}`;
    if (config.tags) { const tagMap: Record<string,string> = { up: 'white_check_mark', alert: 'large_orange_circle', ssl_warning: 'warning', inactive: 'black_circle', value_changed: 'arrows_counterclockwise' }; headers['X-Tags'] = tagMap[payload.newStatus] ?? 'rotating_light'; }

    const body = `${payload.oldStatus} → ${payload.newStatus}${payload.message ? `\n${payload.message}` : ''}`;

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`ntfy returned ${res.status}`);
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
