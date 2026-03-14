import type { NotificationPlugin, NotificationPayload } from '../types';

export const slackPlugin: NotificationPlugin = {
  type: 'slack',
  name: 'Slack',
  description: 'Send to a Slack channel via webhook',
  configFields: [
    { key: 'webhookUrl', label: 'Slack Webhook URL', type: 'url', required: true, placeholder: 'https://hooks.slack.com/services/...' },
    { key: 'channel', label: 'Channel (optional)', type: 'text', placeholder: '#monitoring' },
  ],

  async send(config, payload) {
    const slackIcons: Record<string,string> = { up: ':white_check_mark:', alert: ':large_orange_circle:', ssl_warning: ':warning:', inactive: ':black_circle:', value_changed: ':arrows_counterclockwise:' };
    const icon = slackIcons[payload.newStatus] ?? ':red_circle:';
    const colorMap: Record<string,string> = { up: '#2ecc71', alert: '#e67e22', ssl_warning: '#f39c12', ssl_expired: '#e74c3c', inactive: '#95a5a6', value_changed: '#3498db' };
    const color = colorMap[payload.newStatus] ?? '#e74c3c';

    const body: Record<string, unknown> = {
      attachments: [{
        color,
        blocks: [{
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `${icon} *${payload.monitorName}*\nStatus: *${payload.oldStatus}* → *${payload.newStatus}*${payload.message ? `\n${payload.message}` : ''}`,
          },
        }],
      }],
    };
    if (config.channel) body.channel = config.channel;

    const res = await fetch(String(config.webhookUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Slack returned ${res.status}`);
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
