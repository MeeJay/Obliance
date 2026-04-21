import { useEffect, useState } from 'react';
import { TwoFactorPromptModal } from './TwoFactorPromptModal';
import { setTwoFactorListener } from '@/utils/twoFactorGate';

// Mount this ONCE at the app root. It registers a listener the axios
// response interceptor calls into when the server demands a fresh 2FA
// code. The modal is displayed; on submit the pending promise resolves
// with the code so axios can retry the original request.
//
// No props — this component is intentionally a singleton. Its lifecycle
// is tied to the signed-in app shell.

interface Pending {
  actionLabel: string;
  currentIp?: string;
  resolve: (result: { code: string; trustIp: boolean }) => void;
  reject: (err: Error) => void;
}

export function TwoFactorGate() {
  const [pending, setPending] = useState<Pending | null>(null);

  useEffect(() => {
    setTwoFactorListener((p) => setPending(p as Pending));
    return () => setTwoFactorListener(null);
  }, []);

  if (!pending) return null;

  return (
    <TwoFactorPromptModal
      actionLabel={pending.actionLabel}
      currentIp={pending.currentIp}
      onClose={() => {
        pending.reject(new Error('Two-factor verification cancelled'));
        setPending(null);
      }}
      onSubmit={async (code, { trustIp }) => {
        pending.resolve({ code, trustIp });
        setPending(null);
      }}
    />
  );
}
