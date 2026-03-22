import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Package, ShieldCheck } from 'lucide-react';
import { UpdatesPage } from './UpdatesPage';
import { CompliancePage } from './CompliancePage';
import { clsx } from 'clsx';

type Tab = 'updates' | 'compliance';

export function PoliciesPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('updates');

  const tabs: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
    { id: 'updates', label: t('policies.tabUpdates'), icon: <Package size={16} /> },
    { id: 'compliance', label: t('policies.tabCompliance'), icon: <ShieldCheck size={16} /> },
  ];

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold text-text-primary">{t('policies.title')}</h1>
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
      {tab === 'updates' && <UpdatesPage embedded />}
      {tab === 'compliance' && <CompliancePage embedded />}
    </div>
  );
}
