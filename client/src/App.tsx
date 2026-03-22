import { useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { useNativeTopOffset } from '@/hooks/useNativeTopOffset';
import { useAuthStore } from '@/store/authStore';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';
import { AppLayout } from '@/components/layout/AppLayout';
import { LoginPage } from '@/pages/LoginPage';
import { EnrollmentPage } from '@/pages/EnrollmentPage';
import { ForgotPasswordPage } from '@/pages/ForgotPasswordPage';
import { ResetPasswordPage } from '@/pages/ResetPasswordPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { DeviceListPage } from '@/pages/DeviceListPage';
import { DeviceDetailPage } from '@/pages/DeviceDetailPage';
import { SchedulesPage } from '@/pages/SchedulesPage';
import { PoliciesPage } from '@/pages/PoliciesPage';
import { SupervisionPage } from '@/pages/SupervisionPage';
import { GroupDetailPage } from '@/pages/GroupDetailPage';
import { GroupEditPage } from '@/pages/GroupEditPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { AdminUsersPage } from '@/pages/AdminUsersPage';
import { AdminDevicesPage } from '@/pages/AdminDevicesPage';
import { ProfilePage } from '@/pages/ProfilePage';
import { ImportExportPage } from '@/pages/ImportExportPage';
import { AdminTenantsPage } from '@/pages/AdminTenantsPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { ForeignAuthPage } from '@/pages/ForeignAuthPage';
import '@/i18n';

export default function App() {
  const { checkSession } = useAuthStore();
  const nativeTop = useNativeTopOffset();

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  return (
    <BrowserRouter>
      <Routes>
        {/* Public */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/auth/foreign" element={<ForeignAuthPage />} />

        {/* Protected */}
        <Route element={<ProtectedRoute />}>
          <Route path="/enroll" element={<EnrollmentPage />} />
          <Route element={<AppLayout />}>
            {/* Main RMM */}
            <Route path="/" element={<DashboardPage />} />
            <Route path="/devices" element={<DeviceListPage />} />
            <Route path="/devices/:id" element={<DeviceDetailPage />} />
            <Route path="/schedules" element={<SchedulesPage />} />
            <Route path="/policies" element={<PoliciesPage />} />
            {/* Groups */}
            <Route path="/group/:id" element={<GroupDetailPage />} />
            <Route path="/group/:id/edit" element={<GroupEditPage />} />
            {/* User */}
            <Route path="/profile" element={<ProfilePage />} />

            {/* Admin-only */}
            <Route element={<ProtectedRoute requiredRole="admin" />}>
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/admin/users" element={<AdminUsersPage />} />
              <Route path="/admin/devices" element={<AdminDevicesPage />} />
              <Route path="/admin/supervision" element={<SupervisionPage />} />
              <Route path="/admin/import-export" element={<ImportExportPage />} />
              <Route path="/admin/tenants" element={<AdminTenantsPage />} />
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>

      <Toaster
        position="top-right"
        containerStyle={nativeTop ? { top: nativeTop + 8 } : undefined}
        toastOptions={{
          className: '!bg-bg-secondary !text-text-primary !border !border-border',
          duration: 4000,
        }}
      />
    </BrowserRouter>
  );
}
