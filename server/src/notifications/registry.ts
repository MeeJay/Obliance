import type { NotificationPlugin } from './types';
import type { NotificationPluginMeta } from '@obliance/shared';
import { webhookPlugin } from './plugins/webhook';
import { discordPlugin } from './plugins/discord';
import { telegramPlugin } from './plugins/telegram';
import { slackPlugin } from './plugins/slack';
import { teamsPlugin } from './plugins/teams';
import { gotifyPlugin } from './plugins/gotify';
import { ntfyPlugin } from './plugins/ntfy';
import { pushoverPlugin } from './plugins/pushover';
import { smtpPlugin } from './plugins/smtp';
import { freemobilePlugin } from './plugins/freemobile';

const plugins = new Map<string, NotificationPlugin>();

// Register built-in plugins
[
  webhookPlugin,
  discordPlugin,
  telegramPlugin,
  slackPlugin,
  teamsPlugin,
  gotifyPlugin,
  ntfyPlugin,
  pushoverPlugin,
  smtpPlugin,
  freemobilePlugin,
].forEach((plugin) => {
  plugins.set(plugin.type, plugin);
});

export function getPlugin(type: string): NotificationPlugin | undefined {
  return plugins.get(type);
}

export function getAllPlugins(): NotificationPlugin[] {
  return Array.from(plugins.values());
}

export function getPluginMetas(): NotificationPluginMeta[] {
  return getAllPlugins().map((p) => ({
    type: p.type,
    name: p.name,
    description: p.description,
    configFields: p.configFields,
  }));
}

export function registerPlugin(plugin: NotificationPlugin): void {
  plugins.set(plugin.type, plugin);
}
