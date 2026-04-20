import { useState, useRef, useEffect } from 'react';
import { ShieldCheck, X, Loader2 } from 'lucide-react';

// Modal shown when a server response says `twoFactorRequired: true` on a
// sensitive action. The caller provides:
//   - the action label (for context: "Reboot SRV-01")
//   - an `onSubmit(code)` that re-sends the original request with the code
//     in the body and resolves on success or throws on failure
//
// The modal focuses the input, validates 6 digits, disables submit while
// pending, and renders server errors inline so the user can retry without
// losing context.

export function TwoFactorPromptModal({
  actionLabel,
  onClose,
  onSubmit,
}: {
  actionLabel: string;
  onClose: () => void;
  onSubmit: (code: string) => Promise<void>;
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const submit = async () => {
    setError(null);
    if (!/^\d{6}$/.test(code)) {
      setError('Enter a 6-digit TOTP code from your authenticator app.');
      return;
    }
    setBusy(true);
    try {
      await onSubmit(code);
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Verification failed');
      setCode('');
      requestAnimationFrame(() => inputRef.current?.focus());
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-bg-secondary border border-border rounded-xl shadow-2xl w-full max-w-sm mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-accent" />
          <span className="text-sm font-semibold text-text-primary">Sensitive action</span>
          <button onClick={onClose} className="ml-auto p-1 text-text-muted hover:text-text-primary rounded">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-4 py-4 space-y-3">
          <p className="text-xs text-text-muted">
            <strong className="text-text-primary">{actionLabel}</strong> is marked sensitive by your tenant admin.
            Enter your current 6-digit TOTP code to confirm.
          </p>
          <input
            ref={inputRef}
            type="text"
            inputMode="numeric"
            maxLength={6}
            pattern="\d{6}"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            placeholder="123456"
            className="w-full px-3 py-2 text-center text-lg font-mono tracking-[0.5em] bg-bg-tertiary border border-border rounded text-text-primary focus:outline-none focus:border-accent"
          />
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
        <div className="px-4 py-3 border-t border-border flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="px-3 py-1.5 text-xs border border-border rounded text-text-muted hover:text-text-primary disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy || code.length !== 6}
            className="px-3 py-1.5 text-xs bg-accent text-white rounded hover:bg-accent/90 disabled:opacity-50 flex items-center gap-1.5"
          >
            {busy && <Loader2 className="w-3 h-3 animate-spin" />}
            Verify & execute
          </button>
        </div>
      </div>
    </div>
  );
}
