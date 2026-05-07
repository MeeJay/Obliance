import { Building2 } from 'lucide-react';
import { useTenantStore } from '@/store/tenantStore';
import { useIsMasterTenant } from '@/hooks/useIsMasterTenant';
import { MASTER_TENANT_ID } from '@obliance/shared';
import { clsx } from 'clsx';

interface Props {
  tenantId: number | null | undefined;
  /** Optional explicit name override — useful when the API row already
   *  carries `tenantName` and we want to avoid the store lookup. */
  tenantName?: string | null;
  /** Compact rendering for dense tables (smaller padding, single line). */
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Inline tenant chip rendered next to entity names on master/god view.
 * Returns `null` when:
 *   - the caller isn't on the master tenant (the chip would be redundant
 *     — they're already inside one tenant context)
 *   - tenantId is missing
 *
 * Looks up the display name from the already-loaded tenants store so we
 * don't have to thread `tenantName` through every API. Falls back to
 * `Tenant {id}` when the store hasn't loaded yet.
 *
 * The Default tenant gets the accent (blue) variant to make the master
 * stand out from child tenants in lists scanned at speed.
 */
export function TenantBadge({ tenantId, tenantName, size = 'sm', className }: Props) {
  const isMaster = useIsMasterTenant();
  const tenants = useTenantStore((s) => s.tenants);
  if (!isMaster) return null;
  if (tenantId == null) return null;

  const name = tenantName ?? tenants.find((t) => t.id === tenantId)?.name ?? `Tenant ${tenantId}`;
  const isDefault = tenantId === MASTER_TENANT_ID;

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-full border whitespace-nowrap',
        size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs',
        isDefault
          ? 'bg-accent/10 text-accent border-accent/30'
          : 'bg-bg-tertiary text-text-secondary border-border',
        className,
      )}
      title={`Tenant: ${name}`}
    >
      <Building2 className={size === 'sm' ? 'w-2.5 h-2.5' : 'w-3 h-3'} />
      {name}
    </span>
  );
}
