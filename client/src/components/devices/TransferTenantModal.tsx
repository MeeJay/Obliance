import { useEffect, useState } from 'react';
import { ArrowRightLeft, AlertTriangle, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { deviceApi } from '@/api/device.api';
import { Modal } from '@/components/common/Modal';
import { useConfirm } from '@/components/common/ConfirmDialog';
import toast from 'react-hot-toast';

// Transfer a device from the current tenant to another. Caller must be admin
// in both tenants (or platform admin); the candidate list is already
// filtered server-side.
//
// After transfer:
//  - device.tenant_id / api_key_id are updated, group_id is cleared
//  - custom metrics + compliance results for the device are dropped
//  - pending commands are cancelled
//  - a `reconfigure_agent` command is enqueued so the agent switches to
//    the new API key on its next push

interface Props {
  deviceId: number;
  deviceName: string;
  onClose: () => void;
  onTransferred?: () => void;
}

interface Candidate {
  tenantId: number;
  tenantName: string;
  tenantSlug: string;
  apiKeys: { id: number; label: string; defaultGroupId: number | null }[];
}

export function TransferTenantModal({ deviceId, deviceName, onClose, onTransferred }: Props) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTenantId, setSelectedTenantId] = useState<number | null>(null);
  const [selectedKeyId, setSelectedKeyId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    deviceApi.listTransferCandidates(deviceId)
      .then((rows) => {
        setCandidates(rows);
        // Auto-select first tenant if exactly one is eligible.
        if (rows.length === 1) {
          setSelectedTenantId(rows[0].tenantId);
          if (rows[0].apiKeys.length > 0) setSelectedKeyId(rows[0].apiKeys[0].id);
        }
      })
      .catch(() => toast.error(t('devices.transfer.loadFailed', 'Failed to load target tenants')))
      .finally(() => setLoading(false));
  }, [deviceId, t]);

  const selectedTenant = candidates.find((c) => c.tenantId === selectedTenantId);

  const submit = async () => {
    if (!selectedTenantId || !selectedKeyId) return;
    // Shared confirm dialog instead of window.confirm (a no-op in the
    // Android WebView) — docs/obli-mobile.md §5.6.
    const ok = await confirm({
      title: t('devices.transfer.confirmTitle', 'Transfer "{{device}}" to {{tenant}}?', {
        device: deviceName, tenant: selectedTenant?.tenantName ?? '',
      }),
      message: t(
        'devices.transfer.confirmMessage',
        "This will clear the device's group, drop its custom metrics and compliance results in the current tenant, and reconfigure the agent to report to the new tenant on its next check-in.",
      ),
      confirmLabel: t('devices.transfer.submit', 'Transfer'),
    });
    if (!ok) return;
    setSubmitting(true);
    try {
      await deviceApi.transferToTenant(deviceId, selectedTenantId, selectedKeyId);
      toast.success(t('devices.transfer.initiated', 'Transfer initiated — agent will reconfigure on next push.'));
      onTransferred?.();
      onClose();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || t('devices.transfer.failed', 'Transfer failed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      icon={<ArrowRightLeft className="w-4 h-4 text-accent" />}
      title={t('devices.transfer.title', 'Transfer to another tenant')}
      bodyClassName="px-4 py-4 space-y-4"
      footer={
        <>
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded text-text-muted hover:text-text-primary coarse:min-h-10"
          >
            {t('common.cancel', 'Cancel')}
          </button>
          <button
            disabled={!selectedTenantId || !selectedKeyId || submitting}
            onClick={submit}
            className="px-3 py-1.5 text-xs bg-accent text-white rounded hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 coarse:min-h-10"
          >
            {submitting && <Loader2 className="w-3 h-3 animate-spin" />}
            {t('devices.transfer.submit', 'Transfer')}
          </button>
        </>
      }
    >
      <div className="flex items-start gap-2 p-2.5 rounded bg-orange-400/5 border border-orange-400/20 text-[11px] text-orange-400/90">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <div>
          {t('devices.transfer.warningPrefix', 'This transfers')}{' '}
          <strong className="text-text-primary break-all">{deviceName}</strong>{' '}
          {t(
            'devices.transfer.warningSuffix',
            "to another tenant. Group assignment, custom metrics, schedule alerts, and compliance results from the current tenant will be cleared. The agent's API key will be swapped via a queued command on its next push.",
          )}
        </div>
      </div>

      {loading ? (
        <div className="py-8 flex justify-center text-text-muted">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : candidates.length === 0 ? (
        <p className="text-sm text-text-muted italic">
          {t(
            'devices.transfer.noCandidates',
            'You are not admin in any other tenant. Ask a platform admin to perform the transfer, or join the target tenant as admin first.',
          )}
        </p>
      ) : (
        <>
          <div>
            <label className="block text-[10px] uppercase font-semibold text-text-muted mb-1.5">
              {t('devices.transfer.targetTenant', 'Target tenant')}
            </label>
            <select
              value={selectedTenantId ?? ''}
              onChange={(e) => {
                const id = e.target.value ? parseInt(e.target.value) : null;
                setSelectedTenantId(id);
                const tc = candidates.find((c) => c.tenantId === id);
                setSelectedKeyId(tc && tc.apiKeys.length > 0 ? tc.apiKeys[0].id : null);
              }}
              className="w-full px-3 py-2 text-sm bg-bg-tertiary rounded text-text-primary focus:outline-none focus:border-accent"
            >
              <option value="">{t('devices.transfer.selectTenant', '— Select a tenant —')}</option>
              {candidates.map((c) => (
                <option key={c.tenantId} value={c.tenantId}>
                  {c.tenantName} ({c.tenantSlug}){c.apiKeys.length === 0 ? ` — ${t('devices.transfer.noApiKeys', 'no API keys')}` : ''}
                </option>
              ))}
            </select>
          </div>
          {selectedTenant && (
            <div>
              <label className="block text-[10px] uppercase font-semibold text-text-muted mb-1.5">
                {t('devices.transfer.targetKey', 'Target API key')}
              </label>
              {selectedTenant.apiKeys.length === 0 ? (
                <p className="text-xs text-red-400">
                  {t('devices.transfer.noKeysHint', 'This tenant has no API keys yet. Create one under')}{' '}
                  <code>/admin/devices → API Keys</code>{' '}
                  {t('devices.transfer.noKeysHintSuffix', 'in that tenant first.')}
                </p>
              ) : (
                <select
                  value={selectedKeyId ?? ''}
                  onChange={(e) => setSelectedKeyId(e.target.value ? parseInt(e.target.value) : null)}
                  className="w-full px-3 py-2 text-sm bg-bg-tertiary rounded text-text-primary focus:outline-none focus:border-accent"
                >
                  {selectedTenant.apiKeys.map((k) => (
                    <option key={k.id} value={k.id}>{k.label || t('devices.transfer.keyFallback', 'Key #{{id}}', { id: k.id })}</option>
                  ))}
                </select>
              )}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
