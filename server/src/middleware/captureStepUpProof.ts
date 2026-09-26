import type { Request, Response, NextFunction } from 'express';

// P5 (docs/mobile/device-bound-2fa.md §6.0): step-up PROOFS never travel
// with the business body.
//
// Clients (web interceptor, Android app 0.3.x) replay the original JSON body
// with the proof fields added (`twoFactorCode`, `trustIp`, and later
// `stepUpPassword`, `deviceAssertion`, `deviceBulkId`). Left in req.body they
// were (a) stripped by validate() before the envelope could read them (users,
// teams, profile routes: the code was never seen), and (b) copied into
// approval payloads, error logs (`body: req.body`) and `...req.body` inserts.
//
// Mounted in app.ts right after express.json() and the session, before any
// router: when req.body is a plain object, the proof fields are MOVED to
// req.stepUpProof and deleted from the body. Every reader (checkSecondFactor
// in services/deviceKey/stepUpProof.ts) reads req.stepUpProof only.
// validate.ts is untouched.

export interface StepUpProof {
  /** TOTP code as typed (trimmed string). */
  twoFactorCode?: string;
  /** Explicit "trust this IP" opt-in; honoured only when `=== true`. */
  trustIp?: boolean;
  /** Password fallback in a device-bound session (later lot). */
  stepUpPassword?: string;
  /** Device-key assertion (later lot) — raw, validated by its reader. */
  deviceAssertion?: unknown;
  /** Bulk step-up id (later lot) — raw, validated by its reader. */
  deviceBulkId?: unknown;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      stepUpProof?: StepUpProof;
    }
  }
}

export const STEP_UP_PROOF_FIELDS = ['twoFactorCode', 'trustIp', 'stepUpPassword', 'deviceAssertion', 'deviceBulkId'] as const;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

export function captureStepUpProof(req: Request, _res: Response, next: NextFunction): void {
  const proof: StepUpProof = {};
  const body = req.body as unknown;
  if (isPlainObject(body)) {
    for (const key of STEP_UP_PROOF_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
      const v = body[key];
      delete body[key];
      switch (key) {
        case 'twoFactorCode':
          // The app and the web send a string; tolerate a JSON number.
          if (typeof v === 'string' || typeof v === 'number') {
            const s = String(v).trim();
            if (s) proof.twoFactorCode = s.slice(0, 32);
          }
          break;
        case 'trustIp':
          proof.trustIp = v === true;
          break;
        case 'stepUpPassword':
          if (typeof v === 'string' && v.length > 0) proof.stepUpPassword = v.slice(0, 1024);
          break;
        case 'deviceAssertion':
          proof.deviceAssertion = v;
          break;
        case 'deviceBulkId':
          proof.deviceBulkId = v;
          break;
      }
    }
  }
  req.stepUpProof = proof;
  next();
}
