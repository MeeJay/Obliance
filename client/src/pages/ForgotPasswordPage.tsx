import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import apiClient from '@/api/client';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';

export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setError(t('forgotPassword.invalidEmail'));
      return;
    }

    setSending(true);
    try {
      await apiClient.post('/auth/forgot-password', { email });
      setSent(true);
    } catch {
      // Always show success (no email enumeration)
      setSent(true);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-primary p-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <img src="/logo.webp" alt="Obliance" className="mx-auto h-16 w-16 mb-3" />
          <h1 className="text-3xl font-bold text-text-primary">Obliance</h1>
        </div>

        <div className="rounded-lg border border-border bg-bg-secondary p-6 space-y-5">
          {sent ? (
            <div className="text-center space-y-4">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-status-up-bg">
                <svg className="h-6 w-6 text-status-up" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              </div>
              <div>
                <h2 className="text-lg font-semibold text-text-primary">{t('forgotPassword.successTitle')}</h2>
                <p className="mt-1 text-sm text-text-muted">{t('forgotPassword.successMessage')}</p>
              </div>
              <Link to="/login" className="block text-sm text-primary hover:underline">
                {t('forgotPassword.backToLogin')}
              </Link>
            </div>
          ) : (
            <>
              <div>
                <h2 className="text-lg font-semibold text-text-primary">{t('forgotPassword.title')}</h2>
                <p className="mt-1 text-sm text-text-muted">{t('forgotPassword.description')}</p>
              </div>
              <form onSubmit={handleSubmit} className="space-y-4">
                <Input
                  label={t('forgotPassword.emailLabel')}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t('forgotPassword.emailPlaceholder')}
                  autoFocus
                  required
                />
                {error && (
                  <div className="rounded-md bg-status-down-bg border border-status-down/30 p-3">
                    <p className="text-sm text-status-down">{error}</p>
                  </div>
                )}
                <Button type="submit" className="w-full" loading={sending}>
                  {sending ? t('forgotPassword.sending') : t('forgotPassword.submit')}
                </Button>
              </form>
              <Link to="/login" className="block text-center text-sm text-text-muted hover:text-text-primary">
                {t('forgotPassword.backToLogin')}
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
