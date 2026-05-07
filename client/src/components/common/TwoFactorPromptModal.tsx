import { useState, useRef, useEffect } from 'react';
import { ShieldCheck, X, Loader2 } from 'lucide-react';

// Modal shown when a server response says `twoFactorRequired: true` on a
// sensitive action. The caller provides:
// - the action label (for context: "Reboot SRV-01")
// - an `onSubmit(code)` that re-sends the original request with the code
// in the body and resolves on success or throws on failure
//
// The modal focuses the input, validates 6 digits, disables submit while
// pending, and renders server errors inline so the user can retry without
// losing context.

export function TwoFactorPromptModal({
 actionLabel,
 currentIp,
 onClose,
 onSubmit,
}: {
 actionLabel: string;
 /** IP the server sees the user coming from — shown next to the trust
 * checkbox so the user verifies before opting in. Passed from the
 * 401 response body (`currentIp`). */
 currentIp?: string;
 onClose: () => void;
 onSubmit: (code: string, opts: { trustIp: boolean }) => Promise<void>;
}) {
 const [code, setCode] = useState('');
 const [trustIp, setTrustIp] = useState(false); // explicit opt-in
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
 await onSubmit(code, { trustIp });
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
 className="bg-bg-secondary rounded-xl shadow-2xl w-full max-w-sm mx-4"
 onClick={(e) => e.stopPropagation()}
 >
 <div className="px-4 py-3 flex items-center gap-2">
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
 className="w-full px-3 py-2 text-center text-lg font-mono tracking-[0.5em] bg-bg-tertiary rounded text-text-primary focus:outline-none focus:border-accent"
 />
 {/* Explicit opt-in: skip the prompt for 24h for THIS user + THIS
 IP only. If the cookie is stolen from a different IP the
 trust does not follow — a step-up is still required. */}
 <label className="flex items-start gap-2 cursor-pointer select-none">
 <input
 type="checkbox"
 checked={trustIp}
 onChange={(e) => setTrustIp(e.target.checked)}
 className="mt-0.5 accent-accent"
 />
 <span className="text-[11px] text-text-muted">
 Trust this IP for 24h
 {currentIp && (
 <span className="block font-mono text-[10px] text-text-primary/80 mt-0.5">{currentIp}</span>
 )}
 <span className="block text-[10px] text-text-muted/70 mt-0.5">
 Skips the TOTP prompt for sensitive actions from this IP only. Revocable any time from your profile.
 </span>
 </span>
 </label>
 {error && <p className="text-xs text-red-400">{error}</p>}
 </div>
 <div className="px-4 py-3 flex justify-end gap-2">
 <button
 onClick={onClose}
 disabled={busy}
 className="px-3 py-1.5 text-xs rounded text-text-muted hover:text-text-primary disabled:opacity-50"
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
