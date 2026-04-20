import type { AxiosError } from 'axios';

// Wraps a request function that may fail with a 401 { twoFactorRequired: true }.
// When that happens, the caller is expected to show a 2FA prompt and retry
// the same request with `twoFactorCode` attached. This utility encapsulates
// the "is this a 2FA-required error?" detection so callers only need a one
// liner:
//
//   try { await request(); }
//   catch (err) {
//     if (is2FARequired(err)) {
//       setPendingAction({ label, retry: (code) => request({ twoFactorCode: code }) });
//       setShow2FA(true);
//     } else throw err;
//   }

export function is2FARequired(err: unknown): boolean {
  const e = err as AxiosError<{ twoFactorRequired?: boolean }>;
  return e?.response?.status === 401 && !!e?.response?.data?.twoFactorRequired;
}
