// Module-level event bridge between the axios response interceptor (which
// lives outside the React tree) and the <TwoFactorGate> component (which
// owns the modal UI). A single listener is registered at app mount; axios
// calls `awaitTwoFactorCode` when the server responds with 401
// twoFactorRequired, the gate pops the modal, and the listener resolves
// the promise with the code the user typed.

export interface TwoFactorCodeResult { code: string; trustIp: boolean }

/** Optional hints from the 401 body (older servers send none of them). */
export interface TwoFactorPromptHints {
  /** `false` when the server will neither honour nor grant an IP trust for
   *  this action (e.g. SSH key / SSH button, TOTP management): the "Trust
   *  this IP" box is hidden. Absent = shown, as before. */
  trustIpAllowed?: boolean;
  /** The action needs a code never used before (not the sign-in code). */
  codeMustBeNew?: boolean;
  /** 'password': the server asks the CURRENT PASSWORD (401 passwordRequired,
   *  account without a code to give); the result's `code` is the password. */
  mode?: 'code' | 'password';
}

interface Pending extends TwoFactorPromptHints {
  actionLabel: string;
  currentIp?: string;
  resolve: (result: TwoFactorCodeResult) => void;
  reject: (err: Error) => void;
}

type Listener = (pending: Pending) => void;

let listener: Listener | null = null;

/** Rejection message when the user closes the prompt — callers can tell a
 *  cancellation from a failure with isTwoFactorCancelled(). */
export const TWO_FACTOR_CANCELLED = 'Two-factor verification cancelled';

export function isTwoFactorCancelled(err: unknown): boolean {
  return (err as { message?: unknown } | null)?.message === TWO_FACTOR_CANCELLED;
}

export function setTwoFactorListener(fn: Listener | null): void {
  listener = fn;
  if (fn) console.debug('[tfa-gate] listener registered');
  else console.debug('[tfa-gate] listener cleared');
}

export function awaitTwoFactorCode(actionLabel: string, currentIp?: string, hints: TwoFactorPromptHints = {}): Promise<TwoFactorCodeResult> {
  return new Promise((resolve, reject) => {
    if (!listener) {
      console.warn('[tfa-gate] awaitTwoFactorCode called but no listener is mounted');
      reject(new Error('Two-factor gate is not mounted. Did you forget <TwoFactorGate /> at app root?'));
      return;
    }
    console.debug('[tfa-gate] prompting for code —', actionLabel, 'ip:', currentIp || '(unknown)');
    listener({ actionLabel, currentIp, ...hints, resolve, reject });
  });
}
