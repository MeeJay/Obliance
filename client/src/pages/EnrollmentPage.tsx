import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Check, ChevronRight } from 'lucide-react';
import apiClient from '@/api/client';
import { twoFactorApi, type TotpSetupData } from '@/api/twoFactor.api';
import { useAuthStore } from '@/store/authStore';
import { SUPPORTED_LANGUAGES, setLanguage } from '@/i18n';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';

type Step = 'language' | 'profile' | 'alerts' | 'security';
const STEPS: Step[] = ['language', 'profile', 'alerts', 'security'];

interface EnrollData {
  preferredLanguage: string;
  displayName: string;
  email: string;
  toastEnabled: boolean;
  toastPosition: 'bottom-right' | 'top-center';
}

// ── Language flags (emoji) ──────────────────────────────────────────────────
const LANG_FLAGS: Record<string, string> = {
  en: '🇬🇧', fr: '🇫🇷', es: '🇪🇸', de: '🇩🇪', 'pt-BR': '🇧🇷',
  'zh-CN': '🇨🇳', ja: '🇯🇵', ko: '🇰🇷', ru: '🇷🇺', ar: '🇸🇦',
  it: '🇮🇹', nl: '🇳🇱', pl: '🇵🇱', tr: '🇹🇷', sv: '🇸🇪',
  da: '🇩🇰', cs: '🇨🇿', uk: '🇺🇦',
};

// ── Stepper ─────────────────────────────────────────────────────────────────
function Stepper({ currentStep }: { currentStep: Step }) {
  const { t } = useTranslation();
  const labels: Record<Step, string> = {
    language: t('enrollment.stepLanguage'),
    profile:  t('enrollment.stepProfile'),
    alerts:   t('enrollment.stepAlerts'),
    security: t('enrollment.stepSecurity'),
  };
  const currentIdx = STEPS.indexOf(currentStep);

  return (
    <div className="flex items-center justify-center gap-0 mb-8">
      {STEPS.map((step, idx) => (
        <div key={step} className="flex items-center">
          <div className="flex flex-col items-center gap-1">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold border-2 transition-colors ${
                idx < currentIdx
                  ? 'bg-primary border-primary text-white'
                  : idx === currentIdx
                  ? 'border-primary text-primary bg-transparent'
                  : 'border-border text-text-muted bg-transparent'
              }`}
            >
              {idx < currentIdx ? <Check size={14} /> : idx + 1}
            </div>
            <span className={`text-xs hidden sm:block ${idx === currentIdx ? 'text-text-primary font-medium' : 'text-text-muted'}`}>
              {labels[step]}
            </span>
          </div>
          {idx < STEPS.length - 1 && (
            <div className={`w-12 sm:w-20 h-0.5 mx-1 mb-5 transition-colors ${idx < currentIdx ? 'bg-primary' : 'bg-border'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Step 1: Language ─────────────────────────────────────────────────────────
function LanguageStep({ selected, onSelect }: { selected: string; onSelect: (code: string) => void }) {
  const { t } = useTranslation();
  return (
    <div>
      <h2 className="text-xl font-semibold text-text-primary mb-1">{t('enrollment.language.title')}</h2>
      <p className="text-sm text-text-muted mb-5">{t('enrollment.language.subtitle')}</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-72 overflow-y-auto pr-1">
        {SUPPORTED_LANGUAGES.map((lang) => (
          <button
            key={lang.code}
            type="button"
            onClick={() => { onSelect(lang.code); setLanguage(lang.code); }}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left transition-colors text-sm ${
              selected === lang.code
                ? 'border-primary bg-primary/10 text-text-primary'
                : 'border-border hover:border-primary/50 hover:bg-bg-hover text-text-secondary'
            }`}
          >
            <span className="text-xl leading-none">{LANG_FLAGS[lang.code] ?? '🌐'}</span>
            <div className="min-w-0">
              <div className="font-medium truncate">{lang.nativeName}</div>
              {lang.nativeName !== lang.name && (
                <div className="text-xs text-text-muted truncate">{lang.name}</div>
              )}
            </div>
            {selected === lang.code && <Check size={14} className="ml-auto shrink-0 text-primary" />}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Step 2: Profile ──────────────────────────────────────────────────────────
function ProfileStep({
  displayName, email, emailError,
  onDisplayName, onEmail,
}: {
  displayName: string; email: string; emailError: string;
  onDisplayName: (v: string) => void; onEmail: (v: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div>
      <h2 className="text-xl font-semibold text-text-primary mb-1">{t('enrollment.profile.title')}</h2>
      <p className="text-sm text-text-muted mb-5">{t('enrollment.profile.subtitle')}</p>
      <div className="space-y-4">
        <Input
          label={t('enrollment.profile.displayName')}
          type="text"
          value={displayName}
          onChange={(e) => onDisplayName(e.target.value)}
          placeholder={t('enrollment.profile.displayNamePlaceholder')}
          autoFocus
        />
        <div>
          <Input
            label={`${t('enrollment.profile.emailLabel')} *`}
            type="email"
            value={email}
            onChange={(e) => onEmail(e.target.value)}
            placeholder={t('enrollment.profile.emailPlaceholder')}
            required
          />
          {emailError ? (
            <p className="mt-1 text-xs text-status-down">{emailError}</p>
          ) : (
            <p className="mt-1 text-xs text-text-muted">{t('enrollment.profile.emailHint')}</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Alert position preview SVG ───────────────────────────────────────────────
function AlertPreviewSvg({ position }: { position: 'bottom-right' | 'top-center' }) {
  return (
    <svg viewBox="0 0 200 120" className="w-full max-w-xs mx-auto rounded-lg border border-border bg-bg-primary">
      {/* Screen body */}
      <rect x="4" y="4" width="192" height="112" rx="6" fill="currentColor" className="text-bg-secondary" stroke="currentColor" strokeWidth="1" />
      {/* Top bar */}
      <rect x="4" y="4" width="192" height="16" rx="6" fill="currentColor" className="text-bg-hover" />
      <rect x="8" y="8" width="40" height="8" rx="3" fill="currentColor" className="text-border" />
      <rect x="160" y="8" width="30" height="8" rx="3" fill="currentColor" className="text-border" />
      {/* Content lines */}
      {[28, 38, 48, 58].map((y) => (
        <rect key={y} x="12" y={y} width={30 + (y % 20) * 2} height="5" rx="2" fill="currentColor" className="text-border opacity-50" />
      ))}
      {/* Alert pill */}
      {position === 'bottom-right' ? (
        <>
          <rect x="110" y="82" width="80" height="22" rx="4" fill="currentColor" className="text-primary" opacity="0.9" />
          <rect x="115" y="87" width="50" height="4" rx="2" fill="white" opacity="0.9" />
          <rect x="115" y="94" width="35" height="3" rx="2" fill="white" opacity="0.6" />
        </>
      ) : (
        <>
          <rect x="60" y="24" width="80" height="22" rx="4" fill="currentColor" className="text-primary" opacity="0.9" />
          <rect x="65" y="29" width="50" height="4" rx="2" fill="white" opacity="0.9" />
          <rect x="65" y="36" width="35" height="3" rx="2" fill="white" opacity="0.6" />
        </>
      )}
    </svg>
  );
}

// ── Step 3: Alerts ───────────────────────────────────────────────────────────
function AlertsStep({
  enabled, position,
  onEnabled, onPosition,
}: {
  enabled: boolean; position: 'bottom-right' | 'top-center';
  onEnabled: (v: boolean) => void; onPosition: (v: 'bottom-right' | 'top-center') => void;
}) {
  const { t } = useTranslation();
  return (
    <div>
      <h2 className="text-xl font-semibold text-text-primary mb-1">{t('enrollment.alerts.title')}</h2>
      <p className="text-sm text-text-muted mb-5">{t('enrollment.alerts.subtitle')}</p>

      <label className="flex items-start gap-3 cursor-pointer mb-5">
        <div className="relative mt-0.5">
          <input
            type="checkbox"
            className="sr-only peer"
            checked={enabled}
            onChange={(e) => onEnabled(e.target.checked)}
          />
          <div className="w-9 h-5 rounded-full border-2 border-border peer-checked:border-primary peer-checked:bg-primary bg-bg-hover transition-colors" />
          <div className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform peer-checked:translate-x-4" />
        </div>
        <div>
          <div className="text-sm font-medium text-text-primary">{t('enrollment.alerts.enableLabel')}</div>
          <div className="text-xs text-text-muted">{t('enrollment.alerts.enableDesc')}</div>
        </div>
      </label>

      {enabled && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-text-primary">{t('enrollment.alerts.positionLabel')}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {(['bottom-right', 'top-center'] as const).map((pos) => (
              <button
                key={pos}
                type="button"
                onClick={() => onPosition(pos)}
                className={`rounded-lg border p-3 text-left transition-colors ${
                  position === pos ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50 hover:bg-bg-hover'
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <div className={`h-4 w-4 rounded-full border-2 flex items-center justify-center ${position === pos ? 'border-primary' : 'border-border'}`}>
                    {position === pos && <div className="h-2 w-2 rounded-full bg-primary" />}
                  </div>
                  <span className="text-sm font-medium text-text-primary">
                    {pos === 'bottom-right' ? t('enrollment.alerts.bottomRight') : t('enrollment.alerts.topCenter')}
                  </span>
                </div>
                <p className="text-xs text-text-muted mb-3">
                  {pos === 'bottom-right' ? t('enrollment.alerts.bottomRightDesc') : t('enrollment.alerts.topCenterDesc')}
                </p>
                <AlertPreviewSvg position={pos} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Step 4: Security (TOTP) ──────────────────────────────────────────────────
function SecurityStep({
  totpAlreadyEnabled, totpSetup, totpCode, totpLoading,
  onSetupTotp, onTotpCode, onSkip,
}: {
  totpAlreadyEnabled: boolean;
  totpSetup: TotpSetupData | null;
  totpCode: string;
  totpLoading: boolean;
  onSetupTotp: () => void;
  onTotpCode: (v: string) => void;
  onSkip: () => void;
}) {
  const { t } = useTranslation();

  if (totpAlreadyEnabled) {
    return (
      <div>
        <h2 className="text-xl font-semibold text-text-primary mb-1">{t('enrollment.security.title')}</h2>
        <p className="text-sm text-text-muted mb-5">{t('enrollment.security.subtitle')}</p>
        <div className="flex items-center gap-2 rounded-lg border border-status-up/30 bg-status-up-bg p-4 text-sm text-status-up">
          <Check size={16} /> {t('enrollment.security.totpAlreadyEnabled')}
        </div>
        <p className="mt-3 text-xs text-text-muted">{t('enrollment.security.emailOtpAvailable')}</p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-xl font-semibold text-text-primary mb-1">{t('enrollment.security.title')}</h2>
      <p className="text-sm text-text-muted mb-5">{t('enrollment.security.subtitle')}</p>

      {!totpSetup ? (
        <div className="space-y-3">
          <button
            type="button"
            onClick={onSetupTotp}
            disabled={totpLoading}
            className="w-full flex items-center justify-between rounded-lg border border-border hover:border-primary/50 hover:bg-bg-hover p-4 text-left transition-colors group"
          >
            <div>
              <div className="text-sm font-medium text-text-primary">{t('enrollment.security.setupTotp')}</div>
              <div className="text-xs text-text-muted">{t('enrollment.security.setupTotpDesc')}</div>
            </div>
            <ChevronRight size={16} className="text-text-muted group-hover:text-primary transition-colors" />
          </button>
          <button
            type="button"
            onClick={onSkip}
            className="w-full text-center text-sm text-text-muted hover:text-text-primary py-2 transition-colors"
          >
            {t('enrollment.security.skipForNow')}
          </button>
          <p className="text-xs text-text-muted text-center">{t('enrollment.security.setupLater')}</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex justify-center">
            <img src={totpSetup.qrDataUrl} alt="TOTP QR code" className="w-44 h-44 rounded border border-border" />
          </div>
          <p className="text-xs text-text-muted text-center">{t('profile.security.totpScanDesc')}</p>
          <p className="text-xs text-text-muted text-center font-mono">{t('profile.security.totpSecret', { secret: totpSetup.secret })}</p>
          <Input
            label={t('enrollment.security.verificationCode')}
            type="text"
            inputMode="numeric"
            value={totpCode}
            onChange={(e) => onTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder={t('enrollment.security.verificationCodePlaceholder')}
            autoFocus
          />
        </div>
      )}
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────
export function EnrollmentPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { checkSession, user } = useAuthStore();

  const [step, setStep] = useState<Step>('language');
  const [data, setData] = useState<EnrollData>({
    preferredLanguage: user?.preferredLanguage ?? 'en',
    displayName: user?.displayName ?? '',
    email: user?.email ?? '',
    toastEnabled: true,
    toastPosition: 'bottom-right',
  });

  const [emailError, setEmailError] = useState('');
  const [totpAlreadyEnabled, setTotpAlreadyEnabled] = useState(false);
  const [totpSetup, setTotpSetup] = useState<TotpSetupData | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [totpLoading, setTotpLoading] = useState(false);
  const [totpSkipped, setTotpSkipped] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [error, setError] = useState('');

  const currentIdx = STEPS.indexOf(step);

  // Check TOTP status when entering security step
  const handleAdvanceToSecurity = async () => {
    try {
      const status = await twoFactorApi.getStatus();
      setTotpAlreadyEnabled(status.totpEnabled);
    } catch {
      // ignore — show setup option
    }
    setStep('security');
  };

  const handleSetupTotp = async () => {
    setTotpLoading(true);
    try {
      const setup = await twoFactorApi.totpSetup();
      setTotpSetup(setup);
    } catch {
      // ignore
    } finally {
      setTotpLoading(false);
    }
  };

  const handleNext = async (e?: FormEvent) => {
    e?.preventDefault();
    setError('');

    if (step === 'language') {
      setStep('profile');
      return;
    }

    if (step === 'profile') {
      // Validate email
      if (!data.email) {
        setEmailError(t('enrollment.profile.emailRequired'));
        return;
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(data.email)) {
        setEmailError(t('enrollment.profile.emailInvalid'));
        return;
      }
      setEmailError('');
      setStep('alerts');
      return;
    }

    if (step === 'alerts') {
      await handleAdvanceToSecurity();
      return;
    }

    // step === 'security' — complete enrollment
    await completeEnrollment();
  };

  const completeEnrollment = async () => {
    setCompleting(true);
    setError('');
    try {
      // If TOTP code was entered, enable TOTP first
      if (totpSetup && totpCode.length === 6) {
        await twoFactorApi.totpEnable(totpCode);
      }

      await apiClient.post('/auth/enrollment', {
        displayName: data.displayName || null,
        email: data.email,
        preferredLanguage: data.preferredLanguage,
        toastEnabled: data.toastEnabled,
        toastPosition: data.toastPosition,
      });

      await checkSession();
      navigate('/', { replace: true });
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      const msg = axiosErr?.response?.data?.error ?? '';
      if (msg.toLowerCase().includes('email')) {
        setEmailError(t('enrollment.profile.emailInUse'));
        setStep('profile');
      } else {
        setError(t('enrollment.errors.failed'));
      }
    } finally {
      setCompleting(false);
    }
  };

  const handleBack = () => {
    const idx = STEPS.indexOf(step);
    if (idx > 0) setStep(STEPS[idx - 1]);
  };

  const isNextDisabled = step === 'security' && totpSetup && !totpSkipped && totpCode.length !== 6;
  const nextLabel = step === 'security' ? t('enrollment.complete') : t('common.next');

  return (
    <div className="min-h-screen bg-bg-primary flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-xl">
        {/* Header */}
        <div className="text-center mb-8">
          <img src="/logo.webp" alt="Obliance" className="mx-auto h-14 w-14 mb-3" />
          <h1 className="text-2xl font-bold text-text-primary">{t('enrollment.welcomeTitle', { appName: 'Obliance' })}</h1>
          <p className="text-sm text-text-muted mt-1">{t('enrollment.welcomeSubtitle')}</p>
        </div>

        {/* Stepper */}
        <Stepper currentStep={step} />

        {/* Card */}
        <form onSubmit={handleNext} className="rounded-xl border border-border bg-bg-secondary p-6 shadow-sm">
          {step === 'language' && (
            <LanguageStep
              selected={data.preferredLanguage}
              onSelect={(code) => setData((d) => ({ ...d, preferredLanguage: code }))}
            />
          )}
          {step === 'profile' && (
            <ProfileStep
              displayName={data.displayName}
              email={data.email}
              emailError={emailError}
              onDisplayName={(v) => setData((d) => ({ ...d, displayName: v }))}
              onEmail={(v) => setData((d) => ({ ...d, email: v }))}
            />
          )}
          {step === 'alerts' && (
            <AlertsStep
              enabled={data.toastEnabled}
              position={data.toastPosition}
              onEnabled={(v) => setData((d) => ({ ...d, toastEnabled: v }))}
              onPosition={(v) => setData((d) => ({ ...d, toastPosition: v }))}
            />
          )}
          {step === 'security' && (
            <SecurityStep
              totpAlreadyEnabled={totpAlreadyEnabled}
              totpSetup={totpSetup}
              totpCode={totpCode}
              totpLoading={totpLoading}
              onSetupTotp={handleSetupTotp}
              onTotpCode={setTotpCode}
              onSkip={() => { setTotpSkipped(true); completeEnrollment(); }}
            />
          )}

          {error && (
            <div className="mt-4 rounded-md bg-status-down-bg border border-status-down/30 p-3">
              <p className="text-sm text-status-down">{error}</p>
            </div>
          )}

          {/* Navigation buttons */}
          {!(step === 'security' && !totpAlreadyEnabled && !totpSetup) && (
            <div className="flex items-center justify-between mt-6 pt-4 border-t border-border">
              <button
                type="button"
                onClick={handleBack}
                className={`text-sm text-text-muted hover:text-text-primary transition-colors ${currentIdx === 0 ? 'invisible' : ''}`}
              >
                ← {t('common.back')}
              </button>
              <Button
                type="submit"
                loading={completing}
                disabled={!!isNextDisabled}
              >
                {nextLabel}
              </Button>
            </div>
          )}
        </form>

        {/* Step indicator */}
        <p className="text-center text-xs text-text-muted mt-4">
          {t('enrollment.step', { current: currentIdx + 1, total: STEPS.length })}
        </p>
      </div>
    </div>
  );
}
