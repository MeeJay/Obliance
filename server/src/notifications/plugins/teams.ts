import type { NotificationPlugin, NotificationPayload } from '../types';

interface StatusInfo {
  emoji: string;
  label: string;
  containerStyle: 'good' | 'attention' | 'warning' | 'emphasis' | 'default';
}

function getStatusInfo(status: string): StatusInfo {
  switch (status) {
    case 'up':
      return { emoji: '🟢', label: 'Up', containerStyle: 'good' };
    case 'down':
      return { emoji: '🔴', label: 'Down', containerStyle: 'attention' };
    case 'ssl_expired':
      return { emoji: '🔴', label: 'SSL Expired', containerStyle: 'attention' };
    case 'ssl_warning':
      return { emoji: '⚠️', label: 'SSL Warning', containerStyle: 'warning' };
    case 'value_changed':
      return { emoji: '🔄', label: 'Value Changed', containerStyle: 'emphasis' };
    case 'alert':
      return { emoji: '🟠', label: 'Alert', containerStyle: 'warning' };
    case 'inactive':
      return { emoji: '⚫', label: 'Inactive', containerStyle: 'default' };
    default:
      return { emoji: '❓', label: status, containerStyle: 'default' };
  }
}

function buildAdaptiveCard(payload: NotificationPayload): Record<string, unknown> {
  const { emoji, containerStyle } = getStatusInfo(payload.newStatus);

  const title = payload.isGroupNotification
    ? `${emoji} Group Alert — ${payload.groupName}`
    : `${emoji} ${payload.monitorName}`;

  const subtitle = payload.isGroupNotification
    ? `${payload.downMonitors?.length ?? 0} monitor(s) affected`
    : `${payload.oldStatus.toUpperCase()} → ${payload.newStatus.toUpperCase()}`;

  const facts: { title: string; value: string }[] = [];

  if (!payload.isGroupNotification) {
    facts.push({
      title: 'Status',
      value: `${payload.oldStatus.toUpperCase()} → ${payload.newStatus.toUpperCase()}`,
    });
  }

  if (payload.monitorUrl) {
    facts.push({ title: 'URL', value: payload.monitorUrl });
  }

  if (payload.message) {
    facts.push({ title: 'Details', value: payload.message });
  }

  if (payload.isGroupNotification && payload.downMonitors?.length) {
    facts.push({ title: 'Affected monitors', value: payload.downMonitors.join(', ') });
  }

  facts.push({
    title: 'Time',
    value: new Date(payload.timestamp).toLocaleString('fr-FR', {
      dateStyle: 'short',
      timeStyle: 'medium',
    }),
  });

  if (payload.appName) {
    facts.push({ title: 'Source', value: payload.appName });
  }

  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        contentUrl: null,
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body: [
            {
              type: 'Container',
              style: containerStyle,
              bleed: true,
              items: [
                {
                  type: 'ColumnSet',
                  columns: [
                    {
                      type: 'Column',
                      width: 'stretch',
                      items: [
                        {
                          type: 'TextBlock',
                          text: title,
                          weight: 'Bolder',
                          size: 'Medium',
                          wrap: true,
                        },
                        {
                          type: 'TextBlock',
                          text: subtitle,
                          spacing: 'None',
                          isSubtle: true,
                          wrap: true,
                        },
                      ],
                    },
                  ],
                },
              ],
            },
            ...(facts.length > 0
              ? [{ type: 'FactSet', facts }]
              : []),
          ],
          msteams: { width: 'Full' },
        },
      },
    ],
  };
}

export const teamsPlugin: NotificationPlugin = {
  type: 'teams',
  name: 'Microsoft Teams',
  description: 'Send to a Teams channel via Incoming Webhook (Adaptive Cards)',

  configFields: [
    {
      key: 'webhookUrl',
      label: 'Webhook URL',
      type: 'url',
      required: true,
      placeholder: 'https://xxx.webhook.office.com/webhookb2/...',
    },
  ],

  async send(config, payload) {
    const body = buildAdaptiveCard(payload);

    const res = await fetch(String(config.webhookUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Teams returned ${res.status}${text ? `: ${text}` : ''}`);
    }
  },

  async sendTest(config) {
    await this.send(config, {
      monitorName: 'Test Monitor',
      monitorUrl: 'https://example.com',
      oldStatus: 'up',
      newStatus: 'down',
      message: 'This is a test notification from Obliance',
      timestamp: new Date().toISOString(),
      appName: 'Obliance',
    });
  },
};
