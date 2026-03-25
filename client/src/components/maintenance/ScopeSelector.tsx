import { useState, useEffect, useRef } from 'react';
import { Globe, Server, Folder, RefreshCw, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { DeviceGroup, Device, MaintenanceScope } from '@obliance/shared';
import { groupsApi } from '@/api/groups.api';
import { deviceApi } from '@/api/device.api';
import { cn } from '@/utils/cn';

// ── Public types ──────────────────────────────────────────────────────────────

export interface ScopeTarget {
  scopeType: MaintenanceScope;
  scopeId: number | null;
  /** Children to disable after creating the group-scoped window */
  disables?: Array<{ scopeType: 'device'; scopeId: number }>;
}

// ── Internal selection state ──────────────────────────────────────────────────

interface Selection {
  global: boolean;
  /** Device groups whose entire content is selected */
  groupIds: Set<number>;
  /** Devices explicitly excluded from a selected parent group */
  deselectedDeviceIds: Set<number>;
  /** Devices selected individually (not via a group) */
  individualDeviceIds: Set<number>;
}

function emptySelection(): Selection {
  return {
    global: false,
    groupIds: new Set(),
    deselectedDeviceIds: new Set(),
    individualDeviceIds: new Set(),
  };
}

function cloneSelection(s: Selection): Selection {
  return {
    global: s.global,
    groupIds: new Set(s.groupIds),
    deselectedDeviceIds: new Set(s.deselectedDeviceIds),
    individualDeviceIds: new Set(s.individualDeviceIds),
  };
}

function resolveTargets(
  sel: Selection,
  devicesByGroup: Map<number, Device[]>,
): ScopeTarget[] {
  if (sel.global) return [{ scopeType: 'global', scopeId: null }];

  const targets: ScopeTarget[] = [];

  for (const gId of sel.groupIds) {
    const disables = (devicesByGroup.get(gId) ?? [])
      .filter((d) => sel.deselectedDeviceIds.has(d.id))
      .map((d) => ({ scopeType: 'device' as const, scopeId: d.id }));
    targets.push({ scopeType: 'group', scopeId: gId, disables: disables.length ? disables : undefined });
  }

  for (const dId of sel.individualDeviceIds) {
    targets.push({ scopeType: 'device', scopeId: dId });
  }

  return targets;
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  defaultScopeType?: MaintenanceScope;
  defaultScopeId?: number;
  onChange: (targets: ScopeTarget[]) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ScopeSelector({ defaultScopeType, defaultScopeId, onChange }: Props) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<DeviceGroup[]>([]);
  const [devicesByGroup, setDevicesByGroup] = useState<Map<number, Device[]>>(new Map());
  const [ungroupedDevices, setUngroupedDevices] = useState<Device[]>([]);
  const [sel, setSel] = useState<Selection>(emptySelection());

  // Ref for the scrollable column — used by auto-scroll on pre-selection
  const deviceScrollRef = useRef<HTMLDivElement>(null);

  // ── Load data once on mount ────────────────────────────────────────────────

  useEffect(() => {
    let mounted = true;
    Promise.all([groupsApi.list(), deviceApi.list({ approvalStatus: 'approved' })])
      .then(([grps, devices]) => {
        if (!mounted) return;

        const dByGroup = new Map<number, Device[]>();
        const ungD: Device[] = [];
        for (const d of devices) {
          if (d.groupId !== null) {
            if (!dByGroup.has(d.groupId)) dByGroup.set(d.groupId, []);
            dByGroup.get(d.groupId)!.push(d);
          } else {
            ungD.push(d);
          }
        }

        // Sort everything alphabetically
        grps.sort((a, b) => a.name.localeCompare(b.name));
        dByGroup.forEach((arr) => arr.sort((a, b) => (a.displayName ?? a.hostname).localeCompare(b.displayName ?? b.hostname)));
        ungD.sort((a, b) => (a.displayName ?? a.hostname).localeCompare(b.displayName ?? b.hostname));

        setGroups(grps);
        setDevicesByGroup(dByGroup);
        setUngroupedDevices(ungD);
        setLoading(false);

        // Apply pre-selection if provided
        if (defaultScopeType && defaultScopeId !== undefined) {
          const init = emptySelection();
          if (defaultScopeType === 'global') {
            init.global = true;
          } else if (defaultScopeType === 'group') {
            init.groupIds.add(defaultScopeId);
          } else if (defaultScopeType === 'device') {
            init.individualDeviceIds.add(defaultScopeId);
          }
          setSel(init);
          onChange(resolveTargets(init, dByGroup));
        }
      })
      .catch(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-scroll to pre-selected element once data is loaded ───────────────
  useEffect(() => {
    if (loading || !defaultScopeType || defaultScopeId === undefined) return;

    const timer = setTimeout(() => {
      let key: string | null = null;

      if (defaultScopeType === 'group') {
        key = `group-${defaultScopeId}`;
      } else if (defaultScopeType === 'device') {
        key = `device-${defaultScopeId}`;
      }

      if (deviceScrollRef.current && key) {
        const el = deviceScrollRef.current.querySelector<HTMLElement>(`[data-item-key="${key}"]`);
        el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }, 60);

    return () => clearTimeout(timer);
  }, [loading]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Update helper ──────────────────────────────────────────────────────────

  function update(next: Selection) {
    setSel(next);
    onChange(resolveTargets(next, devicesByGroup));
  }

  // ── Toggle: Global ─────────────────────────────────────────────────────────

  function toggleGlobal() {
    if (sel.global) {
      update(emptySelection());
    } else {
      const next = emptySelection();
      next.global = true;
      update(next);
    }
  }

  // ── Toggle: All devices (column header) ───────────────────────────────────

  function toggleAllDevices() {
    const everyGroupSelected = groups.length > 0 && groups.every((g) => sel.groupIds.has(g.id));
    const everyUngroupedSelected = ungroupedDevices.every((d) => sel.individualDeviceIds.has(d.id));
    const allSelected = everyGroupSelected && everyUngroupedSelected;

    const next = cloneSelection(sel);
    next.global = false;

    if (allSelected) {
      for (const g of groups) {
        next.groupIds.delete(g.id);
        (devicesByGroup.get(g.id) ?? []).forEach((d) => next.deselectedDeviceIds.delete(d.id));
      }
      for (const d of ungroupedDevices) next.individualDeviceIds.delete(d.id);
    } else {
      for (const g of groups) {
        next.groupIds.add(g.id);
        (devicesByGroup.get(g.id) ?? []).forEach((d) => {
          next.individualDeviceIds.delete(d.id);
          next.deselectedDeviceIds.delete(d.id);
        });
      }
      for (const d of ungroupedDevices) next.individualDeviceIds.add(d.id);
    }
    update(next);
  }

  // ── Toggle: Device groups & children ──────────────────────────────────────

  function toggleGroup(gId: number) {
    const gDevices = devicesByGroup.get(gId) ?? [];
    const next = cloneSelection(sel);
    next.global = false;

    if (next.groupIds.has(gId)) {
      next.groupIds.delete(gId);
      gDevices.forEach((d) => next.deselectedDeviceIds.delete(d.id));
    } else {
      next.groupIds.add(gId);
      gDevices.forEach((d) => {
        next.individualDeviceIds.delete(d.id);
        next.deselectedDeviceIds.delete(d.id);
      });
    }
    update(next);
  }

  function toggleDeviceChild(deviceId: number, groupId: number) {
    const next = cloneSelection(sel);
    if (!next.groupIds.has(groupId)) return; // group not selected, noop

    if (next.deselectedDeviceIds.has(deviceId)) {
      next.deselectedDeviceIds.delete(deviceId);
    } else {
      next.deselectedDeviceIds.add(deviceId);
      const gDevices = devicesByGroup.get(groupId) ?? [];
      if (gDevices.length > 0 && gDevices.every((d) => next.deselectedDeviceIds.has(d.id))) {
        next.groupIds.delete(groupId);
        gDevices.forEach((d) => next.deselectedDeviceIds.delete(d.id));
      }
    }
    update(next);
  }

  function toggleIndividualDevice(deviceId: number) {
    const next = cloneSelection(sel);
    next.global = false;
    if (next.individualDeviceIds.has(deviceId)) next.individualDeviceIds.delete(deviceId);
    else next.individualDeviceIds.add(deviceId);
    update(next);
  }

  // ── State queries ──────────────────────────────────────────────────────────

  function groupState(gId: number): 'selected' | 'partial' | 'none' {
    if (!sel.groupIds.has(gId)) return 'none';
    const deselCount = (devicesByGroup.get(gId) ?? []).filter((d) => sel.deselectedDeviceIds.has(d.id)).length;
    return deselCount === 0 ? 'selected' : 'partial';
  }

  function isDeviceEffective(d: Device): boolean {
    if (sel.global) return true;
    if (d.groupId !== null && sel.groupIds.has(d.groupId)) return !sel.deselectedDeviceIds.has(d.id);
    return sel.individualDeviceIds.has(d.id);
  }

  function isDeviceExcluded(d: Device): boolean {
    return d.groupId !== null && sel.groupIds.has(d.groupId) && sel.deselectedDeviceIds.has(d.id);
  }

  const allDevicesSel =
    (groups.length > 0 || ungroupedDevices.length > 0) &&
    groups.every((g) => sel.groupIds.has(g.id)) &&
    ungroupedDevices.every((d) => sel.individualDeviceIds.has(d.id));

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-6 text-sm text-text-muted">
        <RefreshCw size={14} className="animate-spin" />
        {t('common.loading')}
      </div>
    );
  }

  return (
    <div className="space-y-2">

      {/* ── Global ────────────────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={toggleGlobal}
        className={cn(
          'w-full flex items-center gap-2.5 px-3 py-2 rounded-md border text-sm font-medium transition-all',
          sel.global
            ? 'bg-rose-600/20 border-rose-500/40 text-rose-300'
            : 'bg-bg-tertiary border-border text-text-secondary hover:border-rose-500/30 hover:text-text-primary',
        )}
      >
        <Globe size={14} className={sel.global ? 'text-rose-400' : 'text-text-muted'} />
        <span className="flex-1 text-left">{t('maintenance.scopeGlobalBtn')}</span>
        {sel.global && <Check size={13} className="text-rose-400 shrink-0" />}
      </button>

      {/* ── Devices column ────────────────────────────────────────────────── */}
      <div className="rounded-md border border-border flex flex-col overflow-hidden">
        {/* Column header — click to select/deselect all devices */}
        <button
          type="button"
          onClick={toggleAllDevices}
          className={cn(
            'flex items-center gap-2 px-2.5 py-1.5 border-b border-border text-xs font-semibold uppercase tracking-wider transition-colors shrink-0',
            allDevicesSel
              ? 'bg-blue-600/20 text-blue-300'
              : 'bg-bg-tertiary text-text-muted hover:bg-bg-hover hover:text-text-primary',
          )}
        >
          <Server size={11} className={allDevicesSel ? 'text-blue-400' : ''} />
          <span className="flex-1 text-left">{t('maintenance.colAgents')}</span>
          {allDevicesSel && <Check size={11} className="text-blue-400" />}
        </button>

        {/* Scrollable list */}
        <div ref={deviceScrollRef} className="overflow-y-auto max-h-52 p-1 space-y-px">
          {groups.length === 0 && ungroupedDevices.length === 0 && (
            <p className="text-xs text-text-muted px-2 py-3 text-center">{t('maintenance.noAgentsInList')}</p>
          )}

          {groups.map((g) => {
            const state = groupState(g.id);
            const gDevices = devicesByGroup.get(g.id) ?? [];
            return (
              <div key={g.id}>
                {/* Group row */}
                <button
                  type="button"
                  data-item-key={`group-${g.id}`}
                  onClick={() => toggleGroup(g.id)}
                  className={cn(
                    'w-full flex items-center gap-1.5 px-2 py-1 rounded text-sm text-left transition-colors',
                    state !== 'none'
                      ? 'bg-blue-600/20 text-blue-300'
                      : 'text-text-secondary hover:bg-white/5',
                  )}
                >
                  <Folder size={12} className={state !== 'none' ? 'text-blue-400 shrink-0' : 'text-text-muted shrink-0'} />
                  <span className="flex-1 truncate font-medium">{g.name}</span>
                  {state === 'partial' && (
                    <span className="text-[9px] text-blue-400/70 font-bold shrink-0 ml-1">{t('maintenance.partialLabel')}</span>
                  )}
                  {state === 'selected' && <Check size={11} className="text-blue-400 shrink-0" />}
                </button>

                {/* Device children */}
                {gDevices.map((d) => {
                  const excluded = isDeviceExcluded(d);
                  const effective = isDeviceEffective(d);
                  return (
                    <button
                      key={d.id}
                      type="button"
                      data-item-key={`device-${d.id}`}
                      onClick={() =>
                        state !== 'none'
                          ? toggleDeviceChild(d.id, g.id)
                          : toggleIndividualDevice(d.id)
                      }
                      className={cn(
                        'w-full flex items-center gap-1.5 pl-5 pr-2 py-0.5 rounded text-xs text-left transition-colors',
                        excluded
                          ? 'text-red-400/60 line-through bg-red-500/5 hover:bg-red-500/10'
                          : effective
                            ? 'bg-blue-600/10 text-blue-300/80'
                            : 'text-text-muted hover:bg-white/5',
                      )}
                    >
                      <Server size={10} className="shrink-0" />
                      <span className="truncate">{d.displayName ?? d.hostname}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}

          {/* Ungrouped devices */}
          {ungroupedDevices.length > 0 && (
            <>
              {groups.length > 0 && (
                <div className="px-2 pt-1.5 pb-0.5">
                  <span className="text-[9px] text-text-muted font-semibold uppercase tracking-wider">{t('maintenance.noGroupLabel')}</span>
                </div>
              )}
              {ungroupedDevices.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  data-item-key={`device-${d.id}`}
                  onClick={() => toggleIndividualDevice(d.id)}
                  className={cn(
                    'w-full flex items-center gap-1.5 px-2 py-0.5 rounded text-xs text-left transition-colors',
                    isDeviceEffective(d)
                      ? 'bg-blue-600/10 text-blue-300/80'
                      : 'text-text-muted hover:bg-white/5',
                  )}
                >
                  <Server size={10} className="shrink-0" />
                  <span className="truncate">{d.displayName ?? d.hostname}</span>
                </button>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
