// Module-level event bridge between the axios response interceptor (which
// lives outside the React tree) and the <TwoFactorGate> component (which
// owns the modal UI). A single listener is registered at app mount; axios
// calls `awaitTwoFactorCode` when the server responds with 401
// twoFactorRequired, the gate pops the modal, and the listener resolves
// the promise with the code the user typed.

interface Pending {
  actionLabel: string;
  resolve: (code: string) => void;
  reject: (err: Error) => void;
}

type Listener = (pending: Pending) => void;

let listener: Listener | null = null;

export function setTwoFactorListener(fn: Listener | null): void {
  listener = fn;
  if (fn) console.debug('[tfa-gate] listener registered');
  else console.debug('[tfa-gate] listener cleared');
}

export function awaitTwoFactorCode(actionLabel: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!listener) {
      console.warn('[tfa-gate] awaitTwoFactorCode called but no listener is mounted');
      reject(new Error('Two-factor gate is not mounted. Did you forget <TwoFactorGate /> at app root?'));
      return;
    }
    console.debug('[tfa-gate] prompting for code —', actionLabel);
    listener({ actionLabel, resolve, reject });
  });
}
