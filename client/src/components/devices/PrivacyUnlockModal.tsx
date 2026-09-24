import { useState, useEffect, useRef } from 'react';
import { Lock, Loader2 } from 'lucide-react';
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
      onClose={onClose}
      size="sm"
      phoneLayout="sheet"
      // While the request is in flight the dialog cannot be dismissed
      // (same as the old backdrop / × guards).
      dismissible={!submitting}
      // On touch a tap outside is usually meant to hide the keyboard: keep
      // the dialog (× / Cancel / Android back still close it).
      closeOnBackdrop={!coarse}
      overlayClassName="bg-black/70"
      className="sm:rounded-2xl"
      bodyClassName="px-5 py-5 space-y-3"
      footerClassName="px-5 bg-bg-tertiary/30"
      ariaLabel={mode === 'disable' ? t('privacy.unlock.disableTitle', 'Disable privacy mode') : t('privacy.unlock.title', 'Privacy mode unlock')}
      title={
        <span className="flex items-center gap-3 font-normal">
          <span className="w-9 h-9 shrink-0 rounded-full bg-accent/15 border border-accent/30 flex items-center justify-center">
            <Lock className="w-4 h-4 text-accent" />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-semibold text-text-primary truncate">
              {mode === 'disable' ? t('privacy.unlock.disableTitle', 'Disable privacy mode') : t('privacy.unlock.title', 'Privacy mode unlock')}
            </span>
            <span className="block text-xs text-text-muted truncate">
              {mode === 'disable'
                ? t('privacy.unlock.disableSubtitle', 'Enter the device password to turn privacy off')
                : <>{t('privacy.unlock.subtitle', 'Enter the device password to access')} <span className="text-text-primary">{label}</span></>}
            </span>
          </span>
        </span>
      }
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
      <form onSubmit={handleSubmit} className="space-y-3">
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
