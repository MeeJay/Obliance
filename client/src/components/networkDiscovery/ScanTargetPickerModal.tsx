import { useState, useEffect, useMemo } from 'react';
import { X, Search, Monitor, FolderOpen, Check, Wifi } from 'lucide-react';
import { deviceApi } from '@/api/device.api';
import type { Device } from '@obliance/shared';
import toast from 'react-hot-toast';
import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';

interface Props {
  onClose: () => void;
  onDispatch: (deviceIds: number[]) => Promise<void> | void;
}

type GroupKey = string; // "group:<id>" or "group:none"

interface GroupBucket {
  key: GroupKey;
  groupId: number | null;
  groupName: string;
  devices: Device[];
}

export function ScanTargetPickerModal({ onClose, onDispatch }: Props) {
  const { t } = useTranslation();

  const [loading, setLoading] = useState(true);
  const [devices, setDevices] = useState<Device[]>([]);
  const [query, setQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [dispatching, setDispatching] = useState(false);

  useEffect(() => {
    deviceApi.list({ status: 'online' })
      .then((rows) => setDevices(rows))
      .catch(() => toast.error(t('common.error')))
      .finally(() => setLoading(false));
  }, [t]);

  // Filter by query (hostname / displayName / group name / ip)
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return devices;
    return devices.filter((d) => {
      const haystack = [
        d.hostname,
        d.displayName,
        d.groupName,
        d.ipLocal,
        d.ipPublic,
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [devices, query]);

  // Bucket filtered devices by group, groups sorted alphabetically with
  // "Ungrouped" last.
  const buckets: GroupBucket[] = useMemo(() => {
    const map = new Map<GroupKey, GroupBucket>();
    for (const d of filtered) {
      const key: GroupKey = d.groupId ? `group:${d.groupId}` : 'group:none';
      if (!map.has(key)) {
        map.set(key, {
          key,
          groupId: d.groupId,
          groupName: d.groupName || (t('discovery.picker.ungrouped') || 'Ungrouped'),
          devices: [],
        });
      }
      map.get(key)!.devices.push(d);
    }
    for (const b of map.values()) {
      b.devices.sort((a, c) => (a.hostname || '').localeCompare(c.hostname || ''));
    }
    return Array.from(map.values()).sort((a, b) => {
      if (a.groupId === null) return 1;
      if (b.groupId === null) return -1;
      return a.groupName.localeCompare(b.groupName);
    });
  }, [filtered, t]);

  const toggle = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleGroup = (bucket: GroupBucket) => {
    const ids = bucket.devices.map((d) => d.id);
    const allSelected = ids.every((id) => selectedIds.has(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        ids.forEach((id) => next.delete(id));
      } else {
        ids.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const selectAllFiltered = () => {
    setSelectedIds(new Set(filtered.map((d) => d.id)));
  };

  const clearAll = () => setSelectedIds(new Set());

  const handleDispatch = async () => {
    if (selectedIds.size === 0) return;
    setDispatching(true);
    try {
      await onDispatch(Array.from(selectedIds));
      onClose();
    } finally {
      setDispatching(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="bg-bg-primary border border-border rounded-xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border flex-shrink-0">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">
              {t('discovery.picker.title') || 'Select agents to run the scan'}
            </h3>
            <p className="text-xs text-text-muted mt-0.5">
              {t('discovery.picker.subtitle') ||
                'Each selected agent scans its own local subnet. Pick one agent per site.'}
            </p>
          </div>
          <button onClick={onClose} className="p-1 text-text-muted hover:text-text-primary rounded">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search + select-all bar */}
        <div className="flex items-center gap-2 px-5 py-3 border-b border-border flex-shrink-0">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('discovery.picker.searchPlaceholder') || 'Type to filter by agent or group...'}
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-bg-secondary border border-border rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
            />
          </div>
          <button
            onClick={selectedIds.size > 0 ? clearAll : selectAllFiltered}
            className="px-2.5 py-1.5 text-xs font-medium bg-bg-secondary border border-border rounded-lg text-text-muted hover:text-accent hover:border-accent transition-colors"
          >
            {selectedIds.size > 0
              ? (t('discovery.picker.clearAll') || 'Clear')
              : (t('discovery.picker.selectAll', { count: filtered.length }) ||
                  `Select all (${filtered.length})`)}
          </button>
        </div>

        {/* Body — grouped list */}
        <div className="flex-1 overflow-y-auto px-3 py-2">
          {loading ? (
            <p className="text-xs text-text-muted py-6 text-center">{t('common.loading') || 'Loading...'}</p>
          ) : filtered.length === 0 ? (
            <p className="text-xs text-text-muted py-6 text-center">
              {devices.length === 0
                ? (t('discovery.noOnlineAgents') || 'No online agents available')
                : (t('discovery.picker.noMatch') || 'No agent matches the filter')}
            </p>
          ) : (
            buckets.map((b) => {
              const ids = b.devices.map((d) => d.id);
              const selectedInGroup = ids.filter((id) => selectedIds.has(id)).length;
              const allInGroup = selectedInGroup === ids.length;
              return (
                <div key={b.key} className="mb-2">
                  <button
                    onClick={() => toggleGroup(b)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-muted hover:text-accent transition-colors"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    <span className="flex-1 text-left">{b.groupName}</span>
                    <span className="text-[10px] text-text-muted/70 normal-case tracking-normal">
                      {selectedInGroup > 0 && `${selectedInGroup}/`}
                      {b.devices.length}
                    </span>
                    <span
                      className={clsx(
                        'w-3.5 h-3.5 rounded-sm border flex items-center justify-center',
                        allInGroup
                          ? 'bg-accent border-accent'
                          : selectedInGroup > 0
                            ? 'bg-accent/30 border-accent'
                            : 'border-text-muted/40',
                      )}
                    >
                      {allInGroup && <Check className="w-2.5 h-2.5 text-white" />}
                    </span>
                  </button>
                  <div className="space-y-0.5">
                    {b.devices.map((d) => {
                      const checked = selectedIds.has(d.id);
                      return (
                        <button
                          key={d.id}
                          onClick={() => toggle(d.id)}
                          className={clsx(
                            'w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left rounded transition-colors',
                            checked ? 'bg-accent/15 text-text-primary' : 'text-text-muted hover:bg-bg-secondary hover:text-text-primary',
                          )}
                        >
                          <span
                            className={clsx(
                              'w-3.5 h-3.5 rounded-sm border flex-shrink-0 flex items-center justify-center',
                              checked ? 'bg-accent border-accent' : 'border-text-muted/40',
                            )}
                          >
                            {checked && <Check className="w-2.5 h-2.5 text-white" />}
                          </span>
                          <Monitor className="w-3.5 h-3.5 flex-shrink-0" />
                          <span className="flex-1 truncate">{d.displayName || d.hostname || `#${d.id}`}</span>
                          {d.ipLocal && (
                            <span className="text-[10px] text-text-muted/70 font-mono flex-shrink-0">{d.ipLocal}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-border flex-shrink-0">
          <span className="text-xs text-text-muted">
            {selectedIds.size > 0
              ? (t('discovery.picker.selectedCount', { count: selectedIds.size }) ||
                  `${selectedIds.size} selected`)
              : (t('discovery.picker.selectHint') || 'Select one or more agents.')}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-text-muted hover:text-text-primary transition-colors"
            >
              {t('common.cancel') || 'Cancel'}
            </button>
            <button
              onClick={handleDispatch}
              disabled={selectedIds.size === 0 || dispatching}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-accent text-white rounded-lg hover:bg-accent/80 disabled:opacity-50 transition-colors"
            >
              <Wifi className={clsx('w-3.5 h-3.5', dispatching && 'animate-pulse')} />
              {t('discovery.picker.launch', { count: selectedIds.size }) ||
                `Launch scan on ${selectedIds.size} agent(s)`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
