import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Plus, RotateCcw, Terminal } from 'lucide-react';
import type { RemoteSession } from '@obliance/shared';
import { clsx } from 'clsx';

// Modale shown on "Connect SSH" / "Connect CMD" / "Connect PowerShell"
// when the caller already has at least one resumable session on the
// target device. Multi-tty is preserved: "Start new session" stays an
// explicit action, and the caller can spawn as many parallel tunnels
// as they want — each one becomes its own row in the list next time.
//
// Resume only really restores state when the agent has tmux installed
// (Unix). On Windows the resume call falls through to a fresh shell
// because we don't have a session multiplexer there yet — the modale
// still surfaces but the badge "(no resume on Windows)" warns the
// admin upfront so they don't expect their cwd to come back.
//
// Resumable list is already pre-scoped server-side: a non-admin only
// sees their OWN sessions, an admin sees their tenant's, master sees
// install-wide. So this UI doesn't need to filter again.

export interface ResumeOrNewSessionModalProps {
  sessions: RemoteSession[];
  protocol: 'ssh' | 'cmd' | 'powershell' | 'rdp' | 'oblireach';
  /** Called when the user picks an existing session to resume. */
  onResume: (sessionId: string) => void | Promise<void>;
  /** Called when the user wants a fresh session. */
  onNew: () => void | Promise<void>;
  onCancel: () => void;
  /** True while a resume/new request is in flight — disables buttons
   *  to prevent double-tap. */
  busy?: boolean;
}

function timeAgoShort(iso: string | null | undefined): string {
  if (!iso) return '?';
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}min`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}j`;
}

export function ResumeOrNewSessionModal({ sessions, protocol, onResume, onNew, onCancel, busy }: ResumeOrNewSessionModalProps) {
  const { t } = useTranslation();
  const [pickedId, setPickedId] = useState<string | null>(null);

  const protoLabel = protocol === 'ssh' ? 'SSH' : protocol === 'cmd' ? 'CMD' : protocol === 'powershell' ? 'PowerShell' : protocol === 'rdp' ? 'RDP' : 'Remote';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onCancel}>
      <div
        className="bg-bg-primary rounded-xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-accent" />
            <h2 className="text-base font-semibold text-text-primary">
              {t('remote.resumeModal.title', { protocol: protoLabel, defaultValue: `Active ${protoLabel} sessions` })}
            </h2>
          </div>
          <button
            onClick={onCancel}
            className="p-1 text-text-muted hover:text-text-primary transition-colors"
            disabled={busy}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 pb-3 text-xs text-text-muted">
          {t('remote.resumeModal.help', 'You already have one or more sessions on this device. Pick one to reconnect (scrollback + running processes preserved if the agent supports tmux), or start a fresh tab.')}
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-3 space-y-2">
          {sessions.map((s) => {
            const picked = pickedId === s.id;
            return (
              <button
                key={s.id}
                onClick={() => setPickedId(s.id)}
                disabled={busy}
                className={clsx(
                  'w-full text-left rounded-lg p-3 transition-colors',
                  'bg-bg-secondary hover:bg-bg-tertiary',
                  picked && 'ring-2 ring-accent',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-text-primary">
                    {s.startedByUser?.displayName || s.startedByUser?.username || `User #${s.startedBy ?? '?'}`}
                  </span>
                  <span className="text-[10px] uppercase tracking-wide text-text-muted">
                    {s.status}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-3 text-xs text-text-muted">
                  <span>{t('remote.resumeModal.startedAgo', { ago: timeAgoShort(s.startedAt), defaultValue: `started ${timeAgoShort(s.startedAt)} ago` })}</span>
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3">
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-3 py-1.5 text-sm text-text-muted hover:text-text-primary disabled:opacity-50"
          >
            {t('common.cancel', 'Cancel')}
          </button>
          <button
            onClick={onNew}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-bg-secondary hover:bg-bg-tertiary rounded-md text-text-primary disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" />
            {t('remote.resumeModal.newSession', 'Start new session')}
          </button>
          <button
            onClick={() => pickedId && onResume(pickedId)}
            disabled={busy || !pickedId}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-accent text-white rounded-md hover:bg-accent/80 disabled:opacity-50"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            {t('remote.resumeModal.resume', 'Resume')}
          </button>
        </div>
      </div>
    </div>
  );
}
