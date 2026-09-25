import { useState, useMemo, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Laptop, History, FileBarChart2 } from 'lucide-react';
import { RemoteSessionsPage } from './RemoteSessionsPage';
import { HistoryPage } from './HistoryPage';
import { ReportsPage } from './ReportsPage';
import { useAuthStore } from '@/store/authStore';
import { PageContainer } from '@/components/common/PageContainer';
import { SegmentedTabs } from '@/components/common/SegmentedTabs';

type Tab = 'remote' | 'history' | 'reports';

// All three tabs share the unified `supervision:read` capability now
// (the old per-tab supervision_remote / supervision_history /
// manage_reports keys are gone — they never mapped to a runtime
// check, only to a phantom cosmetics list pushed to Obligate).
const TAB_CAPABILITY: Record<Tab, string> = {
 remote: 'supervision:read',
 history: 'supervision:read',
 reports: 'supervision:read',
};

export function SupervisionPage() {
 const { t } = useTranslation();
 const { isAdmin, permissions } = useAuthStore();
 const admin = isAdmin();
 const tenantCaps = useMemo(
 () => new Set(permissions?.tenantCapabilities ?? []),
 [permissions?.tenantCapabilities],
 );

 // Only render tabs the user has access to (admins see everything).
 const tabs = useMemo<Array<{ id: Tab; label: string; icon: React.ReactNode }>>(() => {
 const all: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
 { id: 'remote', label: t('supervision.tabRemote'), icon: <Laptop size={16} /> },
 { id: 'history', label: t('supervision.tabHistory'), icon: <History size={16} /> },
 { id: 'reports', label: t('supervision.tabReports'), icon: <FileBarChart2 size={16} /> },
 ];
 return admin ? all : all.filter((tab) => tenantCaps.has(TAB_CAPABILITY[tab.id]));
 }, [t, admin, tenantCaps]);

 const [tab, setTab] = useState<Tab>(tabs[0]?.id ?? 'remote');

 // Snap the active tab back into the visible set if the user's caps change
 // (e.g. an admin revoked a team capability while the page was open).
 useEffect(() => {
 if (tabs.length > 0 && !tabs.some((t2) => t2.id === tab)) setTab(tabs[0].id);
 }, [tabs, tab]);

 if (tabs.length === 0) {
 // User has no supervision access at all → bounce them off the page.
 return <Navigate to="/" replace />;
 }

 // PageContainer: p-3 / sm:p-4 / lg:p-6 (= the historic p-6 on desktop).
 // SegmentedTabs: same bar as before, scrolls horizontally instead of
 // wrapping long labels ("Sessions distantes") on phones.
 return (
 <PageContainer className="space-y-6">
 <h1 className="text-2xl font-bold text-text-primary">{t('supervision.title')}</h1>
 <SegmentedTabs<Tab>
 tabs={tabs}
 value={tab}
 onChange={setTab}
 ariaLabel={t('supervision.title')}
 tabClassName="max-sm:px-3"
 />
 {tab === 'remote' && <RemoteSessionsPage embedded />}
 {tab === 'history' && <HistoryPage embedded />}
 {tab === 'reports' && <ReportsPage embedded />}
 </PageContainer>
 );
}
