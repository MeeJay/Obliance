import { useRef, useState } from 'react';
import { ChevronDown, Building2, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTenantStore } from '@/store/tenantStore';
import { useGroupStore } from '@/store/groupStore';
import { useDeviceStore } from '@/store/deviceStore';
import { disconnectSocket, connectSocket } from '@/socket/socketClient';
import { useAuthStore } from '@/store/authStore';
import { Drawer } from '@/components/common/Drawer';
import { useClickOutside } from '@/hooks/useClickOutside';
import { useNativeBack } from '@/hooks/useNativeBack';
import { useLayoutMode } from '@/hooks/useMediaQuery';
import { cn } from '@/utils/cn';

export function TenantSwitcher() {
  const { t } = useTranslation();
  const { currentTenantId, tenants, setCurrentTenant } = useTenantStore();
  const { user } = useAuthStore();
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const isPhone = useLayoutMode() === 'phone';

  // Hooks must run BEFORE the early returns below (Rules of Hooks).
  // Dropdown: outside tap (pointerdown), Escape and Android back close it.
  // The phone sheet (Drawer) handles its own dismissal.
  const dropdownOpen = open && !isPhone;
  useClickOutside([panelRef, buttonRef], () => setOpen(false), dropdownOpen);
  useNativeBack(() => {
    setOpen(false);
    buttonRef.current?.focus({ preventScroll: true });
  }, dropdownOpen, { escape: true });

  // In the native DESKTOP app (ObliTools) the injected tab bar replaces this
  // dropdown. The Android shell does not set this flag: the switcher stays.
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

  const renderRows = (sheet: boolean) => tenants.map((tenant) => (
    <button
      key={tenant.id}
      onClick={() => handleSwitch(tenant.id)}
      aria-current={tenant.id === currentTenantId ? 'true' : undefined}
      className={cn(
        'w-full flex items-center justify-between px-3 py-2 text-sm text-left transition-colors hover:bg-bg-hover',
        sheet ? 'min-h-12 rounded-lg' : 'coarse:min-h-11',
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
  ));

  return (
    <div className="relative min-w-0">
      <button
        ref={buttonRef}
        onClick={() => setOpen((v) => !v)}
        disabled={switching}
        aria-haspopup={isPhone ? 'dialog' : 'true'}
        aria-expanded={open}
        aria-label={`${t('tenant.label', 'Tenant')}: ${currentTenant?.name ?? ''}`}
        className={cn(
          'flex max-w-full min-w-0 items-center gap-2 rounded-md bg-bg-hover px-3 py-1.5 text-[13px] text-text-primary font-medium transition-colors hover:bg-bg-active',
          'max-md:gap-1.5 max-md:px-2.5 coarse:min-h-10',
          switching && 'opacity-60 cursor-wait',
        )}
      >
        {/* The "TENANT" caption is dropped below 1024 px to leave room for
            the name (the aria-label keeps it for screen readers). */}
        <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-text-muted max-lg:hidden">
          {t('tenant.label', 'Tenant')}
        </span>
        <span className="min-w-0 max-w-[140px] truncate tracking-[0.04em]">{currentTenant?.name ?? '…'}</span>
        <ChevronDown size={12} className={cn('shrink-0 text-text-muted transition-transform', open && 'rotate-180')} />
      </button>

      {/* Tablet / desktop: anchored dropdown. */}
      {dropdownOpen && (
        <div
          ref={panelRef}
          className="absolute left-0 top-9 z-50 w-52 max-w-[calc(100vw-1.5rem)] rounded-xl bg-bg-secondary shadow-2xl overflow-hidden"
        >
          <div className="px-3 py-2 ">
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">
              {t('tenant.switchWorkspace')}
            </p>
          </div>
          <div className="py-1 max-h-64 overflow-y-auto overscroll-contain">
            {renderRows(false)}
          </div>
        </div>
      )}

      {/* Phone: bottom sheet with 48 px rows. */}
      <Drawer
        open={open && isPhone}
        onClose={() => setOpen(false)}
        side="bottom"
        size="md"
        title={t('tenant.switchWorkspace')}
        icon={<Building2 className="h-4 w-4 text-accent" />}
        bodyClassName="px-2 pb-3 pt-0"
      >
        <div>{renderRows(true)}</div>
      </Drawer>
    </div>
  );
}
