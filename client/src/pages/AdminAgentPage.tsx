import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Legacy page — replaced by AdminDevicesPage.
 * Redirect immediately to /admin/devices.
 */
export function AdminAgentPage() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate('/admin/devices', { replace: true });
  }, [navigate]);
  return null;
}
