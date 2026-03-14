import { useState, useEffect } from 'react';
import { X, CalendarClock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type {
  MaintenanceWindow,
  CreateMaintenanceWindowRequest,
  MaintenanceScopeType,
  MaintenanceScheduleType,
  MaintenanceRecurrenceType,
} from '@obliance/shared';
import { cn } from '@/utils/cn';
import { maintenanceApi } from '@/api/maintenance.api';
import { ScopeSelector } from './ScopeSelector';
import type { ScopeTarget } from './ScopeSelector';

/**
 * Convert a UTC ISO string to the "YYYY-MM-DDTHH:MM" format expected by
 * <input type="datetime-local">, expressed in the browser's local timezone.
 * (The datetime-local input has no timezone concept — it always shows/reads
 *  local time, so we must convert accordingly.)
 */
function utcToLocalInput(isoString: string): string {
  const date = new Date(isoString);
  // getTimezoneOffset() returns minutes BEHIND UTC (negative for UTC+ zones)
  const localMs = date.getTime() - date.getTimezoneOffset() * 60_000;
  return new Date(localMs).toISOString().slice(0, 16);
}

const TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Moscow',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Australia/Sydney',
];

interface ChannelOption {
  id: number;
  name: string;
  type: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called for EDIT mode only — update the existing window */
  onSave: (data: CreateMaintenanceWindowRequest) => Promise<void>;
  /** Called after multi-create completes (CREATE mode) — parent should reload */
  onSaved?: () => void;
  initial?: MaintenanceWindow | null;
  /** scopeOptions is no longer used — kept for backward-compat callers */
  scopeOptions?: unknown[];
  channelOptions: ChannelOption[];
  /** Pre-select this scope when opening in CREATE mode */
  defaultScopeType?: MaintenanceScopeType;
  defaultScopeId?: number;
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">
      {children}
    </label>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        'w-full rounded-md border border-border bg-bg-tertiary px-3 py-2 text-sm text-text-primary',
        'focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent',
        props.className,
      )}
    />
  );
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement> & { children: React.ReactNode }) {
  return (
    <select
      {...props}
      className={cn(
        'w-full rounded-md border border-border bg-bg-tertiary px-3 py-2 text-sm text-text-primary',
        'focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent',
        props.className,
      )}
    />
  );
}

export function MaintenanceWindowModal({
  open,
  onClose,
  onSave,
  onSaved,
  initial,
  channelOptions,
  defaultScopeType,
  defaultScopeId,
}: Props) {
  const { t } = useTranslation();
  const isEdit = !!initial;

  // Translated day labels — computed here so they react to language changes
  const DAYS = [
    t('maintenance.dayMon'), t('maintenance.dayTue'), t('maintenance.dayWed'),
    t('maintenance.dayThu'), t('maintenance.dayFri'), t('maintenance.daySat'), t('maintenance.daySun'),
  ];

  // ── Schedule fields ───────────────────────────────────────────────────────
  const [name, setName] = useState('');
  const [scheduleType, setScheduleType] = useState<MaintenanceScheduleType>('one_time');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [startTime, setStartTime] = useState('02:00');
  const [endTime, setEndTime] = useState('04:00');
  const [recurrenceType, setRecurrenceType] = useState<MaintenanceRecurrenceType>('weekly');
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([]);
  const [timezone, setTimezone] = useState('UTC');
  const [notifyChannelIds, setNotifyChannelIds] = useState<number[]>([]);
  const [active, setActive] = useState(true);

  // ── Edit-mode scope fields (single scope, from the existing window) ───────
  const [editScopeType, setEditScopeType] = useState<MaintenanceScopeType>('device');
  const [editScopeId, setEditScopeId] = useState<number | ''>('');

  // ── Create-mode scope selection (multi-scope via ScopeSelector) ───────────
  const [scopeTargets, setScopeTargets] = useState<ScopeTarget[]>([]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // ── Reset form when opening ───────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    if (initial) {
      setName(initial.name);
      setScheduleType(initial.scheduleType);
      setStartAt(initial.startAt ? utcToLocalInput(initial.startAt) : '');
      setEndAt(initial.endAt ? utcToLocalInput(initial.endAt) : '');
      setStartTime(initial.startTime ?? '02:00');
      setEndTime(initial.endTime ?? '04:00');
      setRecurrenceType(initial.recurrenceType ?? 'weekly');
      setDaysOfWeek(initial.daysOfWeek ?? []);
      setTimezone(initial.timezone ?? 'UTC');
      setNotifyChannelIds(initial.notifyChannelIds ?? []);
      setActive(initial.active ?? true);
      setEditScopeType(initial.scopeType);
      setEditScopeId(initial.scopeId ?? '');
    } else {
      setName('');
      setScheduleType('one_time');
      setStartAt('');
      setEndAt('');
      setStartTime('02:00');
      setEndTime('04:00');
      setRecurrenceType('weekly');
      setDaysOfWeek([]);
      setTimezone('UTC');
      setNotifyChannelIds([]);
      setActive(true);
      setScopeTargets([]);
    }
    setError('');
  }, [open, initial]);

  const toggleDay = (d: number) =>
    setDaysOfWeek((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));

  const toggleChannel = (id: number) =>
    setNotifyChannelIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  // ── Build base window data (schedule fields) ──────────────────────────────
  function buildBaseData(): Omit<CreateMaintenanceWindowRequest, 'scopeType' | 'scopeId'> {
    return {
      name: name.trim(),
      scheduleType,
      startAt: scheduleType === 'one_time' ? new Date(startAt).toISOString() : null,
      endAt: scheduleType === 'one_time' ? new Date(endAt).toISOString() : null,
      startTime: scheduleType === 'recurring' ? startTime : null,
      endTime: scheduleType === 'recurring' ? endTime : null,
      recurrenceType: scheduleType === 'recurring' ? recurrenceType : null,
      daysOfWeek: scheduleType === 'recurring' && recurrenceType === 'weekly' ? daysOfWeek : null,
      timezone,
      notifyChannelIds,
      active,
    };
  }

  // ── Validate shared fields ────────────────────────────────────────────────
  function validateBase(): string | null {
    if (!name.trim()) return t('maintenance.validationName');
    if (scheduleType === 'one_time') {
      if (!startAt || !endAt) return t('maintenance.validationDates');
      if (new Date(startAt) >= new Date(endAt)) return t('maintenance.validationEndAfterStart');
    }
    if (scheduleType === 'recurring' && recurrenceType === 'weekly' && daysOfWeek.length === 0) {
      return t('maintenance.validationDays');
    }
    return null;
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const baseErr = validateBase();
    if (baseErr) return setError(baseErr);

    setSaving(true);
    setError('');

    try {
      if (isEdit) {
        // ── EDIT mode: single scope, delegate to parent ──────────────────
        await onSave({
          ...buildBaseData(),
          scopeType: editScopeType,
          scopeId: editScopeType === 'global' ? null : Number(editScopeId),
        });
        onClose();
      } else {
        // ── CREATE mode: one window per selected scope target ────────────
        if (scopeTargets.length === 0) {
          setSaving(false);
          return setError(t('maintenance.validationScope'));
        }

        const base = buildBaseData();
        for (const target of scopeTargets) {
          const created = await maintenanceApi.create({
            ...base,
            scopeType: target.scopeType,
            scopeId: target.scopeId,
          });
          // Disable for excluded children (e.g. agent deselected within a group)
          if (target.disables) {
            for (const d of target.disables) {
              await maintenanceApi.disableForScope(created.id, d.scopeType as 'group' | 'monitor' | 'agent', d.scopeId);
            }
          }
        }
        onSaved?.();
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('maintenance.failedSave'));
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl rounded-xl border border-border bg-bg-secondary shadow-2xl flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <CalendarClock size={18} className="text-accent" />
            <h2 className="text-base font-semibold text-text-primary">
              {isEdit ? t('maintenance.editTitle') : t('maintenance.newTitle')}
            </h2>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Body — scrollable */}
        <form onSubmit={handleSubmit} className="overflow-y-auto flex-1 px-5 py-4 space-y-4">

          {/* Name */}
          <div>
            <Label>{t('maintenance.fieldName')}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('maintenance.namePlaceholder')} />
          </div>

          {/* ── Scope ────────────────────────────────────────────────────── */}
          <div>
            <Label>{t('maintenance.fieldScope')}</Label>

            {isEdit ? (
              /* Edit mode: simple dropdowns (scope already set, allow changing) */
              <div className={cn('gap-3', editScopeType === 'global' ? 'flex' : 'grid grid-cols-2')}>
                <div className={editScopeType === 'global' ? 'w-1/2' : undefined}>
                  <Select
                    value={editScopeType}
                    onChange={(e) => { setEditScopeType(e.target.value as MaintenanceScopeType); setEditScopeId(''); }}
                  >
                    <option value="device">{t('common.device')}</option>
                    <option value="group">{t('common.group')}</option>
                    <option value="global">{t('maintenance.scopeGlobal')}</option>
                  </Select>
                </div>
                {editScopeType !== 'global' && (
                  <div>
                    <Input
                      type="number"
                      value={editScopeId}
                      onChange={(e) => setEditScopeId(Number(e.target.value))}
                      placeholder={t('maintenance.scopeIdPlaceholder')}
                    />
                  </div>
                )}
              </div>
            ) : (
              /* Create mode: visual two-column selector */
              <ScopeSelector
                defaultScopeType={defaultScopeType}
                defaultScopeId={defaultScopeId}
                onChange={setScopeTargets}
              />
            )}
          </div>

          {/* Schedule type tabs */}
          <div>
            <Label>{t('maintenance.fieldScheduleType')}</Label>
            <div className="flex rounded-md overflow-hidden border border-border">
              {(['one_time', 'recurring'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setScheduleType(st)}
                  className={cn(
                    'flex-1 py-1.5 text-sm font-medium transition-colors',
                    scheduleType === st
                      ? 'bg-accent text-white'
                      : 'bg-bg-tertiary text-text-secondary hover:bg-bg-hover',
                  )}
                >
                  {st === 'one_time' ? t('maintenance.oneTime') : t('maintenance.recurring')}
                </button>
              ))}
            </div>
          </div>

          {/* One-time fields */}
          {scheduleType === 'one_time' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t('maintenance.fieldStart')}</Label>
                <Input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
              </div>
              <div>
                <Label>{t('maintenance.fieldEnd')}</Label>
                <Input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
              </div>
            </div>
          )}

          {/* Recurring fields */}
          {scheduleType === 'recurring' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{t('maintenance.fieldRecurrence')}</Label>
                  <Select
                    value={recurrenceType}
                    onChange={(e) => setRecurrenceType(e.target.value as MaintenanceRecurrenceType)}
                  >
                    <option value="daily">{t('maintenance.recurrenceDaily')}</option>
                    <option value="weekly">{t('maintenance.recurrenceWeekly')}</option>
                  </Select>
                </div>
                <div>
                  <Label>{t('maintenance.fieldTimezone')}</Label>
                  <Select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                    {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
                  </Select>
                </div>
              </div>

              {recurrenceType === 'weekly' && (
                <div>
                  <Label>{t('maintenance.fieldDaysOfWeek')}</Label>
                  <div className="flex gap-1.5 flex-wrap">
                    {DAYS.map((d, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => toggleDay(i)}
                        className={cn(
                          'px-2.5 py-1 rounded text-xs font-semibold border transition-colors',
                          daysOfWeek.includes(i)
                            ? 'bg-accent border-accent text-white'
                            : 'bg-bg-tertiary border-border text-text-secondary hover:border-accent',
                        )}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{t('maintenance.fieldStartTime')}</Label>
                  <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                </div>
                <div>
                  <Label>{t('maintenance.fieldEndTime')}</Label>
                  <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                </div>
              </div>
            </>
          )}

          {/* Notification channels */}
          {channelOptions.length > 0 && (
            <div>
              <Label>{t('maintenance.notifyChannels')}</Label>
              <p className="text-xs text-text-muted mb-2">
                {t('maintenance.notifyChannelsDesc')}
              </p>
              <div className="space-y-1.5 max-h-32 overflow-y-auto">
                {channelOptions.map((ch) => (
                  <label key={ch.id} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={notifyChannelIds.includes(ch.id)}
                      onChange={() => toggleChannel(ch.id)}
                      className="h-3.5 w-3.5 rounded border-border bg-bg-tertiary text-accent focus:ring-accent"
                    />
                    <span className="text-sm text-text-primary">{ch.name}</span>
                    <span className="text-xs text-text-muted">({ch.type})</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Active toggle */}
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="h-4 w-4 rounded border-border bg-bg-tertiary text-accent focus:ring-accent"
            />
            <span className="text-sm font-medium text-text-primary">{t('maintenance.fieldActive')}</span>
          </label>

          {error && <p className="text-sm text-red-500">{error}</p>}
        </form>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-5 py-4 border-t border-border shrink-0">
          {/* Selection summary (create mode only) */}
          {!isEdit && scopeTargets.length > 0 && (
            <p className="text-xs text-text-muted">
              {t('maintenance.willCreate', { count: scopeTargets.length })}
              {scopeTargets.some((st) => st.disables?.length) && (
                <span className="text-text-muted/70">
                  {t('maintenance.withExclusions', { count: scopeTargets.reduce((n, st) => n + (st.disables?.length ?? 0), 0) })}
                </span>
              )}
            </p>
          )}
          {(!(!isEdit && scopeTargets.length > 0)) && <div />}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-4 py-2 text-sm font-medium text-text-secondary bg-bg-tertiary hover:bg-bg-hover border border-border transition-colors"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={handleSubmit as unknown as React.MouseEventHandler<HTMLButtonElement>}
              disabled={saving}
              className="rounded-md px-4 py-2 text-sm font-medium text-white bg-accent hover:bg-accent-hover disabled:opacity-50 transition-colors"
            >
              {saving
                ? (isEdit ? t('common.saving') : t('maintenance.creating'))
                : (isEdit ? t('maintenance.saveChanges') : t('common.create'))}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
