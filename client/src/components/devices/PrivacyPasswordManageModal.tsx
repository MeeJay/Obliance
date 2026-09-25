import { useState, useEffect, useRef } from 'react';
import { ShieldCheck, Loader2, AlertTriangle, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { deviceApi } from '@/api/device.api';
import { Modal } from '@/components/common/Modal';
import { useIsCoarsePointer } from '@/hooks/useMediaQuery';

type Mode = 'set' | 'change' | 'remove';

interface Props {
  deviceId: number;
  mode: Mode;
  onClose: () => void;
  onSuccess: (passwordSet: boolean) => void;
}

// Password fields: no autocapitalize / autocorrect / spellcheck on touch
// keyboards (docs/obli-mobile.md §5.10).
const PASSWORD_INPUT_PROPS = {
  type: 'password',
  autoComplete: 'off',
  autoCapitalize: 'off',
  autoCorrect: 'off',
  spellCheck: false,
} as const;

export function PrivacyPasswordManageModal({ deviceId, mode, onClose, onSuccess }: Props) {
  const { t } = useTranslation();
  const coarse = useIsCoarsePointer();
  const [oldPassword, setOldPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [ack, setAck] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Skip the auto-focus on touch: it would open the soft keyboard over
    // the warning before the user has read it.
    if (coarse) return;
    const id = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(id);
  }, [coarse]);

  const title = mode === 'set'
    ? t('privacy.password.setTitle', 'Set privacy password')
    : mode === 'change'
      ? t('privacy.password.changeTitle', 'Change privacy password')
      : t('privacy.password.removeTitle', 'Remove privacy password');

  const canSubmit = (() => {
    if (submitting) return false;
    if (mode === 'set') return password && password === confirm && ack;
    if (mode === 'change') return oldPassword && password && password === confirm;
    if (mode === 'remove') return password;
    return false;
  })();

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      if (mode === 'set') {
        await deviceApi.setPrivacyPassword(deviceId, password);
        toast.success(t('privacy.password.setDone', 'Privacy password set'));
        onSuccess(true);
      } else if (mode === 'change') {
        await deviceApi.changePrivacyPassword(deviceId, oldPassword, password);
        toast.success(t('privacy.password.changeDone', 'Privacy password changed'));
        onSuccess(true);
      } else {
        await deviceApi.removePrivacyPassword(deviceId, password);
        toast.success(t('privacy.password.removeDone', 'Privacy password removed'));
        onSuccess(false);
      }
      onClose();
    } catch (err: any) {
      const msg = err?.response?.data?.error || t('privacy.password.failed', 'Operation failed');
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  // While the request is in flight the dialog cannot be dismissed (× /
  // Cancel disabled; Escape / Android back / backdrop are no-ops).
  const guardedClose = () => { if (!submitting) onClose(); };

  const inputCls = 'w-full px-3 py-2.5 text-sm bg-bg-tertiary rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent transition-colors';

  return (
    <Modal
      open
      onClose={guardedClose}
      size="sm"
      // The historic header (px-5 py-4, icon circle, × kept visible but
      // disabled while submitting) is rendered in the body instead of
      // Modal's px-4 py-3 header, so the desktop dialog is unchanged.
      showCloseButton={false}
      // Tapping outside (e.g. to hide the soft keyboard) must not discard
      // the typed passwords on touch; the × / Cancel / back still close.
      closeOnBackdrop={!coarse}
      overlayClassName="bg-black/70"
      className="sm:max-w-md sm:rounded-2xl"
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
            disabled={!canSubmit}
            className={`px-4 py-1.5 text-sm font-medium text-white rounded-md disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2 coarse:min-h-10 ${
              mode === 'remove' ? 'bg-red-500 hover:bg-red-500/90' : 'bg-accent hover:bg-accent/90'
            }`}
          >
            {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {mode === 'set'
              ? t('privacy.password.setSubmit', 'Set password')
              : mode === 'change'
                ? t('privacy.password.changeSubmit', 'Change password')
                : t('privacy.password.removeSubmit', 'Remove password')}
          </button>
        </>
      }
    >
      <div className="px-5 py-4 flex items-center gap-3">
        <div className="w-9 h-9 shrink-0 rounded-full bg-accent/15 border border-accent/30 flex items-center justify-center">
          <ShieldCheck className="w-4 h-4 text-accent" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-text-primary">{title}</div>
          <div className="text-xs text-text-muted">{t('privacy.password.mustBeOff', 'Privacy mode must be OFF on the device')}</div>
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
        {mode === 'set' && (
          <div className="flex gap-2 p-3 rounded-lg border border-orange-400/30 bg-orange-400/5 text-xs text-orange-200">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              {t(
                'privacy.password.setWarning',
                'This password is stored only on the device. Obliance cannot recover it. If you lose it, you will need local access to the machine to reset privacy mode.',
              )}
            </div>
          </div>
        )}

        {mode === 'change' && (
          <input
            ref={inputRef}
            {...PASSWORD_INPUT_PROPS}
            value={oldPassword}
            onChange={(e) => setOldPassword(e.target.value)}
            disabled={submitting}
            placeholder={t('privacy.password.current', 'Current password')}
            className={inputCls}
          />
        )}

        <input
          ref={mode === 'change' ? undefined : inputRef}
          {...PASSWORD_INPUT_PROPS}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={submitting}
          placeholder={mode === 'remove' ? t('privacy.password.current', 'Current password') : t('privacy.password.new', 'New password')}
          className={inputCls}
        />

        {mode !== 'remove' && (
          <input
            {...PASSWORD_INPUT_PROPS}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            disabled={submitting}
            placeholder={t('privacy.password.confirmNew', 'Confirm new password')}
            className={inputCls}
          />
        )}
        {mode !== 'remove' && password && confirm && password !== confirm && (
          <p className="text-xs text-red-400">{t('privacy.password.mismatch', 'Passwords do not match')}</p>
        )}

        {mode === 'set' && (
          <label className="flex items-start gap-2 text-xs text-text-muted cursor-pointer coarse:py-2">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5" />
            <span>{t('privacy.password.ack', 'I understand this password cannot be recovered by Obliance.')}</span>
          </label>
        )}
      </form>
    </Modal>
  );
}
