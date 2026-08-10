import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine, Brush,
} from 'recharts';
import {
  Rewind, Clock, Cpu, HardDrive, Activity, Server, RotateCcw, ChevronLeft, ChevronRight, AlertTriangle,
} from 'lucide-react';
import { deviceApi } from '../../api/device.api';
import type { RewindRange, RewindSeries, RewindSnapshot } from '@obliance/shared';

// ─── helpers ─────────────────────────────────────────────────────────────────
const DAY_MS = 24 * 60 * 60 * 1000;
const ms = (iso: string | Date | null) => (iso ? new Date(iso).getTime() : 0);
const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function fmtTime(d: string | number | Date) { return new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
function fmtTimeSec(d: string | number | Date) { return new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
function fmtDate(d: string | number | Date) { return new Date(d).toLocaleDateString([], { weekday: 'short', day: '2-digit', month: 'short' }); }
function fmtDateInput(d: Date) {
  const x = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return x.toISOString().slice(0, 10);
}
function fmtMem(mb: number) { return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`; }
const isRunning = (s: string | undefined) => /run|active/i.test(String(s ?? ''));

const C_CPU = 'rgb(var(--c-accent))';
const C_RAM = '#38bdf8';
const C_DISK = '#34d399';

// ─── vertical iOS-style time scrubber ────────────────────────────────────────
function TimeScrubber({ min, max, value, detailFrom, onChange }: {
  min: number; max: number; value: number; detailFrom: number | null; onChange: (t: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState(false);
  const span = Math.max(1, max - min);
  // oldest = top (0%), now = bottom (100%) — matches the pinned "Now" caption.
  const topFor = (t: number) => ((clamp(t, min, max) - min) / span) * 100;

  const pick = useCallback((clientY: number) => {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const frac = clamp((clientY - r.top) / r.height, 0, 1); // top→oldest, bottom→now
    onChange(min + frac * span);
  }, [min, span, onChange]);

  // Day tick marks between min and max (local midnights).
  const days = useMemo(() => {
    const out: { t: number; label: string }[] = [];
    // Step by calendar day (setDate), not fixed 24h, so ticks stay on local
    // midnight across DST transitions.
    const cur = startOfDay(new Date(min));
    while (cur.getTime() < min) cur.setDate(cur.getDate() + 1);
    for (; cur.getTime() <= max; cur.setDate(cur.getDate() + 1)) out.push({ t: cur.getTime(), label: fmtDate(cur) });
    return out;
  }, [min, max]);

  return (
    <div className="flex flex-col items-stretch select-none" style={{ width: 132 }}>
      <div
        ref={ref}
        className="relative flex-1 rounded-2xl cursor-ns-resize touch-none overflow-hidden"
        style={{
          minHeight: 460,
          background: 'linear-gradient(180deg, #d97a3a 0%, #c0506b 42%, #7d5ba6 72%, #4b6bb0 100%)',
        }}
        onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); setDrag(true); pick(e.clientY); }}
        onPointerMove={(e) => { if (drag) pick(e.clientY); }}
        onPointerUp={() => setDrag(false)}
        onPointerCancel={() => setDrag(false)}
      >
        {/* faint hour ticks */}
        {Array.from({ length: 25 }).map((_, i) => (
          <div key={i} className="absolute right-0 h-px bg-white/15" style={{ top: `${(i / 24) * 100}%`, width: i % 6 === 0 ? 16 : 9 }} />
        ))}
        {/* detail-window boundary (process/services exist below this) */}
        {detailFrom != null && detailFrom > min && (
          <div className="absolute left-0 right-0 border-t border-dashed border-white/40" style={{ top: `${topFor(detailFrom)}%` }}>
            <span className="absolute right-1 -top-3 text-[9px] text-white/70 font-mono">7j</span>
          </div>
        )}
        {/* day labels */}
        {days.map((d) => (
          <div key={d.t} className="absolute left-2 text-[10px] font-medium text-white/85 -translate-y-1/2" style={{ top: `${topFor(d.t)}%` }}>
            {d.label}
          </div>
        ))}
        {/* NOW marker (bottom) */}
        <div className="absolute left-2 bottom-1 text-[10px] font-semibold text-white">Now</div>
        {/* handle */}
        <div className="absolute left-0 right-0 pointer-events-none" style={{ top: `${topFor(value)}%` }}>
          <div className="h-0.5 bg-white shadow-[0_0_8px_rgba(255,255,255,0.9)]" />
          <div className="absolute right-1 -top-3 rounded-md bg-black/55 backdrop-blur px-1.5 py-0.5 text-[10px] font-mono text-white whitespace-nowrap">
            {fmtTime(value)}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── metric chart ────────────────────────────────────────────────────────────
function MetricChart({ data, series, unit, selected, onPick, xDomain }: {
  data: any[]; series: { key: string; name: string; color: string }[]; unit: string;
  selected: number; onPick: (t: number) => void; xDomain: [number, number];
}) {
  return (
    <div style={{ width: '100%', height: 190 }}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -12 }}
          onClick={(e: any) => { if (e && e.activeLabel != null) onPick(Number(e.activeLabel)); }}>
          <defs>
            {series.map((s) => (
              <linearGradient key={s.key} id={`g-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={0.35} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
          <XAxis dataKey="t" type="number" scale="time" domain={xDomain} allowDataOverflow
            tickFormatter={(v) => fmtTime(v)} tick={{ fontSize: 10, fill: 'rgb(var(--c-text-muted))', fontFamily: 'JetBrains Mono' }}
            stroke="rgba(255,255,255,0.1)" minTickGap={40} />
          <YAxis domain={unit === '%' ? [0, 100] : ['auto', 'auto']} unit={unit}
            tick={{ fontSize: 10, fill: 'rgb(var(--c-text-muted))', fontFamily: 'JetBrains Mono' }}
            width={44} stroke="rgba(255,255,255,0.1)" />
          <Tooltip
            contentStyle={{ background: 'rgb(var(--c-bg-tertiary))', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: 'rgb(var(--c-text-muted))' }}
            labelFormatter={(v) => fmtTimeSec(Number(v))}
            formatter={(val: any, name: any) => [`${val}${unit}`, name]} />
          {series.map((s) => (
            <Area key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={1.8}
              fill={`url(#g-${s.key})`} isAnimationActive={false} dot={false} />
          ))}
          <ReferenceLine x={selected} stroke="#fff" strokeDasharray="3 3" strokeOpacity={0.7} ifOverflow="extendDomain" />
          <Brush dataKey="t" height={22} travellerWidth={8} tickFormatter={(v) => fmtTime(v)}
            stroke="rgb(var(--c-accent))" fill="rgba(255,255,255,0.03)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── main tab ────────────────────────────────────────────────────────────────
export default function RewindTab({ deviceId }: { deviceId: number }) {
  const { t } = useTranslation();
  const [range, setRange] = useState<RewindRange | null>(null);
  const [selected, setSelected] = useState<number>(Date.now());
  const [series, setSeries] = useState<RewindSeries | null>(null);
  const [snap, setSnap] = useState<RewindSnapshot | null>(null);
  const [loadingSeries, setLoadingSeries] = useState(false);
  const [loadingSnap, setLoadingSnap] = useState(false);
  const [rangeError, setRangeError] = useState(false);
  const [reload, setReload] = useState(0);
  const dayKeyRef = useRef<string>('');

  // Load scrubber bounds. A load failure (500 / permission) is tracked
  // separately from a genuinely-empty device so we don't show a false
  // "collection just started" all-clear.
  useEffect(() => {
    let alive = true;
    setRangeError(false);
    deviceApi.getRewindRange(deviceId).then((r) => {
      if (!alive) return;
      setRange(r);
      setSelected(ms(r.now) || Date.now());
    }).catch(() => { if (alive) setRangeError(true); });
    return () => { alive = false; };
  }, [deviceId, reload]);

  // Fetch the day's series whenever the selected DAY changes.
  const dayStart = useMemo(() => startOfDay(new Date(selected)).getTime(), [selected]);
  useEffect(() => {
    const nowMs = range ? ms(range.now) : Date.now();
    const from = new Date(dayStart);
    const to = new Date(Math.min(dayStart + DAY_MS, nowMs));
    const key = fmtDateInput(from);
    if (key === dayKeyRef.current) return;
    dayKeyRef.current = key;
    setLoadingSeries(true);
    deviceApi.getRewindSeries(deviceId, from, to)
      .then((s) => setSeries(s))
      .catch(() => setSeries(null))
      .finally(() => setLoadingSeries(false));
  }, [deviceId, dayStart, range]);

  // Fetch the snapshot at the selected instant (debounced).
  useEffect(() => {
    let alive = true;
    setLoadingSnap(true);
    const h = setTimeout(() => {
      deviceApi.getRewindSnapshotAt(deviceId, new Date(selected))
        .then((s) => { if (alive) setSnap(s); })      // ignore out-of-order responses
        .catch(() => { if (alive) setSnap(null); })
        .finally(() => { if (alive) setLoadingSnap(false); });
    }, 220);
    return () => { alive = false; clearTimeout(h); };
  }, [deviceId, selected]);

  const chartData = useMemo(() => (series?.points ?? []).map((p) => ({
    t: ms(p.t), cpu: p.cpu, cpuMax: p.cpuMax, ram: p.ram, ramMax: p.ramMax,
  })), [series]);

  // Real machine CPU/RAM at the selected instant (from the accurate metric series,
  // NOT a sum of per-process ps values).
  const atPoint = useMemo(() => {
    if (!chartData.length) return null;
    let best = chartData[0];
    for (const p of chartData) if (Math.abs(p.t - selected) < Math.abs(best.t - selected)) best = p;
    // Don't present a far-away bucket as "the value at this instant".
    const cutoff = (series?.resolution === 'hourly' ? 60 : 5) * 60 * 1000 * 2; // ~2 buckets
    return Math.abs(best.t - selected) <= cutoff ? best : null;
  }, [chartData, selected, series]);

  const minMs = range?.metricFrom ? ms(range.metricFrom) : (range ? ms(range.now) - 30 * DAY_MS : Date.now() - 30 * DAY_MS);
  const maxMs = range ? ms(range.now) : Date.now();
  const detailFrom = range?.processFrom ? ms(range.processFrom) : (range?.serviceFrom ? ms(range.serviceFrom) : null);
  // Chart X domain = the selected day window (not the data extremes), so the
  // selection marker is always in-range and trailing gaps show as empty space.
  const xDomain: [number, number] = [dayStart, Math.min(dayStart + DAY_MS, maxMs)];

  const hasAnyData = !!(range && (range.metricFrom || range.processFrom || range.serviceFrom));

  const shiftDay = (dir: number) => {
    const d = new Date(selected);
    d.setDate(d.getDate() + dir); // calendar-day step (DST-safe), keeps wall-clock time
    setSelected(clamp(d.getTime(), minMs, maxMs));
  };
  const onDateInput = (v: string) => {
    if (!v) return;
    const d = new Date(v + 'T12:00:00');
    setSelected(clamp(d.getTime(), minMs, maxMs));
  };

  return (
    <div className="space-y-4">
      {/* header / controls */}
      <div className="flex flex-wrap items-center gap-3 p-4 bg-bg-secondary rounded-xl">
        <div className="flex items-center gap-2 text-text-primary">
          <Rewind className="w-5 h-5 text-accent" />
          <span className="font-semibold">{t('rewind.title') || 'Rewind — machine à remonter le temps'}</span>
        </div>
        <div className="flex-1" />
        <button onClick={() => shiftDay(-1)} className="p-1.5 rounded-lg bg-bg-tertiary/60 hover:bg-bg-tertiary text-text-muted" title={t('rewind.prevDay') || 'Jour précédent'}>
          <ChevronLeft className="w-4 h-4" />
        </button>
        <input type="date" value={fmtDateInput(new Date(selected))} max={fmtDateInput(new Date(maxMs))} min={fmtDateInput(new Date(minMs))}
          onChange={(e) => onDateInput(e.target.value)}
          className="bg-bg-tertiary/60 rounded-lg px-2 py-1.5 text-sm text-text-primary border border-white/5 [color-scheme:dark]" />
        <button onClick={() => shiftDay(1)} className="p-1.5 rounded-lg bg-bg-tertiary/60 hover:bg-bg-tertiary text-text-muted" title={t('rewind.nextDay') || 'Jour suivant'}>
          <ChevronRight className="w-4 h-4" />
        </button>
        <div className="px-3 py-1.5 rounded-lg bg-accent/10 text-accent font-mono text-sm tabular-nums">
          {fmtDate(selected)} · {fmtTimeSec(selected)}
        </div>
        <button onClick={() => setSelected(maxMs)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-bg-tertiary/60 hover:bg-bg-tertiary text-text-muted text-sm" title={t('rewind.backToNow') || 'Revenir à maintenant'}>
          <RotateCcw className="w-3.5 h-3.5" /> {t('rewind.now') || 'Maintenant'}
        </button>
      </div>

      {rangeError ? (
        <div className="p-10 bg-bg-secondary rounded-xl text-center text-text-muted">
          <AlertTriangle className="w-8 h-8 mx-auto mb-3 text-red-400/70" />
          <p className="mb-3">{t('rewind.loadError') || 'Impossible de charger le Rewind (erreur serveur ou accès refusé).'}</p>
          <button onClick={() => setReload((x) => x + 1)} className="px-3 py-1.5 rounded-lg bg-bg-tertiary/60 hover:bg-bg-tertiary text-text-primary text-sm">
            {t('common.retry') || 'Réessayer'}
          </button>
        </div>
      ) : !hasAnyData ? (
        <div className="p-10 bg-bg-secondary rounded-xl text-center text-text-muted">
          <Clock className="w-8 h-8 mx-auto mb-3 opacity-40" />
          {t('rewind.noData') || "La collecte vient de démarrer — les données du Rewind apparaîtront au fil de l'eau (métriques en continu, process ~5 min)."}
        </div>
      ) : (
        <div className="flex gap-4">
          {/* main column */}
          <div className="flex-1 min-w-0 space-y-4">
            {/* metric graphs */}
            <div className="p-4 bg-bg-secondary rounded-xl">
              <div className="flex items-center gap-2 mb-2 text-sm font-semibold text-text-muted">
                <Cpu className="w-4 h-4" />{t('rewind.cpuRam') || 'CPU / RAM'}
                <span className="ml-auto text-[11px] font-normal text-text-muted">
                  {series?.resolution === 'hourly' ? (t('rewind.resHourly') || 'résolution horaire') : (t('rewind.res5min') || 'résolution 5 min')}
                </span>
              </div>
              {loadingSeries && !chartData.length ? (
                <div className="h-[190px] flex items-center justify-center text-text-muted text-sm">…</div>
              ) : chartData.length ? (
                <MetricChart data={chartData} unit="%" selected={selected} onPick={setSelected} xDomain={xDomain}
                  series={[{ key: 'cpu', name: 'CPU', color: C_CPU }, { key: 'ram', name: 'RAM', color: C_RAM }]} />
              ) : (
                <div className="h-[190px] flex items-center justify-center text-text-muted text-sm">{t('rewind.noDayData') || 'Aucune métrique ce jour-là'}</div>
              )}
            </div>

            {/* disk graphs */}
            {series?.disks?.length ? (
              <div className="p-4 bg-bg-secondary rounded-xl">
                <div className="flex items-center gap-2 mb-2 text-sm font-semibold text-text-muted">
                  <HardDrive className="w-4 h-4" />{t('rewind.disk') || 'Disque (%)'}
                </div>
                <MetricChart
                  data={mergeDisks(series.disks)} unit="%" selected={selected} onPick={setSelected} xDomain={xDomain}
                  series={series.disks.map((d, i) => ({ key: `d${i}`, name: d.mount, color: i === 0 ? C_DISK : DISK_PALETTE[i % DISK_PALETTE.length] }))} />
              </div>
            ) : null}

            {/* snapshot panels */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <ProcessPanel snap={snap} loading={loadingSnap} atCpu={atPoint?.cpu ?? null} atRam={atPoint?.ram ?? null} t={t} />
              <ServicePanel snap={snap} loading={loadingSnap} t={t} />
            </div>
          </div>

          {/* vertical scrubber (lg+) */}
          <div className="hidden lg:flex shrink-0">
            <TimeScrubber min={minMs} max={maxMs} value={selected} detailFrom={detailFrom} onChange={setSelected} />
          </div>
        </div>
      )}
    </div>
  );
}

const DISK_PALETTE = ['#34d399', '#fbbf24', '#f472b6', '#60a5fa', '#a78bfa'];

// Merge per-mount disk series into a single recharts dataset keyed d0/d1/…
function mergeDisks(disks: RewindSeries['disks']) {
  const byT = new Map<number, any>();
  disks.forEach((d, i) => {
    for (const p of d.points) {
      const t = ms(p.t);
      if (!byT.has(t)) byT.set(t, { t });
      byT.get(t)[`d${i}`] = p.pct;
    }
  });
  return [...byT.values()].sort((a, b) => a.t - b.t);
}

// ─── process panel ───────────────────────────────────────────────────────────
function ProcessPanel({ snap, loading, atCpu, atRam, t }: {
  snap: RewindSnapshot | null; loading: boolean; atCpu: number | null; atRam: number | null; t: any;
}) {
  const p = snap?.process ?? null;
  return (
    <div className="p-4 bg-bg-secondary rounded-xl">
      <div className="flex items-center gap-2 mb-3 text-sm font-semibold text-text-muted">
        <Activity className="w-4 h-4" />{t('rewind.processes') || 'Processus'}
        {p && <span className="ml-auto text-[11px] font-normal font-mono text-text-muted">{fmtTimeSec(p.capturedAt)} · {p.processCount} {t('rewind.total') || 'total'}</span>}
      </div>
      {/* real machine CPU/RAM at instant (accurate — from metrics, not ps sum) */}
      <div className="flex gap-4 mb-3 text-xs">
        <span className="text-text-muted">{t('rewind.machineCpu') || 'CPU machine'}: <span className="text-text-primary font-mono">{atCpu != null ? `${atCpu}%` : '—'}</span></span>
        <span className="text-text-muted">{t('rewind.machineRam') || 'RAM machine'}: <span className="text-text-primary font-mono">{atRam != null ? `${atRam}%` : '—'}</span></span>
      </div>
      {!p ? (
        <div className="py-8 text-center text-text-muted text-sm">
          {loading ? '…' : (t('rewind.noProcSnap') || 'Pas de snapshot process à cet instant (machine hors-ligne, ou avant le début de la collecte).')}
        </div>
      ) : (
        <div className="max-h-72 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="text-text-muted sticky top-0 bg-bg-secondary">
              <tr className="text-left">
                <th className="py-1 font-medium">{t('rewind.process') || 'Processus'}</th>
                <th className="py-1 font-medium text-right">CPU%</th>
                <th className="py-1 font-medium text-right">RAM</th>
                <th className="py-1 font-medium">{t('rewind.user') || 'User'}</th>
              </tr>
            </thead>
            <tbody>
              {p.procs.map((pr, i) => (
                <tr key={`${pr.pid}-${i}`} className="border-t border-white/5">
                  <td className="py-1 pr-2 text-text-primary truncate max-w-[160px]" title={pr.name}>{pr.name}</td>
                  <td className="py-1 text-right font-mono tabular-nums text-accent">{pr.cpu.toFixed(1)}</td>
                  <td className="py-1 text-right font-mono tabular-nums text-text-primary">{fmtMem(pr.memMb)}</td>
                  <td className="py-1 text-text-muted truncate max-w-[90px]" title={pr.user ?? ''}>{pr.user ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── service panel ───────────────────────────────────────────────────────────
function ServicePanel({ snap, loading, t }: { snap: RewindSnapshot | null; loading: boolean; t: any }) {
  const s = snap?.service ?? null;
  const sorted = useMemo(() => {
    if (!s) return [];
    return [...s.services].sort((a, b) => Number(isRunning(b.status as string)) - Number(isRunning(a.status as string)));
  }, [s]);
  return (
    <div className="p-4 bg-bg-secondary rounded-xl">
      <div className="flex items-center gap-2 mb-3 text-sm font-semibold text-text-muted">
        <Server className="w-4 h-4" />{t('rewind.services') || 'Services'}
        {s && <span className="ml-auto text-[11px] font-normal font-mono text-text-muted">{fmtTimeSec(s.capturedAt)} · {s.runningCount}/{s.serviceCount}</span>}
      </div>
      {!s ? (
        <div className="py-8 text-center text-text-muted text-sm">
          {loading ? '…' : (t('rewind.noSvcSnap') || 'Pas de snapshot services à cet instant.')}
        </div>
      ) : (
        <div className="max-h-72 overflow-y-auto">
          <table className="w-full text-xs">
            <tbody>
              {sorted.map((sv, i) => (
                <tr key={`${sv.name ?? i}`} className="border-t border-white/5">
                  <td className="py-1">
                    <span className={`inline-block w-1.5 h-1.5 rounded-full mr-2 ${isRunning(sv.status as string) ? 'bg-green-400' : 'bg-gray-500'}`} />
                  </td>
                  <td className="py-1 pr-2 text-text-primary truncate max-w-[200px]" title={String(sv.displayName ?? sv.name ?? '')}>
                    {String(sv.displayName ?? sv.name ?? '—')}
                  </td>
                  <td className="py-1 text-right text-text-muted">{String(sv.status ?? '')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
