import { useState, useEffect, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { User, Save, KeyRound, Bell, CheckCircle2, AlertTriangle, QrCode, Mail } from 'lucide-react';
import { profileApi } from '@/api/profile.api';
import { appConfigApi } from '@/api/appConfig.api';
import { twoFactorApi, type TwoFactorStatus } from '@/api/twoFactor.api';
import { useAuthStore } from '@/store/authStore';
import { useLiveAlertsStore } from '@/store/liveAlertsStore';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { SUPPORTED_LANGUAGES, setLanguage } from '@/i18n';
import toast from 'react-hot-toast';

export function ProfilePage() {
  const { t } = useTranslation();
  const { user: sessionUser, requires2faSetup } = useAuthStore();
  const { localEnabled: alertEnabled, position: alertPosition, setEnabled, setPosition } = useLiveAlertsStore();

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [preferredLanguage, setPreferredLanguage] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  const [savingPrefs, setSavingPrefs] = useState(false);

  // 2FA state
  const [allow2fa, setAllow2fa] = useState(false);
  const [tfaStatus, setTfaStatus] = useState<TwoFactorStatus | null>(null);

  // TOTP setup flow
  const [totpSetupData, setTotpSetupData] = useState<{ secret: string; qrDataUrl: string } | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [totpSaving, setTotpSaving] = useState(false);

  // Email OTP setup flow
  const [emailSetupStep, setEmailSetupStep] = useState<'idle' | 'entering' | 'sent'>('idle');
  const [emailInput, setEmailInput] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [emailSaving, setEmailSaving] = useState(false);

  useEffect(() => {
    profileApi.get().then((profile) => {
      setDisplayName(profile.displayName || '');
      setEmail((profile as any).email || '');
      setPreferredLanguage((profile as any).preferredLanguage || '');
    });
    appConfigApi.getConfig().then((cfg) => {
      setAllow2fa(cfg.allow_2fa === 'true');
    }).catch(() => {});
    twoFactorApi.getStatus().then(setTfaStatus).catch(() => {});
  }, []);

  const handleProfileSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      await profileApi.update({ displayName: displayName || null, email: email || null, preferredLanguage: preferredLanguage || undefined });
      toast.success(t('profile.profileUpdated'));
    } catch {
      toast.error(t('profile.failedProfile'));
    } finally {
      setSavingProfile(false);
    }
  };

  const handlePasswordSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (newPassword !== confirmPassword) {
      toast.error(t('profile.password.mismatch'));
      return;
    }

    if (newPassword.length < 6) {
      toast.error(t('profile.password.tooShort'));
      return;
    }

    setSavingPassword(true);
    try {
      await profileApi.changePassword(currentPassword, newPassword);
      toast.success(t('profile.password.changed'));
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      const msg = err?.response?.data?.error || t('profile.password.failed');
      toast.error(msg);
    } finally {
      setSavingPassword(false);
    }
  };

  const handleSavePreferences = async () => {
    setSavingPrefs(true);
    try {
      await profileApi.update({
        preferences: {
          toastEnabled: alertEnabled,
          toastPosition: alertPosition,
        },
      });
      toast.success(t('profile.alerts.preferencesSaved'));
    } catch {
      toast.error(t('profile.alerts.failedPreferences'));
    } finally {
      setSavingPrefs(false);
    }
  };

  const handleLanguageChange = async (code: string) => {
    setPreferredLanguage(code);
    setLanguage(code);
    try {
      await profileApi.update({ preferredLanguage: code });
    } catch {
      // non-critical, ignore
    }
  };

  return (
    <div className="p-6 max-w-2xl min-w-0 mx-auto">
      <h1 className="text-2xl font-semibold text-text-primary mb-6">{t('profile.title')}</h1>

      {/* Profile section */}
      <form onSubmit={handleProfileSubmit} className="mb-8">
        <div className="rounded-lg border border-border bg-bg-secondary p-5 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <User size={18} className="text-accent" />
            <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide">
              {t('profile.sectionProfile')}
            </h2>
          </div>

          <div className="space-y-1">
            <label className="block text-sm font-medium text-text-secondary">{t('profile.usernameLabel')}</label>
            <p className="text-sm text-text-primary font-mono bg-bg-tertiary rounded-md px-3 py-2">
              {sessionUser?.username}
            </p>
          </div>

          <Input
            label={t('profile.displayNameLabel')}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={t('profile.displayNamePlaceholder')}
          />

          <div>
            <Input
              label={t('profile.emailLabel')}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('profile.emailPlaceholder')}
            />
            <p className="mt-1 text-xs text-text-muted">{t('profile.emailHint')}</p>
          </div>

          <div className="space-y-1">
            <label className="block text-sm font-medium text-text-secondary">{t('profile.preferredLanguage')}</label>
            <select
              value={preferredLanguage}
              onChange={(e) => handleLanguageChange(e.target.value)}
              className="w-full rounded-md border border-border bg-bg-tertiary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
            >
              {SUPPORTED_LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.nativeName} ({lang.name})
                </option>
              ))}
            </select>
          </div>

          <Button type="submit" loading={savingProfile}>
            <Save size={16} className="mr-1.5" />
            {t('profile.saveProfile')}
          </Button>
        </div>
      </form>

      {/* Password section */}
      <form onSubmit={handlePasswordSubmit} className="mb-8">
        <div className="rounded-lg border border-border bg-bg-secondary p-5 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <KeyRound size={18} className="text-accent" />
            <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide">
              {t('profile.password.title')}
            </h2>
          </div>

          <Input
            label={t('profile.password.current')}
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder={t('profile.password.currentPlaceholder')}
            required
          />

          <Input
            label={t('profile.password.new')}
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder={t('profile.password.newPlaceholder')}
            required
          />

          <Input
            label={t('profile.password.confirm')}
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder={t('profile.password.confirmPlaceholder')}
            required
          />

          <Button type="submit" loading={savingPassword}>
            <KeyRound size={16} className="mr-1.5" />
            {t('profile.password.change')}
          </Button>
        </div>
      </form>

      {/* Live Alert Notifications section */}
      <div className="mb-8">
        <div className="rounded-lg border border-border bg-bg-secondary p-5 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <Bell size={18} className="text-accent" />
            <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide">
              {t('profile.alerts.title')}
            </h2>
          </div>

          {/* Enabled toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-text-primary">{t('profile.alerts.enableLabel')}</p>
              <p className="text-xs text-text-muted mt-0.5">
                {t('profile.alerts.enableDesc')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setEnabled(!alertEnabled)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                alertEnabled ? 'bg-accent' : 'bg-bg-tertiary'
              }`}
              aria-pressed={alertEnabled}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  alertEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Position selector */}
          <div>
            <p className="text-sm font-medium text-text-primary mb-2">{t('profile.alerts.positionLabel')}</p>
            <div className="flex flex-col gap-3">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="alertPosition"
                  value="bottom-right"
                  checked={alertPosition === 'bottom-right'}
                  onChange={() => setPosition('bottom-right')}
                  className="accent-accent mt-0.5"
                />
                <div>
                  <span className="text-sm text-text-primary">{t('profile.alerts.bottomRight')}</span>
                  <p className="text-xs text-text-muted">
                    {t('profile.alerts.bottomRightDesc')}
                  </p>
                </div>
              </label>
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="alertPosition"
                  value="top-center"
                  checked={alertPosition === 'top-center'}
                  onChange={() => setPosition('top-center')}
                  className="accent-accent mt-0.5"
                />
                <div>
                  <span className="text-sm text-text-primary">{t('profile.alerts.topCenter')}</span>
                  <p className="text-xs text-text-muted">
                    {t('profile.alerts.topCenterDesc')}
                  </p>
                </div>
              </label>
            </div>
          </div>

          <Button type="button" onClick={handleSavePreferences} loading={savingPrefs}>
            <Save size={16} className="mr-1.5" />
            {t('profile.alerts.savePreferences')}
          </Button>
        </div>
      </div>

      {/* Security / 2FA section */}
      {(allow2fa || requires2faSetup) && (
        <div>
          <h2 className="text-lg font-semibold text-text-primary mb-4">{t('profile.security.title')}</h2>

          {requires2faSetup && (
            <div className="mb-4 flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
              <AlertTriangle size={16} className="text-amber-400 mt-0.5 shrink-0" />
              <p className="text-sm text-amber-300">
                {t('profile.security.force2faWarning')}
              </p>
            </div>
          )}

          <div className="rounded-lg border border-border bg-bg-secondary divide-y divide-border">
            {/* TOTP */}
            <div className="p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <QrCode size={16} className="text-text-muted" />
                  <p className="text-sm font-medium text-text-primary">{t('profile.security.totp')}</p>
                  {tfaStatus?.totpEnabled && <CheckCircle2 size={14} className="text-green-400" />}
                </div>
                {tfaStatus?.totpEnabled ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      try {
                        await twoFactorApi.totpDisable();
                        setTfaStatus((s) => s ? { ...s, totpEnabled: false } : s);
                        toast.success(t('profile.security.totpDisabled'));
                      } catch { toast.error(t('profile.security.failedDisableTotp')); }
                    }}
                  >
                    {t('common.disable')}
                  </Button>
                ) : !totpSetupData ? (
                  <Button
                    size="sm"
                    onClick={async () => {
                      try {
                        const data = await twoFactorApi.totpSetup();
                        setTotpSetupData(data);
                        setTotpCode('');
                      } catch { toast.error(t('profile.security.failedStartTotp')); }
                    }}
                  >
                    {t('common.enable')}
                  </Button>
                ) : null}
              </div>

              {!tfaStatus?.totpEnabled && totpSetupData && (
                <div className="space-y-3">
                  <p className="text-xs text-text-muted">{t('profile.security.totpScanDesc')}</p>
                  <img src={totpSetupData.qrDataUrl} alt="TOTP QR Code" className="w-40 h-40 rounded-lg border border-border" />
                  <p className="text-xs text-text-muted font-mono break-all">{t('profile.security.totpSecret', { secret: totpSetupData.secret })}</p>
                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <Input
                        label={t('profile.security.verificationCode')}
                        type="text"
                        inputMode="numeric"
                        value={totpCode}
                        onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="000000"
                      />
                    </div>
                    <Button
                      disabled={totpCode.length !== 6 || totpSaving}
                      loading={totpSaving}
                      onClick={async () => {
                        setTotpSaving(true);
                        try {
                          await twoFactorApi.totpEnable(totpCode);
                          setTfaStatus((s) => s ? { ...s, totpEnabled: true } : s);
                          setTotpSetupData(null);
                          setTotpCode('');
                          toast.success(t('profile.security.totpEnabled'));
                        } catch { toast.error(t('profile.security.invalidCode')); }
                        finally { setTotpSaving(false); }
                      }}
                    >
                      {t('common.confirm')}
                    </Button>
                    <Button variant="ghost" onClick={() => { setTotpSetupData(null); setTotpCode(''); }}>{t('common.cancel')}</Button>
                  </div>
                </div>
              )}
            </div>

            {/* Email OTP */}
            <div className="p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Mail size={16} className="text-text-muted" />
                  <p className="text-sm font-medium text-text-primary">{t('profile.security.emailOtp')}</p>
                  {tfaStatus?.emailOtpEnabled && (
                    <>
                      <CheckCircle2 size={14} className="text-green-400" />
                      <span className="text-xs text-text-muted">{tfaStatus.email}</span>
                    </>
                  )}
                </div>
                {tfaStatus?.emailOtpEnabled ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      try {
                        await twoFactorApi.emailDisable();
                        setTfaStatus((s) => s ? { ...s, emailOtpEnabled: false, email: null } : s);
                        toast.success(t('profile.security.emailOtpDisabled'));
                      } catch { toast.error(t('profile.security.failedDisableEmailOtp')); }
                    }}
                  >
                    {t('common.disable')}
                  </Button>
                ) : emailSetupStep === 'idle' ? (
                  <Button size="sm" onClick={() => setEmailSetupStep('entering')}>{t('common.enable')}</Button>
                ) : null}
              </div>

              {!tfaStatus?.emailOtpEnabled && emailSetupStep === 'entering' && (
                <div className="space-y-3">
                  <Input
                    label={t('profile.security.yourEmail')}
                    type="email"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    placeholder={t('profile.security.emailPlaceholder')}
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <Button
                      disabled={!emailInput || emailSaving}
                      loading={emailSaving}
                      onClick={async () => {
                        setEmailSaving(true);
                        try {
                          await twoFactorApi.emailSetup(emailInput);
                          setEmailSetupStep('sent');
                          toast.success(t('profile.security.codeSent'));
                        } catch { toast.error(t('profile.security.failedSendCode')); }
                        finally { setEmailSaving(false); }
                      }}
                    >
                      {t('profile.security.sendCode')}
                    </Button>
                    <Button variant="ghost" onClick={() => { setEmailSetupStep('idle'); setEmailInput(''); setEmailCode(''); }}>{t('common.cancel')}</Button>
                  </div>
                </div>
              )}

              {!tfaStatus?.emailOtpEnabled && emailSetupStep === 'sent' && (
                <div className="space-y-3">
                  <p className="text-xs text-text-muted">{t('profile.security.enterCode', { email: emailInput })}</p>
                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <Input
                        label={t('profile.security.verificationCode')}
                        type="text"
                        inputMode="numeric"
                        value={emailCode}
                        onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="000000"
                        autoFocus
                      />
                    </div>
                    <Button
                      disabled={emailCode.length !== 6 || emailSaving}
                      loading={emailSaving}
                      onClick={async () => {
                        setEmailSaving(true);
                        try {
                          await twoFactorApi.emailEnable(emailCode);
                          const status = await twoFactorApi.getStatus();
                          setTfaStatus(status);
                          setEmailSetupStep('idle');
                          setEmailInput('');
                          setEmailCode('');
                          toast.success(t('profile.security.emailOtpEnabled'));
                        } catch { toast.error(t('profile.security.invalidCode')); }
                        finally { setEmailSaving(false); }
                      }}
                    >
                      {t('common.confirm')}
                    </Button>
                    <Button variant="ghost" onClick={() => { setEmailSetupStep('idle'); setEmailInput(''); setEmailCode(''); }}>{t('common.cancel')}</Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
