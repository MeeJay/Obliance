import { LogOut, Download } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/store/authStore';
import { useTenantStore } from '@/store/tenantStore';
import { anonymize } from '@/utils/anonymize';
import { useSocketStore } from '@/store/socketStore';
import { NotificationCenter } from './NotificationCenter';
import { TenantSwitcher } from './TenantSwitcher';
import { Logo } from '@/components/common/Logo';
import { cn } from '@/utils/cn';

/** True when running inside the Obliance native desktop app overlay. */
const isNativeApp = typeof window !== 'undefined' &&
 !!(window as Window & { __obliance_is_native_app?: boolean }).__obliance_is_native_app;

// ── App switcher data ───────────────────────────────────────────────────────
//
// Per docs/obli-design-system.md §1 + §4.1 — five fixed pills, current app
// glowing with its own brand colour. The order is fixed across the suite so
// muscle memory carries between apps.

type AppType = 'obliview' | 'obliguard' | 'oblimap' | 'obliance' | 'obliplan' | 'oblihub';

interface AppEntry {
 type: AppType;
 label: string;
 /** Brand dot colour. Reused as the active pill's text + glow. */
 color: string;
}

const APP_ORDER: AppEntry[] = [
 { type: 'obliview', label: 'Obliview', color: '#2bc4bd' },
 { type: 'obliguard', label: 'Obliguard', color: '#f5a623' },
 { type: 'oblimap', label: 'Oblimap', color: '#1edd8a' },
 { type: 'obliance', label: 'Obliance', color: '#e03a3a' },
 { type: 'obliplan', label: 'Obliplan', color: '#7c6cff' },
 { type: 'oblihub', label: 'Oblihub', color: '#2d4ec9' },
];

const CURRENT_APP: AppType = 'obliance';

export function Header() {
 const { t } = useTranslation();
 const { user, logout } = useAuthStore();
 const { status: socketStatus } = useSocketStore();
 const tenants = useTenantStore((s) => s.tenants);
 const currentTenantId = useTenantStore((s) => s.currentTenantId);
 const [connectedApps, setConnectedApps] = useState<Array<{ appType: string; name: string; baseUrl: string }>>([]);

 useEffect(() => {
 fetch('/api/auth/connected-apps', { credentials: 'include' })
 .then(r => r.json())
 .then((d: { success: boolean; data?: Array<{ appType: string; name: string; baseUrl: string }> }) => {
 if (d.success && d.data) setConnectedApps(d.data);
 })
 .catch(() => {});
 }, []);

 // Build a map of which apps are reachable so we know which pills are
 // clickable. The current app (Obliance) is always available.
 const reachable = new Set<string>([CURRENT_APP]);
 for (const a of connectedApps) reachable.add(a.appType);

 const goApp = (app: AppEntry) => {
 if (app.type === CURRENT_APP) return;
 const target = connectedApps.find(c => c.appType === app.type);
 if (!target) return;
 // Cross-app tenant handoff: append ?tenant=<slug> so the target app can
 // restore the same tenant context post-SSO. Drops to the user's first
 // tenant on the target app if no match.
 const tenantSlug = tenants.find(t => t.id === currentTenantId)?.slug;
 const url = new URL(`${target.baseUrl}/auth/sso-redirect`);
 if (tenantSlug) url.searchParams.set('tenant', tenantSlug);
 window.location.href = url.toString();
 };

 const username = user?.username ?? '';
 const strippedUsername = username.startsWith('og_') ? username.slice(3) : username;
 // Prefer displayName for the topbar badge — falls back to the username minus
 // the og_ SSO prefix if no displayName is set.
 const displayedUsername = anonymize(user?.displayName || strippedUsername);

 return (
 <header className="flex h-13 shrink-0 items-center gap-3 bg-bg-secondary px-4" style={{ height: 52 }}>
 {/* Logo — always visible in the topbar so it (and the tenant selector
 right next to it) stay accessible regardless of sidebar state
 (pinned, collapsed, floating). Reserved width matches the default
 sidebar width so nav items below align with content. */}
 <Link to="/" className="flex items-center gap-2 shrink-0">
 <Logo className="h-8 w-auto max-w-[160px] object-contain" />
 </Link>

 {/* Tenant selector — sits left of the app switcher, preserving the
 context that gets carried across apps. */}
 <TenantSwitcher />

 {/* App switcher pills — only the current app + the apps the user
 actually has access to via Obligate are rendered. Hiding the
 unreachable ones entirely (rather than dimming them) matches
 the pre-Obligate behaviour: an admin without Oblimap rights
 shouldn't even see the Oblimap pill, since there's no path to
 enable it from here. */}
 {!isNativeApp && (
 <nav className="flex items-center gap-1 rounded-lg bg-bg-hover p-1 ml-1">
 {APP_ORDER.filter((app) => app.type === CURRENT_APP || reachable.has(app.type)).map((app) => {
 const isCurrent = app.type === CURRENT_APP;
 return (
 <button
 key={app.type}
 type="button"
 onClick={() => goApp(app)}
 className={cn(
 'flex items-center gap-2 px-3 py-1.5 rounded-md text-[12.5px] font-medium transition-colors',
 isCurrent
 ? 'bg-bg-secondary text-text-primary font-semibold shadow-[0_1px_3px_rgb(46_52_64_/_0.1)]'
 : 'text-text-secondary hover:bg-bg-active hover:text-text-primary',
 )}
 title={app.label}
 >
 <span
 className="w-2 h-2 rounded-full shrink-0"
 style={{ background: app.color }}
 />
 {app.label}
 </button>
 );
 })}
 </nav>
 )}

 <div className="ml-auto flex items-center gap-3">
 {/* Download App link */}
 {!isNativeApp && (
 <Link
 to="/download"
 className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[13px] font-medium text-text-muted hover:bg-bg-hover hover:text-text-primary transition-colors"
 >
 <Download size={14} />
 {t('nav.downloadApp')}
 </Link>
 )}

 {/* Socket connection status dot */}
 <button
 onClick={socketStatus !== 'connected' ? () => window.location.reload() : undefined}
 title={
 socketStatus === 'connected' ? t('header.socketConnected') :
 socketStatus === 'reconnecting' ? t('header.socketReconnecting') :
 t('header.socketDisconnected')
 }
 className={cn(
 'flex h-7 w-7 items-center justify-center rounded-md transition-opacity',
 socketStatus !== 'connected' && 'cursor-pointer hover:opacity-70',
 socketStatus === 'connected' && 'cursor-default',
 )}
 >
 <span
 className={cn(
 'h-2 w-2 rounded-full transition-colors',
 socketStatus === 'connected' && 'bg-green-500',
 socketStatus === 'reconnecting' && 'bg-amber-400 animate-pulse',
 socketStatus === 'disconnected' && 'bg-red-500 animate-pulse',
 )}
 />
 </button>

 {/* Notification Center */}
 <NotificationCenter />

 {user && (
 <>
 <div className="flex items-center gap-2 pl-1.5 pr-3 py-1 rounded-lg bg-bg-hover">
 {user.avatar ? (
 <img
 src={user.avatar}
 alt={displayedUsername}
 className="w-7 h-7 rounded-full object-cover"
 />
 ) : (
 <div
 className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold text-white"
 style={{ background: 'linear-gradient(135deg, rgba(224,58,58,0.6), rgba(255,100,100,0.4))' }}
 >
 {(displayedUsername?.[0] ?? '?').toUpperCase()}
 </div>
 )}
 <span className="text-[13px] font-medium text-text-primary">{displayedUsername}</span>
 <span className="text-[10px] font-mono uppercase tracking-wider text-accent pl-2 -light">
 {user.role}
 </span>
 </div>
 <button
 onClick={logout}
 title={t('nav.signOut')}
 className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-bg-hover hover:text-text-primary transition-colors"
 >
 <LogOut size={15} />
 </button>
 </>
 )}
 </div>
 </header>
 );
}
