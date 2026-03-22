import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';

// Must match REQUIRED_ENROLLMENT_VERSION in server/src/controllers/enrollment.controller.ts
const REQUIRED_ENROLLMENT_VERSION = 1;

interface ProtectedRouteProps {
  requiredRole?: string;
}

export function ProtectedRoute({ requiredRole }: ProtectedRouteProps) {
  const { user, isInitialized } = useAuthStore();
  const location = useLocation();

  if (!isInitialized) {
    return (
      <div className="flex h-screen items-center justify-center bg-bg-primary">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Redirect to enrollment if user hasn't completed the required enrollment version.
  // Skip the check when already on /enroll to prevent a redirect loop.
  // Skip for Obligate SSO users — onboarding is managed by Gate.
  if (
    user.foreignSource !== 'obligate' &&
    (user.enrollmentVersion ?? 0) < REQUIRED_ENROLLMENT_VERSION &&
    location.pathname !== '/enroll'
  ) {
    return <Navigate to="/enroll" replace />;
  }

  if (requiredRole && user.role !== requiredRole) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
