import { useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
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
import { ScriptLibraryPage } from '@/pages/ScriptLibraryPage';
import { ScriptSchedulesPage } from '@/pages/ScriptSchedulesPage';
import { UpdatesPage } from '@/pages/UpdatesPage';
import { CompliancePage } from '@/pages/CompliancePage';
import { RemoteSessionsPage } from '@/pages/RemoteSessionsPage';
import { ReportsPage } from '@/pages/ReportsPage';
import { HistoryPage } from '@/pages/HistoryPage';
import { GroupManagePage } from '@/pages/GroupManagePage';
import { GroupDetailPage } from '@/pages/GroupDetailPage';
import { GroupEditPage } from '@/pages/GroupEditPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { NotificationsPage } from '@/pages/NotificationsPage';
import { AdminUsersPage } from '@/pages/AdminUsersPage';
import { AdminDevicesPage } from '@/pages/AdminDevicesPage';
import { ProfilePage } from '@/pages/ProfilePage';
import { DownloadPage } from '@/pages/DownloadPage';
import { ImportExportPage } from '@/pages/ImportExportPage';
import { AdminMaintenancePage } from '@/pages/AdminMaintenancePage';
import { AdminTenantsPage } from '@/pages/AdminTenantsPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { ForeignAuthPage } from '@/pages/ForeignAuthPage';
import '@/i18n';

export default function App() {
  const { checkSession } = useAuthStore();

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
            <Route path="/scripts" element={<ScriptLibraryPage />} />
            <Route path="/schedules" element={<ScriptSchedulesPage />} />
            <Route path="/updates" element={<UpdatesPage />} />
            <Route path="/compliance" element={<CompliancePage />} />
            <Route path="/remote" element={<RemoteSessionsPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/history" element={<HistoryPage />} />
            {/* Groups */}
            <Route path="/group/:id" element={<GroupDetailPage />} />
            <Route path="/group/:id/edit" element={<GroupEditPage />} />
            {/* User */}
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/download" element={<DownloadPage />} />

            {/* Admin-only */}
            <Route element={<ProtectedRoute requiredRole="admin" />}>
              <Route path="/groups" element={<GroupManagePage />} />
              <Route path="/notifications" element={<NotificationsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/admin/users" element={<AdminUsersPage />} />
              <Route path="/admin/devices" element={<AdminDevicesPage />} />
              <Route path="/admin/import-export" element={<ImportExportPage />} />
              <Route path="/admin/maintenance" element={<AdminMaintenancePage />} />
              <Route path="/admin/tenants" element={<AdminTenantsPage />} />
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>

      <Toaster
        position="top-right"
        toastOptions={{
          className: '!bg-bg-secondary !text-text-primary !border !border-border',
          duration: 4000,
        }}
      />
    </BrowserRouter>
  );
}
