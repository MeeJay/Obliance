import { useSearchParams } from 'react-router-dom';
import { DevicesPageLayout } from '@/components/devices/DevicesPageLayout';

export function DeviceListPage() {
  const [searchParams] = useSearchParams();
  const statusFilter = searchParams.get('status') || undefined;

  return <DevicesPageLayout mode="monitoring" initialStatusFilter={statusFilter} />;
}
