import { useTenantStore } from '@/store/tenantStore';
import { MASTER_TENANT_ID, isMasterTenant } from '@obliance/shared';

/** True when the active tenant is the master/Default tenant — the
 *  god view that aggregates every child tenant's data. UI code uses
 *  this to switch between strict tenant scoping and the cross-tenant
 *  view (tenant grouping in sidebar, "Tenant" column on lists,
 *  multi-tenant fan-out targets in create forms, etc).
 *
 *  Re-exports the constant so call sites that need both the boolean
 *  and the literal id (e.g. for query-param building) only import this. */
export function useIsMasterTenant(): boolean {
  const currentTenantId = useTenantStore((s) => s.currentTenantId);
  return isMasterTenant(currentTenantId);
}

export { MASTER_TENANT_ID };
