import { useState, useEffect, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import apiClient from '@/api/client';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';

export function ResetPasswordPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [validating, setValidating] = useState(true);
  const [tokenValid, setTokenValid] = useState(false);

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) {
      setValidating(false);
      setTokenValid(false);
      return;
    }
    apiClient
      .post('/auth/reset-password/validate', { token })
      .then((res) => {
        setTokenValid(res.data?.data?.valid === true);
      })
      .catch(() => {
        setTokenValid(false);
      })
      .finally(() => setValidating(false));
  }, [token]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (newPassword !== confirmPassword) {
      setError(t('resetPassword.mismatch'));
      return;
    }
    if (newPassword.length < 6) {
      setError(t('resetPassword.tooShort'));
      return;
    }

    setSubmitting(true);
    try {
      await apiClient.post('/auth/reset-password', { token, newPassword });
      setDone(true);
    } catch {
      setError(t('resetPassword.failed'));
    } finally {
      setSubmitting(false);
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
          {validating ? (
            <div className="flex justify-center py-4">
              <LoadingSpinner size="md" />
            </div>
          ) : !tokenValid ? (
            <div className="text-center space-y-4">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-status-down-bg">
                <svg className="h-6 w-6 text-status-down" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <div>
                <h2 className="text-lg font-semibold text-text-primary">{t('resetPassword.title')}</h2>
                <p className="mt-1 text-sm text-status-down">{t('resetPassword.invalidToken')}</p>
              </div>
              <Link to="/forgot-password" className="block text-sm text-primary hover:underline">
                {t('forgotPassword.submit')}
              </Link>
              <Link to="/login" className="block text-sm text-text-muted hover:text-text-primary">
                {t('resetPassword.backToLogin')}
              </Link>
            </div>
          ) : done ? (
            <div className="text-center space-y-4">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-status-up-bg">
                <svg className="h-6 w-6 text-status-up" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              </div>
              <div>
                <h2 className="text-lg font-semibold text-text-primary">{t('resetPassword.successTitle')}</h2>
                <p className="mt-1 text-sm text-text-muted">{t('resetPassword.successMessage')}</p>
              </div>
              <Link to="/login" className="block text-sm text-primary hover:underline">
                {t('resetPassword.backToLogin')}
              </Link>
            </div>
          ) : (
            <>
              <div>
                <h2 className="text-lg font-semibold text-text-primary">{t('resetPassword.title')}</h2>
              </div>
              <form onSubmit={handleSubmit} className="space-y-4">
                <Input
                  label={t('resetPassword.newPassword')}
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder={t('resetPassword.newPasswordPlaceholder')}
                  autoFocus
                  required
                />
                <Input
                  label={t('resetPassword.confirmPassword')}
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder={t('resetPassword.confirmPasswordPlaceholder')}
                  required
                />
                {error && (
                  <div className="rounded-md bg-status-down-bg border border-status-down/30 p-3">
                    <p className="text-sm text-status-down">{error}</p>
                  </div>
                )}
                <Button type="submit" className="w-full" loading={submitting}>
                  {submitting ? t('resetPassword.submitting') : t('resetPassword.submit')}
                </Button>
              </form>
              <Link to="/login" className="block text-center text-sm text-text-muted hover:text-text-primary">
                {t('resetPassword.backToLogin')}
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
