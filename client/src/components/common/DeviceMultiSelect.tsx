import { useEffect, useMemo, useState } from 'react';
import { Search, Check, FolderOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import { deviceApi } from '@/api/device.api';
import { anonymize } from '@/utils/anonymize';
import { deviceMatchesSearch } from '@/utils/deviceSearch';
import type { Device } from '@obliance/shared';

// Inline picker for selecting a list of specific devices — used by Schedule
// and Scenario "by device" target. Mirrors the GroupTreeMultiSelect pattern
// (controlled selectedIds + onChange) but loads the entire device list once
// and filters client-side via deviceSearch (same field set as /devices).

interface Props {
  selectedIds: number[];
  onChange: (ids: number[]) => void;
  /** Cap on the number of devices fetched. 5000 covers typical fleets;
   *  bump if your tenant runs larger. */
  maxDevices?: number;
}

export function DeviceMultiSelect({ selectedIds, onChange, maxDevices = 5000 }: Props) {
  const { t } = useTranslation();
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  useEffect(() => {
    deviceApi.listPaginated({ pageSize: maxDevices, approvalStatus: 'approved' })
      .then(r => setDevices(r.items))
      .catch(() => setDevices([]))
      .finally(() => setLoading(false));
  }, [maxDevices]);

  const filtered = useMemo(
    () => devices.filter(d => deviceMatchesSearch(d, query)),
    [devices, query],
  );

  const selected = new Set(selectedIds);
  const toggle = (id: number) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    onChange([...next]);
  };
  const selectAllFiltered = () => {
    const next = new Set(selected);
    for (const d of filtered) next.add(d.id);
    onChange([...next]);
  };
  const clearSelection = () => onChange([]);

  return (
    <div className="rounded-lg border border-border bg-bg-tertiary">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <Search className="w-3.5 h-3.5 text-text-muted shrink-0" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('devices.searchPlaceholder', 'Hostname, IP, user, UUID, OS, tag…')}
          className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted/60 focus:outline-none"
        />
        <span className="text-[11px] font-mono text-text-muted shrink-0">
          {selected.size} / {filtered.length}
        </span>
      </div>
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border text-[11px]">
        <button onClick={selectAllFiltered} className="text-accent hover:underline">
          {t('common.selectAll', 'Tout sélectionner')}{query && ` (${filtered.length})`}
        </button>
        <span className="text-text-muted/50">·</span>
        <button onClick={clearSelection} className="text-text-muted hover:text-text-primary">
          {t('common.clear', 'Tout déselectionner')}
        </button>
      </div>
      <div className="max-h-[280px] overflow-y-auto">
        {loading ? (
          <div className="px-3 py-3 text-sm text-text-muted">{t('common.loading', 'Chargement...')}</div>
        ) : filtered.length === 0 ? (
          <div className="px-3 py-3 text-sm text-text-muted">{t('devices.noMatch', 'Aucun appareil ne correspond')}</div>
        ) : (
          filtered.map(d => {
            const isSelected = selected.has(d.id);
            const label = anonymize(d.displayName || d.hostname);
            return (
              <button
                key={d.id}
                onClick={() => toggle(d.id)}
                className={clsx(
                  'w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-bg-hover',
                  isSelected && 'bg-accent/5',
                )}
              >
                <span className={clsx(
                  'w-4 h-4 rounded border flex items-center justify-center shrink-0',
                  isSelected ? 'bg-accent border-accent text-white' : 'border-border',
                )}>
                  {isSelected && <Check className="w-3 h-3" />}
                </span>
                <span className="text-sm text-text-primary truncate flex-1">{label}</span>
                {d.groupName && (
                  <span className="inline-flex items-center gap-1 text-[10px] text-text-muted shrink-0">
                    <FolderOpen className="w-3 h-3" />
                    <span className="truncate max-w-[120px]">{anonymize(d.groupName)}</span>
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
