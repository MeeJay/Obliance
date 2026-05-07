import { Building2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTenantStore } from '@/store/tenantStore';
import { useIsMasterTenant } from '@/hooks/useIsMasterTenant';
import { MASTER_TENANT_ID } from '@obliance/shared';
import { clsx } from 'clsx';

interface Props {
 value: Set<number>;
 onChange: (next: Set<number>) => void;
 /** When provided, only render chips for tenants whose id is in this
 * list (typically the set of tenants present in the current page's
 * data). Lets the chip row stay tight on dashboards that only see a
 * subset of tenants. When omitted, all accessible tenants are
 * rendered. */
 availableTenantIds?: number[];
 /** Optional className applied to the wrapper. */
 className?: string;
}

/**
 * Master-only chip row to narrow the god view to one or several
 * tenants. Returns `null` outside master so call sites can drop it in
 * unconditionally.
 *
 * The Default/master tenant chip is forced to the leftmost position
 * with a `(master)` suffix; the rest is alpha. A "Clear" button
 * surfaces only when at least one chip is active so the chip row
 * collapses cleanly in idle state.
 */
export function TenantFilterChips({ value, onChange, availableTenantIds, className }: Props) {
 const { t } = useTranslation();
 const isMaster = useIsMasterTenant();
 const tenants = useTenantStore((s) => s.tenants);
 if (!isMaster) return null;

 const allowed = availableTenantIds ? new Set(availableTenantIds) : null;
 const visible = tenants
 .filter((tenant) => !allowed || allowed.has(tenant.id))
 .sort((a, b) => {
 if (a.id === MASTER_TENANT_ID) return -1;
 if (b.id === MASTER_TENANT_ID) return 1;
 return a.name.localeCompare(b.name);
 });
 if (visible.length <= 1) return null;

 const toggle = (id: number) => {
 const next = new Set(value);
 if (next.has(id)) next.delete(id); else next.add(id);
 onChange(next);
 };

 return (
 <div className={clsx('flex items-center gap-1.5 flex-wrap', className)}>
 <span className="text-[10px] uppercase tracking-wider text-text-muted mr-1">
 <Building2 size={10} className="inline mr-1" />
 {t('tenantFilter.label') || 'Tenant'}
 </span>
 {visible.map((tenant) => {
 const on = value.has(tenant.id);
 return (
 <button
 key={tenant.id}
 type="button"
 onClick={() => toggle(tenant.id)}
 className={clsx(
 'px-2.5 py-1 text-xs font-medium rounded-full border transition-colors',
 on
 ? 'bg-accent/10 border-accent text-accent'
 : 'border-transparent text-text-muted hover:border-accent/30',
 )}
 >
 <Building2 size={10} className="inline mr-1" />
 {tenant.id === MASTER_TENANT_ID ? `${tenant.name} (master)` : tenant.name}
 </button>
 );
 })}
 {value.size > 0 && (
 <button
 type="button"
 onClick={() => onChange(new Set())}
 className="text-[10px] text-accent hover:underline ml-1"
 >
 {t('tenantFilter.clear') || 'Effacer'}
 </button>
 )}
 </div>
 );
}
