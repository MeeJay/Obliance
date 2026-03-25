import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { DeviceTable } from '@/components/devices/DeviceTable';

export function DeviceListPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const statusFilter = searchParams.get('status') || undefined;

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold text-text-primary">{t('nav.devices')}</h1>
      <DeviceTable mode="monitoring" initialStatusFilter={statusFilter} />
    </div>
  );
}
