import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Laptop, History, FileBarChart2 } from 'lucide-react';
import { RemoteSessionsPage } from './RemoteSessionsPage';
import { HistoryPage } from './HistoryPage';
import { ReportsPage } from './ReportsPage';
import { clsx } from 'clsx';

type Tab = 'remote' | 'history' | 'reports';

export function SupervisionPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('remote');

  const tabs: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
    { id: 'remote', label: t('supervision.tabRemote'), icon: <Laptop size={16} /> },
    { id: 'history', label: t('supervision.tabHistory'), icon: <History size={16} /> },
    { id: 'reports', label: t('supervision.tabReports'), icon: <FileBarChart2 size={16} /> },
  ];

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold text-text-primary">{t('supervision.title')}</h1>
      <div className="flex items-center gap-1 rounded-lg bg-bg-secondary p-1 border border-border">
        {tabs.map((t2) => (
          <button
            key={t2.id}
            onClick={() => setTab(t2.id)}
            className={clsx(
              'flex items-center gap-2 flex-1 px-4 py-2 text-sm font-medium rounded-md transition-colors justify-center',
              tab === t2.id ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary',
            )}
          >
            {t2.icon}
            {t2.label}
          </button>
        ))}
      </div>
      {tab === 'remote' && <RemoteSessionsPage embedded />}
      {tab === 'history' && <HistoryPage embedded />}
      {tab === 'reports' && <ReportsPage embedded />}
    </div>
  );
}
