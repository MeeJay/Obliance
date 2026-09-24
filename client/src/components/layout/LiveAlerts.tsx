import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { useLiveAlertsStore } from '@/store/liveAlertsStore';
import type { LiveAlert, AlertSeverity } from '@/store/liveAlertsStore';
import { useTenantStore } from '@/store/tenantStore';
import { useNativeTopOffset } from '@/hooks/useNativeTopOffset';
import { useLayoutMode } from '@/hooks/useMediaQuery';
import { cn } from '@/utils/cn';

const TOAST_LIFETIME_MS = 60_000; // bottom-right: 1 min from alert.createdAt
const TOP_CENTER_LIFETIME_MS = 10_000; // top-center: 10 s (user sees only the latest)
/** Max stacked toasts: a phone screen would be buried under 10 cards. */
const MAX_TOASTS = { phone: 3, other: 10 } as const;

const SEVERITY_STYLES: Record<AlertSeverity, { bar: string; title: string }> = {
  down: { bar: 'border-l-red-500', title: 'text-red-400' },
  up: { bar: 'border-l-green-500', title: 'text-green-400' },
  warning: { bar: 'border-l-amber-500', title: 'text-amber-400' },
  info: { bar: 'border-l-blue-500', title: 'text-blue-400' },
  critical: { bar: 'border-l-red-600', title: 'text-red-500' },
};

// ─── Single toast card ────────────────────────────────────────────────────────

interface AlertCardProps {
  alert: LiveAlert;
  opacity?: number;
  lifetimeMs: number;
}

function AlertCard({ alert, opacity = 1, lifetimeMs }: AlertCardProps) {
  const { t } = useTranslation();
  const { dismissToast } = useLiveAlertsStore();
  const navigate = useNavigate();
  const styles = SEVERITY_STYLES[alert.severity];

  // Per-notification independent timer — respects elapsed time since createdAt.
  // If the page reloads after the window has already elapsed, the toast is
  // immediately dismissed without rendering.
  useEffect(() => {
    const elapsed = Date.now() - new Date(alert.createdAt).getTime();
    const msRemaining = Math.max(0, lifetimeMs - elapsed);

    if (msRemaining === 0) {
      dismissToast(alert.id);
      return;
    }

    const timer = setTimeout(() => dismissToast(alert.id), msRemaining);
    return () => clearTimeout(timer);
  }, [alert.id, alert.createdAt, lifetimeMs, dismissToast]);

  const handleCardClick = () => {
    if (alert.navigateTo) {
      navigate(alert.navigateTo);
    }
  };

  return (
    <div
      className={cn(
        'pointer-events-auto relative flex items-stretch rounded-xl/50 backdrop-blur-md bg-bg-secondary/80 shadow-lg overflow-hidden transition-opacity duration-300',
        alert.navigateTo && 'cursor-pointer hover:bg-bg-secondary/90',
        `border-l-4 ${styles.bar}`,
      )}
      style={{ opacity }}
      onClick={handleCardClick}
    >
      <div className="flex-1 p-3 pr-8 min-w-0 coarse:pr-11">
        <p className={cn('text-sm font-semibold leading-tight truncate', styles.title)}>
          {alert.title}
        </p>
        <p className="text-xs text-text-muted mt-0.5 leading-snug line-clamp-2">
          {alert.message}
        </p>
      </div>

      {/* Dismiss button — hides from tray but keeps alert in the bell.
          40 px target on touch screens. */}
      <button
        className="absolute top-2 right-2 text-text-muted hover:text-text-primary transition-colors coarse:top-0 coarse:right-0 coarse:flex coarse:h-10 coarse:w-10 coarse:items-center coarse:justify-center"
        onClick={(e) => {
          e.stopPropagation();
          dismissToast(alert.id);
        }}
        aria-label={t('liveAlerts.dismiss') || 'Dismiss'}
      >
        <X size={13} />
      </button>
    </div>
  );
}

// ─── Main LiveAlerts renderer ──────────────────────────────────────────────────

/**
 * Live-alert toasts. Rendered inside the app-wide FloatingDock (AppLayout):
 * the bottom-right stack flows above the chat FAB / shell pill instead of
 * overlapping them, goes full width on phones, and is the first thing to
 * shrink (oldest cards clipped) when the dock runs out of height.
 */
export function LiveAlerts() {
  const { alerts, localEnabled, multiTenantEnabled, position } = useLiveAlertsStore();
  const { currentTenantId } = useTenantStore();
  const nativeTop = useNativeTopOffset();
  const isPhone = useLayoutMode() === 'phone';

  const lifetimeMs = position === 'top-center' ? TOP_CENTER_LIFETIME_MS : TOAST_LIFETIME_MS;
  const now = Date.now();

  // Compute which toasts should currently be visible in the tray
  const visibleToasts = alerts.filter((a) => {
    if (a.toastDismissed) return false;
    // Already past the lifetime window — don't render (AlertCard.useEffect will dismiss on mount)
    if (now - new Date(a.createdAt).getTime() >= lifetimeMs) return false;
    // Per-tenant preference filter
    // If currentTenantId is not yet loaded, treat all alerts as local
    const isLocal = currentTenantId !== null ? a.tenantId === currentTenantId : true;
    return isLocal ? localEnabled : multiTenantEnabled;
  });

  if (visibleToasts.length === 0) return null;

  if (position === 'top-center') {
    // Only show the newest alert
    const latest = visibleToasts[0];
    return (
      <div
        className="pointer-events-auto fixed left-1/2 -translate-x-1/2 z-[1] w-[400px] max-w-[calc(100vw-2rem)] animate-fade-in"
        style={{ top: `calc(${nativeTop + 64}px + var(--safe-top))` }}
      >
        <AlertCard key={latest.id} alert={latest} lifetimeMs={TOP_CENTER_LIFETIME_MS} />
      </div>
    );
  }

  // bottom-right: show up to 10 (3 on phones), newest at bottom, older
  // stacked above with fading opacity.
  const capped = visibleToasts.slice(0, isPhone ? MAX_TOASTS.phone : MAX_TOASTS.other);

  return (
    // In the dock's flex column: shrinks first (flex-shrink 100) and clips
    // the oldest cards at the top rather than squeezing the chat panel. The
    // -my-6 / py-6 pair leaves room for the card shadows inside the clip.
    <div
      className="pointer-events-none relative z-[1] -my-6 flex min-h-0 w-80 max-w-full flex-col-reverse gap-2 overflow-y-clip py-6 max-md:w-full"
      style={{ flexShrink: 100 }}
    >
      {capped.map((alert, index) => {
        const opacity = Math.max(0.4, 1 - index * 0.15);
        return (
          <AlertCard
            key={alert.id}
            alert={alert}
            opacity={opacity}
            lifetimeMs={TOAST_LIFETIME_MS}
          />
        );
      })}
    </div>
  );
}
