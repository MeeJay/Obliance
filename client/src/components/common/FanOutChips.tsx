import { Building2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTenantStore } from '@/store/tenantStore';
import { useIsMasterTenant } from '@/hooks/useIsMasterTenant';
import { useCanHover } from '@/hooks/useMediaQuery';
import { Tip } from './Tip';

interface Props {
  /** Array of tenant ids the entity has been fan-outed to. */
  targetTenantIds?: number[] | null;
}

/**
 * Displays a small inline chip set for entities the master tenant has
 * fan-outed to one or more child tenants. Visible only on the master
 * view — tenant enfants who see the entity already know they're the
 * audience (they can see the row because of the fan-out). Hidden when
 * the array is empty / null so non-fan-outed rows stay uncluttered.
 *
 * The explanation is a native title tooltip with a mouse (unchanged) and a
 * tap-to-open Tip on touch screens, where title never shows.
 */
export function FanOutChips({ targetTenantIds }: Props) {
  const { t } = useTranslation();
  const isMaster = useIsMasterTenant();
  const tenants = useTenantStore((s) => s.tenants);
  const canHover = useCanHover();
  if (!isMaster) return null;
  if (!Array.isArray(targetTenantIds) || targetTenantIds.length === 0) return null;

  const byId = new Map(tenants.map((tn) => [tn.id, tn.name] as const));
  const tooltip = t('fanOut.tooltip', 'Shared read-only with these tenants');
  const chips = (
    <span className="inline-flex items-center gap-1 flex-wrap" title={canHover ? tooltip : undefined}>
      <Building2 size={10} className="text-accent" />
      <span className="text-[10px] uppercase tracking-wider text-text-muted">→</span>
      {targetTenantIds.map((id) => (
        <span key={id} className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/30">
          {byId.get(id) ?? t('fanOut.tenantFallback', 'Tenant {{id}}', { id })}
        </span>
      ))}
    </span>
  );
  return canHover ? chips : <Tip content={tooltip}>{chips}</Tip>;
}
