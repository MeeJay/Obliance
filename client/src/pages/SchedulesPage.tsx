import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigationType, useSearchParams } from 'react-router-dom';
import { CalendarClock, Code2, Play, History, Zap } from 'lucide-react';
import { ScriptSchedulesPage } from './ScriptSchedulesPage';
import { ScriptLibraryPage } from './ScriptLibraryPage';
import { ScriptRunPage } from './ScriptRunPage';
import { ScriptHistoryPage } from './ScriptHistoryPage';
import { ScenariosPage } from './ScenariosPage';
import { PageContainer } from '@/components/common/PageContainer';
import { SegmentedTabs, type SegmentedTab } from '@/components/common/SegmentedTabs';

type Tab = 'schedules' | 'scenarios' | 'scripts' | 'run' | 'history';

const TABS: ReadonlyArray<Tab> = ['schedules', 'scenarios', 'scripts', 'run', 'history'];

export function SchedulesPage() {
 const { t } = useTranslation();
 const [searchParams, setSearchParams] = useSearchParams();
 // The active tab lives in the URL (?tab=…) so a reload, a shared link and
 // the browser / Android back button all land on the right tab. Default
 // tab = no param (clean /automations URL).
 const rawTab = searchParams.get('tab');
 const urlTab: Tab | null = TABS.includes(rawTab as Tab) ? (rawTab as Tab) : null;

 // The sidebar "Automations" link PUSHes a bare /automations. While this
 // page is already mounted that used to keep the current tab (it was local
 // state), so keep doing that: a bare PUSH that did not come from our own
 // tab bar re-selects the last tab and rewrites the URL in place.
 const location = useLocation();
 const navigationType = useNavigationType();
 const lastTabRef = useRef<Tab | null>(null); // null until the first commit
 const internalNavRef = useRef(false);
 const restoreTab: Tab | null =
 urlTab == null
 && navigationType === 'PUSH'
 && !internalNavRef.current
 && lastTabRef.current != null
 && lastTabRef.current !== 'schedules'
 ? lastTabRef.current
 : null;
 const tab: Tab = urlTab ?? restoreTab ?? 'schedules';

 useEffect(() => {
 if (restoreTab) {
 setSearchParams((prev) => {
 const params = new URLSearchParams(prev);
 params.set('tab', restoreTab);
 return params;
 }, { replace: true });
 return;
 }
 internalNavRef.current = false;
 lastTabRef.current = tab;
 // Runs once per navigation; restoreTab / tab are derived from it.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [location.key]);

 const setTab = (next: Tab) => {
 if (next === tab) return;
 internalNavRef.current = true;
 setSearchParams((prev) => {
 const params = new URLSearchParams(prev);
 if (next === 'schedules') params.delete('tab');
 else params.set('tab', next);
 return params;
 });
 };

 const tabs: SegmentedTab<Tab>[] = [
 { id: 'schedules', label: t('schedules.tabSchedules'), icon: <CalendarClock size={16} /> },
 { id: 'scenarios', label: t('automations.tabScenarios', 'Scenarios'), icon: <Zap size={16} /> },
 { id: 'scripts', label: t('schedules.tabScripts'), icon: <Code2 size={16} /> },
 { id: 'run', label: t('schedules.tabRun'), icon: <Play size={16} /> },
 { id: 'history', label: t('schedules.tabHistory'), icon: <History size={16} /> },
 ];

 return (
 <PageContainer className="space-y-4 lg:space-y-6">
 <h1 className="text-2xl font-bold text-text-primary">{t('automations.title', 'Automations')}</h1>
 <SegmentedTabs tabs={tabs} value={tab} onChange={setTab} ariaLabel={t('automations.title', 'Automations')} />
 {tab === 'schedules' && <ScriptSchedulesPage embedded />}
 {tab === 'scenarios' && <ScenariosPage embedded />}
 {tab === 'scripts' && <ScriptLibraryPage embedded />}
 {tab === 'run' && <ScriptRunPage embedded />}
 {tab === 'history' && <ScriptHistoryPage embedded />}
 </PageContainer>
 );
}
