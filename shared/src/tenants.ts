// Master tenant — the seeded "Default" workspace at id=1. Acts as a
// god-view across the install: admins on this tenant see (and can
// shape) every other tenant's data through fan-out semantics. Cannot
// be deleted, cannot be renamed away from its admin role.
//
// Hardcoded to 1 because every install seeds the default tenant first,
// and downstream code (sidebars, deep-link redirect, fan-out queries)
// reads this constant. Switching to a runtime-configurable id would
// require migrating every reference; not worth it until a customer
// genuinely asks for a multi-master setup.
export const MASTER_TENANT_ID = 1;

/** True when the supplied tenantId is the master/Default tenant. Treats
 *  null/undefined as "not master" so a missing session doesn't grant
 *  god view by accident. */
export function isMasterTenant(tenantId: number | null | undefined): boolean {
  return tenantId === MASTER_TENANT_ID;
}
