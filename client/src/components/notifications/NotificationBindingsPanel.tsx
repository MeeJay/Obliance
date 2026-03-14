import { useEffect, useState, useCallback } from 'react';
import { Bell, BellOff, ArrowDown, Check, Ban } from 'lucide-react';
import { notificationsApi } from '@/api/notifications.api';
import { cn } from '@/utils/cn';
import type { NotificationChannel, OverrideMode } from '@obliance/shared';
import toast from 'react-hot-toast';

interface ResolvedBinding {
  channelId: number;
  channelName: string;
  channelType: string;
  source: 'global' | 'group' | 'monitor' | 'agent';
  sourceId: number | null;
  sourceName: string;
  isDirect: boolean;
  isExcluded: boolean;
}

interface NotificationBindingsPanelProps {
  scope: 'group' | 'monitor' | 'agent';
  scopeId: number;
  title?: string;
}

export function NotificationBindingsPanel({ scope, scopeId, title }: NotificationBindingsPanelProps) {
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [resolved, setResolved] = useState<ResolvedBinding[]>([]);
  const [directBindings, setDirectBindings] = useState<Map<number, OverrideMode>>(new Map());
  const [overrideMode, setOverrideMode] = useState<OverrideMode>('merge');
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const [allChannels, resolvedBindings, scopeBindings] = await Promise.all([
        notificationsApi.listChannels(),
        notificationsApi.getResolvedBindings(scope, scopeId),
        notificationsApi.getBindings(scope, scopeId),
      ]);
      setChannels(allChannels);
      setResolved(resolvedBindings);

      // Map channelId → overrideMode for direct bindings
      const bindingMap = new Map<number, OverrideMode>();
      for (const b of scopeBindings) {
        bindingMap.set(b.channelId, b.overrideMode);
      }
      setDirectBindings(bindingMap);

      // Detect override mode from existing non-exclude direct bindings
      const replaceBinding = scopeBindings.find((b) => b.overrideMode === 'replace');
      if (replaceBinding) setOverrideMode('replace');
    } catch {
      // ignore
    }
    setLoading(false);
  }, [scope, scopeId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  /** Bind a channel at this scope (merge or current override mode) */
  const bindChannel = async (channelId: number) => {
    try {
      await notificationsApi.addBinding(channelId, scope, scopeId, overrideMode);
      toast.success('Binding added');
      await loadData();
    } catch {
      toast.error('Failed to add binding');
    }
  };

  /** Remove a direct binding (bound or exclude) */
  const removeDirectBinding = async (channelId: number) => {
    try {
      await notificationsApi.removeBinding(channelId, scope, scopeId);
      toast.success('Binding removed');
      await loadData();
    } catch {
      toast.error('Failed to remove binding');
    }
  };

  /** Exclude (unbind) an inherited channel at this scope */
  const excludeChannel = async (channelId: number) => {
    try {
      await notificationsApi.addBinding(channelId, scope, scopeId, 'exclude');
      toast.success('Channel excluded');
      await loadData();
    } catch {
      toast.error('Failed to exclude channel');
    }
  };

  const changeOverrideMode = async (mode: OverrideMode) => {
    setOverrideMode(mode);
    // Update all existing non-exclude direct bindings to the new mode
    for (const [channelId, bindMode] of directBindings) {
      if (bindMode === 'exclude') continue; // Don't change exclude bindings
      try {
        await notificationsApi.addBinding(channelId, scope, scopeId, mode);
      } catch {
        // ignore individual failures
      }
    }
    await loadData();
  };

  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-bg-secondary p-4">
        <div className="text-sm text-text-muted">Loading notifications...</div>
      </div>
    );
  }

  const resolvedMap = new Map(resolved.map((r) => [r.channelId, r]));

  // Check if there are any non-exclude direct bindings (for showing the override mode selector)
  const hasNonExcludeDirectBindings = Array.from(directBindings.values()).some((m) => m !== 'exclude');

  return (
    <div className="rounded-lg border border-border bg-bg-secondary p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide flex items-center gap-1.5">
          <Bell size={12} />
          {title || 'Notification Channels'}
        </h3>

        {hasNonExcludeDirectBindings && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-muted">Override:</span>
            <div className="inline-flex rounded-md border border-border overflow-hidden">
              <button
                onClick={() => changeOverrideMode('merge')}
                className={cn(
                  'px-2 py-0.5 text-xs font-medium transition-colors',
                  overrideMode === 'merge'
                    ? 'bg-accent text-white'
                    : 'bg-bg-tertiary text-text-secondary hover:text-text-primary',
                )}
              >
                Merge
              </button>
              <button
                onClick={() => changeOverrideMode('replace')}
                className={cn(
                  'px-2 py-0.5 text-xs font-medium transition-colors',
                  overrideMode === 'replace'
                    ? 'bg-orange-600 text-white'
                    : 'bg-bg-tertiary text-text-secondary hover:text-text-primary',
                )}
              >
                Replace
              </button>
            </div>
          </div>
        )}
      </div>

      {channels.length === 0 ? (
        <p className="text-sm text-text-muted">No notification channels configured.</p>
      ) : (
        <div className="space-y-2">
          {channels.map((channel) => {
            const directMode = directBindings.get(channel.id);
            const isDirect = directMode !== undefined;
            const isDirectExclude = directMode === 'exclude';
            const isDirectBound = isDirect && !isDirectExclude;
            const resolvedEntry = resolvedMap.get(channel.id);
            const isInherited = resolvedEntry && !resolvedEntry.isDirect && !resolvedEntry.isExcluded;

            // Determine visual state
            let icon: React.ReactNode;
            let rowStyle: string;
            let buttonLabel: string;
            let buttonStyle: string;
            let buttonAction: () => void;

            if (isDirectBound) {
              // Directly bound at this scope
              icon = <Bell size={14} className="shrink-0 text-accent" />;
              rowStyle = 'border-accent/40 bg-accent/5';
              buttonLabel = 'Bound';
              buttonStyle = 'bg-accent text-white hover:bg-accent/80';
              buttonAction = () => removeDirectBinding(channel.id);
            } else if (isDirectExclude) {
              // Excluded at this scope (unbind override)
              icon = <Ban size={14} className="shrink-0 text-orange-500" />;
              rowStyle = 'border-orange-500/30 bg-orange-500/5';
              buttonLabel = 'Excluded';
              buttonStyle = 'bg-orange-600 text-white hover:bg-orange-500';
              buttonAction = () => removeDirectBinding(channel.id);
            } else if (isInherited) {
              // Inherited from parent scope (not excluded) — show Unbind
              icon = <Check size={14} className="shrink-0 text-text-muted" />;
              rowStyle = 'border-border bg-bg-tertiary/50';
              buttonLabel = 'Unbind';
              buttonStyle = 'bg-orange-600/10 text-orange-600 hover:bg-orange-600/20';
              buttonAction = () => excludeChannel(channel.id);
            } else {
              // Not bound, not inherited — show Bind
              icon = <BellOff size={14} className="shrink-0 text-text-muted" />;
              rowStyle = 'border-border bg-bg-primary';
              buttonLabel = 'Bind';
              buttonStyle = 'bg-bg-tertiary text-text-secondary hover:bg-bg-hover hover:text-text-primary';
              buttonAction = () => bindChannel(channel.id);
            }

            return (
              <div
                key={channel.id}
                className={cn(
                  'flex items-center justify-between rounded-md border px-3 py-2',
                  rowStyle,
                )}
              >
                <div className="flex items-center gap-3 min-w-0">
                  {icon}

                  <div className="min-w-0">
                    <span className={cn(
                      'text-sm truncate block',
                      isDirectExclude ? 'text-text-muted line-through' : 'text-text-primary',
                    )}>
                      {channel.name}
                    </span>
                    <span className="text-xs text-text-muted">{channel.type}</span>
                    {isInherited && resolvedEntry && (
                      <span className="text-xs text-text-muted ml-2 inline-flex items-center gap-0.5">
                        <ArrowDown size={10} />
                        via {resolvedEntry.sourceName}
                      </span>
                    )}
                    {isDirectExclude && resolvedEntry && !resolvedEntry.isDirect && (
                      <span className="text-xs text-orange-500 ml-2 inline-flex items-center gap-0.5">
                        <Ban size={10} />
                        overrides {resolvedEntry.sourceName}
                      </span>
                    )}
                  </div>
                </div>

                <button
                  onClick={buttonAction}
                  className={cn(
                    'shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors',
                    buttonStyle,
                  )}
                >
                  {buttonLabel}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {overrideMode === 'replace' && hasNonExcludeDirectBindings && (
        <p className="mt-3 text-xs text-orange-500">
          Replace mode: inherited channels from parent scopes will be ignored.
        </p>
      )}
    </div>
  );
}
