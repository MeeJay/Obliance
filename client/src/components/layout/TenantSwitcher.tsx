import { useRef, useState, useEffect } from 'react';
import { ChevronDown, Building2, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTenantStore } from '@/store/tenantStore';
import { useGroupStore } from '@/store/groupStore';
import { useDeviceStore } from '@/store/deviceStore';
import { disconnectSocket, connectSocket } from '@/socket/socketClient';
import { useAuthStore } from '@/store/authStore';
import { cn } from '@/utils/cn';

export function TenantSwitcher() {
  const { t } = useTranslation();
  const { currentTenantId, tenants, setCurrentTenant } = useTenantStore();
  const { user } = useAuthStore();
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Close on outside click — must be BEFORE the early return to satisfy Rules of Hooks
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // In the native desktop app the injected tab bar replaces this dropdown
  const isNativeApp = !!(window as Window & { __obliance_is_native_app?: boolean }).__obliance_is_native_app;
  if (isNativeApp && tenants.length > 1) return null;

  // Only show when there are multiple tenants
  if (tenants.length <= 1) return null;

  const currentTenant = tenants.find((t) => t.id === currentTenantId) ?? tenants[0];

  const handleSwitch = async (tenantId: number) => {
    if (tenantId === currentTenantId || switching) return;
    setSwitching(true);
    setOpen(false);

    try {
      await setCurrentTenant(tenantId);

      // Reload all tenant-scoped data in parallel
      await Promise.all([
        useDeviceStore.getState().fetchDevices(),
        useGroupStore.getState().fetchTree(),
      ]);

      // Reconnect socket with new tenantId
      if (user) {
        disconnectSocket();
        connectSocket(user.id, tenantId);
      }
    } finally {
      setSwitching(false);
    }
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setOpen((v) => !v)}
        disabled={switching}
        className={cn(
          'flex items-center gap-1.5 rounded-md border border-border bg-bg-tertiary px-2.5 py-1 text-sm text-text-primary transition-colors hover:bg-bg-hover',
          switching && 'opacity-60 cursor-wait',
        )}
      >
        <Building2 size={13} className="text-accent shrink-0" />
        <span className="max-w-[120px] truncate font-medium">{currentTenant?.name ?? '…'}</span>
        <ChevronDown size={12} className={cn('text-text-muted transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          ref={panelRef}
          className="absolute left-0 top-9 z-50 w-52 rounded-xl border border-border bg-bg-secondary shadow-2xl overflow-hidden"
        >
          <div className="px-3 py-2 border-b border-border">
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">
              {t('tenant.switchWorkspace')}
            </p>
          </div>
          <div className="py-1 max-h-64 overflow-y-auto">
            {tenants.map((tenant) => (
              <button
                key={tenant.id}
                onClick={() => handleSwitch(tenant.id)}
                className={cn(
                  'w-full flex items-center justify-between px-3 py-2 text-sm text-left transition-colors hover:bg-bg-hover',
                  tenant.id === currentTenantId
                    ? 'text-accent font-semibold'
                    : 'text-text-primary',
                )}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Building2 size={13} className="shrink-0 text-text-muted" />
                  <span className="truncate">{tenant.name}</span>
                  {tenant.role === 'admin' && (
                    <span className="shrink-0 text-[10px] text-text-muted bg-bg-tertiary rounded px-1 py-0.5">
                      {t('tenant.roleAdmin')}
                    </span>
                  )}
                </div>
                {tenant.id === currentTenantId && (
                  <Check size={13} className="shrink-0 text-accent" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
