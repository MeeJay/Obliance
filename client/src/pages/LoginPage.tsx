import { useState, useEffect, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/store/authStore';
import { twoFactorApi } from '@/api/twoFactor.api';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { Logo } from '@/components/common/Logo';

type Step = 'credentials' | '2fa';

export function LoginPage() {
 const { t } = useTranslation();
 const navigate = useNavigate();
 const { login, isLoading, checkSession } = useAuthStore();
 const [searchParams] = useSearchParams();

 const [username, setUsername] = useState('');
 const [password, setPassword] = useState('');
 const errorParam = searchParams.get('error');
 const [error, setError] = useState(
 errorParam === 'sso_failed' ? t('login.ssoFailed', 'SSO authentication failed. Please try local login.')
 // SSO worked but the linked local account is disabled in Obliance.
 : errorParam === 'account_disabled' ? t('login.accountDisabled', 'Your account is disabled on this server. Ask an administrator to re-enable it.')
 : '',
 );
 const [serverVersion, setServerVersion] = useState<string | null>(null);
 // The account is an SSO (Obligate) account without a local TOTP: it can
 // only sign in through Obligate (server answer 403 ssoLoginRequired).
 const [ssoLoginRequired, setSsoLoginRequired] = useState(false);

 // If we arrived here with ?error=sso_failed (or account_disabled), don't auto-redirect to Obligate again
 const ssoFailed = errorParam === 'sso_failed' || errorParam === 'account_disabled';
 // Break-glass: ?local=1 forces the local username/password form and skips
 // the automatic SSO redirect. Lets a local admin sign in even when SSO is
 // enabled and Obligate is up — the escape hatch when SSO is misconfigured
 // (e.g. no permission-group mapping yet) so you can never be fully locked out.
 const forceLocal = searchParams.get('local') === '1' || searchParams.get('local') === 'true';

 const [step, setStep] = useState<Step>('credentials');
 const [mfaMethods, setMfaMethods] = useState<{ totp: boolean; email: boolean }>({ totp: false, email: false });
 const [mfaTab, setMfaTab] = useState<'totp' | 'email'>('totp');
 const [mfaCode, setMfaCode] = useState('');
 const [mfaLoading, setMfaLoading] = useState(false);

 // SSO state: 'checking' = initial check, 'redirecting' = going to Obligate,
 // 'unavailable' = Obligate down (show local login + warning), 'local' = no Obligate configured
 const [ssoState, setSsoState] = useState<'checking' | 'redirecting' | 'unavailable' | 'local'>(ssoFailed ? 'unavailable' : forceLocal ? 'local' : 'checking');

 const checkSso = () => {
 return fetch('/api/auth/sso-config')
 .then(r => r.json())
 .then((data: { success: boolean; data?: { obligateUrl: string | null; obligateReachable: boolean; obligateEnabled: boolean } }) => {
 if (data.success && data.data?.obligateEnabled && data.data.obligateUrl) {
 if (data.data.obligateReachable) {
 // Anti-loop: if we redirected to SSO less than 15s ago and ended up back here, Gate is broken
 const lastRedirect = sessionStorage.getItem('_sso_redirect_ts');
 if (lastRedirect && Date.now() - parseInt(lastRedirect) < 15000) {
 setSsoState('unavailable');
 return 'unavailable';
 }
 sessionStorage.setItem('_sso_redirect_ts', String(Date.now()));
 setSsoState('redirecting');
 window.location.href = '/auth/sso-redirect';
 return 'redirected';
 }
 setSsoState('unavailable');
 return 'unavailable';
 }
 setSsoState('local');
 return 'local';
 })
 .catch(() => { setSsoState('unavailable'); return 'unavailable'; });
 };

 useEffect(() => {
 fetch('/health')
 .then((r) => r.json())
 .then((data: { version?: string }) => setServerVersion(data.version ?? null))
 .catch(() => {});

 // Check existing session first
 fetch('/api/auth/me', { credentials: 'include' })
 .then(r => r.json())
 .then((d: { success?: boolean }) => {
 if (d.success) { navigate('/', { replace: true }); return; }
 // No session — check Obligate unless we just failed or local was forced
 if (forceLocal) setSsoState('local');
 else if (!ssoFailed) checkSso();
 else setSsoState('unavailable');
 })
 .catch(() => { if (forceLocal) setSsoState('local'); else if (!ssoFailed) checkSso(); });
 }, []); // eslint-disable-line react-hooks/exhaustive-deps

 // Poll Obligate every 60s when unavailable — redirect as soon as it comes back
 useEffect(() => {
 if (ssoState !== 'unavailable') return;
 const interval = setInterval(() => {
 checkSso();
 }, 60_000);
 return () => clearInterval(interval);
 }, [ssoState]); // eslint-disable-line react-hooks/exhaustive-deps

 const handleSubmit = async (e: FormEvent) => {
 e.preventDefault();
 setError('');
 setSsoLoginRequired(false);
 try {
 const result = await login(username, password);
 if (result.requires2fa) {
 setMfaMethods(result.methods);
 setMfaTab(result.methods.totp ? 'totp' : 'email');
 setMfaCode('');
 setStep('2fa');
 } else {
 navigate('/', { replace: true });
 }
 } catch (err) {
 if ((err as { code?: string } | null)?.code === 'ssoLoginRequired') {
 setPassword('');
 setSsoLoginRequired(true);
 return;
 }
 setError(err instanceof Error ? err.message : t('login.loginFailed'));
 }
 };

 const handleMfaSubmit = async (e: FormEvent) => {
 e.preventDefault();
 setError('');
 setMfaLoading(true);
 try {
 await twoFactorApi.verify(mfaCode, mfaTab);
 await checkSession();
 navigate('/', { replace: true });
 } catch (err: unknown) {
 const axiosErr = err as { response?: { status?: number; data?: { error?: string } } };
 const status = axiosErr?.response?.status;
 const serverMsg = axiosErr?.response?.data?.error ?? '';
 if (status === 400 && serverMsg.toLowerCase().includes('pending')) {
 // Session was lost between login and 2FA verify (e.g. server restart)
 setError(t('login.twoFactor.sessionExpired'));
 setStep('credentials');
 } else {
 setError(t('login.twoFactor.invalidCode'));
 }
 } finally {
 setMfaLoading(false);
 }
 };

 const handleResendEmail = async () => {
 try {
 await twoFactorApi.resendEmail();
 } catch {
 setError(t('login.twoFactor.resendFailed'));
 }
 };

 // While checking or redirecting, show a minimal loading screen — never flash the local login form
 if (ssoState === 'checking' || ssoState === 'redirecting') {
 return (
 <div className="flex min-h-dvh supports-[not(height:100dvh)]:min-h-screen items-center justify-center bg-bg-primary">
 <div className="text-center">
 <Logo className="mx-auto h-24 w-24 mb-3 animate-pulse" />
 <p className="text-sm text-text-secondary">
 {ssoState === 'redirecting' ? t('login.ssoRedirecting', 'Redirecting to login...') : t('login.ssoChecking', 'Checking authentication...')}
 </p>
 </div>
 </div>
 );
 }

 // Phone / tablet / touch (soft keyboard): min-h in dvh so the page grows
 // and scrolls instead of clipping when the keyboard shrinks the viewport;
 // the version footer joins the column flow (a `fixed bottom` footer would
 // ride up over the form above the keyboard). Safe-area padding keeps the
 // form clear of the status / gesture bars in the Android shell (= p-4 on
 // desktop, where the insets are 0).
 return (
 <div className="flex min-h-dvh supports-[not(height:100dvh)]:min-h-screen items-center justify-center bg-bg-primary p-4 pt-[max(1rem,var(--safe-top))] pb-[max(1rem,var(--safe-bottom))] max-lg:flex-col coarse:flex-col">
 <div className="w-full max-w-sm space-y-8 relative">
 <div className="text-center">
 <Logo className="mx-auto h-24 w-24 mb-3" />
 <p className="mt-2 text-sm text-text-secondary">{t('login.title')}</p>
 </div>

 {ssoState === 'unavailable' && (
 <div className="bg-status-pending-bg border border-status-pending/30 rounded-lg p-3 text-sm text-status-pending">
 {t('login.ssoUnavailable', 'Centralized login (Obligate) is unavailable. Using local authentication.')}
 </div>
 )}

 {step === 'credentials' ? (
 <form onSubmit={handleSubmit} className="space-y-6 rounded-lg bg-bg-secondary p-6">
 <Input
 label={t('login.username')}
 type="text"
 value={username}
 onChange={(e) => setUsername(e.target.value)}
 placeholder={t('login.usernamePlaceholder')}
 autoComplete="username"
 autoCapitalize="off"
 autoCorrect="off"
 spellCheck={false}
 enterKeyHint="next"
 autoFocus
 required
 />
 <Input
 label={t('login.password')}
 type="password"
 value={password}
 onChange={(e) => setPassword(e.target.value)}
 placeholder={t('login.passwordPlaceholder')}
 autoComplete="current-password"
 enterKeyHint="go"
 required
 />
 {error && (
 <div className="rounded-md bg-status-down-bg border border-status-down/30 p-3">
 <p className="text-sm text-status-down">{error}</p>
 </div>
 )}
 {ssoLoginRequired && (
 <div role="alert" className="rounded-md bg-status-pending-bg border border-status-pending/30 p-3 space-y-3">
 <p className="text-sm font-medium text-text-primary">
 {t('login.ssoLoginRequired.title', 'This account signs in through Obligate')}
 </p>
 <p className="text-xs text-text-secondary">
 {t('login.ssoLoginRequired.body', 'Its password and two-factor authentication are managed in Obligate. Local sign-in is only possible with an authenticator app set up on this server.')}
 </p>
 <Button type="button" variant="secondary" className="w-full" onClick={() => { window.location.href = '/auth/sso-redirect'; }}>
 {t('login.ssoLoginRequired.button', 'Sign in with Obligate')}
 </Button>
 </div>
 )}
 <Button type="submit" className="w-full" loading={isLoading}>
 {t('login.signIn')}
 </Button>
 <div className="text-center">
 <Link to="/forgot-password" className="text-xs text-text-muted hover:text-text-primary transition-colors coarse:inline-flex coarse:min-h-10 coarse:items-center coarse:px-2">
 {t('login.forgotPassword')}
 </Link>
 </div>
 </form>
 ) : (
 <form onSubmit={handleMfaSubmit} className="space-y-5 rounded-lg bg-bg-secondary p-6">
 <div>
 <p className="text-sm font-medium text-text-primary mb-1">{t('login.twoFactor.title')}</p>
 <p className="text-xs text-text-muted">{t('login.twoFactor.description')}</p>
 </div>

 {mfaMethods.totp && mfaMethods.email && (
 <div className="flex rounded-md overflow-hidden text-sm">
 <button
 type="button"
 onClick={() => setMfaTab('totp')}
 className={`flex-1 py-1.5 transition-colors coarse:min-h-10 ${mfaTab === 'totp' ? 'bg-primary text-white' : 'text-text-secondary hover:bg-bg-hover'}`}
 >
 {t('login.twoFactor.tabTotp')}
 </button>
 <button
 type="button"
 onClick={() => setMfaTab('email')}
 className={`flex-1 py-1.5 transition-colors coarse:min-h-10 ${mfaTab === 'email' ? 'bg-primary text-white' : 'text-text-secondary hover:bg-bg-hover'}`}
 >
 {t('login.twoFactor.tabEmail')}
 </button>
 </div>
 )}

 {mfaTab === 'email' && (
 <p className="text-xs text-text-muted">{t('login.twoFactor.emailSent')}</p>
 )}

 <Input
 label={mfaTab === 'totp' ? t('login.twoFactor.totpLabel') : t('login.twoFactor.emailLabel')}
 type="text"
 inputMode="numeric"
 autoComplete="one-time-code"
 enterKeyHint="go"
 value={mfaCode}
 onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
 placeholder={t('login.twoFactor.codePlaceholder')}
 autoFocus
 required
 />

 {error && (
 <div className="rounded-md bg-status-down-bg border border-status-down/30 p-3">
 <p className="text-sm text-status-down">{error}</p>
 </div>
 )}

 <div className="flex flex-col gap-2">
 <Button type="submit" className="w-full" loading={mfaLoading}>{t('login.twoFactor.verify')}</Button>
 {mfaTab === 'email' && (
 <button type="button" onClick={handleResendEmail} className="text-xs text-text-muted hover:text-text-primary text-center coarse:min-h-10">
 {t('login.twoFactor.resend')}
 </button>
 )}
 <button type="button" onClick={() => { setStep('credentials'); setError(''); }} className="text-xs text-text-muted hover:text-text-primary text-center coarse:min-h-10">
 {t('login.twoFactor.backToLogin')}
 </button>
 </div>
 </form>
 )}
 </div>

 <p className="fixed bottom-3 left-0 right-0 text-center text-xs text-text-secondary/50 select-none max-lg:static max-lg:mt-8 coarse:static coarse:mt-8">
 {t('login.clientVersion', { version: __APP_VERSION__ })}
 {serverVersion && ` · ${t('login.serverVersion', { version: serverVersion })}`}
 </p>
 </div>
 );
}
