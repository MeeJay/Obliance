import { LogOut, Download, Menu, Settings, TerminalSquare, UserCircle } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/store/authStore';
import { useTenantStore } from '@/store/tenantStore';
import { useUiStore } from '@/store/uiStore';
import { anonymize } from '@/utils/anonymize';
import { useSocketStore } from '@/store/socketStore';
import { NotificationCenter } from './NotificationCenter';
import { TenantSwitcher } from './TenantSwitcher';
import { SshBastionButton } from './SshBastionButton';
import { Logo } from '@/components/common/Logo';
import { IconButton } from '@/components/common/IconButton';
import { ActionMenu, type ActionMenuItem } from '@/components/common/ActionMenu';
import { useLayoutMode } from '@/hooks/useMediaQuery';
import { isAndroidApp, canUseNative, native } from '@/native/bridge';
import { cn } from '@/utils/cn';

/** True when running inside the Obliance native desktop app overlay (ObliTools —
 *  NOT the Android shell, see docs/obli-mobile.md §2). */
const isNativeApp = typeof window !== 'undefined' &&
  !!(window as Window & { __obliance_is_native_app?: boolean }).__obliance_is_native_app;

// ── App switcher data ───────────────────────────────────────────────────────
//
// Per docs/obli-design-system.md §1 + §4.1 — seven fixed pills, current app
// glowing with its own brand colour. The order is fixed across the suite so
// muscle memory carries between apps.

type AppType = 'obliview' | 'obliguard' | 'oblimap' | 'obliance' | 'obliplan' | 'oblidesk' | 'oblihub';

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
  { type: 'oblidesk', label: 'Oblidesk', color: '#22b8f5' },
  { type: 'oblihub', label: 'Oblihub', color: '#2d4ec9' },
];

const CURRENT_APP: AppType = 'obliance';

/**
 * Topbar — degrades with the layout mode (docs/obli-mobile.md §4):
 *  - desktop ≥ 1024: as designed; < 1280 the app pills show their dot only.
 *  - tablet 768–1023: hamburger (sidebar drawer), "Download App" moved into
 *    the account menu, icon-only SSH button, avatar-only user badge (opens
 *    the account menu).
 *  - phone < 768: hamburger · logo mark · truncated tenant · socket · bell ·
 *    avatar menu (profile, apps, SSH bastion, download page, app settings,
 *    sign out).
 * In the Android shell the desktop "Download App" link is hidden (it serves
 * the Windows Oblireach MSI); the account menu offers "App updates" (the
 * /download page = installed version + update check) and the native settings.
 */
export function Header() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const { status: socketStatus } = useSocketStore();
  const tenants = useTenantStore((s) => s.tenants);
  const currentTenantId = useTenantStore((s) => s.currentTenantId);
  const mobileNavOpen = useUiStore((s) => s.mobileNavOpen);
  const toggleMobileNav = useUiStore((s) => s.toggleMobileNav);
  const mode = useLayoutMode();
  const isPhone = mode === 'phone';
  const isDesktop = mode === 'desktop';
  const android = isAndroidApp();
  const [connectedApps, setConnectedApps] = useState<Array<{ appType: string; name: string; baseUrl: string }>>([]);
  // Phone: the SSH bastion panel opens as a sheet from the account menu.
  const [sshSheetOpen, setSshSheetOpen] = useState(false);
  const [sshAvailable, setSshAvailable] = useState(false);

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
  const visibleApps = APP_ORDER.filter((app) => app.type === CURRENT_APP || reachable.has(app.type));

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

  const socketLabel =
    socketStatus === 'connected' ? t('header.socketConnected') :
    socketStatus === 'reconnecting' ? t('header.socketReconnecting') :
    t('header.socketDisconnected');

  // The account menu replaces the plain badge below 1024 px, and everywhere
  // in the Android shell (it carries the native "App settings" entry).
  const useAccountMenu = !isDesktop || android;
  // App pills: hidden in the ObliTools desktop shell (its own tab bar).
  const showAppPills = !isNativeApp && !isPhone;
  const otherApps = !isNativeApp ? visibleApps.filter((a) => a.type !== CURRENT_APP) : [];

  const avatar = (size: 'sm' | 'md') => (
    user?.avatar ? (
      <img
        src={user.avatar}
        alt={displayedUsername}
        className={cn('rounded-full object-cover', size === 'md' ? 'w-7 h-7' : 'w-4 h-4')}
      />
    ) : size === 'md' ? (
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold text-white"
        style={{ background: 'linear-gradient(135deg, rgba(224,58,58,0.6), rgba(255,100,100,0.4))' }}
      >
        {(displayedUsername?.[0] ?? '?').toUpperCase()}
      </div>
    ) : (
      <UserCircle className="w-4 h-4" />
    )
  );

  // /download (Oblireach Desktop + the Android APK; inside the Android shell
  // the installed version + "Check for updates") — the desktop header link is
  // not shown below 1024 px nor in the Android shell, so the account menu
  // carries it there. Never in ObliTools (it already is the desktop app).
  const showDownloadItem = !isNativeApp;
  const accountItems: ActionMenuItem[] = user ? [
    {
      key: 'profile',
      icon: avatar('sm'),
      label: displayedUsername || (t('nav.profile') || 'Profile'),
      description: `${t('nav.profile') || 'Profile'} · ${user.role}`,
      onClick: () => navigate('/profile'),
    },
    // Phone: the app pills live here.
    ...(isPhone ? otherApps.map((app, i): ActionMenuItem => ({
      key: `app-${app.type}`,
      icon: <span className="block w-2 h-2 rounded-full" style={{ background: app.color }} />,
      label: app.label,
      onClick: () => goApp(app),
      separator: i === 0,
    })) : []),
    // Phone: SSH bastion (the header button is not shown).
    ...(isPhone && sshAvailable ? [{
      key: 'ssh',
      icon: <TerminalSquare className="w-4 h-4" />,
      label: t('sshBastion.button.title') || 'SSH bastion',
      onClick: () => setSshSheetOpen(true),
      separator: true,
    } satisfies ActionMenuItem] : []),
    // Download page — Android shell: the app's version / updates screen.
    ...(showDownloadItem ? [{
      key: 'download',
      icon: <Download className="w-4 h-4" />,
      label: android
        ? (t('header.appUpdates') || 'App updates')
        : (t('nav.downloadApp') || 'Download App'),
      onClick: () => navigate('/download'),
      separator: !(isPhone && sshAvailable),
    } satisfies ActionMenuItem] : []),
    // Android shell: native app settings (server URL, notifications, updates).
    ...(android && canUseNative('openSettings') ? [{
      key: 'app-settings',
      icon: <Settings className="w-4 h-4" />,
      label: t('header.appSettings') || 'App settings',
      onClick: () => { native.openSettings().catch(() => { /* shell too old */ }); },
      separator: !(isPhone && sshAvailable) && !showDownloadItem,
    } satisfies ActionMenuItem] : []),
    {
      key: 'logout',
      icon: <LogOut className="w-4 h-4" />,
      label: t('nav.signOut'),
      onClick: () => { logout(); },
      danger: true,
      separator: true,
    },
  ] : [];

  return (
    <header
      className={cn(
        'flex shrink-0 items-center gap-3 bg-bg-secondary',
        // Safe areas (0 on desktop → identical px-4 / 52 px).
        'pt-safe pl-[max(1rem,var(--safe-left))] pr-[max(1rem,var(--safe-right))]',
        'max-md:gap-2 max-md:pl-[max(0.75rem,var(--safe-left))] max-md:pr-[max(0.75rem,var(--safe-right))]',
      )}
      style={{ height: 'calc(52px + var(--safe-top))' }}
    >
      {/* Hamburger — opens the sidebar drawer below 1024 px. */}
      {!isDesktop && (
        <IconButton
          label={t('header.openMenu') || 'Open menu'}
          icon={<Menu className="h-5 w-5" />}
          size="md"
          onClick={toggleMobileNav}
          aria-expanded={mobileNavOpen}
          aria-haspopup="dialog"
          className="-ml-1.5 shrink-0"
        />
      )}

      {/* Logo — always visible in the topbar so it (and the tenant selector
          right next to it) stay accessible regardless of sidebar state
          (pinned, collapsed, floating). Phone: the square mark only. */}
      <Link to="/" className="flex items-center gap-2 shrink-0" aria-label="Obliance">
        {isPhone ? (
          <img src="/favicon.svg" alt="Obliance" className="h-8 w-8" />
        ) : (
          <Logo className="h-8 w-auto max-w-[160px] object-contain" />
        )}
      </Link>

      {/* Tenant selector — sits left of the app switcher, preserving the
          context that gets carried across apps. Shrinks (truncates) on
          narrow screens; stays visible in the Android shell. */}
      <TenantSwitcher />

      {/* App switcher pills — only the current app + the apps the user
          actually has access to via Obligate are rendered. Hiding the
          unreachable ones entirely (rather than dimming them) matches
          the pre-Obligate behaviour: an admin without Oblimap rights
          shouldn't even see the Oblimap pill, since there's no path to
          enable it from here. Below 1280 px the labels collapse to the
          brand dot; on phones the apps move to the account menu. */}
      {showAppPills && (
        <nav
          aria-label={t('header.apps') || 'Apps'}
          className="flex items-center gap-1 rounded-lg bg-bg-hover p-1 ml-1 max-lg:min-w-0 max-lg:overflow-x-auto max-lg:scrollbar-none"
        >
          {visibleApps.map((app) => {
            const isCurrent = app.type === CURRENT_APP;
            return (
              <button
                key={app.type}
                type="button"
                onClick={() => goApp(app)}
                className={cn(
                  'flex items-center gap-2 px-3 py-1.5 rounded-md text-[12.5px] font-medium transition-colors shrink-0',
                  'max-xl:px-2.5 coarse:min-h-9',
                  isCurrent
                    ? 'bg-bg-secondary text-text-primary font-semibold shadow-[0_1px_3px_rgb(46_52_64_/_0.1)]'
                    : 'text-text-secondary hover:bg-bg-active hover:text-text-primary',
                )}
                title={app.label}
                aria-label={app.label}
                aria-current={isCurrent ? 'page' : undefined}
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: app.color }}
                />
                <span className="hidden xl:inline">{app.label}</span>
              </button>
            );
          })}
        </nav>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-3 max-md:gap-1.5">
        {/* Download App link — desktop widths only, never in a native shell
            (ObliTools already is the app; the Android shell must not offer
            the Windows MSI). */}
        {!isNativeApp && !android && isDesktop && (
          <Link
            to="/download"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[13px] font-medium text-text-muted hover:bg-bg-hover hover:text-text-primary transition-colors"
          >
            <Download size={14} />
            {t('nav.downloadApp')}
          </Link>
        )}

        {/* SSH bastion: authorize this IP for 24h (hidden when disabled).
            Tablet: icon only. Phone: no header button — the panel opens as
            a sheet from the account menu. */}
        <SshBastionButton
          compact={!isDesktop}
          sheetOnly={isPhone}
          open={isPhone ? sshSheetOpen : undefined}
          onOpenChange={isPhone ? setSshSheetOpen : undefined}
          onAvailableChange={setSshAvailable}
        />

        {/* Socket connection status dot */}
        <button
          onClick={socketStatus !== 'connected' ? () => window.location.reload() : undefined}
          title={socketLabel}
          aria-label={socketLabel}
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-md transition-opacity coarse:h-10 coarse:w-10',
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
          useAccountMenu ? (
            <>
              <ActionMenu
                items={accountItems}
                label={t('header.accountMenu') || 'Account menu'}
                menuClassName="w-64"
                trigger={(p) => (
                  <button
                    {...p}
                    type="button"
                    aria-label={t('header.accountMenu') || 'Account menu'}
                    className={cn(
                      'flex items-center gap-2 rounded-lg bg-bg-hover transition-colors hover:bg-bg-active',
                      isDesktop ? 'pl-1.5 pr-3 py-1' : 'p-1 coarse:p-1.5',
                    )}
                  >
                    {avatar('md')}
                    {isDesktop && (
                      <>
                        <span className="text-[13px] font-medium text-text-primary">{displayedUsername}</span>
                        <span className="text-[10px] font-mono uppercase tracking-wider text-accent pl-2 -light">
                          {user.role}
                        </span>
                      </>
                    )}
                  </button>
                )}
              />
              {/* Tablet keeps the one-tap sign-out next to the avatar. */}
              {mode === 'tablet' && (
                <IconButton
                  label={t('nav.signOut')}
                  icon={<LogOut size={15} />}
                  size="md"
                  variant="ghost"
                  onClick={logout}
                />
              )}
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 pl-1.5 pr-3 py-1 rounded-lg bg-bg-hover">
                {avatar('md')}
                <span className="text-[13px] font-medium text-text-primary">{displayedUsername}</span>
                <span className="text-[10px] font-mono uppercase tracking-wider text-accent pl-2 -light">
                  {user.role}
                </span>
              </div>
              <button
                onClick={logout}
                title={t('nav.signOut')}
                aria-label={t('nav.signOut')}
                className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-bg-hover hover:text-text-primary transition-colors"
              >
                <LogOut size={15} />
              </button>
            </>
          )
        )}
      </div>
    </header>
  );
}
