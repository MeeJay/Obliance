import { lookup } from 'dns/promises';
import { isIP } from 'net';

// Reject any HTTP target that resolves to a private / loopback /
// link-local / metadata range. Used by webhook + geolocation +
// software-repo download paths so an admin (or compromised tenant
// admin) can't aim our outbound fetcher at internal services
// (Redis, Kubelet, AWS metadata 169.254.169.254, …).
//
// We resolve the hostname BEFORE the request fires and re-check the
// raw IP — `https://example.com` could otherwise CNAME-redirect onto
// an internal address. This is best-effort against an attacker who
// races DNS responses; for stronger isolation production should use
// an outbound HTTP proxy with allow-listed destinations.

const PRIVATE_V4_PREFIXES = [
  /^10\./,
  /^127\./,
  /^169\.254\./,           // link-local + AWS metadata
  /^192\.168\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./, // 172.16.0.0 – 172.31.255.255
  /^0\./,                  // 0.0.0.0/8
  /^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\./, // CGNAT 100.64.0.0/10
];

export function isPrivateIPv4(ip: string): boolean {
  return PRIVATE_V4_PREFIXES.some((re) => re.test(ip));
}

export function isPrivateIPv6(ip: string): boolean {
  const lc = ip.toLowerCase();
  // ::1 (loopback), fc00::/7 (ULA), fe80::/10 (link-local),
  // ::ffff:<v4> (mapped — re-check the v4 portion).
  if (lc === '::1') return true;
  if (lc.startsWith('fc') || lc.startsWith('fd')) return true;
  if (lc.startsWith('fe8') || lc.startsWith('fe9') || lc.startsWith('fea') || lc.startsWith('feb')) return true;
  const mapped = lc.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return false;
}

export async function assertPublicHttpUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Invalid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Refused non-HTTP scheme: ${url.protocol}`);
  }
  const hostname = url.hostname;
  // Localhost + literal IPs handled directly.
  if (hostname === 'localhost' || hostname === 'localhost.localdomain') {
    throw new Error('Refused private destination (localhost)');
  }
  const v = isIP(hostname);
  if (v === 4 && isPrivateIPv4(hostname)) throw new Error(`Refused private destination (${hostname})`);
  if (v === 6 && isPrivateIPv6(hostname)) throw new Error(`Refused private destination (${hostname})`);
  if (v === 0) {
    // DNS hostname — resolve and screen. `lookup` returns the OS
    // resolver's first answer; we screen ALL answers when available.
    try {
      const all = await lookup(hostname, { all: true });
      for (const a of all) {
        if (a.family === 4 && isPrivateIPv4(a.address)) throw new Error(`Refused private destination (${hostname} → ${a.address})`);
        if (a.family === 6 && isPrivateIPv6(a.address)) throw new Error(`Refused private destination (${hostname} → ${a.address})`);
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Refused')) throw err;
      throw new Error(`Could not resolve ${hostname}: ${(err as Error).message}`);
    }
  }
  return url;
}
