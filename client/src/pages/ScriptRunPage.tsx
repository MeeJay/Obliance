import { useEffect, useState } from 'react';
import { Play, Loader2 } from 'lucide-react';
import { scriptApi } from '@/api/script.api';
import type { Script, ScheduleTargetType } from '@obliance/shared';
import { PageContainer } from '@/components/common/PageContainer';
import { GroupTreeMultiSelect } from '@/components/automation/GroupTreeMultiSelect';
import toast from 'react-hot-toast';
import { clsx } from 'clsx';

export function ScriptRunPage({ embedded }: { embedded?: boolean } = {}) {
 const [scripts, setScripts] = useState<Script[]>([]);
 const [scriptId, setScriptId] = useState<number | null>(null);
 const [targetType, setTargetType] = useState<ScheduleTargetType>('all');
 const [targetIds, setTargetIds] = useState<number[]>([]);
 const [isRunning, setIsRunning] = useState(false);
 const [lastResult, setLastResult] = useState<{ count: number; batchId?: string } | null>(null);

 useEffect(() => {
 scriptApi.list().then(setScripts).catch(() => {});
 }, []);

 const handleRun = async () => {
 if (!scriptId) { toast.error('Select a script'); return; }
 if (targetType === 'group' && targetIds.length === 0) { toast.error('Select at least one group'); return; }

 setIsRunning(true);
 setLastResult(null);
 try {
 const execs = await scriptApi.executeNow(scriptId, { targetType, targetIds });
 setLastResult({ count: execs.length, batchId: execs[0]?.batchId ?? undefined });
 toast.success(`Script launched on ${execs.length} device(s)`);
 } catch (err: any) {
 toast.error(err?.response?.data?.error || 'Failed to execute script');
 } finally {
 setIsRunning(false);
 }
 };

 return (
 <PageContainer embedded={embedded} className="space-y-6">
 {!embedded && (
 <div>
 <h1 className="text-2xl font-bold text-text-primary">Run Script</h1>
 <p className="text-sm text-text-muted mt-0.5">Execute a script on-demand across devices</p>
 </div>
 )}

 <div className="bg-bg-secondary rounded-xl p-4 sm:p-6 space-y-5 max-w-2xl">
 {/* Script selection */}
 <div className="space-y-1">
 <label className="text-xs font-medium text-text-muted uppercase">Script</label>
 <select
 value={scriptId ?? ''}
 onChange={(e) => setScriptId(e.target.value ? parseInt(e.target.value, 10) : null)}
 className="w-full px-3 py-2 text-sm bg-bg-tertiary rounded-lg text-text-primary focus:outline-none focus:border-accent"
 >
 <option value="">Select a script...</option>
 {scripts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
 </select>
 </div>

 {/* Target type */}
 <div className="space-y-1">
 <label className="text-xs font-medium text-text-muted uppercase">Target</label>
 <div className="flex gap-2">
 {(['all', 'group'] as const).map((t) => (
 <button
 key={t}
 onClick={() => { setTargetType(t); setTargetIds([]); }}
 className={clsx(
 'flex-1 py-2 text-sm rounded-lg border transition-colors',
 targetType === t ? 'bg-accent/10 border-accent text-accent' : 'border-transparent text-text-muted hover:border-accent/50',
 )}
 >
 {t === 'all' ? 'All devices' : 'By group'}
 </button>
 ))}
 </div>
 </div>

 {/* Group tree multi-select */}
 {targetType === 'group' && (
 <div className="space-y-1">
 <label className="text-xs font-medium text-text-muted uppercase">Groups</label>
 <GroupTreeMultiSelect selectedIds={targetIds} onChange={setTargetIds} />
 </div>
 )}

 {/* Run button */}
 <button
 onClick={handleRun}
 disabled={isRunning || !scriptId}
 className={clsx(
 'flex items-center justify-center gap-2 w-full py-3 rounded-lg text-sm font-medium transition-colors',
 isRunning || !scriptId
 ? 'bg-bg-tertiary text-text-muted cursor-not-allowed'
 : 'bg-accent text-white hover:bg-accent/80',
 )}
 >
 {isRunning ? (
 <><Loader2 className="w-4 h-4 animate-spin" /> Running...</>
 ) : (
 <><Play className="w-4 h-4" /> Execute now</>
 )}
 </button>

 {/* Result */}
 {lastResult && (
 <div className="rounded-lg border border-green-400/30 bg-green-400/5 p-3 text-sm text-green-400">
 Script dispatched to {lastResult.count} device(s). Check the History tab for results.
 </div>
 )}
 </div>
 </PageContainer>
 );
}
