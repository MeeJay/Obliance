import { useTranslation } from 'react-i18next';
import { Copy, ExternalLink } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '@/components/common/Button';
import { useIsCoarsePointer } from '@/hooks/useMediaQuery';
import { openExternal } from '@/utils/openExternal';
import { copyText } from '@/utils/clipboard';

/**
 * Issuer used by the server when it builds the TOTP QR code
 * (server/src/services/twoFactor.service.ts → config.appName, default
 * "Obliance"). The generated codes only depend on the secret + SHA1/6/30,
 * so a different label never breaks verification — it only changes the
 * entry name shown in the authenticator app.
 */
const TOTP_ISSUER = 'Obliance';

/** otpauth:// URI equivalent to the QR code the server renders (SHA1, 6 digits, 30 s). */
export function buildTotpUri(secret: string, account?: string | null, issuer: string = TOTP_ISSUER): string {
  const label = account ? `${issuer}:${account}` : issuer;
  const params = new URLSearchParams({
    secret: secret.replace(/\s+/g, ''),
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}

/**
 * Touch-only helpers for TOTP enrolment (ProfilePage + EnrollmentPage): a
 * phone cannot scan its own screen, so offer "Open in authenticator app"
 * (otpauth:// → Android intent via the shell, OS handler in a browser) and
 * "Copy secret". Renders nothing with a mouse — the desktop flow (scan the
 * QR code) is unchanged.
 */
export function TotpMobileActions({
  secret,
  account,
  className,
}: {
  secret: string;
  account?: string | null;
  className?: string;
}) {
  const { t } = useTranslation();
  const coarse = useIsCoarsePointer();
  if (!coarse || !secret) return null;

  const openApp = async () => {
    const ok = await openExternal(buildTotpUri(secret, account));
    if (!ok) toast.error(t('profile.security.openAuthenticatorFailed', 'No authenticator app could be opened. Copy the secret instead.'));
  };

  const copySecret = async () => {
    const ok = await copyText(secret.replace(/\s+/g, ''));
    if (ok) toast.success(t('common.copied'));
    else toast.error(t('common.error'));
  };

  return (
    <div className={`flex flex-wrap gap-2 ${className ?? ''}`}>
      <Button type="button" size="sm" onClick={openApp} className="min-h-10">
        <ExternalLink size={14} className="mr-1.5" />
        {t('profile.security.openAuthenticator', 'Open in authenticator app')}
      </Button>
      <Button type="button" size="sm" variant="secondary" onClick={copySecret} className="min-h-10">
        <Copy size={14} className="mr-1.5" />
        {t('profile.security.copySecret', 'Copy secret')}
      </Button>
    </div>
  );
}
