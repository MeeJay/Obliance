import { useState, useEffect, useRef } from 'react';
import { Lock, Loader2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { deviceApi } from '@/api/device.api';

interface Props {
  deviceId: number;
  feature: 'scripts' | 'remote' | 'files' | 'processes' | 'chat';
  featureLabel?: string;
  mode?: 'unlock' | 'disable';
  onClose: () => void;
  onUnlocked: (ttlSeconds: number) => void;
}

const FEATURE_LABELS: Record<string, string> = {
  scripts: 'Scripts',
  remote: 'Remote access',
  files: 'File explorer',
  processes: 'Processes',
  chat: 'Chat',
};

export function PrivacyUnlockModal({ deviceId, feature, featureLabel, mode = 'unlock', onClose, onUnlocked }: Props) {
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!password || submitting) return;
    setSubmitting(true);
    try {
      if (mode === 'disable') {
        await deviceApi.disablePrivacyWithPassword(deviceId, password);
        toast.success('Privacy disable command sent');
        onUnlocked(0);
      } else {
        const { ttlSeconds } = await deviceApi.unlockPrivacyFeature(deviceId, password, feature);
        toast.success(`${featureLabel ?? FEATURE_LABELS[feature]} unlocked`);
        onUnlocked(ttlSeconds);
      }
    } catch (err: any) {
      const msg = err?.response?.data?.error || 'Incorrect password';
      toast.error(msg);
      setPassword('');
      inputRef.current?.focus();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={() => !submitting && onClose()}
    >
      <div
        className="bg-bg-secondary border border-border rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-border flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-accent/15 border border-accent/30 flex items-center justify-center">
            <Lock className="w-4 h-4 text-accent" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-text-primary">{mode === 'disable' ? 'Disable privacy mode' : 'Privacy mode unlock'}</div>
            <div className="text-xs text-text-muted truncate">
              {mode === 'disable'
                ? 'Enter the device password to turn privacy off'
                : <>Enter the device password to access <span className="text-text-primary">{featureLabel ?? FEATURE_LABELS[feature]}</span></>}
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="px-5 py-5 space-y-3">
          <input
            ref={inputRef}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={submitting}
            autoComplete="off"
            placeholder="Password"
            className="w-full px-3 py-2.5 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent transition-colors"
          />
          <p className="text-xs text-text-muted">
            {mode === 'disable'
              ? 'Privacy mode will be turned off on the device.'
              : 'Your unlock lasts 15 minutes and only applies to this feature on this device.'}
          </p>
        </form>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border bg-bg-tertiary/30 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-3 py-1.5 text-sm text-text-muted hover:text-text-primary rounded-md transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => handleSubmit()}
            disabled={submitting || !password}
            className="px-4 py-1.5 text-sm font-medium bg-accent text-white rounded-md hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {mode === 'disable' ? 'Disable privacy' : 'Unlock'}
          </button>
        </div>
      </div>
    </div>
  );
}
