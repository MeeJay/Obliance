// TRUSTED_PROXIES may come from .env: load it before reading process.env.
import '../env';
import { BlockList, isIP } from 'net';
import type { IncomingMessage } from 'http';

/**
 * The one way to know a client's IP (audit, "trust this IP" 2FA window, SSH
 * button whitelist, rate limits, agent address).
 *
 * `X-Forwarded-For` is a list the CLIENT can pre-fill: only the entries added
 * by proxies we trust are meaningful. Like Express's `trust proxy`, the list
 * is walked from the right (closest hop first) and the first address that is
 * NOT a trusted proxy is the client. Taking the first (left-most) value, as
 * this server used to, lets anyone with a stolen session claim a "trusted" IP.
 *
 * Trusted proxies: env TRUSTED_PROXIES, comma-separated IPs, CIDRs or the
 * keywords loopback, linklocal, uniquelocal. Default "loopback, 172.16.0.0/12":
 * the client container's nginx and a reverse proxy (e.g. Nginx Proxy Manager)
 * running in Docker on the same host. A reverse proxy elsewhere on the LAN
 * must be added (e.g. TRUSTED_PROXIES="loopback, 172.16.0.0/12, 192.168.1.10").
 * Avoid "uniquelocal" when LAN clients reach the proxy directly: a LAN client
 * would then be treated as a proxy and could forge its address.
 */
export const DEFAULT_TRUSTED_PROXIES = 'loopback, 172.16.0.0/12';

const KEYWORDS: Record<string, string[]> = {
  loopback: ['127.0.0.0/8', '::1/128'],
  linklocal: ['169.254.0.0/16', 'fe80::/10'],
  uniquelocal: ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', 'fc00::/7'],
};

/** Strips the IPv4-mapped IPv6 prefix and an IPv6 zone id. */
export function normalizeIp(raw: string | undefined | null): string {
  const s = (raw ?? '').trim().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '');
  return s.replace(/%.*$/, '');
}

export function compileTrustedProxies(spec: string): (addr: string) => boolean {
  const list = new BlockList();
  const entries = spec.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  for (const entry of entries.flatMap((e) => KEYWORDS[e] ?? [e])) {
    const [ip, bitsText] = entry.split('/');
    const family = isIP(ip);
    if (!family) throw new Error(`TRUSTED_PROXIES: invalid entry "${entry}"`);
    const type = family === 4 ? 'ipv4' : 'ipv6';
    if (bitsText === undefined) {
      list.addAddress(ip, type);
    } else {
      const bits = Number(bitsText);
      if (!Number.isInteger(bits) || bits < 0 || bits > (family === 4 ? 32 : 128)) {
        throw new Error(`TRUSTED_PROXIES: invalid prefix in "${entry}"`);
      }
      list.addSubnet(ip, bits, type);
    }
  }
  return (addr: string) => {
    const ip = normalizeIp(addr);
    const family = isIP(ip);
    return family !== 0 && list.check(ip, family === 4 ? 'ipv4' : 'ipv6');
  };
}

/** Trust function of this process (also given to Express `trust proxy`). */
export const isTrustedProxy = compileTrustedProxies(process.env.TRUSTED_PROXIES || DEFAULT_TRUSTED_PROXIES);

/**
 * Client IP of an HTTP request or WebSocket upgrade: the socket address, then
 * X-Forwarded-For from right to left while the current hop is a trusted
 * proxy. A malformed entry stops the walk at the last valid address.
 */
export function resolveClientIp(
  socketAddress: string | undefined,
  forwardedFor: string | string[] | undefined,
  trusted: (addr: string) => boolean = isTrustedProxy,
): string {
  let current = normalizeIp(socketAddress);
  const header = Array.isArray(forwardedFor) ? forwardedFor.join(',') : forwardedFor ?? '';
  const hops = header.split(',').map(normalizeIp).filter((h) => h.length > 0);
  while (current && trusted(current) && hops.length > 0) {
    const next = hops.pop()!;
    if (!isIP(next)) break;
    current = next;
  }
  return current;
}

export function clientIp(req: IncomingMessage): string {
  return resolveClientIp(req.socket?.remoteAddress, req.headers['x-forwarded-for']);
}
