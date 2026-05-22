import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { X, Cpu, MemoryStick, Camera, RotateCcw, Trash2, Plus } from 'lucide-react';
import { clsx } from 'clsx';
import type { VirtualMachine, VmAction } from '@obliance/shared';

// Shared action signature — returns the raw response so callers can detect
// the 202 pending-approval shape. params carries action-specific fields.
type RunAction = (vmId: string, action: VmAction, params?: Record<string, unknown>) => Promise<any>;

function ModalShell({ title, icon, onClose, children }: { title: string; icon: React.ReactNode; onClose: () => void; children: React.ReactNode }) {
  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-bg-secondary rounded-xl shadow-2xl w-full max-w-md mx-4 flex flex-col max-h-[80vh]" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 flex items-center gap-2">
          {icon}
          <span className="text-sm font-semibold text-text-primary">{title}</span>
          <button onClick={onClose} className="ml-auto p-1 text-text-muted hover:text-text-primary rounded"><X className="w-4 h-4" /></button>
        </div>
        <div className="px-4 py-3 overflow-y-auto">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

const inputCls = 'w-full px-3 py-2 text-sm bg-bg-tertiary rounded-lg text-text-primary focus:outline-none focus:border-accent';
const labelCls = 'text-xs font-medium text-text-muted mb-1 block';

// ── Edit VM (vCPU / RAM) ──────────────────────────────────────────────────────
export function EditVmModal({ vm, onClose, run }: { vm: VirtualMachine; onClose: () => void; run: RunAction }) {
  const { t } = useTranslation();
  const [cpu, setCpu] = useState<number>(vm.cpuCount ?? 2);
  const [ramGb, setRamGb] = useState<number>(vm.memoryBytes ? Math.max(1, Math.round(vm.memoryBytes / (1024 ** 3))) : 4);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await run(vm.vmId, 'edit', { cpuCount: cpu, memoryStartupBytes: ramGb * (1024 ** 3) });
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <ModalShell title={`${t('hyperv.editTitle') || 'Edit VM'} — ${vm.name}`} icon={<Cpu className="w-4 h-4 text-accent" />} onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className={labelCls}>{t('hyperv.vcpu') || 'Virtual processors'}</label>
          <input type="number" min={1} max={256} value={cpu} onChange={(e) => setCpu(parseInt(e.target.value, 10) || 1)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}><MemoryStick className="w-3 h-3 inline mr-1" />{t('hyperv.ramGb') || 'Startup memory (GB)'}</label>
          <input type="number" min={1} max={4096} value={ramGb} onChange={(e) => setRamGb(parseInt(e.target.value, 10) || 1)} className={inputCls} />
          <p className="text-[10px] text-text-muted mt-1">{t('hyperv.editNote') || 'Applied via Set-VM. The VM may need to be off for some changes to take effect.'}</p>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-text-muted hover:text-text-primary">{t('common.cancel') || 'Cancel'}</button>
          <button onClick={save} disabled={saving} className="px-3 py-1.5 text-xs bg-accent text-white rounded-lg hover:bg-accent/90 disabled:opacity-50">
            {saving ? '…' : (t('common.save') || 'Save')}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

// ── Create VM ─────────────────────────────────────────────────────────────────
export function CreateVmModal({ onClose, run }: { onClose: () => void; run: RunAction }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [cpu, setCpu] = useState(2);
  const [ramGb, setRamGb] = useState(4);
  const [diskGb, setDiskGb] = useState(60);
  const [generation, setGeneration] = useState(2);
  const [switchName, setSwitchName] = useState('');
  const [saving, setSaving] = useState(false);

  const create = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      // vmId is ignored by the server for 'create'; pass '' as placeholder.
      await run('', 'create', {
        name: name.trim(),
        cpuCount: cpu,
        memoryStartupBytes: ramGb * (1024 ** 3),
        vhdSizeBytes: diskGb * (1024 ** 3),
        generation,
        switchName: switchName.trim() || undefined,
      });
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <ModalShell title={t('hyperv.createTitle') || 'New virtual machine'} icon={<Plus className="w-4 h-4 text-accent" />} onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className={labelCls}>{t('hyperv.col.name') || 'Name'}</label>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="WEB-01" className={inputCls} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>{t('hyperv.vcpu') || 'vCPU'}</label>
            <input type="number" min={1} max={256} value={cpu} onChange={(e) => setCpu(parseInt(e.target.value, 10) || 1)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>{t('hyperv.ramGb') || 'RAM (GB)'}</label>
            <input type="number" min={1} max={4096} value={ramGb} onChange={(e) => setRamGb(parseInt(e.target.value, 10) || 1)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>{t('hyperv.diskGb') || 'Disk (GB)'}</label>
            <input type="number" min={1} max={65536} value={diskGb} onChange={(e) => setDiskGb(parseInt(e.target.value, 10) || 1)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>{t('hyperv.generation') || 'Generation'}</label>
            <select value={generation} onChange={(e) => setGeneration(parseInt(e.target.value, 10))} className={inputCls}>
              <option value={2}>Gen 2 (UEFI)</option>
              <option value={1}>Gen 1 (BIOS)</option>
            </select>
          </div>
        </div>
        <div>
          <label className={labelCls}>{t('hyperv.switch') || 'Virtual switch (optional)'}</label>
          <input value={switchName} onChange={(e) => setSwitchName(e.target.value)} placeholder="Default Switch" className={inputCls} />
          <p className="text-[10px] text-text-muted mt-1">{t('hyperv.createNote') || 'A blank VHDX is created in the host’s default store. Attach an ISO / OS afterwards.'}</p>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-text-muted hover:text-text-primary">{t('common.cancel') || 'Cancel'}</button>
          <button onClick={create} disabled={saving || !name.trim()} className="px-3 py-1.5 text-xs bg-accent text-white rounded-lg hover:bg-accent/90 disabled:opacity-50">
            {saving ? '…' : (t('hyperv.create') || 'Create')}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

// ── Checkpoint manager ─────────────────────────────────────────────────────────
export function CheckpointModal({ vm, onClose, run }: { vm: VirtualMachine; onClose: () => void; run: RunAction }) {
  const { t } = useTranslation();
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const checkpoints = vm.checkpoints ?? [];

  const act = async (action: VmAction, checkpointName?: string) => {
    if (action === 'checkpoint_delete' && !confirm(t('hyperv.confirmCpDelete', { name: checkpointName }) || `Delete checkpoint "${checkpointName}"?`)) return;
    if (action === 'checkpoint_apply' && !confirm(t('hyperv.confirmCpApply', { name: checkpointName }) || `Restore VM to checkpoint "${checkpointName}"? Unsaved state since then is lost.`)) return;
    setBusy(checkpointName ?? '__create');
    try {
      await run(vm.vmId, action, checkpointName ? { checkpointName } : (newName ? { checkpointName: newName } : undefined));
      onClose(); // the action re-enumerates server-side; closing avoids a stale list
    } finally { setBusy(null); }
  };

  return (
    <ModalShell title={`${t('hyperv.checkpointsTitle') || 'Checkpoints'} — ${vm.name}`} icon={<Camera className="w-4 h-4 text-accent" />} onClose={onClose}>
      <div className="space-y-3">
        {/* Create */}
        <div className="flex gap-2">
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t('hyperv.checkpointNamePh') || 'New checkpoint name (optional)'} className={inputCls} />
          <button onClick={() => act('checkpoint_create')} disabled={busy === '__create'} className="shrink-0 px-3 py-2 text-xs bg-accent text-white rounded-lg hover:bg-accent/90 disabled:opacity-50 flex items-center gap-1.5">
            <Camera className="w-3.5 h-3.5" /> {t('hyperv.action.checkpoint') || 'Create'}
          </button>
        </div>

        {/* List */}
        {checkpoints.length === 0 ? (
          <p className="text-xs text-text-muted py-3 text-center">{t('hyperv.noCheckpoints') || 'No checkpoints.'}</p>
        ) : (
          <div className="rounded-lg bg-bg-tertiary/40 divide-y divide-border/40">
            {checkpoints.map((cp) => (
              <div key={cp.name} className="flex items-center gap-2 px-3 py-2">
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-text-primary truncate">{cp.name}</div>
                  {cp.createdAt && <div className="text-[10px] text-text-muted">{new Date(cp.createdAt).toLocaleString()}</div>}
                </div>
                <button
                  onClick={() => act('checkpoint_apply', cp.name)}
                  disabled={!!busy}
                  title={t('hyperv.applyCheckpoint') || 'Restore to this checkpoint'}
                  className={clsx('p-1.5 rounded text-blue-400 hover:bg-blue-400/10 disabled:opacity-40')}
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
                <button
                  onClick={() => act('checkpoint_delete', cp.name)}
                  disabled={!!busy}
                  title={t('hyperv.action.delete') || 'Delete'}
                  className="p-1.5 rounded text-red-400 hover:bg-red-400/10 disabled:opacity-40"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
        <p className="text-[10px] text-text-muted">{t('hyperv.checkpointNote') || 'Apply / delete may require 2FA depending on tenant restrictions. The list refreshes after the host re-enumerates.'}</p>
      </div>
    </ModalShell>
  );
}
