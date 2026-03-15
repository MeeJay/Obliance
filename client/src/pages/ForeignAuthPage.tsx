/**
 * ForeignAuthPage — /auth/foreign
 *
 * Landing page for users arriving from another Obliance-family app via SSO.
 */

import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeftRight, Eye, EyeOff, Loader2, ShieldAlert, Shield } from 'lucide-react';
import { ssoApi } from '@/api/sso.api';
import { useAuthStore } from '@/store/authStore';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';

type Stage = 'loading' | 'link-required' | 'link-2fa' | 'set-password' | 'error';

export function ForeignAuthPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { checkSession } = useAuthStore();

  const token    = searchParams.get('token') ?? '';
  const from     = searchParams.get('from') ?? '';
  const redirect = searchParams.get('redirect') ?? '/';
  const source   = searchParams.get('source') ?? '';

  const [stage, setStage]               = useState<Stage>('loading');
  const [errorMsg, setErrorMsg]         = useState('');
  const [password, setPassword]         = useState('');
  const [confirm, setConfirm]           = useState('');
  const [pwError, setPwError]           = useState('');
  const [showPw, setShowPw]             = useState(false);
  const [saving, setSaving]             = useState(false);
  const [linkToken, setLinkToken]       = useState('');
  const [linkUsername, setLinkUsername] = useState('');
  const [linkPassword, setLinkPassword] = useState('');
  const [linkError, setLinkError]       = useState('');
  const [linking, setLinking]           = useState(false);
  const [mfaMethods, setMfaMethods]     = useState<{ totp: boolean; email: boolean }>({ totp: false, email: false });
  const [mfaMethod, setMfaMethod]       = useState<'totp' | 'email'>('totp');
  const [mfaCode, setMfaCode]           = useState('');
  const [mfaError, setMfaError]         = useState('');
  const [mfaVerifying, setMfaVerifying] = useState(false);
  const [mfaResending, setMfaResending] = useState(false);

  const sourceName = source
    ? source.charAt(0).toUpperCase() + source.slice(1)
    : (() => { try { return new URL(from).hostname; } catch { return 'external app'; } })();

  useEffect(() => {
    if (!token || !from) {
      setErrorMsg('Missing SSO parameters. Please try switching again.');
      setStage('error');
      return;
    }

    ssoApi.exchange(token, from)
      .then((data) => {
        if ('needsLinking' in data) {
          setLinkToken(data.linkToken);
          setLinkUsername(data.conflictingUsername);
          setStage('link-required');
        } else if (data.isFirstLogin) {
          setStage('set-password');
        } else {
          void finalize();
        }
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'SSO authentication failed';
        setErrorMsg(msg);
        setStage('error');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function finalize() {
    await checkSession();
    navigate(redirect, { replace: true });
  }

  async function handleSetPassword() {
    setPwError('');
    if (password.length < 8) { setPwError('Password must be at least 8 characters'); return; }
    if (password !== confirm) { setPwError('Passwords do not match'); return; }
    setSaving(true);
    try {
      await ssoApi.setLocalPassword(password);
    } catch {
      // Non-blocking
    } finally {
      setSaving(false);
    }
    void finalize();
  }

  async function handleLink() {
    setLinkError('');
    if (!linkPassword) { setLinkError('Password is required'); return; }
    setLinking(true);
    try {
      const data = await ssoApi.completeLink(linkToken, linkPassword);
      if ('requires2fa' in data) {
        setMfaMethods(data.methods);
        setMfaMethod(data.methods.totp ? 'totp' : 'email');
        setStage('link-2fa');
        return;
      }
      void finalize();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Linking failed';
      setLinkError(msg);
    } finally {
      setLinking(false);
    }
  }

  async function handleVerifyMfa() {
    setMfaError('');
    if (!mfaCode) { setMfaError('Code is required'); return; }
    setMfaVerifying(true);
    try {
      await ssoApi.verifyLink2fa(mfaCode, mfaMethod);
      void finalize();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Invalid code';
      setMfaError(msg);
    } finally {
      setMfaVerifying(false);
    }
  }

  async function handleResendMfa() {
    setMfaResending(true);
    try { await ssoApi.resendLink2faEmail(); } catch { /* silent */ }
    finally { setMfaResending(false); }
  }

  if (stage === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-primary p-4">
        <div className="w-full max-w-sm text-center space-y-6">
          <div className="flex items-center justify-center gap-2">
            <ArrowLeftRight size={28} className="text-accent" />
            <span className="text-xl font-semibold text-text-primary">SSO Connection</span>
          </div>
          <div className="space-y-3">
            <Loader2 size={36} className="animate-spin text-accent mx-auto" />
            <p className="text-sm text-text-secondary">Signing you in via {sourceName}&hellip;</p>
          </div>
        </div>
      </div>
    );
  }

  if (stage === 'link-required') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-primary p-4">
        <div className="w-full max-w-sm rounded-xl border border-border bg-bg-secondary p-8 space-y-5">
          <div className="text-center space-y-2">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-accent/10 border border-accent/30">
              <ArrowLeftRight size={22} className="text-accent" />
            </div>
            <h1 className="text-lg font-semibold text-text-primary">Link your accounts</h1>
            <p className="text-sm text-text-muted">
              An account <span className="font-medium text-text-secondary">{linkUsername}</span> already
              exists on Obliance. Enter your Obliance password to link it to your {sourceName} identity.
            </p>
          </div>
          <div className="space-y-3">
            <div className="relative">
              <Input
                label={`Obliance password for "${linkUsername}"`}
                type={showPw ? 'text' : 'password'}
                value={linkPassword}
                onChange={(e) => setLinkPassword(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleLink(); }}
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="absolute right-3 top-8 text-text-muted hover:text-text-primary"
              >
                {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            {linkError && <p className="text-xs text-status-down">{linkError}</p>}
          </div>
          <Button className="w-full" onClick={handleLink} disabled={linking || !linkPassword}>
            {linking ? 'Linking\u2026' : 'Link accounts'}
          </Button>
          <Button variant="secondary" className="w-full" onClick={() => navigate('/login', { replace: true })}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  if (stage === 'link-2fa') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-primary p-4">
        <div className="w-full max-w-sm rounded-xl border border-border bg-bg-secondary p-8 space-y-5">
          <div className="text-center space-y-2">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-accent/10 border border-accent/30">
              <Shield size={22} className="text-accent" />
            </div>
            <h1 className="text-lg font-semibold text-text-primary">Two-factor verification</h1>
            <p className="text-sm text-text-muted">
              Account <span className="font-medium text-text-secondary">{linkUsername}</span> has 2FA
              enabled. Enter the code to complete the link.
            </p>
          </div>

          {mfaMethods.totp && mfaMethods.email && (
            <div className="flex rounded-md border border-border overflow-hidden text-xs">
              <button
                type="button"
                onClick={() => { setMfaMethod('totp'); setMfaCode(''); setMfaError(''); }}
                className={`flex-1 py-1.5 transition-colors ${mfaMethod === 'totp' ? 'bg-accent/10 text-accent font-medium' : 'text-text-muted hover:text-text-primary'}`}
              >
                Authenticator app
              </button>
              <button
                type="button"
                onClick={() => { setMfaMethod('email'); setMfaCode(''); setMfaError(''); }}
                className={`flex-1 py-1.5 border-l border-border transition-colors ${mfaMethod === 'email' ? 'bg-accent/10 text-accent font-medium' : 'text-text-muted hover:text-text-primary'}`}
              >
                Email code
              </button>
            </div>
          )}

          <div className="space-y-2">
            <Input
              label={mfaMethod === 'totp' ? '6-digit TOTP code' : 'Code sent to your email'}
              type="text"
              inputMode="numeric"
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleVerifyMfa(); }}
              autoFocus
              className="tracking-widest text-center"
            />
            {mfaMethod === 'email' && (
              <button
                type="button"
                onClick={() => void handleResendMfa()}
                disabled={mfaResending}
                className="text-xs text-accent hover:text-accent/80 disabled:opacity-50"
              >
                {mfaResending ? 'Sending\u2026' : 'Resend code'}
              </button>
            )}
            {mfaError && <p className="text-xs text-status-down">{mfaError}</p>}
          </div>

          <Button className="w-full" onClick={handleVerifyMfa} disabled={mfaVerifying || mfaCode.length !== 6}>
            {mfaVerifying ? 'Verifying\u2026' : 'Verify & link accounts'}
          </Button>
          <Button variant="secondary" className="w-full" onClick={() => navigate('/login', { replace: true })}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  if (stage === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-primary p-4">
        <div className="w-full max-w-sm rounded-xl border border-border bg-bg-secondary p-8 text-center space-y-4">
          <ShieldAlert size={40} className="mx-auto text-status-down" />
          <h1 className="text-lg font-semibold text-text-primary">SSO Failed</h1>
          <p className="text-sm text-text-muted">{errorMsg}</p>
          <Button variant="secondary" onClick={() => navigate('/login', { replace: true })}>
            Back to Login
          </Button>
        </div>
      </div>
    );
  }

  // set-password stage
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-primary p-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-bg-secondary p-8 space-y-5">
        <div className="text-center space-y-2">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-accent/10 border border-accent/30">
            <ArrowLeftRight size={22} className="text-accent" />
          </div>
          <h1 className="text-lg font-semibold text-text-primary">Welcome to Obliance!</h1>
          <p className="text-sm text-text-muted">
            You signed in via <span className="font-medium text-text-secondary">{sourceName}</span>.
            Set a local password to also log in directly &mdash; or skip for now.
          </p>
        </div>

        <div className="space-y-3">
          <div className="relative">
            <Input
              label="Local password (optional)"
              type={showPw ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              autoFocus
            />
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              className="absolute right-3 top-8 text-text-muted hover:text-text-primary"
            >
              {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
          <Input
            label="Confirm password"
            type={showPw ? 'text' : 'password'}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Repeat your password"
          />
          {pwError && <p className="text-xs text-status-down">{pwError}</p>}
        </div>

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={() => void finalize()} disabled={saving}>
            Skip for now
          </Button>
          <Button className="flex-1" onClick={handleSetPassword} disabled={saving || !password}>
            {saving ? 'Saving\u2026' : 'Set password'}
          </Button>
        </div>
      </div>
    </div>
  );
}
