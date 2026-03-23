import { useAuthStore } from '@/store/authStore';

/**
 * Returns true when the current user has anonymous mode enabled.
 * Safe to call outside React (reads store directly).
 */
export function isAnonymousMode(): boolean {
  return useAuthStore.getState().user?.preferences?.anonymousMode === true;
}

/**
 * Masks sensitive text for anonymous mode.
 * No-op when anonymous mode is off — returns the original text.
 *
 * Masking strategy:
 *  - Preserves the first char and length hint for readability
 *  - Short strings (≤3 chars): fully masked
 *  - Longer strings: first char + dots
 *
 * Examples:
 *  "srv-prod-01"  → "s••••••••••"
 *  "192.168.1.10" → "1••••••••••"
 *  "meejay"       → "m•••••"
 *  "PC"           → "••"
 */
export function anonymize(text: string | null | undefined): string {
  if (!text) return text ?? '';
  if (!isAnonymousMode()) return text;
  if (text.length <= 3) return '•'.repeat(text.length);
  return text[0] + '•'.repeat(text.length - 1);
}

/**
 * Masks an IP address.
 * "192.168.1.10" → "192.•••.•.••"
 * "2001:db8::1"  → "2001:•••::•"
 */
export function anonymizeIp(ip: string | null | undefined): string {
  if (!ip) return ip ?? '';
  if (!isAnonymousMode()) return ip;

  // IPv4
  if (ip.includes('.')) {
    const parts = ip.split('.');
    return parts[0] + '.' + parts.slice(1).map(p => '•'.repeat(p.length)).join('.');
  }
  // IPv6
  if (ip.includes(':')) {
    const parts = ip.split(':');
    return parts[0] + ':' + parts.slice(1).map(p => p ? '•'.repeat(p.length) : '').join(':');
  }
  return anonymize(ip);
}

/**
 * Masks a MAC address.
 * "00:11:22:33:44:55" → "00:••:••:••:••:••"
 */
export function anonymizeMac(mac: string | null | undefined): string {
  if (!mac) return mac ?? '';
  if (!isAnonymousMode()) return mac;
  const parts = mac.split(/[:-]/);
  const sep = mac.includes('-') ? '-' : ':';
  return parts[0] + sep + parts.slice(1).map(p => '•'.repeat(p.length)).join(sep);
}

/**
 * Masks a file path or URL.
 * "C:\Users\meejay\Documents" → "C:\•••••\••••••\•••••••••"
 * "/home/meejay/.ssh" → "/••••/••••••/••••"
 */
export function anonymizePath(path: string | null | undefined): string {
  if (!path) return path ?? '';
  if (!isAnonymousMode()) return path;
  const sep = path.includes('\\') ? '\\' : '/';
  const parts = path.split(sep);
  return parts[0] + sep + parts.slice(1).map(p => '•'.repeat(p.length)).join(sep);
}
