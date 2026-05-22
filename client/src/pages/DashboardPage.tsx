import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  RefreshCw, ArrowRight, Package, Clock, FolderOpen, Plus, ScreenShare,
  AlertTriangle, AlertCircle, HardDrive, ShieldCheck, FolderTree, Wifi, Box,
  Building2,
} from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { useDeviceStore } from '@/store/deviceStore';
import { MASTER_TENANT_ID } from '@obliance/shared';
import {
  deviceApi,
  type GroupStats, type FleetTimeseriesPoint, type FleetHourlyPoint,
  type AgentVersionRow, type DiskSaturationResult,
} from '@/api/device.api';
import { useTranslation } from 'react-i18next';
import { anonymize } from '@/utils/anonymize';
import { useUiStore } from '@/store/uiStore';
import { clsx } from 'clsx';
import { hypervApi } from '@/api/hyperv.api';
import { HyperVVmTable } from '@/components/hyperv/HyperVVmTable';
import type { VirtualMachine, VmAction } from '@obliance/shared';
import toast from 'react-hot-toast';

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
    // h-full + flex-col so this card stretches with its row siblings.
    // The "Appareils total" card carries the most content (sparkline +
    // 4-day grid) so it sets the row height; the simpler HeroCards now
    // grow to match instead of looking visibly shorter.
    <div className="h-full flex flex-col rounded-xl p-5 relative overflow-hidden bg-gradient-to-br from-accent/10 via-bg-secondary to-bg-secondary shadow-[0_0_0_1px_rgb(var(--c-accent)/0.18)_inset,_0_6px_28px_-10px_rgb(var(--c-accent)/0.25)]">
      <div className="text-[11px] font-mono uppercase tracking-[0.14em] text-text-muted mb-3">{label}</div>
      <div className={`font-display text-[48px] font-semibold leading-none ${color}`}>{value}</div>
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

function HeroCard({ label, value, color, delta, deltaText, barPct, barColor, subStats, subStatsHeader }: {
  label: string; value: number; color: string;
  /** Numeric delta sign for the icon: positive = ↑, negative = ↓, 0 = stable */
  delta?: number | null;
  deltaText?: string;
  barPct?: number;
  barColor?: string;
  /** Optional secondary breakdown rendered under the bar — used by the
   *  "En ligne" card to expose the warning / critical / updating /
   *  updateError counts so the total of "online + offline" matches the
   *  "Appareils total" headline even when some agents are in those
   *  intermediate states. Items are shown even at value 0 when
   *  `subStatsHeader` is set — the header makes the layout grid-like
   *  and a missing item under "Dont :" would feel like a bug. */
  subStats?: Array<{ label: string; value: number; color?: string }>;
  /** Optional label rendered above the subStats row (e.g. "Dont :"). */
  subStatsHeader?: string;
}) {
  const deltaIconClass = delta == null ? 'text-text-muted' :
                          delta === 0   ? 'text-text-muted' :
                          delta > 0     ? 'text-green-400' : 'text-accent';
  const deltaIcon = delta == null ? '—' : delta === 0 ? '—' : delta > 0 ? '↑' : '↓';
  return (
    // h-full + flex-col so the card matches the row height set by the
    // taller HeroFeatured sibling. Without this the simpler cards
    // appeared shorter and the row felt unbalanced.
    <div className="h-full flex flex-col rounded-xl p-5 relative overflow-hidden bg-bg-secondary shadow-[0_1px_0_0_rgba(255,255,255,0.03),_0_6px_24px_-8px_rgba(0,0,0,0.45)]">
      <div className="text-[11px] font-mono uppercase tracking-[0.14em] text-text-muted mb-3">{label}</div>
      <div className={`font-display text-[36px] font-semibold leading-none ${color}`}>{value}</div>
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
      {subStats && subStats.length > 0 && (
        <div className="mt-2">
          {subStatsHeader && (
            <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-text-muted/80 mb-1">
              {subStatsHeader}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] font-mono text-text-muted">
            {subStats.map((s) => (
              <span key={s.label} className="flex items-center gap-1">
                <span className={s.color ?? 'text-text-secondary'}>{s.value}</span>
                <span>{s.label}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Donut ────────────────────────────────────────────────────────────────────

interface DonutSlice { name: string; value: number; color: string; to?: string }

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
          const Inner = (
            <>
              <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: s.color }} />
              <span className="text-text-primary font-medium flex-1">{s.name}</span>
              <span className="text-text-muted font-mono text-[11px]">{s.value} · {pct}%</span>
            </>
          );
          return s.to ? (
            <Link key={s.name} to={s.to}
              className="flex items-center gap-3 text-[13px] -mx-1.5 px-1.5 py-0.5 rounded hover:bg-bg-hover transition-colors">
              {Inner}
            </Link>
          ) : (
            <div key={s.name} className="flex items-center gap-3 text-[13px]">
              {Inner}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Activity chart (online/offline lines, multi-tab) ─────────────────────────

type ActivityRange = '24h' | '7j' | '14j' | '30j';

// Unified shape so the chart can render both daily and hourly snapshots
// without branching internally — the parent maps each input to this.
interface ActivityPoint { label: string; online: number; offline: number; total: number }

function ActivityChart({ data }: { data: ActivityPoint[] }) {
  const { t } = useTranslation();
  if (data.length < 2) {
    return (
      <div className="h-[240px] flex items-center justify-center text-text-muted text-sm">
        {t('dashboard.notEnoughHistory', "Pas assez d'historique — données après 24h")}
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
          {data[i].label}
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
  const { t } = useTranslation();
  const max = Math.max(...rows.map(r => r.count), 1);
  return (
    <div className="rounded-xl bg-bg-secondary p-5 shadow-[0_1px_0_0_rgba(255,255,255,0.03),_0_6px_24px_-8px_rgba(0,0,0,0.45)] flex flex-col gap-3">
      <div>
        <div className="text-[15px] font-semibold text-text-primary">{t('dashboard.topAgentVersions', 'Top versions agent')}</div>
        <div className="text-[11px] font-mono text-text-muted tracking-wider">{t('dashboard.agentVersionsSub', 'distribution du parc')}</div>
      </div>
      {rows.length === 0 ? (
        <div className="text-text-muted text-sm py-4">{t('dashboard.noVersionsReported', 'Aucune version reportée')}</div>
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
  const { t } = useTranslation();
  const pct = score == null ? 0 : Math.max(0, Math.min(100, score));
  const color = pct >= 90 ? '#1edd8a' : pct >= 70 ? '#f5a623' : '#e03a3a';
  const dasharray = `${pct} 100`;
  return (
    <div className="rounded-xl bg-bg-secondary p-5 shadow-[0_1px_0_0_rgba(255,255,255,0.03),_0_6px_24px_-8px_rgba(0,0,0,0.45)] flex flex-col gap-2">
      <div>
        <div className="text-[15px] font-semibold text-text-primary">{t('dashboard.averageCompliance', 'Conformité moyenne')}</div>
        <div className="text-[11px] font-mono text-text-muted tracking-wider">{t('dashboard.averageComplianceSub', 'policies actives')}</div>
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
        {t('dashboard.viewPolicies', 'Voir les policies')} →
      </Link>
    </div>
  );
}

// ── Disques saturés ──────────────────────────────────────────────────────────

function DiskSaturationCard({ data }: { data: DiskSaturationResult }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-xl bg-bg-secondary p-5 shadow-[0_1px_0_0_rgba(255,255,255,0.03),_0_6px_24px_-8px_rgba(0,0,0,0.45)] flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div className="text-[15px] font-semibold text-text-primary">{t('dashboard.diskSaturated', 'Disques saturés')}</div>
          <div className="text-[11px] font-mono text-text-muted tracking-wider">{t('dashboard.diskSaturatedSub', 'au-dessus du seuil défini')}</div>
        </div>
        <div className={`font-display text-[30px] font-semibold ${data.count > 0 ? 'text-amber-400' : 'text-text-muted'} leading-none`}>{data.count}</div>
      </div>
      {data.top.length === 0 ? (
        <div className="text-text-muted text-[12px] font-mono">{t('dashboard.diskSaturatedNone', 'Aucun disque critique')}</div>
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
  const { t } = useTranslation();
  return (
    <div className="rounded-xl bg-bg-secondary p-5 shadow-[0_1px_0_0_rgba(255,255,255,0.03),_0_6px_24px_-8px_rgba(0,0,0,0.45)] flex flex-col gap-3">
      <div>
        <div className="text-[15px] font-semibold text-text-primary">{t('dashboard.remoteSessions', 'Sessions remote')}</div>
        <div className="text-[11px] font-mono text-text-muted tracking-wider">{t('dashboard.remoteSessionsSub', 'live · ObliReach + tunnels')}</div>
      </div>
      <div className="flex items-baseline gap-3">
        <span className={`font-display text-[40px] font-semibold leading-none ${active > 0 ? 'text-accent' : 'text-text-muted'}`}>{active}</span>
        <span className="text-[12px] font-mono text-text-muted">{t('dashboard.remoteSessionsCount', 'en cours')}</span>
      </div>
      <Link to="/admin/supervision"
        className="text-[11px] font-mono text-text-muted hover:text-accent transition-colors flex items-center gap-1">
        <ScreenShare size={11} /> {t('dashboard.supervision', 'Supervision')} →
      </Link>
    </div>
  );
}

// ── Vue par groupe (recursive cards) ─────────────────────────────────────────

function GroupCard({ group, children, depth = 0 }: { group: GroupStats; children?: React.ReactNode; depth?: number }) {
  const { t } = useTranslation();
  const upPct = group.total > 0 ? Math.round((group.online / group.total) * 100) : 0;
  const barColor = upPct >= 95 ? 'bg-green-400' : upPct >= 70 ? 'bg-amber-400' : 'bg-accent';
  const warnings = group.warning + group.critical;

  // Conformité — green ≥90 / amber ≥70 / red <70 / muted if no policy
  const complianceColor =
    group.complianceScore == null ? 'text-text-muted' :
    group.complianceScore >= 90   ? 'text-green-400' :
    group.complianceScore >= 70   ? 'text-amber-400' :
                                    'text-accent';
  // MAJ — amber if any pending, muted otherwise
  const updatesColor = group.pendingUpdates > 0 ? 'text-amber-400' : 'text-text-muted';
  const onlineColor =
    upPct >= 95 ? 'text-green-400' :
    upPct >= 70 ? 'text-amber-400' :
                  'text-accent';

  return (
    <div className={`rounded-lg px-4 py-3 shadow-[0_1px_0_0_rgba(255,255,255,0.03),_0_4px_18px_-8px_rgba(0,0,0,0.45)] ${depth > 0 ? 'bg-bg-tertiary' : 'bg-bg-secondary'}`}>
      <Link
        to={group.groupId ? `/group/${group.groupId}` : '/devices'}
        className="flex items-center gap-3 group min-w-0"
      >
        <FolderOpen size={depth > 0 ? 14 : 16} className="text-accent shrink-0" />
        <span className="text-[14px] font-semibold text-text-primary truncate min-w-0">
          {anonymize(group.groupName) || t('dashboard.ungrouped', 'Sans groupe')}
        </span>

        <div
          className="flex items-center gap-1.5 ml-2"
          title={t('dashboard.tooltipOnline', '{{online}} en ligne sur {{total}} ({{pct}}%)', { online: group.online, total: group.total, pct: upPct })}
        >
          <Wifi size={13} className={onlineColor} />
          <span className="font-mono text-[12px] text-text-secondary">
            <span className={onlineColor}>{group.online}</span>
            <span className="text-text-muted"> / {group.total}</span>
          </span>
        </div>

        <div className="flex-1 min-w-0 max-w-[300px] h-1.5 bg-white/[0.04] rounded overflow-hidden mx-2">
          <div className={`h-full ${barColor}`} style={{ width: `${upPct}%` }} />
        </div>

        <div className="flex items-center gap-3 ml-auto shrink-0">
          {warnings > 0 && (
            <div
              className="flex items-center gap-1 font-mono text-[12px] text-amber-400"
              title={t('dashboard.tooltipAlerts', '{{warning}} warning · {{critical}} critical', { warning: group.warning, critical: group.critical })}
            >
              <AlertTriangle size={13} /> {warnings}
            </div>
          )}
          <div
            className={`flex items-center gap-1 font-mono text-[12px] ${complianceColor}`}
            title={
              group.complianceScore == null
                ? t('dashboard.tooltipNoCompliance', 'Aucune policy de conformité appliquée')
                : t('dashboard.tooltipCompliance', 'Conformité : {{pct}}% sur {{count}} policy(ies)', { pct: Math.round(group.complianceScore), count: group.policyCount })
            }
          >
            <ShieldCheck size={13} />
            {group.complianceScore != null ? `${Math.round(group.complianceScore)}%` : '—'}
          </div>
          <div
            className={`flex items-center gap-1 font-mono text-[12px] ${updatesColor}`}
            title={
              group.pendingUpdates === 0
                ? t('dashboard.tooltipNoUpdates', 'Aucune MAJ en attente')
                : t('dashboard.tooltipUpdates', '{{count}} appareil(s) avec MAJ en attente', { count: group.pendingUpdates })
            }
          >
            <Box size={13} />
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

// ── Connectivity by OS (horizontal stacked bars) ─────────────────────────────

function OsConnectivityCard({ data }: {
  data: Record<'windows' | 'macos' | 'linux' | 'other', { online: number; total: number }> | undefined;
}) {
  const { t } = useTranslation();
  const rows: { name: string; color: string; online: number; total: number; to: string }[] = [
    { name: 'Windows',                              color: '#4f7bff', online: data?.windows.online ?? 0, total: data?.windows.total ?? 0, to: '/devices?os=windows' },
    { name: 'Linux',                                color: '#f5a623', online: data?.linux.online   ?? 0, total: data?.linux.total   ?? 0, to: '/devices?os=linux' },
    { name: 'macOS',                                color: '#1edd8a', online: data?.macos.online   ?? 0, total: data?.macos.total   ?? 0, to: '/devices?os=macos' },
    { name: t('dashboard.osOther', 'Autres'),       color: 'rgba(255,255,255,0.20)', online: data?.other.online ?? 0, total: data?.other.total ?? 0, to: '/devices?os=other' },
  ].filter(r => r.total > 0);

  const max = Math.max(...rows.map(r => r.total), 1);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <div className="text-[13px] font-semibold text-text-primary">{t('dashboard.osConnectivity', 'Connectivité par OS')}</div>
        <div className="text-[10px] font-mono text-text-muted tracking-wider">online / total</div>
      </div>
      {rows.length === 0 ? (
        <div className="text-text-muted text-[12px] py-2">{t('dashboard.noData', 'Aucune donnée')}</div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {rows.map(r => {
            const offline = r.total - r.online;
            const onlinePct  = (r.online / max) * 100;
            const offlinePct = (offline  / max) * 100;
            const upPct = r.total > 0 ? Math.round((r.online / r.total) * 100) : 0;
            return (
              <Link key={r.name} to={r.to}
                className="flex items-center gap-3 -mx-1.5 px-1.5 py-0.5 rounded hover:bg-bg-hover transition-colors"
                title={t('dashboard.tooltipOnline', '{{online}} en ligne sur {{total}} ({{pct}}%)', { online: r.online, total: r.total, pct: upPct })}>
                <span className="flex items-center gap-1.5 w-20 shrink-0">
                  <span className="w-2 h-2 rounded-sm" style={{ background: r.color }} />
                  <span className="text-[12px] text-text-secondary truncate">{r.name}</span>
                </span>
                <div className="flex-1 h-2 bg-white/[0.04] rounded overflow-hidden flex">
                  <div className="h-full" style={{ width: `${onlinePct}%`, background: '#1edd8a' }} />
                  <div className="h-full" style={{ width: `${offlinePct}%`, background: 'rgba(255,255,255,0.18)' }} />
                </div>
                <span className="font-mono text-[11px] text-text-muted w-14 text-right shrink-0">
                  <span className="text-green-400">{r.online}</span>
                  <span className="text-text-muted">/{r.total}</span>
                </span>
              </Link>
            );
          })}
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
  const isAdmin = useAuthStore((s) => s.isAdmin)();
  const [isLoading, setIsLoading] = useState(true);
  const [groupStats, setGroupStats] = useState<GroupStats[]>([]);
  const [series, setSeries] = useState<FleetTimeseriesPoint[]>([]);
  const [hourlySeries, setHourlySeries] = useState<FleetHourlyPoint[]>([]);
  const [versions, setVersions] = useState<AgentVersionRow[]>([]);
  const [disks, setDisks] = useState<DiskSaturationResult>({ count: 0, threshold: 0, top: [] });
  const [activityRange, setActivityRange] = useState<ActivityRange>('14j');
  // Hyper-V tenant grid (Dashboard tab). The tab only appears when the
  // tenant has at least one VM reported by a Hyper-V host.
  const [dashTab, setDashTab] = useState<'overview' | 'hyperv'>('overview');
  const [hyperVms, setHyperVms] = useState<VirtualMachine[]>([]);
  const [hvBusyVmId, setHvBusyVmId] = useState<string | null>(null);
  const loadHyperVms = useCallback(() => {
    hypervApi.listForTenant().then(setHyperVms).catch(() => setHyperVms([]));
  }, []);
  useEffect(() => { loadHyperVms(); }, [loadHyperVms]);
  const handleHvAction = async (vm: VirtualMachine, action: VmAction) => {
    if (action === 'delete' && !confirm(t('hyperv.confirmDelete', { name: vm.name }) || `Delete VM "${vm.name}"? Irreversible.`)) return;
    let params: Record<string, unknown> | undefined;
    if (action === 'checkpoint_create') {
      const name = prompt(t('hyperv.checkpointNamePrompt') || 'Checkpoint name (optional):') ?? '';
      params = name ? { checkpointName: name } : undefined;
    }
    setHvBusyVmId(vm.vmId);
    try {
      const out = await hypervApi.action(vm.hostDeviceId, vm.vmId, action, params);
      if (out && out.status === 'pending_approval') {
        toast.success(t('hyperv.pendingApproval') || 'Action saved — awaiting second admin approval', { duration: 6000 });
      } else {
        toast.success(t('hyperv.actionQueued') || 'Action sent to host');
      }
      setTimeout(loadHyperVms, 2500);
    } catch (e: any) {
      toast.error(e?.response?.data?.error || (t('common.error') || 'Failed'));
    } finally {
      setHvBusyVmId(null);
    }
  };

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      await Promise.all([
        fetchDevices(),
        fetchSummary(),
        deviceApi.getGroupStats().then(setGroupStats).catch(() => {}),
        deviceApi.getFleetTimeseries(30).then(setSeries).catch(() => {}),
        deviceApi.getFleetHourly(24).then(setHourlySeries).catch(() => {}),
        deviceApi.getAgentVersions().then(setVersions).catch(() => {}),
        // Lot D.2: pass 0 as the floor so per-device thresholds resolved
        // server-side dictate the alert level — a kiosk with warn=70 shows up
        // at 70 %, a 10 TB server with warn=90 only at 90 %.
        deviceApi.getDiskSaturated(0).then(setDisks).catch(() => {}),
      ]);
      setIsLoading(false);
    };
    load();
  }, [fetchDevices, fetchSummary]);

  // Derived KPIs
  const total       = summary?.total ?? 0;
  // `summary.online` counts ONLY the strict 'online' status. The
  // dashboard hero used to pretend that "online + offline = total"
  // which never matched the headline: warn/critical/updating/
  // update_error agents are all REACHABLE (the agent is pushing) —
  // they just carry a flag (metric alert, mid-update, update flow
  // errored). We sum every "agent-reachable" status into the
  // `connected` figure and expose the breakdowns as subStats. Without
  // updating + update_error, child tenants with a recent agent
  // version bump saw a 200+ device gap between total and
  // online+offline (cf. user report 1026 ≠ 612+159).
  const onlineStrict = summary?.online ?? 0;
  const warning     = summary?.warning ?? 0;
  const critical    = summary?.critical ?? 0;
  const updating    = (summary as any)?.updating ?? 0;
  const updateError = (summary as any)?.updateError ?? 0;
  // update_error devices stop pushing (the engine flips them out of
  // 'updating' after 10 min without a version change), so the user
  // observes them on /devices?status=offline. We bucket them with
  // offline in the headline + sub-stat instead of with connected,
  // even though the server keeps them in their own status enum.
  const connected   = onlineStrict + warning + critical + updating;
  const offlineRaw  = summary?.offline ?? 0;
  const offline     = offlineRaw + updateError;
  const pending     = summary?.pending ?? 0;
  const pendingUpd  = summary?.pendingUpdates ?? 0;
  const stale       = summary?.staleDevices ?? 0;
  const upToDate    = summary?.agentUpToDate ?? 0;
  const outdated    = summary?.agentOutdated ?? 0;
  const latestVer   = summary?.latestAgentVersion ?? '';
  const remoteSess  = summary?.activeRemoteSessions ?? 0;
  const upcoming    = summary?.upcomingSchedules ?? 0;
  const deltas      = summary?.deltas;

  const onlinePct  = total > 0 ? Math.round((connected / total) * 100) : 0;
  const offlinePct = total > 0 ? Math.round((offline / total) * 100) : 0;
  const updPct     = total > 0 ? Math.round((pendingUpd / total) * 100) : 0;
  const stalePct   = total > 0 ? Math.round((stale / total) * 100) : 0;

  // OS donut data — each slice carries the /devices?os=<family> URL so the
  // legend rows are clickable shortcuts to the filtered device list.
  const os = summary?.osByType ?? { windows: 0, macos: 0, linux: 0, other: 0 };
  const osSlices: DonutSlice[] = useMemo(() => [
    { name: 'Windows', value: os.windows, color: '#4f7bff', to: '/devices?os=windows' },
    { name: 'Linux',   value: os.linux,   color: '#f5a623', to: '/devices?os=linux' },
    { name: 'macOS',   value: os.macos,   color: '#1edd8a', to: '/devices?os=macos' },
    { name: t('dashboard.osOther', 'Autres'), value: os.other, color: 'rgba(255,255,255,0.20)', to: '/devices?os=other' },
  ], [os, t]);

  // Activity chart data — branches on the requested range:
  //   24h → hourly snapshots (intra-day resolution)
  //   7j/14j/30j → daily snapshots
  // Both feed the unified ActivityPoint shape so ActivityChart stays simple.
  const rangeDays = activityRange === '24h' ? 1 : activityRange === '7j' ? 7 : activityRange === '14j' ? 14 : 30;
  const activityData: ActivityPoint[] = useMemo(() => {
    if (activityRange === '24h') {
      return hourlySeries.map((p) => {
        const d = new Date(p.hour);
        const hh = String(d.getHours()).padStart(2, '0');
        return { label: `${hh}h`, online: p.online, offline: p.offline, total: p.total };
      });
    }
    return series.slice(-rangeDays).map((p) => ({
      label: p.day.slice(5),
      online: p.online, offline: p.offline, total: p.total,
    }));
  }, [activityRange, series, hourlySeries, rangeDays]);

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

  // Hierarchical group tree — group-stats now ships parent_id + sort_order so
  // we can render Group1 → Sub1 → Sub2 with the admin-defined ordering and
  // proper depth indentation, instead of a flat "biggest first" list.
  type GroupNode = GroupStats & { children: GroupNode[] };
  const groupTree = useMemo<GroupNode[]>(() => {
    const nodes = new Map<number, GroupNode>();
    for (const g of groupStats) {
      if (g.groupId == null) continue;
      nodes.set(g.groupId, { ...g, children: [] });
    }
    const roots: GroupNode[] = [];
    for (const node of nodes.values()) {
      if (node.parentId != null && nodes.has(node.parentId)) {
        nodes.get(node.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }
    // Sort siblings by sortOrder (server pre-sorted but a re-sort guarantees
    // stability after concurrent edits to the group list).
    const sortRec = (list: GroupNode[]) => {
      list.sort((a, b) => a.sortOrder - b.sortOrder
        || (a.groupName ?? '').localeCompare(b.groupName ?? ''));
      for (const n of list) sortRec(n.children);
    };
    sortRec(roots);
    return roots;
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
        <h1 className="font-display text-2xl font-semibold tracking-wide text-text-primary">
          {t('dashboard.title', 'Tableau de bord')}
        </h1>
        <span className="text-xs font-mono tracking-wider text-text-muted">
          {total} {t('dashboard.devicesManaged', 'appareils gérés')}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {isAdmin && (
            <button
              onClick={openAddAgentModal}
              className="inline-flex items-center gap-2 h-9 px-3.5 rounded-md bg-bg-hover hover:bg-bg-active text-[13px] font-medium text-text-primary transition-colors"
            >
              <Plus size={14} />
              {t('nav.addAgent')}
            </button>
          )}
          <Link
            to="/devices"
            className="inline-flex items-center gap-2 h-9 px-3.5 rounded-md bg-accent/12 hover:bg-accent/20 text-[13px] font-medium text-accent transition-colors"
          >
            {t('dashboard.allDevices', 'Voir tous les appareils')}
            <ArrowRight size={14} />
          </Link>
        </div>
      </div>

      {/* Tab bar — Overview vs Hyper-V. The Hyper-V tab only shows when the
          tenant has at least one VM reported by a host agent. */}
      {hyperVms.length > 0 && (
        <div className="flex items-center gap-1 border-b border-border/40">
          {([
            { id: 'overview' as const, label: t('dashboard.tabOverview', 'Vue d’ensemble') },
            { id: 'hyperv' as const, label: `Hyper-V (${hyperVms.length})` },
          ]).map((tb) => (
            <button
              key={tb.id}
              onClick={() => setDashTab(tb.id)}
              className={clsx(
                'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                dashTab === tb.id
                  ? 'border-accent text-text-primary'
                  : 'border-transparent text-text-muted hover:text-text-primary',
              )}
            >
              {tb.label}
            </button>
          ))}
        </div>
      )}

      {dashTab === 'hyperv' ? (
        <HyperVVmTable vms={hyperVms} busyVmId={hvBusyVmId} showHost onAction={handleHvAction} />
      ) : (
      <>
      {/* Hero row — featured Total + 4 KPIs with deltas. Each card is a Link
          to the matching filtered /devices view so the user can drill into
          the underlying agents in one click. */}
      {/* `items-stretch` is grid's default but we add `h-full` on each
          Link wrapper too: without it the inner card shrinks to its
          content height and the row looks ragged when "Appareils
          total" carries a sparkline + 4-day grid the others don't. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5 items-stretch">
        <Link to="/devices" className="h-full block hover:opacity-95 transition-opacity">
          <HeroFeatured
            label={t('dashboard.totalDevices', 'Appareils total')}
            value={total}
            color="text-accent"
            series={featuredSeries.length > 1 ? featuredSeries : [total, total]}
            days={featuredDays.length > 0 ? featuredDays : [{ short: 'NOW', value: total }]}
          />
        </Link>

        {/* "En ligne" = every connected device (online + warning + critical).
            Strictly online stays separate but is exposed under the bar
            via subStats so the user sees the breakdown. The link uses
            the server-side virtual status `connected` (see
            device.service.ts) so /devices lands on the same union the
            headline number describes. */}
        <Link to="/devices?status=connected" className="h-full block hover:opacity-95 transition-opacity">
          <HeroCard
            label={t('dashboard.online', 'En ligne')}
            value={connected}
            color="text-green-400"
            delta={deltas?.onlineVsYesterday ?? null}
            deltaText={
              deltas?.onlineVsYesterday == null ? `${onlinePct}% ${t('dashboard.ofFleet', 'du parc')}`
                : deltas.onlineVsYesterday === 0 ? t('dashboard.stableVsYesterday', 'stable vs hier')
                : `${Math.abs(deltas.onlineVsYesterday)} ${t('dashboard.vsYesterday', 'vs hier')}`
            }
            barPct={onlinePct}
            barColor="#1edd8a"
            subStatsHeader={t('dashboard.ofWhichHeader', 'Dont :')}
            subStats={[
              { label: t('dashboard.subStatWarning', 'en alerte'), value: warning, color: 'text-yellow-400' },
              { label: t('dashboard.subStatCritical', 'critique'), value: critical, color: 'text-red-400' },
              { label: t('dashboard.subStatUpdating', 'en MAJ'), value: updating, color: 'text-blue-400' },
            ]}
          />
        </Link>

        <Link to="/devices?status=disconnected" className="h-full block hover:opacity-95 transition-opacity">
          <HeroCard
            label={t('dashboard.offline', 'Hors ligne')}
            value={offline}
            color="text-text-secondary"
            delta={deltas?.offlineVsYesterday == null ? null : -deltas.offlineVsYesterday}
            deltaText={
              deltas?.offlineVsYesterday == null ? `${offlinePct}% ${t('dashboard.ofFleet', 'du parc')}`
                : deltas.offlineVsYesterday === 0 ? t('dashboard.stable', 'stable')
                : `${Math.abs(deltas.offlineVsYesterday)} ${t('dashboard.vsYesterday', 'vs hier')}`
            }
            barPct={offlinePct}
            barColor="rgb(var(--c-text-muted))"
            subStatsHeader={updateError > 0 ? t('dashboard.ofWhichHeader', 'Dont :') : undefined}
            subStats={updateError > 0 ? [
              { label: t('dashboard.subStatUpdateError', 'en erreur MAJ'), value: updateError, color: 'text-orange-400' },
            ] : undefined}
          />
        </Link>

        <Link to="/devices?pendingUpdates=1" className="h-full block hover:opacity-95 transition-opacity">
          <HeroCard
            label={t('dashboard.pendingUpdates', 'MAJ en attente')}
            value={pendingUpd}
            color="text-amber-400"
            delta={deltas?.pendingUpdatesVsWeek == null ? null : -deltas.pendingUpdatesVsWeek}
            deltaText={
              deltas?.pendingUpdatesVsWeek == null ? `${updPct}% ${t('dashboard.toPatch', 'à patcher')}`
                : deltas.pendingUpdatesVsWeek === 0 ? t('dashboard.stableThisWeek', 'stable cette semaine')
                : `${Math.abs(deltas.pendingUpdatesVsWeek)} ${t('dashboard.thisWeek', 'cette semaine')}`
            }
            barPct={updPct}
            barColor="#f5a623"
          />
        </Link>

        <Link to="/devices?stale=72" className="h-full block hover:opacity-95 transition-opacity">
          <HeroCard
            label={t('dashboard.staleDevices', 'Injoignables 72h')}
            value={stale}
            color="text-accent"
            delta={deltas?.staleVsYesterday == null ? null : -deltas.staleVsYesterday}
            deltaText={
              stale === 0 ? t('dashboard.allReachable', 'tout le parc joignable')
                : deltas?.staleVsYesterday == null ? `${stalePct}% ${t('dashboard.unreachable', 'injoignables')}`
                : deltas.staleVsYesterday === 0 ? `${stale} ${t('dashboard.stable', 'stable')}`
                : deltas.staleVsYesterday > 0 ? `${deltas.staleVsYesterday} ${t('dashboard.newCount', 'nouveaux')}`
                : `${Math.abs(deltas.staleVsYesterday)} ${t('dashboard.recovered', 'récupérés')}`
            }
            barPct={stalePct}
            barColor="rgb(var(--c-accent))"
          />
        </Link>
      </div>

      {/* Two-col row: Activity chart (2/3) + OS donut (1/3) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3.5">
        <div className="lg:col-span-2 rounded-xl bg-bg-secondary p-5 shadow-[0_1px_0_0_rgba(255,255,255,0.03),_0_6px_24px_-8px_rgba(0,0,0,0.45)]">
          <div className="flex items-center gap-3 mb-3">
            <div>
              <div className="text-[15px] font-semibold text-text-primary">
                {t('dashboard.fleetActivity', 'Activité du parc')}
              </div>
              {/* Subtitle surfaces how much history is actually available —
                  daily snapshots for 7j/14j/30j, hourly for 24h — so
                  identical curves on long ranges (when only N<14 daily
                  snapshots exist) are immediately explainable. */}
              <div className="text-[11px] font-mono text-text-muted tracking-wider">
                {activityRange} · {t('dashboard.agentsOnlineOffline', 'agents en ligne / hors ligne')}
                {' · '}
                {activityRange === '24h'
                  ? t('dashboard.historyAvailableHours', '{{count}} h disponibles', { count: hourlySeries.length })
                  : t('dashboard.historyAvailable', '{{count}} j disponibles', { count: series.length })}
              </div>
            </div>
            <div className="ml-auto flex items-center gap-1 bg-bg-hover rounded-md p-0.5">
              {(['24h', '7j', '14j', '30j'] as ActivityRange[]).map(r => {
                // Disable ranges we can't fill yet. 24h pulls from the hourly
                // snapshot table (separate cron), the others from daily.
                const need = r === '24h' ? 2 : r === '7j' ? 2 : r === '14j' ? 8 : 15;
                const have = r === '24h' ? hourlySeries.length : series.length;
                const enabled = have >= need;
                const isActive = activityRange === r;
                return (
                  <button
                    key={r}
                    onClick={() => enabled && setActivityRange(r)}
                    disabled={!enabled}
                    title={enabled
                      ? r
                      : t('dashboard.notEnoughForRange', 'Historique insuffisant ({{have}}/{{need}})', { have, need })}
                    className={`px-2.5 py-1 text-[11px] font-mono rounded transition-colors ${
                      isActive
                        ? 'bg-bg-active text-text-primary'
                        : enabled
                          ? 'text-text-muted hover:text-text-primary'
                          : 'text-text-muted/40 cursor-not-allowed'
                    }`}
                  >{r}</button>
                );
              })}
            </div>
          </div>
          <ActivityChart data={activityData} />
          <div className="flex items-center gap-4 mt-2 text-[11px] font-mono text-text-muted">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-green-400" /> {t('dashboard.online', 'Online')}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 border-t border-dashed border-text-muted" /> {t('dashboard.offline', 'Offline')}
            </span>
          </div>
        </div>

        <div className="rounded-xl bg-bg-secondary p-5 shadow-[0_1px_0_0_rgba(255,255,255,0.03),_0_6px_24px_-8px_rgba(0,0,0,0.45)] flex flex-col gap-5">
          <div>
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
          {/* Sibling card — connectivité par OS (online/offline split for each
              OS family). Complements the donut by showing which OS bucket is
              most unhealthy at a glance. */}
          <div className="pt-4 border-t border-border">
            <OsConnectivityCard data={summary?.osConnectivity} />
          </div>
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

      {/* Vue par groupe — hierarchical, root → children indented by depth.
          Sibling order respects each group's admin-defined sortOrder so the
          dashboard reads exactly like the group tree elsewhere in the app. */}
      <div className="rounded-xl bg-bg-secondary p-5 shadow-[0_1px_0_0_rgba(255,255,255,0.03),_0_6px_24px_-8px_rgba(0,0,0,0.45)]">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex items-center gap-2">
            <FolderTree size={16} className="text-accent" />
            <div>
              <div className="text-[15px] font-semibold text-text-primary">
                {t('dashboard.groupView', 'Vue par groupe')}
              </div>
              <div className="text-[11px] font-mono text-text-muted tracking-wider">
                {t('dashboard.groupViewSub', 'online · alerts · conformité · MAJ')}
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
            {/* Master tenant: bucket by tenant header before the group
                tree. The sidebar already does this; replicating it
                here keeps the dashboard legible when groups across
                tenants share names (DC / Caisses / etc.) Each
                tenant's master-fan-out groups are sorted alpha after
                the master itself. */}
            {(() => {
              const buckets = bucketGroupsByTenant(groupTree);
              if (!buckets) {
                // Single-tenant view — render flat.
                return groupTree.map(g => renderGroupNode(g, 0));
              }
              return buckets.map(([tenantId, { tenantName, roots }]) => (
                <div key={`tenant-${tenantId}`} className="space-y-2">
                  <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-accent border-b border-accent/20 pb-1">
                    <Building2 size={11} />
                    <span>{tenantName}</span>
                    <span className="text-text-muted">·</span>
                    <span className="text-text-muted">
                      {roots.reduce((sum, g) => sum + g.total, 0)} {t('dashboard.devices', 'appareils')}
                    </span>
                  </div>
                  {roots.map(g => renderGroupNode(g, 0))}
                </div>
              ));
            })()}
          </div>
        )}
      </div>
      </>
      )}

    </div>
  );
}

// Master-tenant grouping helper for the "Vue par groupe" panel.
// Returns null on single-tenant view (caller falls back to flat
// rendering). On master, returns one bucket per tenant:
//   - master tenant first (id=1) — internal devices stay grouped
//   - then alpha by tenant name
// Each bucket carries the GROUP TREE ROOTS owned by that tenant.
// Group rows without tenantId (legacy / "ungrouped" pseudo-row) fall
// back into a "Sans tenant" pseudo-bucket at the tail.
function bucketGroupsByTenant(
  groupTree: Array<GroupStats & { children: any[] }>,
): Array<[number, { tenantName: string; roots: Array<GroupStats & { children: any[] }> }]> | null {
  // Detect master view by checking if any node carries tenantId — the
  // server only populates it on master. On a child tenant view every
  // row has tenantId=null and we skip bucketing.
  const anyHasTenant = groupTree.some((g) => g.tenantId != null);
  if (!anyHasTenant) return null;
  const byTenant = new Map<number, { tenantName: string; roots: Array<GroupStats & { children: any[] }> }>();
  for (const root of groupTree) {
    const tid = root.tenantId ?? 0;
    const tname = root.tenantName ?? (tid === 0 ? 'Sans tenant' : `Tenant ${tid}`);
    if (!byTenant.has(tid)) byTenant.set(tid, { tenantName: tname, roots: [] });
    byTenant.get(tid)!.roots.push(root);
  }
  return [...byTenant.entries()].sort(([aId, a], [bId, b]) => {
    if (aId === MASTER_TENANT_ID) return -1;
    if (bId === MASTER_TENANT_ID) return 1;
    if (aId === 0) return 1; // pseudo bucket at the tail
    if (bId === 0) return -1;
    return a.tenantName.localeCompare(b.tenantName);
  });
}

// Recursively render a group node with its children, indented by depth so
// the hierarchy reads at a glance. Children appear directly below their
// parent in the same flat column (no nested cards) — keeps the visual
// rhythm consistent across depths.
function renderGroupNode(
  node: GroupStats & { children: Array<GroupStats & { children: any[] }> },
  depth: number,
): React.ReactNode {
  return (
    <div key={node.groupId} style={{ paddingLeft: depth > 0 ? `${Math.min(depth, 4) * 18}px` : undefined }}>
      <GroupCard group={node} depth={depth} />
      {node.children.length > 0 && (
        <div className="flex flex-col gap-2.5 mt-2.5">
          {node.children.map((c) => renderGroupNode(c, depth + 1))}
        </div>
      )}
    </div>
  );
}
