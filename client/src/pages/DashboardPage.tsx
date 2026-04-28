import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, ArrowRight, Package, Clock, FolderOpen, Plus, ScreenShare } from 'lucide-react';
import { useDeviceStore } from '@/store/deviceStore';
import { deviceApi, type GroupStats } from '@/api/device.api';
import { useTranslation } from 'react-i18next';
import { anonymize } from '@/utils/anonymize';
import { useUiStore } from '@/store/uiStore';

// ── Hero KPI card ───────────────────────────────────────────────────────────

function HeroCard({
  label, value, subline, color, sublineColor, featured, children,
}: {
  label: string;
  value: string | number;
  subline?: string;
  /** value text colour class, e.g. 'text-accent', 'text-green-400' */
  color?: string;
  sublineColor?: string;
  /** When true, applies the rose glow + gradient bg used for the lead card. */
  featured?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={[
        'rounded-xl p-5 relative overflow-hidden',
        featured
          ? 'bg-gradient-to-br from-accent/10 via-bg-secondary to-bg-secondary shadow-[0_0_0_1px_rgb(var(--c-accent)/0.18)_inset,_0_6px_28px_-10px_rgb(var(--c-accent)/0.25)]'
          : 'bg-bg-secondary shadow-[0_1px_0_0_rgba(255,255,255,0.03),_0_6px_24px_-8px_rgba(0,0,0,0.45)]',
      ].join(' ')}
    >
      <div className="text-[11px] font-mono uppercase tracking-[0.14em] text-text-muted mb-3">
        {label}
      </div>
      <div className={`text-[34px] font-semibold leading-none ${color ?? 'text-text-primary'}`}>
        {value}
      </div>
      {subline && (
        <div className={`text-xs font-mono mt-2 ${sublineColor ?? 'text-text-muted'}`}>
          {subline}
        </div>
      )}
      {children}
    </div>
  );
}

// ── Donut chart ─────────────────────────────────────────────────────────────

interface DonutSlice { name: string; value: number; color: string }

function OsDonut({ slices, total }: { slices: DonutSlice[]; total: number }) {
  // Convert to dasharray fragments. Each slice gets `value/total*100` units
  // of the 100-unit circumference, and the next slice's offset is the
  // negative cumulative sum.
  let cumulative = 0;
  const arcs = slices.map((s) => {
    const len = total > 0 ? (s.value / total) * 100 : 0;
    const offset = -cumulative + 25; // start at 12 o'clock (offset = 25 of 100)
    cumulative += len;
    return { ...s, len, offset };
  });
  return (
    <div className="flex items-center gap-5">
      <svg viewBox="0 0 42 42" className="w-28 h-28 shrink-0">
        <circle cx="21" cy="21" r="15.915" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="3.5" />
        {arcs.map((a) => (
          <circle
            key={a.name}
            cx="21" cy="21" r="15.915"
            fill="none"
            stroke={a.color}
            strokeWidth="3.5"
            strokeDasharray={`${a.len} ${100 - a.len}`}
            strokeDashoffset={a.offset}
            strokeLinecap="butt"
            transform="rotate(-90 21 21)"
          />
        ))}
        <text x="21" y="20" textAnchor="middle" dominantBaseline="middle"
              fill="rgb(var(--c-text-primary))" fontSize="6.5" fontWeight="600">{total}</text>
        <text x="21" y="26" textAnchor="middle" dominantBaseline="middle"
              fill="rgb(var(--c-text-muted))" fontSize="2.6" fontFamily="JetBrains Mono">total</text>
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

// ── Bottom status card ──────────────────────────────────────────────────────

function StatusCard({
  icon, label, name, count, badge, badgeTone = 'muted',
  iconTone = 'accent', to,
}: {
  icon: React.ReactNode;
  label: string;
  name: string;
  count?: string;
  badge?: string;
  badgeTone?: 'green' | 'amber' | 'red' | 'muted';
  iconTone?: 'accent' | 'amber' | 'green' | 'blue';
  to?: string;
}) {
  const iconBg: Record<string, string> = {
    accent: 'bg-accent/10 text-accent',
    amber:  'bg-amber-500/10 text-amber-400',
    green:  'bg-green-500/10 text-green-400',
    blue:   'bg-blue-500/10 text-blue-400',
  };
  const badgeBg: Record<string, string> = {
    green:  'bg-green-500/12 text-green-400',
    amber:  'bg-amber-500/12 text-amber-400',
    red:    'bg-accent/12 text-accent',
    muted:  'bg-bg-hover text-text-muted',
  };
  const body = (
    <div className="flex items-center gap-3.5 rounded-xl bg-bg-secondary p-4 shadow-[0_1px_0_0_rgba(255,255,255,0.03),_0_6px_24px_-8px_rgba(0,0,0,0.45)]">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${iconBg[iconTone]}`}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-text-muted">{label}</div>
        <div className="text-[15px] font-semibold text-text-primary mt-0.5 truncate">{name}</div>
        {count && <div className="text-[12px] font-mono text-text-muted mt-0.5">{count}</div>}
      </div>
      {badge && (
        <div className={`px-2.5 py-1 rounded-md text-[11px] font-mono font-medium shrink-0 ${badgeBg[badgeTone]}`}>
          {badge}
        </div>
      )}
    </div>
  );
  return to ? <Link to={to} className="block hover:opacity-90 transition-opacity">{body}</Link> : body;
}

// ── Page ────────────────────────────────────────────────────────────────────

export function DashboardPage() {
  const { t } = useTranslation();
  const { fetchDevices, summary, fetchSummary } = useDeviceStore();
  const { openAddAgentModal } = useUiStore();
  const [isLoading, setIsLoading] = useState(true);
  const [groupStats, setGroupStats] = useState<GroupStats[]>([]);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      await Promise.all([
        fetchDevices(),
        fetchSummary(),
        deviceApi.getGroupStats().then(setGroupStats).catch(() => {}),
      ]);
      setIsLoading(false);
    };
    load();
  }, [fetchDevices, fetchSummary]);

  // Derived KPIs
  const total       = summary?.total ?? 0;
  const online      = summary?.online ?? 0;
  const offline     = summary?.offline ?? 0;
  const pendingUpd  = summary?.pendingUpdates ?? 0;
  const stale       = summary?.staleDevices ?? 0;
  const upToDate    = summary?.agentUpToDate ?? 0;
  const outdated    = summary?.agentOutdated ?? 0;
  const latestVer   = summary?.latestAgentVersion ?? '';
  const remoteSess  = summary?.activeRemoteSessions ?? 0;
  const upcoming    = summary?.upcomingSchedules ?? 0;

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
    { name: t('dashboard.osOther', 'Autres'),  value: os.other, color: 'rgba(255,255,255,0.20)' },
  ], [os, t]);

  // Largest groups (top 5 by direct device count)
  const topGroups = useMemo(
    () => [...groupStats]
      .filter((g) => g.groupId !== null)
      .sort((a, b) => b.total - a.total)
      .slice(0, 5),
    [groupStats],
  );
  const largest = topGroups[0];
  const largestUpPct = largest && largest.total > 0
    ? Math.round((largest.online / largest.total) * 100)
    : null;

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

      {/* Hero row — 5 KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
        <HeroCard
          featured
          label={t('dashboard.totalDevices', 'Appareils total')}
          value={total}
          color="text-accent"
        >
          <div className="mt-3 h-1 w-full bg-white/[0.04] rounded">
            <div className="h-full rounded bg-accent" style={{ width: `${onlinePct}%` }} />
          </div>
          <div className="text-[11px] font-mono text-text-muted mt-2">
            {online} {t('dashboard.online')} · {offline} {t('dashboard.offline')}
          </div>
        </HeroCard>

        <HeroCard
          label={t('dashboard.online')}
          value={online}
          color="text-green-400"
          subline={`${onlinePct}% ${t('dashboard.ofFleet', 'du parc')}`}
        >
          <div className="mt-3 h-0.5 w-full bg-white/[0.04] rounded">
            <div className="h-full rounded bg-green-400" style={{ width: `${onlinePct}%` }} />
          </div>
        </HeroCard>

        <HeroCard
          label={t('dashboard.offline')}
          value={offline}
          sublineColor="text-text-muted"
          subline={`${offlinePct}% ${t('dashboard.ofFleet', 'du parc')}`}
        >
          <div className="mt-3 h-0.5 w-full bg-white/[0.04] rounded">
            <div className="h-full rounded bg-text-muted" style={{ width: `${offlinePct}%` }} />
          </div>
        </HeroCard>

        <HeroCard
          label={t('dashboard.pendingUpdates', 'MAJ en attente')}
          value={pendingUpd}
          color="text-amber-400"
          subline={`${updPct}% ${t('dashboard.toPatch', 'à patcher')}`}
        >
          <div className="mt-3 h-0.5 w-full bg-white/[0.04] rounded">
            <div className="h-full rounded bg-amber-400" style={{ width: `${updPct}%` }} />
          </div>
        </HeroCard>

        <HeroCard
          label={t('dashboard.staleDevices', 'Injoignables 72h')}
          value={stale}
          color="text-accent"
          sublineColor="text-accent"
          subline={stale > 0 ? `${stalePct}% ${t('dashboard.unreachable', 'injoignables')}` : t('dashboard.allReachable', 'tout le parc joignable')}
        >
          <div className="mt-3 h-0.5 w-full bg-white/[0.04] rounded">
            <div className="h-full rounded bg-accent" style={{ width: `${stalePct}%` }} />
          </div>
        </HeroCard>
      </div>

      {/* Two-col row: top groups list + OS donut */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3.5">
        <div className="lg:col-span-2 rounded-xl bg-bg-secondary p-5 shadow-[0_1px_0_0_rgba(255,255,255,0.03),_0_6px_24px_-8px_rgba(0,0,0,0.45)]">
          <div className="flex items-center gap-3 mb-4">
            <div>
              <div className="text-[15px] font-semibold text-text-primary">
                {t('dashboard.topGroups', 'Plus gros groupes')}
              </div>
              <div className="text-[11px] font-mono text-text-muted tracking-wider">
                {t('dashboard.topGroupsSub', 'tri par taille de parc')}
              </div>
            </div>
            <Link to="/devices" className="ml-auto text-[12px] font-mono text-text-muted hover:text-accent transition-colors">
              {t('dashboard.allGroups', 'Tous les groupes')} →
            </Link>
          </div>
          {topGroups.length === 0 ? (
            <div className="text-text-muted text-sm py-8 text-center">
              {t('dashboard.noGroups', 'Aucun groupe configuré')}
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {topGroups.map((g) => {
                const upPct = g.total > 0 ? Math.round((g.online / g.total) * 100) : 0;
                const barColor = upPct >= 95 ? 'bg-green-400' : upPct >= 70 ? 'bg-amber-400' : 'bg-accent';
                return (
                  <Link
                    key={g.groupId ?? 'ungrouped'}
                    to={g.groupId ? `/group/${g.groupId}` : '/devices'}
                    className="group flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-bg-hover transition-colors"
                  >
                    <FolderOpen size={15} className="text-accent shrink-0" />
                    <span className="text-[14px] font-medium text-text-primary truncate flex-1">
                      {anonymize(g.groupName) || t('dashboard.ungrouped', 'Sans groupe')}
                    </span>
                    <div className="w-32 h-1 bg-white/[0.04] rounded overflow-hidden">
                      <div className={`h-full ${barColor}`} style={{ width: `${upPct}%` }} />
                    </div>
                    <span className="font-mono text-[11px] text-text-muted w-16 text-right">
                      {g.online} / {g.total}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
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

      {/* Bottom row — actionable status snapshots */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {largest && (
          <StatusCard
            icon={<FolderOpen size={16} />}
            iconTone="green"
            label={t('dashboard.largestGroup', 'Plus gros groupe')}
            name={anonymize(largest.groupName) || '—'}
            count={`${largest.total} ${t('dashboard.devices', 'appareils')}`}
            badge={largestUpPct !== null ? `${largestUpPct}% up` : undefined}
            badgeTone={largestUpPct !== null && largestUpPct >= 95 ? 'green' : 'amber'}
            to={largest.groupId ? `/group/${largest.groupId}` : undefined}
          />
        )}

        <StatusCard
          icon={<Package size={16} />}
          iconTone="blue"
          label={t('dashboard.agentVersion', 'Version d\'agent')}
          name={latestVer ? `v${latestVer}` : '—'}
          count={`${upToDate} / ${upToDate + outdated} ${t('dashboard.upToDate', 'à jour')}`}
          badge={outdated > 0 ? `${outdated} outdated` : undefined}
          badgeTone={outdated > 0 ? 'amber' : 'muted'}
        />

        <StatusCard
          icon={<ScreenShare size={16} />}
          iconTone="accent"
          label={t('dashboard.activeSessions', 'Sessions actives')}
          name={remoteSess > 0 ? String(remoteSess) : '—'}
          count={t('dashboard.remoteSessionsSub', 'sessions distantes')}
          to="/admin/supervision"
        />

        <StatusCard
          icon={<Clock size={16} />}
          iconTone="amber"
          label={t('dashboard.upcomingSchedules', 'Schedules 24h')}
          name={String(upcoming)}
          count={t('dashboard.upcomingSchedulesSub', 'planifiés dans les prochaines 24h')}
          to="/automations"
          badge={upcoming === 0 ? '—' : undefined}
          badgeTone="muted"
        />
      </div>

    </div>
  );
}
