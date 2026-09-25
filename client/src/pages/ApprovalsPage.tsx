import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { ShieldCheck, ShieldAlert, Clock, RefreshCw, Check, X } from 'lucide-react';
import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { approvalApi, type PendingApproval } from '@/api/approval.api';
import { useAuthStore } from '@/store/authStore';
import { getSocket } from '@/socket/socketClient';
import toast from 'react-hot-toast';
import { TenantBadge } from '@/components/common/TenantBadge';
import { PageContainer } from '@/components/common/PageContainer';
import { IconButton } from '@/components/common/IconButton';
import { useConfirm, usePrompt } from '@/components/common/ConfirmDialog';

// 2-step approval review page. Shows pending destructive-command requests
// waiting for a second admin's approval. Self-requests (current user is
// the requester) can be cancelled but not approved/denied.

function statusPill(s: string, t: TFunction) {
 const c =
 s === 'pending' ? 'text-yellow-400 border-yellow-400/30 bg-yellow-400/10' :
 s === 'approved' ? 'text-green-400 border-green-400/30 bg-green-400/10' :
 s === 'executed' ? 'text-green-400 border-green-400/30 bg-green-400/10' :
 s === 'denied' ? 'text-red-400 border-red-400/30 bg-red-400/10' :
 s === 'expired' ? 'text-gray-400 border-gray-400/30 bg-gray-400/10' :
 s === 'cancelled' ? 'text-gray-400 border-gray-400/30 bg-gray-400/10' :
 'text-text-muted border-transparent bg-bg-tertiary';
 return <span className={`shrink-0 px-2 py-0.5 rounded-full border font-medium capitalize text-[10px] ${c}`}>{t(`approvals.status.${s}`, s)}</span>;
}

function formatCountdown(expiresAt: string, t: TFunction): string {
 const ms = new Date(expiresAt).getTime() - Date.now();
 if (ms < 0) return t('approvals.status.expired', 'expired');
 const min = Math.floor(ms / 60000);
 const sec = Math.floor((ms % 60000) / 1000);
 return `${min}m ${sec}s`;
}

/**
 * The request description (what the destructive action will do). Desktop
 * (≥ lg, mouse): one truncated line as before. Narrow / touch: up to 3
 * lines, plus a "Show more" toggle when it is still cut — the reviewer must
 * be able to read what they approve.
 */
function RequestDescription({ text }: { text: string }) {
 const { t } = useTranslation();
 const ref = useRef<HTMLParagraphElement>(null);
 const [expanded, setExpanded] = useState(false);
 const [overflowing, setOverflowing] = useState(false);

 useLayoutEffect(() => {
 const el = ref.current;
 if (!el || expanded) return;
 const check = () => setOverflowing(el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1);
 check();
 if (typeof ResizeObserver === 'undefined') return;
 const ro = new ResizeObserver(check);
 ro.observe(el);
 return () => ro.disconnect();
 }, [text, expanded]);

 return (
 <>
 <p
 ref={ref}
 className={clsx(
 'text-sm text-text-primary font-medium',
 expanded
 ? 'whitespace-pre-wrap break-words'
 : 'truncate max-lg:whitespace-normal max-lg:line-clamp-3 max-lg:break-words coarse:whitespace-normal coarse:line-clamp-3 coarse:break-words',
 )}
 >
 {text}
 </p>
 {(overflowing || expanded) && (
 <button
 type="button"
 onClick={() => setExpanded((v) => !v)}
 aria-expanded={expanded}
 className="lg:can-hover:hidden text-[11px] text-accent hover:underline coarse:min-h-9"
 >
 {expanded ? t('approvals.showLess', 'Show less') : t('approvals.showMore', 'Show more')}
 </button>
 )}
 </>
 );
}

export function ApprovalsPage({ embedded = false }: { embedded?: boolean } = {}) {
 const { t } = useTranslation();
 const confirm = useConfirm();
 const prompt = usePrompt();
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
 toast.error(t('approvals.loadFailed', 'Failed to load approvals'));
 } finally {
 if (spinner) setIsLoading(false);
 }
 }, [showResolved, t]);

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
 // In-app prompt (window.prompt is a no-op in the Android WebView). Cancel
 // now really cancels — the old `prompt() ?? undefined` approved anyway.
 const reason = await prompt({
 title: t('approvals.approveTitle', 'Approve this request?'),
 message: <span className="break-words">{a.description}</span>,
 placeholder: t('approvals.reasonOptional', 'Reason (optional)'),
 confirmLabel: t('approvals.approve', 'Approve'),
 // Single-line input: Enter confirms, like the old window.prompt.
 multiline: false,
 plain: false,
 });
 if (reason === null) return;
 setBusyId(a.id);
 try {
 await approvalApi.approve(a.id, reason.trim() || undefined);
 toast.success(t('approvals.approvedToast', 'Approved — commands dispatched'));
 await load(false);
 } catch (err: any) {
 toast.error(err?.response?.data?.error || t('approvals.approveFailed', 'Approval failed'));
 } finally {
 setBusyId(null);
 }
 };

 const handleDeny = async (a: PendingApproval) => {
 const reason = await prompt({
 title: t('approvals.denyTitle', 'Deny this request?'),
 message: <span className="break-words">{a.description}</span>,
 placeholder: t('approvals.reason', 'Reason'),
 confirmLabel: t('approvals.deny', 'Deny'),
 multiline: false,
 plain: false,
 });
 if (reason === null) return; // cancelled the prompt
 setBusyId(a.id);
 try {
 await approvalApi.deny(a.id, reason);
 toast(t('approvals.deniedToast', 'Denied'));
 await load(false);
 } catch (err: any) {
 toast.error(err?.response?.data?.error || t('approvals.denyFailed', 'Deny failed'));
 } finally {
 setBusyId(null);
 }
 };

 const handleCancel = async (a: PendingApproval) => {
 if (!(await confirm({
 message: t('approvals.cancelConfirm', 'Cancel your own pending request?'),
 confirmLabel: t('approvals.cancelRequest', 'Cancel request'),
 cancelLabel: t('common.back', 'Back'),
 }))) return;
 setBusyId(a.id);
 try {
 await approvalApi.cancel(a.id);
 toast(t('approvals.cancelledToast', 'Cancelled'));
 await load(false);
 } catch (err: any) {
 toast.error(err?.response?.data?.error || t('approvals.cancelFailed', 'Cancel failed'));
 } finally {
 setBusyId(null);
 }
 };

 return (
 <PageContainer embedded={embedded}>
 <div className="flex flex-wrap items-center justify-between gap-2 mb-6">
 {!embedded && (
 <div className="flex items-center gap-3">
 <ShieldCheck className="w-6 h-6 text-accent" />
 <div>
 <h1 className="text-xl font-semibold text-text-primary">{t('approvals.title', 'Approvals')}</h1>
 <p className="text-sm text-text-muted">{t('approvals.subtitle', 'Destructive actions waiting for a second admin.')}</p>
 </div>
 </div>
 )}
 {embedded && <div />}
 <div className="flex items-center gap-2 ml-auto">
 <label className="flex items-center gap-2 text-xs text-text-muted cursor-pointer coarse:min-h-10">
 <input
 type="checkbox"
 checked={showResolved}
 onChange={(e) => setShowResolved(e.target.checked)}
 className="accent-accent"
 />
 {t('approvals.showResolved', 'Show resolved')}
 </label>
 <IconButton
 label={t('common.refresh', 'Refresh')}
 icon={<RefreshCw className="w-4 h-4" />}
 variant="plain"
 onClick={() => load(true)}
 className="hover:border-accent/40"
 />
 </div>
 </div>

 {isLoading ? (
 <p className="text-text-muted italic text-sm">{t('common.loading', 'Loading…')}</p>
 ) : items.length === 0 ? (
 <div className="rounded-lg bg-bg-secondary p-8 text-center text-text-muted">
 <ShieldAlert className="w-8 h-8 mx-auto mb-2 opacity-30" />
 <p className="text-sm">{showResolved ? t('approvals.empty', 'No approvals.') : t('approvals.emptyPending', 'No pending approvals.')}</p>
 </div>
 ) : (
 <div className="space-y-2">
 {items.map((a) => {
 const isOwn = a.requestedBy === userId;
 const canReview = a.status === 'pending' && !isOwn;
 const canCancel = a.status === 'pending' && isOwn;
 const expiringSoon = a.status === 'pending' && new Date(a.expiresAt).getTime() - Date.now() < 5 * 60 * 1000;
 const reviewed = a.status === 'approved' || a.status === 'executed';
 return (
 <div
 key={a.id}
 className={clsx(
 'rounded bg-bg-secondary p-3',
 expiringSoon && 'border-orange-400/30 bg-orange-400/5',
 )}
 >
 {/* Below sm the actions take their own row under the request. */}
 <div className="flex items-start justify-between gap-3 max-sm:flex-col max-sm:items-stretch">
 <div className="flex-1 min-w-0">
 <div className="flex items-center gap-2 flex-wrap mb-1">
 {statusPill(a.status, t)}
 <span className="text-[10px] uppercase text-text-muted">{a.requestType.replace('_', ' ')}</span>
 {isOwn && (
 <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/10 text-accent border border-accent/30">
 {t('approvals.yourRequest', 'your request')}
 </span>
 )}
 <TenantBadge tenantId={a.tenantId} />
 </div>
 <RequestDescription text={a.description} />
 <div className="flex items-center gap-3 mt-1 text-[11px] text-text-muted flex-wrap">
 <span>{t('approvals.by', 'By')} <strong className="text-text-secondary">{a.requestedByName || `#${a.requestedBy}`}</strong></span>
 <span>{new Date(a.createdAt).toLocaleString()}</span>
 {a.status === 'pending' && (
 <span className="inline-flex items-center gap-1">
 <Clock className="w-3 h-3" />
 {formatCountdown(a.expiresAt, t)}
 </span>
 )}
 {a.reviewedByName && (
 <span>{reviewed ? t('approvals.approvedBy', 'approved by') : t('approvals.deniedBy', 'denied by')} <strong>{a.reviewedByName}</strong></span>
 )}
 </div>
 {a.reviewReason && (
 <p className="text-[11px] italic text-text-muted mt-1 break-words">"{a.reviewReason}"</p>
 )}
 </div>

 <div className={clsx('flex items-center gap-1.5 shrink-0 coarse:gap-3 max-sm:justify-end', !canReview && !canCancel && 'max-sm:hidden')}>
 {canReview && (
 <>
 <button
 disabled={busyId === a.id}
 onClick={() => handleApprove(a)}
 className="flex items-center gap-1 text-xs px-2.5 py-1 rounded border border-green-400/30 bg-green-400/10 text-green-400 hover:bg-green-400/20 disabled:opacity-50 coarse:min-h-10 coarse:px-3"
 >
 <Check className="w-3.5 h-3.5" /> {t('approvals.approve', 'Approve')}
 </button>
 <button
 disabled={busyId === a.id}
 onClick={() => handleDeny(a)}
 className="flex items-center gap-1 text-xs px-2.5 py-1 rounded border border-red-400/30 bg-red-400/10 text-red-400 hover:bg-red-400/20 disabled:opacity-50 coarse:min-h-10 coarse:px-3"
 >
 <X className="w-3.5 h-3.5" /> {t('approvals.deny', 'Deny')}
 </button>
 </>
 )}
 {canCancel && (
 <button
 disabled={busyId === a.id}
 onClick={() => handleCancel(a)}
 className="flex items-center gap-1 text-xs px-2.5 py-1 rounded text-text-muted hover:text-text-primary disabled:opacity-50 coarse:min-h-10 coarse:px-3"
 >
 {t('common.cancel', 'Cancel')}
 </button>
 )}
 </div>
 </div>
 </div>
 );
 })}
 </div>
 )}
 </PageContainer>
 );
}
