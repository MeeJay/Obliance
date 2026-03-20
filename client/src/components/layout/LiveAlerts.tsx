import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import { useLiveAlertsStore } from '@/store/liveAlertsStore';
import type { LiveAlert, AlertSeverity } from '@/store/liveAlertsStore';
import { useTenantStore } from '@/store/tenantStore';
import { useNativeTopOffset } from '@/hooks/useNativeTopOffset';
import { cn } from '@/utils/cn';

const TOAST_LIFETIME_MS     = 60_000;  // bottom-right: 1 min from alert.createdAt
const TOP_CENTER_LIFETIME_MS = 10_000; // top-center: 10 s (user sees only the latest)

const SEVERITY_STYLES: Record<AlertSeverity, { bar: string; title: string }> = {
  down:     { bar: 'border-l-red-500',    title: 'text-red-400'    },
  up:       { bar: 'border-l-green-500',  title: 'text-green-400'  },
  warning:  { bar: 'border-l-amber-500',  title: 'text-amber-400'  },
  info:     { bar: 'border-l-blue-500',   title: 'text-blue-400'   },
  critical: { bar: 'border-l-red-600',    title: 'text-red-500'    },
};

// ─── Single toast card ────────────────────────────────────────────────────────

interface AlertCardProps {
  alert: LiveAlert;
  opacity?: number;
  lifetimeMs: number;
}

function AlertCard({ alert, opacity = 1, lifetimeMs }: AlertCardProps) {
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
        'relative flex items-stretch rounded-xl border border-border/50 backdrop-blur-md bg-bg-secondary/80 shadow-lg overflow-hidden transition-opacity duration-300',
        alert.navigateTo && 'cursor-pointer hover:bg-bg-secondary/90',
        `border-l-4 ${styles.bar}`,
      )}
      style={{ opacity }}
      onClick={handleCardClick}
    >
      <div className="flex-1 p-3 pr-8 min-w-0">
        <p className={cn('text-sm font-semibold leading-tight truncate', styles.title)}>
          {alert.title}
        </p>
        <p className="text-xs text-text-muted mt-0.5 leading-snug line-clamp-2">
          {alert.message}
        </p>
      </div>

      {/* Dismiss button — hides from tray but keeps alert in the bell */}
      <button
        className="absolute top-2 right-2 text-text-muted hover:text-text-primary transition-colors"
        onClick={(e) => {
          e.stopPropagation();
          dismissToast(alert.id);
        }}
        aria-label="Dismiss"
      >
        <X size={13} />
      </button>
    </div>
  );
}

// ─── Main LiveAlerts renderer ──────────────────────────────────────────────────

export function LiveAlerts() {
  const { alerts, localEnabled, multiTenantEnabled, position } = useLiveAlertsStore();
  const { currentTenantId } = useTenantStore();
  const nativeTop = useNativeTopOffset();

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
      <div className="fixed left-1/2 -translate-x-1/2 z-50 w-[400px] max-w-[calc(100vw-2rem)] animate-fade-in" style={{ top: nativeTop + 64 }}>
        <AlertCard key={latest.id} alert={latest} lifetimeMs={TOP_CENTER_LIFETIME_MS} />
      </div>
    );
  }

  // bottom-right: show up to 10, newest at bottom, older stacked above with fading opacity
  const capped = visibleToasts.slice(0, 10);

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col-reverse gap-2 w-80 max-w-[calc(100vw-2rem)]">
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
