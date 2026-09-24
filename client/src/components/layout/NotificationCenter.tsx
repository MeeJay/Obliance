import { useRef, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Bell, X, Trash2, CheckCheck } from 'lucide-react';
import { useLiveAlertsStore, countUnread } from '@/store/liveAlertsStore';
import type { LiveAlert, AlertSeverity } from '@/store/liveAlertsStore';
import { useTenantStore } from '@/store/tenantStore';
import { Drawer } from '@/components/common/Drawer';
import { useClickOutside } from '@/hooks/useClickOutside';
import { useNativeBack } from '@/hooks/useNativeBack';
import { useLayoutMode } from '@/hooks/useMediaQuery';
import { cn } from '@/utils/cn';

const SEVERITY_STYLES: Record<AlertSeverity, { bar: string; dot: string; title: string }> = {
  down: { bar: 'border-l-red-500', dot: 'bg-red-500', title: 'text-red-400' },
  up: { bar: 'border-l-green-500', dot: 'bg-green-500', title: 'text-green-400' },
  warning: { bar: 'border-l-amber-500', dot: 'bg-amber-500', title: 'text-amber-400' },
  info: { bar: 'border-l-blue-500', dot: 'bg-blue-500', title: 'text-blue-400' },
  critical: { bar: 'border-l-red-600', dot: 'bg-red-600', title: 'text-red-500' },
};

/** Invisible 40×40 tap area on touch screens (layout unchanged). */
const TOUCH_HIT =
  "relative coarse:after:absolute coarse:after:left-1/2 coarse:after:top-1/2 coarse:after:h-10 coarse:after:w-10 coarse:after:-translate-x-1/2 coarse:after:-translate-y-1/2 coarse:after:content-['']";

type TFn = ReturnType<typeof useTranslation>['t'];

function timeAgo(iso: string, t: TFn): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return t('notificationCenter.agoSeconds', { count: diff }) || `${diff}s ago`;
  if (diff < 3600) {
    const m = Math.floor(diff / 60);
    return t('notificationCenter.agoMinutes', { count: m }) || `${m}m ago`;
  }
  if (diff < 86400) {
    const h = Math.floor(diff / 3600);
    return t('notificationCenter.agoHours', { count: h }) || `${h}h ago`;
  }
  const d = Math.floor(diff / 86400);
  return t('notificationCenter.agoDays', { count: d }) || `${d}d ago`;
}

// ─── Single alert row ─────────────────────────────────────────────────────────

interface AlertRowProps {
  alert: LiveAlert;
  showTenantBadge: boolean;
  onRead: (alert: LiveAlert) => void;
  onRemove: (id: number) => void;
}

function AlertRow({ alert, showTenantBadge, onRead, onRemove }: AlertRowProps) {
  const { t } = useTranslation();
  const styles = SEVERITY_STYLES[alert.severity];
  return (
    <div
      className={cn(
        'relative flex items-start gap-3 px-4 py-3 border-l-4 transition-colors',
        styles.bar,
        alert.readAt ? 'opacity-40' : 'opacity-100',
        alert.navigateTo && 'cursor-pointer hover:bg-bg-hover',
      )}
      onClick={() => onRead(alert)}
    >
      <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', styles.dot)} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className={cn('text-sm font-semibold truncate', styles.title)}>
            {alert.title}
          </p>
          {!alert.readAt && (
            <span className="shrink-0 h-1.5 w-1.5 rounded-full bg-accent" />
          )}
        </div>
        <p className="text-xs text-text-muted mt-0.5 truncate">{alert.message}</p>
        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
          <p className="text-xs text-text-muted/60">{timeAgo(alert.createdAt, t)}</p>
          {/* Tenant badge: shown in Global tab for alerts from other tenants */}
          {showTenantBadge && alert.tenantName && (
            <span className="text-[10px] bg-accent/20 text-accent px-1.5 py-0.5 rounded-full font-medium">
              {alert.tenantName}
            </span>
          )}
        </div>
      </div>
      {/* Dismiss — its own 40 px hit area on touch, so a near miss does not
          open (and possibly tenant-switch to) the alert. */}
      <button
        className={cn('shrink-0 text-text-muted hover:text-text-primary transition-colors mt-0.5', TOUCH_HIT)}
        onClick={(e) => { e.stopPropagation(); onRemove(alert.id); }}
        title={t('notificationCenter.dismiss') || 'Dismiss'}
        aria-label={t('notificationCenter.dismiss') || 'Dismiss'}
      >
        <X size={12} />
      </button>
    </div>
  );
}

// ─── Inline toggle switch ─────────────────────────────────────────────────────

interface ToggleProps {
  enabled: boolean;
  onChange: (v: boolean) => void;
  label: string;
}

function Toggle({ enabled, onChange, label }: ToggleProps) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-text-muted">{label}</span>
      <button
        role="switch"
        aria-checked={enabled}
        aria-label={label}
        onClick={() => onChange(!enabled)}
        className={cn(
          'relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors focus:outline-none',
          "coarse:after:absolute coarse:after:-inset-3 coarse:after:content-['']",
          enabled ? 'bg-accent' : 'bg-text-muted/30',
        )}
      >
        <span
          className={cn(
            'inline-block h-3 w-3 rounded-full bg-white shadow transition-transform',
            enabled ? 'translate-x-3.5' : 'translate-x-0.5',
          )}
        />
      </button>
    </div>
  );
}

// ─── Main NotificationCenter ──────────────────────────────────────────────────

type Tab = 'local' | 'global';

export function NotificationCenter() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('local');
  const isPhone = useLayoutMode() === 'phone';

  const {
    alerts,
    localEnabled, multiTenantEnabled,
    setLocalEnabled, setMultiTenantEnabled,
    clearAll, markAllRead, markAlertRead, removeAlert,
  } = useLiveAlertsStore();

  const { currentTenantId, tenants } = useTenantStore();
  const navigate = useNavigate();
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Multi-tenant mode is shown only when the user can access more than one tenant
  const isMultiTenant = tenants.length > 1;

  // Partition alerts by tenant
  const localAlerts = alerts.filter((a) => a.tenantId === currentTenantId);
  const globalAlerts = alerts; // all tenants (including local)

  const tabAlerts = tab === 'global' ? globalAlerts : localAlerts;
  const totalUnread = countUnread(alerts);
  const localUnread = countUnread(localAlerts);

  // If multi-tenant becomes unavailable, fall back to local tab
  useEffect(() => {
    if (!isMultiTenant && tab === 'global') setTab('local');
  }, [isMultiTenant, tab]);

  // Dropdown (tablet / desktop): close on outside tap, Escape and Android
  // back. The phone sheet (Drawer) handles its own dismissal.
  const dropdownOpen = open && !isPhone;
  useClickOutside([panelRef, buttonRef], () => setOpen(false), dropdownOpen);
  useNativeBack(() => {
    setOpen(false);
    buttonRef.current?.focus({ preventScroll: true });
  }, dropdownOpen, { escape: true });

  /**
   * Handle a notification click:
   * - Mark as read
   * - If the alert belongs to another tenant, switch to it then reload all tenant-scoped data
   * - Navigate to alert.navigateTo if set
   */
  const handleAlertClick = async (alert: LiveAlert) => {
    await markAlertRead(alert.id);

    if (alert.tenantId && alert.tenantId !== currentTenantId) {
      // Switch tenant session on the server, then do a full page navigation.
      // A client-side navigate() leaves stale store data in memory; a hard
      // redirect reloads the app fresh with the new tenant context — same as F5.
      await useTenantStore.getState().setCurrentTenant(alert.tenantId);
      setOpen(false);
      window.location.href = alert.navigateTo ?? '/';
      return;
    }

    // Same-tenant: normal client-side navigation
    if (alert.navigateTo) {
      setOpen(false);
      navigate(alert.navigateTo);
    }
  };

  const isAnyEnabled = localEnabled || multiTenantEnabled;
  const title = t('notifications.title') || 'Notifications';

  const headerActions = (
    <div className="flex items-center gap-2 coarse:gap-1">
      {tabAlerts.some((a) => !a.readAt) && (
        <button
          onClick={markAllRead}
          title={t('notificationCenter.markAllRead') || 'Mark all as read'}
          aria-label={t('notificationCenter.markAllRead') || 'Mark all as read'}
          className="text-text-muted hover:text-text-primary transition-colors coarse:min-h-10 coarse:min-w-10 coarse:inline-flex coarse:items-center coarse:justify-center"
        >
          <CheckCheck size={14} />
        </button>
      )}
      {tabAlerts.length > 0 && (
        <button
          onClick={clearAll}
          title={t('notificationCenter.clearLocal') || 'Clear local notifications'}
          aria-label={t('notificationCenter.clearLocal') || 'Clear local notifications'}
          className="text-text-muted hover:text-text-primary transition-colors coarse:min-h-10 coarse:min-w-10 coarse:inline-flex coarse:items-center coarse:justify-center"
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );

  // Tabs + pop-up toggle (shared by the dropdown and the phone sheet)
  const controls = (
    <>
      {/* Tab bar — visible only in multi-tenant mode */}
      {isMultiTenant && (
        <div className="flex gap-1">
          {(['local', 'global'] as const).map((tb) => {
            const badgeCount = tb === 'local' ? localUnread : totalUnread;
            return (
              <button
                key={tb}
                onClick={() => setTab(tb)}
                aria-pressed={tab === tb}
                className={cn(
                  'flex-1 text-xs py-1 rounded-md transition-colors coarse:py-2.5',
                  tab === tb
                    ? 'bg-accent text-white font-medium'
                    : 'text-text-muted hover:text-text-primary hover:bg-bg-hover',
                )}
              >
                {tb === 'local'
                  ? (t('notificationCenter.local') || 'Local')
                  : (t('notificationCenter.allTenants') || 'All Tenants')}
                {badgeCount > 0 && (
                  <span className="ml-1 opacity-80">({badgeCount})</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Per-tab pop-up toggle */}
      {tab === 'local' && (
        <Toggle
          enabled={localEnabled}
          onChange={setLocalEnabled}
          label={localEnabled
            ? (t('notificationCenter.localPopupsOn') || 'Local pop-ups on')
            : (t('notificationCenter.localPopupsOff') || 'Local pop-ups off')}
        />
      )}
      {tab === 'global' && isMultiTenant && (
        <Toggle
          enabled={multiTenantEnabled}
          onChange={setMultiTenantEnabled}
          label={multiTenantEnabled
            ? (t('notificationCenter.allTenantPopupsOn') || 'All-tenant pop-ups on')
            : (t('notificationCenter.allTenantPopupsOff') || 'All-tenant pop-ups off')}
        />
      )}
    </>
  );

  const list = (
    tabAlerts.length === 0 ? (
      <div className="flex flex-col items-center justify-center py-10 text-text-muted gap-2">
        <Bell size={24} className="opacity-30" />
        <p className="text-sm">{t('notificationCenter.empty') || 'No notifications'}</p>
      </div>
    ) : (
      tabAlerts.map((alert) => (
        <AlertRow
          key={alert.id}
          alert={alert}
          // Show tenant badge in the Global tab for cross-tenant alerts
          showTenantBadge={tab === 'global' && alert.tenantId !== currentTenantId}
          onRead={handleAlertClick}
          onRemove={(id) => removeAlert(id)}
        />
      ))
    )
  );

  const footer = tabAlerts.length > 0 && (
    <div className=" px-4 py-2">
      <p className="text-xs text-text-muted/60 text-center">
        {t('notificationCenter.count', { count: tabAlerts.length })
          || `${tabAlerts.length} notification${tabAlerts.length !== 1 ? 's' : ''}`}
      </p>
    </div>
  );

  const bellLabel = t('notificationCenter.title') || 'Notification Center';

  return (
    <div className="relative">
      {/* Bell button */}
      <button
        ref={buttonRef}
        onClick={() => setOpen((v) => !v)}
        title={bellLabel}
        aria-label={totalUnread > 0 ? `${bellLabel} (${totalUnread})` : bellLabel}
        aria-expanded={open}
        aria-haspopup={isPhone ? 'dialog' : 'true'}
        className="relative flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors coarse:min-h-10 coarse:min-w-10 coarse:justify-center"
      >
        <Bell
          size={14}
          className={cn(isAnyEnabled ? 'text-accent' : 'text-text-muted', 'coarse:h-[18px] coarse:w-[18px]')}
        />
        {totalUnread > 0 && (
          <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white leading-none coarse:top-0.5 coarse:right-0.5">
            {totalUnread > 99 ? '99+' : totalUnread}
          </span>
        )}
      </button>

      {/* Dropdown panel (tablet / desktop) — clamped to the viewport height */}
      {dropdownOpen && (
        <div
          ref={panelRef}
          className="absolute right-0 top-8 z-50 flex max-h-[calc(100dvh-4rem)] w-80 max-w-[calc(100vw-2rem)] flex-col rounded-xl bg-bg-secondary shadow-2xl overflow-hidden coarse:top-11"
        >
          {/* Header */}
          <div className="px-4 py-3 space-y-2 shrink-0">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
              <div className="flex items-center gap-2 coarse:gap-1">
                {headerActions}
                <button
                  onClick={() => setOpen(false)}
                  aria-label={t('common.close') || 'Close'}
                  className="text-text-muted hover:text-text-primary transition-colors coarse:min-h-10 coarse:min-w-10 coarse:inline-flex coarse:items-center coarse:justify-center"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
            {controls}
          </div>

          {/* Notifications list */}
          <div className="min-h-0 max-h-96 overflow-y-auto overscroll-contain divide-y divide-border/50">
            {list}
          </div>

          {/* Footer */}
          {footer}
        </div>
      )}

      {/* Phone: bottom sheet */}
      <Drawer
        open={open && isPhone}
        onClose={() => setOpen(false)}
        side="bottom"
        size="lg"
        title={title}
        icon={<Bell className="h-4 w-4 text-accent" />}
        headerExtra={headerActions}
        bodyClassName="p-0"
        footer={footer || undefined}
        footerClassName="justify-center p-0"
      >
        <div className="space-y-2 px-4 pb-3">{controls}</div>
        <div className="divide-y divide-border/50">{list}</div>
      </Drawer>
    </div>
  );
}
