import { useEffect, useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
import { clsx } from 'clsx';
import { notificationsApi } from '@/api/notifications.api';
import type { NotificationChannel, AutomationNotificationBinding, AutomationNotificationMode } from '@obliance/shared';

interface Props {
  value: AutomationNotificationBinding[];
  onChange: (next: AutomationNotificationBinding[]) => void;
}

const MODE_LABELS: Record<AutomationNotificationMode, string> = {
  on_error: 'On error',
  summary: 'Summary',
};

/**
 * Reusable notification channels selector — same visual language as the
 * Obliview "NOTIFICATION CHANNELS" panel. Each row represents a tenant
 * channel. When bound, a mode selector appears (on_error | summary).
 */
export function NotificationChannelBindings({ value, onChange }: Props) {
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
      onChange([...value, { channelId, mode: 'on_error' }]);
    }
  };

  const setMode = (channelId: number, mode: AutomationNotificationMode) => {
    onChange(value.map((b) => b.channelId === channelId ? { ...b, mode } : b));
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold text-text-muted uppercase tracking-widest">
        <Bell className="w-3 h-3" />
        Notification channels
      </div>

      {loading ? (
        <p className="text-xs text-text-muted py-2">Loading channels...</p>
      ) : channels.length === 0 ? (
        <p className="text-xs text-text-muted py-2">
          No notification channels configured. Create one in Admin → Users → Notifications first.
        </p>
      ) : (
        <div className="rounded-lg border border-border bg-bg-secondary overflow-hidden">
          {channels.map((ch) => {
            const binding = bindingFor(ch.id);
            const bound = !!binding;
            return (
              <div
                key={ch.id}
                className={clsx(
                  'flex items-center gap-3 px-4 py-3 border-b border-border last:border-b-0 transition-colors',
                  bound ? 'bg-accent/[0.03]' : '',
                )}
              >
                {bound ? (
                  <Bell className="w-4 h-4 text-accent shrink-0" />
                ) : (
                  <BellOff className="w-4 h-4 text-text-muted/60 shrink-0" />
                )}

                <div className="flex-1 min-w-0">
                  <div className="text-sm text-text-primary font-medium truncate">{ch.name}</div>
                  <div className="text-[11px] text-text-muted">{ch.type}</div>
                </div>

                {bound && (
                  <div className="flex items-center rounded-full bg-bg-tertiary border border-border overflow-hidden shrink-0">
                    {(['on_error', 'summary'] as AutomationNotificationMode[]).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setMode(ch.id, m)}
                        className={clsx(
                          'px-3 py-1 text-[11px] font-medium transition-colors',
                          binding?.mode === m
                            ? 'bg-accent text-white'
                            : 'text-text-muted hover:text-text-primary',
                        )}
                      >
                        {MODE_LABELS[m]}
                      </button>
                    ))}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => toggleBind(ch.id)}
                  className={clsx(
                    'shrink-0 px-3 py-1 text-[11px] font-medium rounded-full border transition-colors',
                    bound
                      ? 'border-orange-400/50 text-orange-400 hover:bg-orange-400/10'
                      : 'border-border text-text-muted hover:text-text-primary hover:border-accent/40',
                  )}
                >
                  {bound ? 'Unbind' : 'Bind'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
