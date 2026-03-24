import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { CalendarClock, Code2 } from 'lucide-react';
import { ScriptSchedulesPage } from './ScriptSchedulesPage';
import { ScriptLibraryPage } from './ScriptLibraryPage';
import { clsx } from 'clsx';

type Tab = 'schedules' | 'scripts';

export function SchedulesPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') === 'scripts' ? 'scripts' : 'schedules';
  const [tab, setTab] = useState<Tab>(initialTab);

  const tabs: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
    { id: 'schedules', label: t('schedules.tabSchedules'), icon: <CalendarClock size={16} /> },
    { id: 'scripts', label: t('schedules.tabScripts'), icon: <Code2 size={16} /> },
  ];

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold text-text-primary">{t('schedules.title')}</h1>
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
      {tab === 'schedules' && <ScriptSchedulesPage embedded />}
      {tab === 'scripts' && <ScriptLibraryPage embedded />}
    </div>
  );
}
