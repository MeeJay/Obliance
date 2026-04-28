import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  RefreshCw, ArrowRight, Package, Clock, FolderOpen, Plus, ScreenShare,
  AlertTriangle, AlertCircle, HardDrive, ShieldCheck, FolderTree, Wifi, Box,
} from 'lucide-react';
import { useDeviceStore } from '@/store/deviceStore';
import {
  deviceApi,
  type GroupStats, type FleetTimeseriesPoint,
  type AgentVersionRow, type DiskSaturationResult,
} from '@/api/device.api';
import { useTranslation } from 'react-i18next';
import { anonymize } from '@/utils/anonymize';
import { useUiStore } from '@/store/uiStore';

// ── Sparkline (filled area + line) ───────────────────────────────────────────

function Sparkline({ data, color, height = 36 }: { data: number[]; color: string; height?: number }) {
  if (data.length < 2) return <div style={{ height }} />;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const w = 200;
  const h = height;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return [x, y];
  });
  const linePath = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L${w},${h} L0,${h} Z`;
  const id = `sg-${color.replace(/[^a-z0-9]/gi, '')}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height }} className="block">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity="0.40" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${id})`} />
      <path d={linePath} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

// ── Hero KPI card (featured: with spark + axis) ──────────────────────────────

function HeroFeatured({ label, value, color, series, days }: {
  label: string; value: number; color: string;
  series: number[]; days: { short: string; value: number }[];
}) {
  return (
    <div className="rounded-xl p-5 relative overflow-hidden bg-gradient-to-br from-accent/10 via-bg-secondary to-bg-secondary shadow-[0_0_0_1px_rgb(var(--c-accent)/0.18)_inset,_0_6px_28px_-10px_rgb(var(--c-accent)/0.25)]">
      <div className="text-[11px] font-mono uppercase tracking-[0.14em] text-text-muted mb-3">{label}</div>
      <div className={`text-[44px] font-semibold leading-none ${color}`}>{value}</div>
      <div className="mt-3"><Sparkline data={series} color="#ff6868" /></div>
      <div className="grid grid-cols-4 mt-2 gap-2">
        {days.map((d, i) => {
          const isLast = i === days.length - 1;
          return (
            <div key={i} className={`flex flex-col items-start ${isLast ? 'text-text-primary' : 'text-text-muted'}`}>
              <span className="text-[10px] font-mono uppercase tracking-wider">{d.short}</span>
              <span className={`text-[12px] font-mono ${isLast ? 'text-text-primary font-semibold' : 'text-text-secondary'}`}>{d.value}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HeroCard({ label, value, color, delta, deltaText, barPct, barColor }: {
  label: string; value: number; color: string;
  /** Numeric delta sign for the icon: positive = ↑, negative = ↓, 0 = stable */
  delta?: number | null;
  deltaText?: string;
  barPct?: number;
  barColor?: string;
}) {
  const deltaIconClass = delta == null ? 'text-text-muted' :
                          delta === 0   ? 'text-text-muted' :
                          delta > 0     ? 'text-green-400' : 'text-accent';
  const deltaIcon = delta == null ? '—' : delta === 0 ? '—' : delta > 0 ? '↑' : '↓';
  return (
    <div className="rounded-xl p-5 relative overflow-hidden bg-bg-secondary shadow-[0_1px_0_0_rgba(255,255,255,0.03),_0_6px_24px_-8px_rgba(0,0,0,0.45)]">
      <div className="text-[11px] font-mono uppercase tracking-[0.14em] text-text-muted mb-3">{label}</div>
      <div className={`text-[34px] font-semibold leading-none ${color}`}>{value}</div>
      {(delta != null || deltaText) && (
        <div className={`text-[12px] font-mono mt-3 ${deltaIconClass}`}>
          <span className="mr-1">{deltaIcon}</span>{deltaText}
        </div>
      )}
      {barPct != null && (
        <div className="mt-2 h-1 w-full bg-white/[0.04] rounded">
          <div className="h-full rounded" style={{ width: `${Math.min(100, Math.max(0, barPct))}%`, background: barColor ?? 'rgb(var(--c-accent))' }} />
        </div>
      )}
    </div>
  );
}

// ── Donut ────────────────────────────────────────────────────────────────────

interface DonutSlice { name: string; value: number; color: string }

function OsDonut({ slices, total }: { slices: DonutSlice[]; total: number }) {
  let cumulative = 0;
  const arcs = slices.map((s) => {
    const len = total > 0 ? (s.value / total) * 100 : 0;
    const offset = -cumulative + 25;
    cumulative += len;
    return { ...s, len, offset };
  });
  return (
    <div className="flex items-center gap-5">
      <svg viewBox="0 0 42 42" className="w-28 h-28 shrink-0">
        <circle cx="21" cy="21" r="15.915" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="3.5" />
        {arcs.map((a) => (
          <circle key={a.name} cx="21" cy="21" r="15.915" fill="none"
            stroke={a.color} strokeWidth="3.5"
            strokeDasharray={`${a.len} ${100 - a.len}`}
            strokeDashoffset={a.offset}
            transform="rotate(-90 21 21)" />
        ))}
        <text x="21" y="20" textAnchor="middle" dominantBaseline="middle" fill="rgb(var(--c-text-primary))" fontSize="6.5" fontWeight="600">{total}</text>
        <text x="21" y="26" textAnchor="middle" dominantBaseline="middle" fill="rgb(var(--c-text-muted))" fontSize="2.6" fontFamily="JetBrains Mono">total</text>
      </svg>
      <div className="flex-1 flex flex-col gap-2">
        {slices.map((s) => {
          const pct = total > 0 ? Math.round((s.value / total) * 100) : 0;
          return (
            <div key={s.name} className="flex items-center gap-3 text-[13px]">
              <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: s.color }} />
              <span className="text-text-primary font-medium flex-1">{s.name}</span>
              <span className="text-text-muted font-mono text-[11px]">{s.value} · {pct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Activity chart (online/offline lines, multi-tab) ─────────────────────────

type ActivityRange = '24h' | '7j' | '14j' | '30j';

function ActivityChart({ data }: { data: FleetTimeseriesPoint[] }) {
  if (data.length < 2) {
    return (
      <div className="h-[240px] flex items-center justify-center text-text-muted text-sm">
        Pas assez d'historique — données après 24h
      </div>
    );
  }
  const maxOnline = Math.max(...data.map(d => d.online), 1);
  const maxOffline = Math.max(...data.map(d => d.offline), 1);
  const yMax = Math.max(maxOnline, maxOffline);
  const w = 800; const h = 240;
  const pad = { l: 36, r: 12, t: 16, b: 28 };
  const cw = w - pad.l - pad.r;
  const ch = h - pad.t - pad.b;
  const xOf = (i: number) => pad.l + (i / (data.length - 1)) * cw;
  const yOf = (v: number) => pad.t + (1 - v / yMax) * ch;
  const onlinePath = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(1)},${yOf(d.online).toFixed(1)}`).join(' ');
  const offlinePath = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(1)},${yOf(d.offline).toFixed(1)}`).join(' ');
  const onlineArea = `${onlinePath} L${xOf(data.length - 1)},${pad.t + ch} L${xOf(0)},${pad.t + ch} Z`;
  const ticks = [0, 0.5, 1].map(t => yMax * t);

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full block" preserveAspectRatio="none">
      <defs>
        <linearGradient id="ag-online" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#1edd8a" stopOpacity="0.30" />
          <stop offset="100%" stopColor="#1edd8a" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* Grid lines */}
      {ticks.map((v, i) => (
        <g key={i}>
          <line x1={pad.l} x2={w - pad.r} y1={yOf(v)} y2={yOf(v)} stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
          <text x={pad.l - 6} y={yOf(v) + 3} fontSize="10" fontFamily="JetBrains Mono" fill="rgb(var(--c-text-muted))" textAnchor="end">{Math.round(v)}</text>
        </g>
      ))}
      <path d={onlineArea} fill="url(#ag-online)" />
      <path d={onlinePath}  fill="none" stroke="#1edd8a" strokeWidth="1.8" strokeLinejoin="round" />
      <path d={offlinePath} fill="none" stroke="rgb(var(--c-text-muted))" strokeWidth="1.4" strokeDasharray="4 3" strokeLinejoin="round" />
      {/* X axis labels (first / mid / last only) */}
      {[0, Math.floor(data.length / 2), data.length - 1].map(i => (
        <text key={i} x={xOf(i)} y={h - 8} fontSize="10" fontFamily="JetBrains Mono" fill="rgb(var(--c-text-muted))" textAnchor="middle">
          {data[i].day.slice(5)}
        </text>
      ))}
    </svg>
  );
}

// ── Mini-stat compact card ───────────────────────────────────────────────────

function MiniStat({ icon, label, value, sub, color = 'text-text-primary', to }: {
  icon: React.ReactNode; label: string; value: React.ReactNode; sub?: string;
  color?: string; to?: string;
}) {
  const body = (
    <div className="flex items-center gap-3 rounded-lg bg-bg-secondary px-3.5 py-2.5 shadow-[0_1px_0_0_rgba(255,255,255,0.03),_0_4px_16px_-8px_rgba(0,0,0,0.35)]">
      <div className="w-8 h-8 rounded-md bg-bg-hover flex items-center justify-center shrink-0 text-text-muted">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[10px] font-mono uppercase tracking-[0.12em] text-text-muted truncate">{label}</div>
        <div className={`text-[14px] font-semibold leading-tight ${color} truncate`}>{value}</div>
        {sub && <div className="text-[10px] font-mono text-text-muted truncate">{sub}</div>}
      </div>
    </div>
  );
  return to ? <Link to={to} className="block hover:opacity-90 transition-opacity">{body}</Link> : body;
}

// ── Top versions agent (horizontal bars) ─────────────────────────────────────

function AgentVersionsCard({ rows }: { rows: AgentVersionRow[] }) {
  const max = Math.max(...rows.map(r => r.count), 1);
  return (
    <div className="rounded-xl bg-bg-secondary p-5 shadow-[0_1px_0_0_rgba(255,255,255,0.03),_0_6px_24px_-8px_rgba(0,0,0,0.45)] flex flex-col gap-3">
      <div>
        <div className="text-[15px] font-semibold text-text-primary">Top versions agent</div>
        <div className="text-[11px] font-mono text-text-muted tracking-wider">distribution du parc</div>
      </div>
      {rows.length === 0 ? (
        <div className="text-text-muted text-sm py-4">Aucune version reportée</div>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.slice(0, 5).map(r => {
            const pct = (r.count / max) * 100;
            return (
              <div key={r.version} className="flex items-center gap-3">
                <span className={`text-[12px] font-mono w-20 truncate ${r.isLatest ? 'text-green-400' : 'text-text-secondary'}`}>
                  v{r.version}
                </span>
                <div className="flex-1 h-2 bg-white/[0.04] rounded overflow-hidden">
                  <div className="h-full rounded" style={{ width: `${pct}%`, background: r.isLatest ? '#1edd8a' : '#4f7bff' }} />
                </div>
                <span className="text-[11px] font-mono text-text-muted w-8 text-right">{r.count}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Conformité gauge ─────────────────────────────────────────────────────────

function ComplianceGauge({ score }: { score: number | null }) {
  const pct = score == null ? 0 : Math.max(0, Math.min(100, score));
  const color = pct >= 90 ? '#1edd8a' : pct >= 70 ? '#f5a623' : '#e03a3a';
  const dasharray = `${pct} 100`;
  return (
    <div className="rounded-xl bg-bg-secondary p-5 shadow-[0_1px_0_0_rgba(255,255,255,0.03),_0_6px_24px_-8px_rgba(0,0,0,0.45)] flex flex-col gap-2">
      <div>
        <div className="text-[15px] font-semibold text-text-primary">Conformité moyenne</div>
        <div className="text-[11px] font-mono text-text-muted tracking-wider">policies actives</div>
      </div>
      <div className="flex items-center justify-center pt-2 pb-1">
        <svg viewBox="0 0 42 28" className="w-32">
          <path d="M3 25 A18 18 0 0 1 39 25" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="3.5" strokeLinecap="round" pathLength="100" />
          <path d="M3 25 A18 18 0 0 1 39 25" fill="none" stroke={color} strokeWidth="3.5" strokeLinecap="round" pathLength="100" strokeDasharray={dasharray} />
          <text x="21" y="22" textAnchor="middle" fill="rgb(var(--c-text-primary))" fontSize="9" fontWeight="700" fontFamily="Rajdhani">
            {score == null ? '—' : `${Math.round(pct)}%`}
          </text>
        </svg>
      </div>
      <Link to="/policies" className="text-center text-[11px] font-mono text-text-muted hover:text-accent transition-colors">
        Voir les policies →
      </Link>
    </div>
  );
}

// ── Disques saturés ──────────────────────────────────────────────────────────

function DiskSaturationCard({ data }: { data: DiskSaturationResult }) {
  return (
    <div className="rounded-xl bg-bg-secondary p-5 shadow-[0_1px_0_0_rgba(255,255,255,0.03),_0_6px_24px_-8px_rgba(0,0,0,0.45)] flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div className="text-[15px] font-semibold text-text-primary">Disques saturés</div>
          <div className="text-[11px] font-mono text-text-muted tracking-wider">&gt; {data.threshold}% utilisés</div>
        </div>
        <div className={`text-[28px] font-semibold ${data.count > 0 ? 'text-amber-400' : 'text-text-muted'} leading-none`}>{data.count}</div>
      </div>
      {data.top.length === 0 ? (
        <div className="text-text-muted text-[12px] font-mono">Aucun disque critique</div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {data.top.map(d => (
            <Link key={d.deviceId} to={`/devices/${d.deviceId}`}
              className="flex items-center gap-2 text-[12px] hover:bg-bg-hover rounded-md px-2 py-1 -mx-2 transition-colors">
              <HardDrive size={12} className="text-text-muted shrink-0" />
              <span className="text-text-secondary truncate flex-1">{anonymize(d.displayName ?? d.hostname)}</span>
              <span className="font-mono text-amber-400">{d.pct}%</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Sessions remote 24h ──────────────────────────────────────────────────────

function RemoteSessionsCard({ active }: { active: number }) {
  return (
    <div className="rounded-xl bg-bg-secondary p-5 shadow-[0_1px_0_0_rgba(255,255,255,0.03),_0_6px_24px_-8px_rgba(0,0,0,0.45)] flex flex-col gap-3">
      <div>
        <div className="text-[15px] font-semibold text-text-primary">Sessions remote</div>
        <div className="text-[11px] font-mono text-text-muted tracking-wider">live · ObliReach + tunnels</div>
      </div>
      <div className="flex items-baseline gap-3">
        <span className={`text-[36px] font-semibold leading-none ${active > 0 ? 'text-accent' : 'text-text-muted'}`}>{active}</span>
        <span className="text-[12px] font-mono text-text-muted">en cours</span>
      </div>
      <Link to="/admin/supervision"
        className="text-[11px] font-mono text-text-muted hover:text-accent transition-colors flex items-center gap-1">
        <ScreenShare size={11} /> Supervision →
      </Link>
    </div>
  );
}

// ── Vue par groupe (recursive cards) ─────────────────────────────────────────

function GroupCard({ group, children, depth = 0 }: { group: GroupStats; children?: React.ReactNode; depth?: number }) {
  const upPct = group.total > 0 ? Math.round((group.online / group.total) * 100) : 0;
  const barColor = upPct >= 95 ? 'bg-green-400' : upPct >= 70 ? 'bg-amber-400' : 'bg-accent';
  const warnings = group.warning + group.critical;
  return (
    <div className={`rounded-lg bg-bg-secondary px-4 py-3 shadow-[0_1px_0_0_rgba(255,255,255,0.03),_0_4px_18px_-8px_rgba(0,0,0,0.45)] ${depth > 0 ? 'bg-bg-tertiary' : ''}`}>
      <Link
        to={group.groupId ? `/group/${group.groupId}` : '/devices'}
        className="flex items-center gap-3 group min-w-0"
      >
        <FolderOpen size={depth > 0 ? 13 : 15} className="text-accent shrink-0" />
        <span className="text-[13px] font-semibold text-text-primary truncate min-w-0">
          {anonymize(group.groupName) || 'Sans groupe'}
        </span>

        <div className="flex items-center gap-1.5 ml-2">
          <Wifi size={12} className="text-text-muted" />
          <span className="font-mono text-[11px] text-text-secondary">
            <span className={upPct >= 95 ? 'text-green-400' : upPct >= 70 ? 'text-amber-400' : 'text-accent'}>{group.online}</span>
            <span className="text-text-muted"> / {group.total}</span>
          </span>
        </div>

        <div className="flex-1 min-w-0 max-w-[300px] h-1.5 bg-white/[0.04] rounded overflow-hidden mx-2">
          <div className={`h-full ${barColor}`} style={{ width: `${upPct}%` }} />
        </div>

        <div className="flex items-center gap-3 ml-auto shrink-0">
          {warnings > 0 && (
            <div className="flex items-center gap-1 font-mono text-[11px] text-amber-400">
              <AlertTriangle size={12} /> {warnings}
            </div>
          )}
          <div className="flex items-center gap-1 font-mono text-[11px] text-text-muted">
            <ShieldCheck size={12} />
            {group.complianceScore != null ? `${Math.round(group.complianceScore)}%` : '—'}
          </div>
          <div className="flex items-center gap-1 font-mono text-[11px] text-text-muted">
            <Box size={12} />
            {group.pendingUpdates}
          </div>
        </div>
      </Link>
      {children && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-3 pl-3 border-l border-border ml-1">
          {children}
        </div>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function DashboardPage() {
  const { t } = useTranslation();
  const { fetchDevices, summary, fetchSummary } = useDeviceStore();
  const { openAddAgentModal } = useUiStore();
  const [isLoading, setIsLoading] = useState(true);
  const [groupStats, setGroupStats] = useState<GroupStats[]>([]);
  const [series, setSeries] = useState<FleetTimeseriesPoint[]>([]);
  const [versions, setVersions] = useState<AgentVersionRow[]>([]);
  const [disks, setDisks] = useState<DiskSaturationResult>({ count: 0, threshold: 85, top: [] });
  const [activityRange, setActivityRange] = useState<ActivityRange>('14j');

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      await Promise.all([
        fetchDevices(),
        fetchSummary(),
        deviceApi.getGroupStats().then(setGroupStats).catch(() => {}),
        deviceApi.getFleetTimeseries(30).then(setSeries).catch(() => {}),
        deviceApi.getAgentVersions().then(setVersions).catch(() => {}),
        deviceApi.getDiskSaturated(85).then(setDisks).catch(() => {}),
      ]);
      setIsLoading(false);
    };
    load();
  }, [fetchDevices, fetchSummary]);

  // Derived KPIs
  const total       = summary?.total ?? 0;
  const online      = summary?.online ?? 0;
  const offline     = summary?.offline ?? 0;
  const critical    = summary?.critical ?? 0;
  const pending     = summary?.pending ?? 0;
  const pendingUpd  = summary?.pendingUpdates ?? 0;
  const stale       = summary?.staleDevices ?? 0;
  const upToDate    = summary?.agentUpToDate ?? 0;
  const outdated    = summary?.agentOutdated ?? 0;
  const latestVer   = summary?.latestAgentVersion ?? '';
  const remoteSess  = summary?.activeRemoteSessions ?? 0;
  const upcoming    = summary?.upcomingSchedules ?? 0;
  const deltas      = summary?.deltas;

  const onlinePct  = total > 0 ? Math.round((online / total) * 100) : 0;
  const offlinePct = total > 0 ? Math.round((offline / total) * 100) : 0;
  const updPct     = total > 0 ? Math.round((pendingUpd / total) * 100) : 0;
  const stalePct   = total > 0 ? Math.round((stale / total) * 100) : 0;

  // OS donut data
  const os = summary?.osByType ?? { windows: 0, macos: 0, linux: 0, other: 0 };
  const osSlices: DonutSlice[] = useMemo(() => [
    { name: 'Windows', value: os.windows, color: '#4f7bff' },
    { name: 'Linux',   value: os.linux,   color: '#f5a623' },
    { name: 'macOS',   value: os.macos,   color: '#1edd8a' },
    { name: t('dashboard.osOther', 'Autres'), value: os.other, color: 'rgba(255,255,255,0.20)' },
  ], [os, t]);

  // Activity chart data (slice timeseries by selected range)
  const rangeDays = activityRange === '24h' ? 1 : activityRange === '7j' ? 7 : activityRange === '14j' ? 14 : 30;
  const activityData = useMemo(() => series.slice(-rangeDays), [series, rangeDays]);

  // Featured hero — last 4 days from timeseries (or pad with synth values)
  const featuredDays = useMemo(() => {
    const last4 = series.slice(-4);
    const labels = ['LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM', 'DIM'];
    return last4.map(p => {
      const d = new Date(p.day);
      return { short: labels[(d.getDay() + 6) % 7], value: p.total };
    });
  }, [series]);
  const featuredSeries = useMemo(() => series.slice(-7).map(p => p.total), [series]);

  // Tree of groups
  const groupTree = useMemo(() => {
    // Build a parent->children map. We don't have parent_id from group-stats yet,
    // so for now we render flat at top level. Hierarchical view requires the
    // groups tree endpoint which already exists (groups.tree()). Future work.
    return [...groupStats]
      .filter(g => g.groupId !== null)
      .sort((a, b) => b.total - a.total);
  }, [groupStats]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-6 h-6 animate-spin text-text-muted" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 p-6">

      {/* Page header */}
      <div className="flex items-baseline gap-4">
        <h1 className="text-2xl font-semibold tracking-wide text-text-primary">
          {t('dashboard.title', 'Tableau de bord')}
        </h1>
        <span className="text-xs font-mono tracking-wider text-text-muted">
          {total} {t('dashboard.devicesManaged', 'appareils gérés')}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={openAddAgentModal}
            className="inline-flex items-center gap-2 h-9 px-3.5 rounded-md bg-bg-hover hover:bg-bg-active text-[13px] font-medium text-text-primary transition-colors"
          >
            <Plus size={14} />
            {t('nav.addAgent')}
          </button>
          <Link
            to="/devices"
            className="inline-flex items-center gap-2 h-9 px-3.5 rounded-md bg-accent/12 hover:bg-accent/20 text-[13px] font-medium text-accent transition-colors"
          >
            {t('dashboard.allDevices', 'Voir tous les appareils')}
            <ArrowRight size={14} />
          </Link>
        </div>
      </div>

      {/* Hero row — featured Total + 4 KPIs with deltas */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
        <HeroFeatured
          label={t('dashboard.totalDevices', 'Appareils total')}
          value={total}
          color="text-accent"
          series={featuredSeries.length > 1 ? featuredSeries : [total, total]}
          days={featuredDays.length > 0 ? featuredDays : [{ short: 'NOW', value: total }]}
        />

        <HeroCard
          label={t('dashboard.online')}
          value={online}
          color="text-green-400"
          delta={deltas?.onlineVsYesterday ?? null}
          deltaText={
            deltas?.onlineVsYesterday == null ? `${onlinePct}% du parc`
              : deltas.onlineVsYesterday === 0 ? 'stable vs hier'
              : `${Math.abs(deltas.onlineVsYesterday)} vs hier`
          }
          barPct={onlinePct}
          barColor="#1edd8a"
        />

        <HeroCard
          label={t('dashboard.offline')}
          value={offline}
          color="text-text-secondary"
          delta={deltas?.offlineVsYesterday == null ? null : -deltas.offlineVsYesterday}
          deltaText={
            deltas?.offlineVsYesterday == null ? `${offlinePct}% du parc`
              : deltas.offlineVsYesterday === 0 ? 'stable'
              : `${Math.abs(deltas.offlineVsYesterday)} vs hier`
          }
          barPct={offlinePct}
          barColor="rgb(var(--c-text-muted))"
        />

        <HeroCard
          label={t('dashboard.pendingUpdates', 'MAJ en attente')}
          value={pendingUpd}
          color="text-amber-400"
          delta={deltas?.pendingUpdatesVsWeek == null ? null : -deltas.pendingUpdatesVsWeek}
          deltaText={
            deltas?.pendingUpdatesVsWeek == null ? `${updPct}% à patcher`
              : deltas.pendingUpdatesVsWeek === 0 ? 'stable cette semaine'
              : `${Math.abs(deltas.pendingUpdatesVsWeek)} cette semaine`
          }
          barPct={updPct}
          barColor="#f5a623"
        />

        <HeroCard
          label={t('dashboard.staleDevices', 'Injoignables 72h')}
          value={stale}
          color="text-accent"
          delta={deltas?.staleVsYesterday == null ? null : -deltas.staleVsYesterday}
          deltaText={
            stale === 0 ? 'tout le parc joignable'
              : deltas?.staleVsYesterday == null ? `${stalePct}% injoignables`
              : deltas.staleVsYesterday === 0 ? `${stale} stables`
              : deltas.staleVsYesterday > 0 ? `${deltas.staleVsYesterday} nouveaux`
              : `${Math.abs(deltas.staleVsYesterday)} récupérés`
          }
          barPct={stalePct}
          barColor="rgb(var(--c-accent))"
        />
      </div>

      {/* Two-col row: Activity chart (2/3) + OS donut (1/3) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3.5">
        <div className="lg:col-span-2 rounded-xl bg-bg-secondary p-5 shadow-[0_1px_0_0_rgba(255,255,255,0.03),_0_6px_24px_-8px_rgba(0,0,0,0.45)]">
          <div className="flex items-center gap-3 mb-3">
            <div>
              <div className="text-[15px] font-semibold text-text-primary">
                {t('dashboard.fleetActivity', 'Activité du parc')}
              </div>
              <div className="text-[11px] font-mono text-text-muted tracking-wider">
                {activityRange} · agents en ligne / hors ligne
              </div>
            </div>
            <div className="ml-auto flex items-center gap-1 bg-bg-hover rounded-md p-0.5">
              {(['24h', '7j', '14j', '30j'] as ActivityRange[]).map(r => (
                <button
                  key={r}
                  onClick={() => setActivityRange(r)}
                  className={`px-2.5 py-1 text-[11px] font-mono rounded transition-colors ${
                    activityRange === r ? 'bg-bg-active text-text-primary' : 'text-text-muted hover:text-text-primary'
                  }`}
                >{r}</button>
              ))}
            </div>
          </div>
          <ActivityChart data={activityData} />
          <div className="flex items-center gap-4 mt-2 text-[11px] font-mono text-text-muted">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-green-400" /> Online
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 border-t border-dashed border-text-muted" /> Offline
            </span>
          </div>
        </div>

        <div className="rounded-xl bg-bg-secondary p-5 shadow-[0_1px_0_0_rgba(255,255,255,0.03),_0_6px_24px_-8px_rgba(0,0,0,0.45)]">
          <div className="mb-4">
            <div className="text-[15px] font-semibold text-text-primary">
              {t('dashboard.osBreakdown', 'Répartition OS')}
            </div>
            <div className="text-[11px] font-mono text-text-muted tracking-wider">
              {t('dashboard.fleetTotal', 'parc total')}
            </div>
          </div>
          <OsDonut slices={osSlices} total={total} />
        </div>
      </div>

      {/* Mini-stats row — preserved metrics: Critical / Pending approval /
          Sessions actives / Schedules 24h / Agent version. Compact format. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <MiniStat
          icon={<AlertCircle size={15} />}
          label={t('dashboard.critical', 'Critical')}
          value={critical}
          color={critical > 0 ? 'text-accent' : 'text-text-primary'}
          to="/devices?status=critical"
        />
        <MiniStat
          icon={<Clock size={15} />}
          label={t('dashboard.pendingApproval', 'À approuver')}
          value={pending}
          color={pending > 0 ? 'text-amber-400' : 'text-text-primary'}
          to="/devices?status=pending"
        />
        <MiniStat
          icon={<ScreenShare size={15} />}
          label={t('dashboard.activeSessions', 'Sessions actives')}
          value={remoteSess}
          color={remoteSess > 0 ? 'text-accent' : 'text-text-primary'}
          to="/admin/supervision"
        />
        <MiniStat
          icon={<Clock size={15} />}
          label={t('dashboard.upcomingSchedules', 'Schedules 24h')}
          value={upcoming}
          to="/automations"
        />
        <MiniStat
          icon={<Package size={15} />}
          label={t('dashboard.agentVersion', "Version d'agent")}
          value={latestVer ? `v${latestVer}` : '—'}
          sub={`${upToDate} / ${upToDate + outdated} à jour`}
          color={outdated > 0 ? 'text-amber-400' : 'text-green-400'}
        />
      </div>

      {/* Secondary metrics row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <AgentVersionsCard rows={versions} />
        <ComplianceGauge score={summary?.complianceScore ?? null} />
        <DiskSaturationCard data={disks} />
        <RemoteSessionsCard active={remoteSess} />
      </div>

      {/* Vue par groupe */}
      <div className="rounded-xl bg-bg-secondary p-5 shadow-[0_1px_0_0_rgba(255,255,255,0.03),_0_6px_24px_-8px_rgba(0,0,0,0.45)]">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex items-center gap-2">
            <FolderTree size={16} className="text-accent" />
            <div>
              <div className="text-[15px] font-semibold text-text-primary">
                {t('dashboard.groupView', 'Vue par groupe')}
              </div>
              <div className="text-[11px] font-mono text-text-muted tracking-wider">
                online · alerts · conformité · MAJ
              </div>
            </div>
          </div>
          <Link to="/admin/devices" className="ml-auto text-[12px] font-mono text-accent hover:opacity-80 transition-opacity">
            {t('dashboard.manageGroups', 'Gérer les groupes')} →
          </Link>
        </div>
        {groupTree.length === 0 ? (
          <div className="text-text-muted text-sm py-6 text-center">
            {t('dashboard.noGroups', 'Aucun groupe configuré')}
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {groupTree.map(g => <GroupCard key={g.groupId} group={g} />)}
          </div>
        )}
      </div>

    </div>
  );
}
