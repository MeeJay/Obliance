import { useState, useEffect, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/store/authStore';
import { twoFactorApi } from '@/api/twoFactor.api';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';

type Step = 'credentials' | '2fa';

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { login, isLoading, checkSession } = useAuthStore();
  const [searchParams] = useSearchParams();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(searchParams.get('error') === 'sso_failed' ? 'SSO authentication failed. Please try local login.' : '');
  const [serverVersion, setServerVersion] = useState<string | null>(null);

  // If we arrived here with ?error=sso_failed, don't auto-redirect to Obligate again
  const ssoFailed = searchParams.get('error') === 'sso_failed';

  const [step, setStep] = useState<Step>('credentials');
  const [mfaMethods, setMfaMethods] = useState<{ totp: boolean; email: boolean }>({ totp: false, email: false });
  const [mfaTab, setMfaTab] = useState<'totp' | 'email'>('totp');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaLoading, setMfaLoading] = useState(false);

  // SSO state: 'checking' = initial check, 'redirecting' = going to Obligate,
  // 'unavailable' = Obligate down (show local login + warning), 'local' = no Obligate configured
  const [ssoState, setSsoState] = useState<'checking' | 'redirecting' | 'unavailable' | 'local'>(ssoFailed ? 'unavailable' : 'checking');

  const checkSso = () => {
    return fetch('/api/auth/sso-config')
      .then(r => r.json())
      .then((data: { success: boolean; data?: { obligateUrl: string | null; obligateReachable: boolean; obligateEnabled: boolean } }) => {
        if (data.success && data.data?.obligateEnabled && data.data.obligateUrl) {
          if (data.data.obligateReachable) {
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
      .catch(() => { setSsoState('local'); return 'local'; });
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
        // No session — check Obligate unless we just failed
        if (!ssoFailed) checkSso();
        else setSsoState('unavailable');
      })
      .catch(() => { if (!ssoFailed) checkSso(); });
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
      <div className="flex min-h-screen items-center justify-center bg-bg-primary">
        <div className="text-center">
          <img src="/logo.webp" alt="Obliance" className="mx-auto h-16 w-16 mb-3 animate-pulse" />
          <p className="text-sm text-text-secondary">
            {ssoState === 'redirecting' ? t('login.ssoRedirecting', 'Redirecting to login...') : t('login.ssoChecking', 'Checking authentication...')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-primary p-4">
      <div className="w-full max-w-sm space-y-8 relative">
        <div className="text-center">
          <img src="/logo.webp" alt="Obliance" className="mx-auto h-16 w-16 mb-3" />
          <h1 className="text-3xl font-bold text-text-primary">Obliance</h1>
          <p className="mt-2 text-sm text-text-secondary">{t('login.title')}</p>
        </div>

        {ssoState === 'unavailable' && (
          <div className="bg-status-pending-bg border border-status-pending/30 rounded-lg p-3 text-sm text-status-pending">
            {t('login.ssoUnavailable', 'Centralized login (Obligate) is unavailable. Using local authentication.')}
          </div>
        )}

        {step === 'credentials' ? (
          <form onSubmit={handleSubmit} className="space-y-6 rounded-lg border border-border bg-bg-secondary p-6">
            <Input
              label={t('login.username')}
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={t('login.usernamePlaceholder')}
              autoComplete="username"
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
              required
            />
            {error && (
              <div className="rounded-md bg-status-down-bg border border-status-down/30 p-3">
                <p className="text-sm text-status-down">{error}</p>
              </div>
            )}
            <Button type="submit" className="w-full" loading={isLoading}>
              {t('login.signIn')}
            </Button>
            <div className="text-center">
              <Link to="/forgot-password" className="text-xs text-text-muted hover:text-text-primary transition-colors">
                {t('login.forgotPassword')}
              </Link>
            </div>
          </form>
        ) : (
          <form onSubmit={handleMfaSubmit} className="space-y-5 rounded-lg border border-border bg-bg-secondary p-6">
            <div>
              <p className="text-sm font-medium text-text-primary mb-1">{t('login.twoFactor.title')}</p>
              <p className="text-xs text-text-muted">{t('login.twoFactor.description')}</p>
            </div>

            {mfaMethods.totp && mfaMethods.email && (
              <div className="flex rounded-md border border-border overflow-hidden text-sm">
                <button
                  type="button"
                  onClick={() => setMfaTab('totp')}
                  className={`flex-1 py-1.5 transition-colors ${mfaTab === 'totp' ? 'bg-primary text-white' : 'text-text-secondary hover:bg-bg-hover'}`}
                >
                  {t('login.twoFactor.tabTotp')}
                </button>
                <button
                  type="button"
                  onClick={() => setMfaTab('email')}
                  className={`flex-1 py-1.5 transition-colors ${mfaTab === 'email' ? 'bg-primary text-white' : 'text-text-secondary hover:bg-bg-hover'}`}
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
                <button type="button" onClick={handleResendEmail} className="text-xs text-text-muted hover:text-text-primary text-center">
                  {t('login.twoFactor.resend')}
                </button>
              )}
              <button type="button" onClick={() => { setStep('credentials'); setError(''); }} className="text-xs text-text-muted hover:text-text-primary text-center">
                {t('login.twoFactor.backToLogin')}
              </button>
            </div>
          </form>
        )}
      </div>

      <p className="fixed bottom-3 left-0 right-0 text-center text-xs text-text-secondary/50 select-none">
        {t('login.clientVersion', { version: __APP_VERSION__ })}
        {serverVersion && ` · ${t('login.serverVersion', { version: serverVersion })}`}
      </p>
    </div>
  );
}
