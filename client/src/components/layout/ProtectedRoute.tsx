import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';

// Must match REQUIRED_ENROLLMENT_VERSION in server/src/controllers/enrollment.controller.ts
const REQUIRED_ENROLLMENT_VERSION = 1;

interface ProtectedRouteProps {
  /** Hard role gate — only users with this exact platform role pass. */
  requiredRole?: string;
  /** Capability gate — passes if user is platform admin OR carries ANY
   *  of the listed tenant-wide capabilities. Used for pages that
   *  shouldn't be admin-only when the operator has granted the
   *  feature explicitly via permission_sets (e.g. Supervision,
   *  Agent config tabs). When both `requiredRole` and
   *  `requiredCapabilities` are passed, the role check wins. */
  requiredCapabilities?: string[];
}

export function ProtectedRoute({ requiredRole, requiredCapabilities }: ProtectedRouteProps) {
  const { user, isInitialized, permissions } = useAuthStore();
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

  // Capability gate — admin always passes. Otherwise the user must
  // carry at least one of the listed caps in `tenantCapabilities`
  // (resolved server-side from the permission_set tied to their
  // user_tenants.role for the active tenant).
  if (requiredCapabilities && requiredCapabilities.length > 0) {
    const isAdmin = user.role === 'admin';
    if (!isAdmin) {
      const caps = new Set(permissions?.tenantCapabilities ?? []);
      const ok = requiredCapabilities.some((c) => caps.has(c));
      if (!ok) return <Navigate to="/" replace />;
    }
  }

  return <Outlet />;
}
