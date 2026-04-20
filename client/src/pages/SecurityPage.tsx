import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Shield, FileText, ShieldCheck } from 'lucide-react';
import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';
import { AuditLogPage } from './AuditLogPage';
import { ApprovalsPage } from './ApprovalsPage';
import { approvalApi } from '@/api/approval.api';
import { getSocket } from '@/socket/socketClient';

type Tab = 'audit' | 'approvals';

// Single admin-level "Security" page that groups the audit log and the
// two-step approval review queue as tabs. Tab selection is reflected in
// the URL (?tab=audit|approvals) so a deep-link stays stable.

export function SecurityPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const initial = (searchParams.get('tab') as Tab) || 'audit';
  const [tab, setTab] = useState<Tab>(initial);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    const cur = searchParams.get('tab');
    if (cur !== tab) {
      const next = new URLSearchParams(searchParams);
      next.set('tab', tab);
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // Keep the in-tab Approvals badge count in sync so switching tabs is
  // instant even if the Approvals page itself hasn't loaded yet.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const rows = await approvalApi.list(false);
        if (!cancelled) setPendingCount(rows.length);
      } catch { /* ignore */ }
    };
    load();
    const socket = getSocket();
    const handler = () => load();
    if (socket) {
      socket.on('APPROVAL_CREATED', handler);
      socket.on('APPROVAL_UPDATED', handler);
    }
    const tick = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(tick);
      if (socket) {
        socket.off('APPROVAL_CREATED', handler);
        socket.off('APPROVAL_UPDATED', handler);
      }
    };
  }, []);

  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-4">
        <Shield className="w-6 h-6 text-accent" />
        <div>
          <h1 className="text-xl font-semibold text-text-primary">{t('security.title', 'Security')}</h1>
          <p className="text-sm text-text-muted">{t('security.description', 'Audit trail and pending approvals.')}</p>
        </div>
      </div>

      <div className="flex items-center gap-1 rounded-lg bg-bg-secondary p-1 border border-border mb-4 inline-flex">
        <TabBtn active={tab === 'audit'} onClick={() => setTab('audit')}>
          <FileText className="w-4 h-4" />
          {t('security.tabAudit', 'Audit log')}
        </TabBtn>
        <TabBtn active={tab === 'approvals'} onClick={() => setTab('approvals')}>
          <ShieldCheck className="w-4 h-4" />
          {t('security.tabApprovals', 'Approvals')}
          {pendingCount > 0 && (
            <span className="ml-1 min-w-[1.25rem] px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/30 text-[10px] font-semibold text-center">
              {pendingCount > 99 ? '99+' : pendingCount}
            </span>
          )}
        </TabBtn>
      </div>

      {tab === 'audit' && <AuditLogPage embedded />}
      {tab === 'approvals' && <ApprovalsPage embedded />}
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-md transition-colors',
        active ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary',
      )}
    >
      {children}
    </button>
  );
}
