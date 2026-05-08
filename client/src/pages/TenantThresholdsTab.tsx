import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, RotateCcw, Save } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '@/components/common/Button';
import { ThresholdsEditor } from '@/components/common/ThresholdsEditor';
import { thresholdsApi, resolvedToInherited, type ResolvedThresholds } from '@/api/thresholds.api';
import { useTenantStore } from '@/store/tenantStore';
import type { MetricThresholds } from '@obliance/shared';

// /policies → onglet "Seuils" — édite la couche tenant du cascade
// (system → global → tenant → group → device). Le placeholder de
// chaque slot affiche la valeur héritée des couches supérieures
// (global ou system) résolue par le serveur, donc l'admin voit
// directement ce qui s'appliquerait s'il laissait un champ vide.
//
// Bouton "Réinitialiser" envoie `null` côté serveur — nettoie la
// colonne `tenants.metric_thresholds_default` et le cascade revient
// au layer global (puis system).
export function TenantThresholdsTab() {
  const { t } = useTranslation();
  const currentTenantId = useTenantStore((s) => s.currentTenantId);
  const [draft, setDraft] = useState<MetricThresholds>({});
  const [initial, setInitial] = useState<MetricThresholds>({});
  const [resolved, setResolved] = useState<ResolvedThresholds | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // We don't need a useEffect dep on tenantStore because the API
  // endpoint reads `req.tenantId` from the session — switching tenant
  // in the topbar already remounts this page through the router.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      thresholdsApi.getTenantThresholds(),
      thresholdsApi.getTenantResolved(),
    ])
      .then(([stored, inherited]) => {
        if (cancelled) return;
        setDraft(stored ?? {});
        setInitial(stored ?? {});
        setResolved(inherited);
      })
      .catch(() => {
        if (!cancelled) toast.error(t('thresholds.failedLoad', 'Failed to load thresholds'));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [currentTenantId, t]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  const save = async () => {
    setSaving(true);
    try {
      const payload = Object.keys(draft).length === 0 ? null : draft;
      const next = await thresholdsApi.setTenantThresholds(payload);
      setInitial(next ?? {});
      setDraft(next ?? {});
      toast.success(t('thresholds.saved', 'Seuils mis à jour'));
      // Re-fetch resolved so the placeholder reflects the new layer
      // (the inherited-from-global slot doesn't change, but if the
      // admin cleared a tenant slot we want the placeholder to fall
      // back visually too).
      const inherited = await thresholdsApi.getTenantResolved();
      setResolved(inherited);
    } catch {
      toast.error(t('thresholds.failedSave', 'Échec de la mise à jour des seuils'));
    } finally {
      setSaving(false);
    }
  };

  const reset = () => setDraft(initial);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-text-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl bg-bg-secondary p-5">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-text-primary">
              {t('thresholds.tenantTitle', 'Seuils par défaut du tenant')}
            </h3>
            <p className="text-xs text-text-muted mt-1 max-w-2xl">
              {t('thresholds.tenantHelp', "Chaque groupe et chaque appareil de ce tenant héritent de ces valeurs si rien n'est défini à leur propre niveau. Laissez un champ vide pour hériter de la couche globale (placeholder en gris).")}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="ghost" size="sm" onClick={reset} disabled={!dirty || saving}>
              <RotateCcw size={14} className="mr-1" />
              {t('common.cancel', 'Annuler')}
            </Button>
            <Button onClick={save} loading={saving} disabled={!dirty}>
              <Save size={14} className="mr-1" />
              {t('common.save', 'Enregistrer')}
            </Button>
          </div>
        </div>
        <ThresholdsEditor
          value={draft}
          onChange={setDraft}
          inheritedFrom={resolved ? resolvedToInherited(resolved) : undefined}
          layer="group"
        />
      </div>
    </div>
  );
}
