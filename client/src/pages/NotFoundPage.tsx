import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/common/Button';

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg-primary p-4">
      <h1 className="text-6xl font-bold text-text-muted">{t('notFound.title')}</h1>
      <p className="mt-4 text-lg text-text-secondary">{t('notFound.message')}</p>
      <Link to="/" className="mt-6">
        <Button variant="secondary">{t('notFound.goToDashboard')}</Button>
      </Link>
    </div>
  );
}
