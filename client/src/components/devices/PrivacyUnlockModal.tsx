import { useState, useEffect, useRef } from 'react';
import { Lock, Loader2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { deviceApi } from '@/api/device.api';
import { Modal } from '@/components/common/Modal';
import { useIsCoarsePointer } from '@/hooks/useMediaQuery';

interface Props {
  deviceId: number;
  feature: 'scripts' | 'remote' | 'files' | 'processes' | 'chat';
  featureLabel?: string;
  mode?: 'unlock' | 'disable';
  onClose: () => void;
  onUnlocked: (ttlSeconds: number) => void;
}

const FEATURE_LABELS: Record<Props['feature'], { key: string; fallback: string }> = {
  scripts: { key: 'privacy.feature.scripts', fallback: 'Scripts' },
  remote: { key: 'privacy.feature.remote', fallback: 'Remote access' },
  files: { key: 'privacy.feature.files', fallback: 'File explorer' },
  processes: { key: 'privacy.feature.processes', fallback: 'Processes' },
  chat: { key: 'privacy.feature.chat', fallback: 'Chat' },
};

export function PrivacyUnlockModal({ deviceId, feature, featureLabel, mode = 'unlock', onClose, onUnlocked }: Props) {
  const { t } = useTranslation();
  const coarse = useIsCoarsePointer();
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const label = featureLabel ?? t(FEATURE_LABELS[feature].key, FEATURE_LABELS[feature].fallback);
  const title = mode === 'disable' ? t('privacy.unlock.disableTitle', 'Disable privacy mode') : t('privacy.unlock.title', 'Privacy mode unlock');
  // While the request is in flight the dialog cannot be dismissed (× /
  // Cancel disabled; Escape / Android back / backdrop are no-ops).
  const guardedClose = () => { if (!submitting) onClose(); };

  useEffect(() => {
    // No programmatic focus on touch: it would pop the soft keyboard over
    // the dialog before the user has read it.
    if (coarse) return;
    const id = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(id);
  }, [coarse]);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!password || submitting) return;
    setSubmitting(true);
    try {
      if (mode === 'disable') {
        await deviceApi.disablePrivacyWithPassword(deviceId, password);
        toast.success(t('privacy.disableSent', 'Privacy disable command sent'));
        onUnlocked(0);
      } else {
        const { ttlSeconds } = await deviceApi.unlockPrivacyFeature(deviceId, password, feature);
        toast.success(t('privacy.unlock.unlocked', '{{feature}} unlocked', { feature: label }));
        onUnlocked(ttlSeconds);
      }
    } catch (err: any) {
      const msg = err?.response?.data?.error || t('privacy.unlock.incorrect', 'Incorrect password');
      toast.error(msg);
      setPassword('');
      inputRef.current?.focus();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open
      onClose={guardedClose}
      size="sm"
      phoneLayout="sheet"
      // The historic header (px-5 py-4, icon circle, × kept visible but
      // disabled while submitting) is rendered in the body instead of
      // Modal's px-4 py-3 header, so the desktop dialog is unchanged.
      showCloseButton={false}
      // On touch a tap outside is usually meant to hide the keyboard: keep
      // the dialog (× / Cancel / Android back still close it).
      closeOnBackdrop={!coarse}
      overlayClassName="bg-black/70"
      className="sm:max-w-sm sm:rounded-2xl"
      bodyClassName="p-0"
      footerClassName="px-5 bg-bg-tertiary/30"
      ariaLabel={title}
      footer={
        <>
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-3 py-1.5 text-sm text-text-muted hover:text-text-primary rounded-md transition-colors coarse:min-h-10"
          >
            {t('common.cancel', 'Cancel')}
          </button>
          <button
            onClick={() => handleSubmit()}
            disabled={submitting || !password}
            className="px-4 py-1.5 text-sm font-medium bg-accent text-white rounded-md hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2 coarse:min-h-10"
          >
            {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {mode === 'disable' ? t('privacy.unlock.disableSubmit', 'Disable privacy') : t('privacy.unlock.submit', 'Unlock')}
          </button>
        </>
      }
    >
      <div className="px-5 py-4 flex items-center gap-3">
        <div className="w-9 h-9 shrink-0 rounded-full bg-accent/15 border border-accent/30 flex items-center justify-center">
          <Lock className="w-4 h-4 text-accent" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-text-primary">{title}</div>
          <div className="text-xs text-text-muted truncate">
            {mode === 'disable'
              ? t('privacy.unlock.disableSubtitle', 'Enter the device password to turn privacy off')
              : <>{t('privacy.unlock.subtitle', 'Enter the device password to access')} <span className="text-text-primary">{label}</span></>}
          </div>
        </div>
        {/* Historic × (same classes as before the Modal migration) with a
            40px touch target on coarse pointers. */}
        <button
          type="button"
          onClick={onClose}
          disabled={submitting}
          aria-label={t('common.close', 'Close')}
          className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors disabled:opacity-50 coarse:min-h-10 coarse:min-w-10 coarse:flex coarse:items-center coarse:justify-center"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="px-5 py-5 space-y-3">
        <input
          ref={inputRef}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={submitting}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="done"
          placeholder={t('common.password', 'Password')}
          className="w-full px-3 py-2.5 text-sm bg-bg-tertiary rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent transition-colors"
        />
        <p className="text-xs text-text-muted">
          {mode === 'disable'
            ? t('privacy.unlock.disableHint', 'Privacy mode will be turned off on the device.')
            : t('privacy.unlock.hint', 'Your unlock lasts 15 minutes and only applies to this feature on this device.')}
        </p>
      </form>
    </Modal>
  );
}
