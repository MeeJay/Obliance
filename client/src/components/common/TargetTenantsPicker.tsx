import { useTranslation } from 'react-i18next';
import { Building2 } from 'lucide-react';
import { useTenantStore } from '@/store/tenantStore';
import { useIsMasterTenant } from '@/hooks/useIsMasterTenant';
import { MASTER_TENANT_ID } from '@obliance/shared';
import { clsx } from 'clsx';

interface Props {
  /** Current selection. Null/undefined = local-only (no fan-out). */
  value: number[] | null | undefined;
  onChange: (next: number[] | null) => void;
  /** Optional label override. Defaults to a generic "Diffuser à". */
  label?: string;
  disabled?: boolean;
}

/**
 * Master-only fan-out picker. Renders a horizontal list of toggle chips,
 * one per child tenant the admin has access to (the master tenant
 * itself is intentionally excluded — fan-out to self is meaningless;
 * the entity is already visible there as the owner). When the user is
 * NOT on the master tenant the component returns `null`, so call
 * sites can drop it in unconditionally.
 *
 * Selection semantics:
 *   - Empty / no chip selected → component emits `null` (clears fan-out;
 *     entity stays local to the master tenant).
 *   - One or more chips selected → array of tenant ids.
 */
export function TargetTenantsPicker({ value, onChange, label, disabled }: Props) {
  const { t } = useTranslation();
  const isMaster = useIsMasterTenant();
  const tenants = useTenantStore((s) => s.tenants);
  if (!isMaster) return null;

  const childTenants = tenants
    .filter((tenant) => tenant.id !== MASTER_TENANT_ID)
    .sort((a, b) => a.name.localeCompare(b.name));
  if (childTenants.length === 0) return null;

  const selected = new Set<number>(Array.isArray(value) ? value : []);
  const toggle = (id: number) => {
    if (disabled) return;
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange(next.size === 0 ? null : [...next]);
  };

  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-text-muted uppercase tracking-wider">
        <Building2 size={11} className="inline mr-1" />
        {label ?? (t('fanOut.label') || 'Diffuser à (lecture seule sur les tenants ciblés)')}
      </label>
      <div className="flex items-center gap-1.5 flex-wrap">
        {childTenants.map((tenant) => {
          const on = selected.has(tenant.id);
          return (
            <button
              key={tenant.id}
              type="button"
              onClick={() => toggle(tenant.id)}
              disabled={disabled}
              className={clsx(
                'inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs border transition-colors',
                on
                  ? 'bg-accent text-white border-accent'
                  : 'bg-bg-secondary border-border text-text-muted hover:text-text-primary',
                disabled && 'opacity-50 cursor-not-allowed',
              )}
            >
              <Building2 size={10} />
              {tenant.name}
            </button>
          );
        })}
        {selected.size > 0 && !disabled && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-[11px] text-text-muted underline hover:text-text-primary"
          >
            {t('fanOut.clear') || 'Retirer'}
          </button>
        )}
      </div>
      <p className="text-[11px] text-text-muted">
        {t('fanOut.hint') || 'Le tenant Default reste propriétaire ; les tenants ciblés voient l\'entité en lecture seule et ne peuvent pas la modifier.'}
      </p>
    </div>
  );
}
