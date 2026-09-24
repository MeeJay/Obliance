import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldCheck, Loader2 } from 'lucide-react';
import { Modal } from './Modal';
import { useIsCoarsePointer } from '@/hooks/useMediaQuery';

// Modal shown when a server response says `twoFactorRequired: true` on a
// sensitive action. The caller provides:
// - the action label (for context: "Reboot SRV-01")
// - an `onSubmit(code)` that re-sends the original request with the code
// in the body and resolves on success or throws on failure
//
// The modal focuses the input, validates 6 digits, disables submit while
// pending, and renders server errors inline so the user can retry without
// losing context.
//
// Built on the shared Modal (portal, focus trap, scroll lock, Escape and
// Android back = cancel). Same look as before on desktop (z-[300] above the
// other dialogs, bg-black/70, max-w-sm card). The body scrolls and the
// Verify / Cancel bar stays pinned under it, so the button remains reachable
// with the numeric keyboard up (phone landscape, split-screen tablet). On a
// touch screen a stray backdrop tap (e.g. to dismiss the keyboard) does NOT
// cancel the pending request.

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
 const { t } = useTranslation();
 const coarse = useIsCoarsePointer();
 const [code, setCode] = useState('');
 const [trustIp, setTrustIp] = useState(false); // explicit opt-in
 const [busy, setBusy] = useState(false);
 const [error, setError] = useState<string | null>(null);
 const inputRef = useRef<HTMLInputElement>(null);

 useEffect(() => { inputRef.current?.focus(); }, []);

 const submit = async () => {
 setError(null);
 if (!/^\d{6}$/.test(code)) {
 setError(t('twoFactorPrompt.invalidFormat', 'Enter a 6-digit TOTP code from your authenticator app.'));
 return;
 }
 setBusy(true);
 try {
 await onSubmit(code, { trustIp });
 onClose();
 } catch (err: any) {
 setError(err?.response?.data?.error || err?.message || t('twoFactorPrompt.failed', 'Verification failed'));
 setCode('');
 requestAnimationFrame(() => inputRef.current?.focus());
 } finally {
 setBusy(false);
 }
 };

 return (
 <Modal
 open
 onClose={onClose}
 title={t('twoFactorPrompt.title', 'Sensitive action')}
 icon={<ShieldCheck className="w-4 h-4 text-accent" />}
 size="sm"
 phoneLayout="center"
 closeOnBackdrop={!coarse}
 overlayClassName="z-[300] bg-black/70"
 className="max-w-sm sm:max-w-sm"
 bodyClassName="py-4 space-y-3"
 footer={
 <>
 <button
 type="button"
 onClick={onClose}
 disabled={busy}
 className="px-3 py-1.5 text-xs rounded text-text-muted hover:text-text-primary disabled:opacity-50 coarse:min-h-10 coarse:px-4"
 >
 {t('common.cancel', 'Cancel')}
 </button>
 <button
 type="button"
 onClick={submit}
 disabled={busy || code.length !== 6}
 className="px-3 py-1.5 text-xs bg-accent text-white rounded hover:bg-accent/90 disabled:opacity-50 flex items-center gap-1.5 coarse:min-h-10 coarse:px-4"
 >
 {busy && <Loader2 className="w-3 h-3 animate-spin" />}
 {t('twoFactorPrompt.verify', 'Verify & execute')}
 </button>
 </>
 }
 >
 <p className="text-xs text-text-muted">
 <strong className="text-text-primary">{actionLabel}</strong>{' '}
 {t('twoFactorPrompt.description', 'is marked sensitive by your tenant admin. Enter your current 6-digit TOTP code to confirm.')}
 </p>
 <input
 ref={inputRef}
 type="text"
 inputMode="numeric"
 maxLength={6}
 pattern="\d{6}"
 autoComplete="one-time-code"
 enterKeyHint="go"
 aria-label={t('twoFactorPrompt.codeLabel', 'TOTP code')}
 value={code}
 onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
 onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
 placeholder="123456"
 className="w-full px-3 py-2 text-center text-lg font-mono tracking-[0.5em] bg-bg-tertiary rounded text-text-primary focus:outline-none focus:border-accent"
 />
 {/* Explicit opt-in: skip the prompt for 24h for THIS user + THIS
 IP only. If the cookie is stolen from a different IP the
 trust does not follow — a step-up is still required. */}
 <label className="flex items-start gap-2 cursor-pointer select-none coarse:py-1">
 <input
 type="checkbox"
 checked={trustIp}
 onChange={(e) => setTrustIp(e.target.checked)}
 className="mt-0.5 accent-accent"
 />
 <span className="text-[11px] text-text-muted">
 {t('twoFactorPrompt.trustIp', 'Trust this IP for 24h')}
 {currentIp && (
 <span className="block font-mono text-[10px] text-text-primary/80 mt-0.5">{currentIp}</span>
 )}
 <span className="block text-[10px] text-text-muted/70 mt-0.5">
 {t('twoFactorPrompt.trustIpHint', 'Skips the TOTP prompt for sensitive actions from this IP only. Revocable any time from your profile.')}
 </span>
 </span>
 </label>
 {error && <p className="text-xs text-red-400">{error}</p>}
 </Modal>
 );
}
