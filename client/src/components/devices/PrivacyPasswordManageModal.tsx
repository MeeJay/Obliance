import { useState, useEffect, useRef } from 'react';
import { ShieldCheck, Loader2, X, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { deviceApi } from '@/api/device.api';

type Mode = 'set' | 'change' | 'remove';

interface Props {
 deviceId: number;
 mode: Mode;
 onClose: () => void;
 onSuccess: (passwordSet: boolean) => void;
}

export function PrivacyPasswordManageModal({ deviceId, mode, onClose, onSuccess }: Props) {
 const [oldPassword, setOldPassword] = useState('');
 const [password, setPassword] = useState('');
 const [confirm, setConfirm] = useState('');
 const [ack, setAck] = useState(false);
 const [submitting, setSubmitting] = useState(false);
 const inputRef = useRef<HTMLInputElement>(null);

 useEffect(() => {
 setTimeout(() => inputRef.current?.focus(), 50);
 }, []);

 const title = mode === 'set' ? 'Set privacy password' : mode === 'change' ? 'Change privacy password' : 'Remove privacy password';

 const canSubmit = (() => {
 if (submitting) return false;
 if (mode === 'set') return password && password === confirm && ack;
 if (mode === 'change') return oldPassword && password && password === confirm;
 if (mode === 'remove') return password;
 return false;
 })();

 const handleSubmit = async (e?: React.FormEvent) => {
 e?.preventDefault();
 if (!canSubmit) return;
 setSubmitting(true);
 try {
 if (mode === 'set') {
 await deviceApi.setPrivacyPassword(deviceId, password);
 toast.success('Privacy password set');
 onSuccess(true);
 } else if (mode === 'change') {
 await deviceApi.changePrivacyPassword(deviceId, oldPassword, password);
 toast.success('Privacy password changed');
 onSuccess(true);
 } else {
 await deviceApi.removePrivacyPassword(deviceId, password);
 toast.success('Privacy password removed');
 onSuccess(false);
 }
 onClose();
 } catch (err: any) {
 const msg = err?.response?.data?.error || 'Operation failed';
 toast.error(msg);
 } finally {
 setSubmitting(false);
 }
 };

 return (
 <div
 className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm"
 onClick={() => !submitting && onClose()}
 >
 <div
 className="bg-bg-secondary rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
 onClick={(e) => e.stopPropagation()}
 >
 <div className="px-5 py-4 flex items-center gap-3">
 <div className="w-9 h-9 rounded-full bg-accent/15 border border-accent/30 flex items-center justify-center">
 <ShieldCheck className="w-4 h-4 text-accent" />
 </div>
 <div className="flex-1 min-w-0">
 <div className="text-sm font-semibold text-text-primary">{title}</div>
 <div className="text-xs text-text-muted">Privacy mode must be OFF on the device</div>
 </div>
 <button
 onClick={onClose}
 disabled={submitting}
 className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors disabled:opacity-50"
 >
 <X className="w-4 h-4" />
 </button>
 </div>

 <form onSubmit={handleSubmit} className="px-5 py-5 space-y-3">
 {mode === 'set' && (
 <div className="flex gap-2 p-3 rounded-lg border border-orange-400/30 bg-orange-400/5 text-xs text-orange-200">
 <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
 <div>
 This password is stored <strong>only on the device</strong>. Obliance cannot recover it.
 If you lose it, you will need local access to the machine to reset privacy mode.
 </div>
 </div>
 )}

 {mode === 'change' && (
 <input
 ref={inputRef}
 type="password"
 value={oldPassword}
 onChange={(e) => setOldPassword(e.target.value)}
 disabled={submitting}
 autoComplete="off"
 placeholder="Current password"
 className="w-full px-3 py-2.5 text-sm bg-bg-tertiary rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent transition-colors"
 />
 )}

 <input
 ref={mode === 'change' ? undefined : inputRef}
 type="password"
 value={password}
 onChange={(e) => setPassword(e.target.value)}
 disabled={submitting}
 autoComplete="off"
 placeholder={mode === 'remove' ? 'Current password' : mode === 'set' ? 'New password' : 'New password'}
 className="w-full px-3 py-2.5 text-sm bg-bg-tertiary rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent transition-colors"
 />

 {mode !== 'remove' && (
 <input
 type="password"
 value={confirm}
 onChange={(e) => setConfirm(e.target.value)}
 disabled={submitting}
 autoComplete="off"
 placeholder="Confirm new password"
 className="w-full px-3 py-2.5 text-sm bg-bg-tertiary rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent transition-colors"
 />
 )}
 {mode !== 'remove' && password && confirm && password !== confirm && (
 <p className="text-xs text-red-400">Passwords do not match</p>
 )}

 {mode === 'set' && (
 <label className="flex items-start gap-2 text-xs text-text-muted cursor-pointer">
 <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5" />
 <span>I understand this password cannot be recovered by Obliance.</span>
 </label>
 )}
 </form>

 <div className="px-5 py-3 bg-bg-tertiary/30 flex items-center justify-end gap-2">
 <button
 onClick={onClose}
 disabled={submitting}
 className="px-3 py-1.5 text-sm text-text-muted hover:text-text-primary rounded-md transition-colors"
 >
 Cancel
 </button>
 <button
 onClick={() => handleSubmit()}
 disabled={!canSubmit}
 className={`px-4 py-1.5 text-sm font-medium text-white rounded-md disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2 ${
 mode === 'remove' ? 'bg-red-500 hover:bg-red-500/90' : 'bg-accent hover:bg-accent/90'
 }`}
 >
 {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
 {mode === 'set' ? 'Set password' : mode === 'change' ? 'Change password' : 'Remove password'}
 </button>
 </div>
 </div>
 </div>
 );
}
