import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

/**
 * Legacy page — replaced by DeviceDetailPage.
 * Redirect immediately to /devices/:id.
 */
export function AgentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  useEffect(() => {
    navigate(id ? `/devices/${id}` : '/devices', { replace: true });
  }, [navigate, id]);
  return null;
}
