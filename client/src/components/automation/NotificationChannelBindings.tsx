import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bell, BellOff } from 'lucide-react';
import { clsx } from 'clsx';
import { notificationsApi } from '@/api/notifications.api';
import type { NotificationChannel, AutomationNotificationBinding, AutomationNotificationMode } from '@obliance/shared';

interface Props {
 value: AutomationNotificationBinding[];
 onChange: (next: AutomationNotificationBinding[]) => void;
}

/**
 * Reusable notification channels selector. Drops into the scenario node
 * sidebar (narrow column) and the schedule form (wide column) without
 * overflow: channel name on its own line, mode pills + bind button on
 * a second line that wraps cleanly inside a 250–350 px container.
 *
 * Mode vocabulary — what each picks up at dispatch time:
 *   - per_device  : one message per device that traverses the node /
 *                   schedule, fired as each device finishes.
 *   - summary     : a single aggregate message after the whole run
 *                   completes (OK: N / Failed: M).
 *
 * Legacy `on_error` is still accepted for read so older bindings keep
 * working; it's mapped to `per_device` for UI display.
 */
export function NotificationChannelBindings({ value, onChange }: Props) {
 const { t } = useTranslation();
 const [channels, setChannels] = useState<NotificationChannel[]>([]);
 const [loading, setLoading] = useState(true);

 useEffect(() => {
 notificationsApi.listChannels()
 .then(setChannels)
 .catch(() => setChannels([]))
 .finally(() => setLoading(false));
 }, []);

 const bindingFor = (channelId: number) => value.find((b) => b.channelId === channelId) || null;

 const toggleBind = (channelId: number) => {
 const current = bindingFor(channelId);
 if (current) {
 onChange(value.filter((b) => b.channelId !== channelId));
 } else {
 onChange([...value, { channelId, mode: 'per_device' }]);
 }
 };

 const setMode = (channelId: number, mode: AutomationNotificationMode) => {
 onChange(value.map((b) => b.channelId === channelId ? { ...b, mode } : b));
 };

 // UI normalises the legacy `on_error` mode to `per_device` so admins
 // see a single, current vocabulary. The server still accepts the
 // legacy string on the wire for backward compat.
 const displayMode = (m: AutomationNotificationMode): 'per_device' | 'summary' =>
 m === 'summary' ? 'summary' : 'per_device';

 const modeLabels: Record<'per_device' | 'summary', string> = {
 per_device: t('notifications.modePerDevice') || 'By device',
 summary: t('notifications.modeSummary') || 'Summary',
 };
 const modeHints: Record<'per_device' | 'summary', string> = {
 per_device: t('notifications.modePerDeviceHint') || 'Sends one alert per device as each one finishes.',
 summary: t('notifications.modeSummaryHint') || 'Sends one aggregate recap after every device has finished.',
 };

 return (
 <div className="space-y-2">
 <div className="flex items-center gap-1.5 text-[10px] font-semibold text-text-muted uppercase tracking-widest">
 <Bell className="w-3 h-3" />
 {t('notifications.channelsHeader') || 'Notification channels'}
 </div>

 {loading ? (
 <p className="text-xs text-text-muted py-2">{t('notifications.loadingChannels') || 'Loading channels...'}</p>
 ) : channels.length === 0 ? (
 <p className="text-xs text-text-muted py-2">
 {t('notifications.noChannels') || 'No notification channels configured. Create one in Admin → Users → Notifications first.'}
 </p>
 ) : (
 <div className="rounded-lg bg-bg-secondary overflow-hidden divide-y divide-bg-tertiary/40">
 {channels.map((ch) => {
 const binding = bindingFor(ch.id);
 const bound = !!binding;
 const cur = bound ? displayMode(binding.mode) : 'per_device';
 return (
 <div
 key={ch.id}
 className={clsx(
 'flex flex-col gap-2 px-3 py-2.5 transition-colors',
 bound ? 'bg-accent/[0.03]' : '',
 )}
 >
 {/* Row 1: bell + channel identity + bind/unbind on the right */}
 <div className="flex items-center gap-2 min-w-0">
 {bound ? (
 <Bell className="w-4 h-4 text-accent shrink-0" />
 ) : (
 <BellOff className="w-4 h-4 text-text-muted/60 shrink-0" />
 )}
 <div className="flex-1 min-w-0">
 <div className="text-sm text-text-primary font-medium truncate">{ch.name}</div>
 <div className="text-[11px] text-text-muted truncate">{ch.type}</div>
 </div>
 <button
 type="button"
 onClick={() => toggleBind(ch.id)}
 className={clsx(
 'shrink-0 px-2.5 py-1 text-[11px] font-medium rounded-full border transition-colors',
 bound
 ? 'border-orange-400/50 text-orange-400 hover:bg-orange-400/10'
 : 'border-accent/40 text-accent hover:bg-accent/10',
 )}
 >
 {bound
 ? (t('notifications.unbind') || 'Unbind')
 : (t('notifications.bind') || 'Bind')}
 </button>
 </div>

 {/* Row 2: mode pills — only when bound, lives under the
 channel name so it never overflows the sidebar. */}
 {bound && (
 <div className="flex flex-wrap items-center gap-1 pl-6">
 {(['per_device', 'summary'] as const).map((m) => (
 <button
 key={m}
 type="button"
 onClick={() => setMode(ch.id, m)}
 title={modeHints[m]}
 className={clsx(
 'px-2.5 py-0.5 text-[11px] font-medium rounded-full border transition-colors',
 cur === m
 ? 'bg-accent text-white border-accent'
 : 'border-bg-tertiary text-text-muted hover:text-text-primary hover:border-accent/40',
 )}
 >
 {modeLabels[m]}
 </button>
 ))}
 </div>
 )}
 </div>
 );
 })}
 </div>
 )}
 </div>
 );
}
