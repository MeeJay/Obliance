import { useEffect, useState, useCallback } from 'react';
import { ShieldCheck, ShieldAlert, Clock, RefreshCw, Check, X } from 'lucide-react';
import { clsx } from 'clsx';
import { approvalApi, type PendingApproval } from '@/api/approval.api';
import { useAuthStore } from '@/store/authStore';
import { getSocket } from '@/socket/socketClient';
import toast from 'react-hot-toast';

// 2-step approval review page. Shows pending destructive-command requests
// waiting for a second admin's approval. Self-requests (current user is
// the requester) can be cancelled but not approved/denied.

function statusPill(s: string) {
  const c =
    s === 'pending'   ? 'text-yellow-400 border-yellow-400/30 bg-yellow-400/10' :
    s === 'approved'  ? 'text-green-400  border-green-400/30  bg-green-400/10'  :
    s === 'executed'  ? 'text-green-400  border-green-400/30  bg-green-400/10'  :
    s === 'denied'    ? 'text-red-400    border-red-400/30    bg-red-400/10'    :
    s === 'expired'   ? 'text-gray-400   border-gray-400/30   bg-gray-400/10'   :
    s === 'cancelled' ? 'text-gray-400   border-gray-400/30   bg-gray-400/10'   :
                        'text-text-muted border-border bg-bg-tertiary';
  return <span className={`shrink-0 px-2 py-0.5 rounded-full border font-medium capitalize text-[10px] ${c}`}>{s}</span>;
}

function formatCountdown(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms < 0) return 'expired';
  const min = Math.floor(ms / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  return `${min}m ${sec}s`;
}

export function ApprovalsPage() {
  const userId = useAuthStore((s) => s.user?.id);
  const [items, setItems] = useState<PendingApproval[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showResolved, setShowResolved] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [, forceRerender] = useState(0);

  const load = useCallback(async (spinner = true) => {
    if (spinner) setIsLoading(true);
    try {
      const rows = await approvalApi.list(showResolved);
      setItems(rows);
    } catch (err) {
      toast.error('Failed to load approvals');
    } finally {
      if (spinner) setIsLoading(false);
    }
  }, [showResolved]);

  useEffect(() => { load(); }, [load]);

  // Tick the countdown every second so "expires in 12m 04s" counts down live.
  useEffect(() => {
    const h = setInterval(() => forceRerender((n) => n + 1), 1000);
    return () => clearInterval(h);
  }, []);

  // Live updates via socket.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const handler = () => load(false);
    socket.on('APPROVAL_CREATED', handler);
    socket.on('APPROVAL_UPDATED', handler);
    return () => {
      socket.off('APPROVAL_CREATED', handler);
      socket.off('APPROVAL_UPDATED', handler);
    };
  }, [load]);

  const handleApprove = async (a: PendingApproval) => {
    const reason = window.prompt('Approve with reason (optional):', '') ?? undefined;
    setBusyId(a.id);
    try {
      await approvalApi.approve(a.id, reason);
      toast.success('Approved — commands dispatched');
      await load(false);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Approval failed');
    } finally {
      setBusyId(null);
    }
  };

  const handleDeny = async (a: PendingApproval) => {
    const reason = window.prompt('Deny with reason:', '');
    if (reason === null) return; // cancelled the prompt
    setBusyId(a.id);
    try {
      await approvalApi.deny(a.id, reason);
      toast('Denied');
      await load(false);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Deny failed');
    } finally {
      setBusyId(null);
    }
  };

  const handleCancel = async (a: PendingApproval) => {
    if (!confirm('Cancel your own pending request?')) return;
    setBusyId(a.id);
    try {
      await approvalApi.cancel(a.id);
      toast('Cancelled');
      await load(false);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Cancel failed');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-6 h-6 text-accent" />
          <div>
            <h1 className="text-xl font-semibold text-text-primary">Approvals</h1>
            <p className="text-sm text-text-muted">Destructive actions waiting for a second admin.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-text-muted cursor-pointer">
            <input
              type="checkbox"
              checked={showResolved}
              onChange={(e) => setShowResolved(e.target.checked)}
              className="accent-accent"
            />
            Show resolved
          </label>
          <button
            onClick={() => load(true)}
            className="p-1.5 rounded border border-border text-text-muted hover:text-text-primary hover:border-accent/40 transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-text-muted italic text-sm">Loading...</p>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-border bg-bg-secondary p-8 text-center text-text-muted">
          <ShieldAlert className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No {showResolved ? '' : 'pending '}approvals.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((a) => {
            const isOwn = a.requestedBy === userId;
            const canReview = a.status === 'pending' && !isOwn;
            const canCancel = a.status === 'pending' && isOwn;
            const expiringSoon = a.status === 'pending' && new Date(a.expiresAt).getTime() - Date.now() < 5 * 60 * 1000;
            return (
              <div
                key={a.id}
                className={clsx(
                  'rounded border border-border bg-bg-secondary p-3',
                  expiringSoon && 'border-orange-400/30 bg-orange-400/5',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      {statusPill(a.status)}
                      <span className="text-[10px] uppercase text-text-muted">{a.requestType.replace('_', ' ')}</span>
                      {isOwn && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/10 text-accent border border-accent/30">
                          your request
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-text-primary font-medium truncate">{a.description}</p>
                    <div className="flex items-center gap-3 mt-1 text-[11px] text-text-muted flex-wrap">
                      <span>By <strong className="text-text-secondary">{a.requestedByName || `#${a.requestedBy}`}</strong></span>
                      <span>{new Date(a.createdAt).toLocaleString()}</span>
                      {a.status === 'pending' && (
                        <span className="inline-flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatCountdown(a.expiresAt)}
                        </span>
                      )}
                      {a.reviewedByName && (
                        <span>{a.status === 'approved' || a.status === 'executed' ? 'approved' : 'denied'} by <strong>{a.reviewedByName}</strong></span>
                      )}
                    </div>
                    {a.reviewReason && (
                      <p className="text-[11px] italic text-text-muted mt-1">"{a.reviewReason}"</p>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {canReview && (
                      <>
                        <button
                          disabled={busyId === a.id}
                          onClick={() => handleApprove(a)}
                          className="flex items-center gap-1 text-xs px-2.5 py-1 rounded border border-green-400/30 bg-green-400/10 text-green-400 hover:bg-green-400/20 disabled:opacity-50"
                        >
                          <Check className="w-3.5 h-3.5" /> Approve
                        </button>
                        <button
                          disabled={busyId === a.id}
                          onClick={() => handleDeny(a)}
                          className="flex items-center gap-1 text-xs px-2.5 py-1 rounded border border-red-400/30 bg-red-400/10 text-red-400 hover:bg-red-400/20 disabled:opacity-50"
                        >
                          <X className="w-3.5 h-3.5" /> Deny
                        </button>
                      </>
                    )}
                    {canCancel && (
                      <button
                        disabled={busyId === a.id}
                        onClick={() => handleCancel(a)}
                        className="flex items-center gap-1 text-xs px-2.5 py-1 rounded border border-border text-text-muted hover:text-text-primary disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
