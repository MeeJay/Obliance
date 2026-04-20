import axios from 'axios';
import { awaitTwoFactorCode } from '@/utils/twoFactorGate';

// ObliTools (cross-site iframe / WebView2 shell): Chrome blocks all cookies for cross-site
// iframes, so we use X-Auth-Token header instead. The token = req.sessionID, stored in
// sessionStorage after login and sent on every request via the interceptor below.
export const isInObliTools = (() => {
  try { return window !== window.top; } catch { return true; }
})() || !!(window as unknown as { __obliview_is_native_app?: boolean }).__obliview_is_native_app;

export const OBLITOOLS_TOKEN_KEY = 'oblitools_auth_token';

const apiClient = axios.create({
  baseURL: '/api',
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor: inject X-Auth-Token header when running inside ObliTools.
apiClient.interceptors.request.use((config) => {
  if (isInObliTools) {
    const token = sessionStorage.getItem(OBLITOOLS_TOKEN_KEY);
    if (token) {
      config.headers['X-Auth-Token'] = token;
    }
  }
  return config;
});

// Response interceptor.
//
// Two roles:
//  1. 401 session expired        → redirect to /login (or clear ObliTools token).
//  2. 401 { twoFactorRequired }  → a restriction marked this action "sensitive".
//     Pop the TwoFactorGate modal, await the user's code, retry the original
//     request once with `twoFactorCode` injected into the JSON body. If the
//     retry fails (bad code), the error bubbles to the caller normally.
//
// The retry is guarded by `config._tfaRetried` so a bad code response
// doesn't loop back into the gate — the user sees a plain "Invalid 2FA
// code" error and can re-trigger the action from the UI.
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const status = error?.response?.status;
    const body = error?.response?.data;
    const config = error?.config ?? {};

    // ── Sensitive-action 2FA gate ──────────────────────────────────────────
    if (status === 401 && body?.twoFactorRequired && !(config as any)._tfaRetried) {
      // Diagnostic log — helps debug "modal didn't pop" scenarios.
      console.debug('[tfa-gate] server requested 2FA for', body?.action || '(unknown action)');
      try {
        const actionLabel = body?.action || 'Sensitive action';
        const code = await awaitTwoFactorCode(actionLabel);

        // Merge twoFactorCode into the request body so the server can verify.
        let payload: Record<string, unknown> = {};
        if (typeof config.data === 'string') {
          try { payload = JSON.parse(config.data) as Record<string, unknown>; } catch { payload = {}; }
        } else if (config.data && typeof config.data === 'object') {
          payload = { ...(config.data as object) };
        }
        payload.twoFactorCode = code;

        (config as any)._tfaRetried = true;
        config.data = JSON.stringify(payload);
        if (!config.headers) config.headers = {} as any;
        (config.headers as any)['Content-Type'] = 'application/json';
        return apiClient(config);
      } catch (cancelled) {
        console.warn('[tfa-gate] 2FA prompt rejected:', (cancelled as any)?.message);
        return Promise.reject(cancelled);
      }
    }

    // ── Plain 401 (session lost) ──────────────────────────────────────────
    // Only redirect to /login when the 401 is *not* an action-specific error
    // (bad 2FA code, missing TOTP config, invalid approval state, etc). Those
    // carry an `error` string in the body but no session-loss signal; if we
    // redirected here, a bad 2FA code would boot the user out of the app.
    const isActionError = status === 401 && body && typeof body === 'object' && typeof body.error === 'string';
    if (status === 401 && !isActionError && !(config as any)._tfaRetried) {
      if (isInObliTools) {
        sessionStorage.removeItem(OBLITOOLS_TOKEN_KEY);
      } else if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  },
);

export default apiClient;
