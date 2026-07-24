import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { config } from '../config';
import { logger } from '../utils/logger';

/**
 * Serves the static `smartctl` binary shipped in the server image to Linux
 * agents that lack smartmontools (see diskHealthProbes.ts). The binaries are
 * produced by the Linux build host (agent/build-linux.sh) into
 * agent/dist/tools/smartctl-linux-<arch> and land in the image via the existing
 * `COPY agent/dist/` layer — no Dockerfile change.
 *
 * Access is gated by a short-lived HMAC token minted by diskHealthCollector and
 * injected into the probe script, so the endpoint isn't an open file mirror.
 */

export type ToolArch = 'amd64' | 'arm64';
const ARCHES: ToolArch[] = ['amd64', 'arm64'];
const TOKEN_TTL_SECONDS = 3600;

// dist/src/services -> /app  ==  same 4-levels-up as agent.controller.ts
const TOOLS_DIR = path.resolve(__dirname, '../../../../agent/dist/tools');

const shaCache = new Map<ToolArch, string | null>();

function isArch(a: unknown): a is ToolArch {
  return a === 'amd64' || a === 'arm64';
}

function filePathFor(arch: ToolArch): string {
  return path.join(TOOLS_DIR, `smartctl-linux-${arch}`);
}

export const smartctlAsset = {
  isArch,

  /** Absolute path if the binary for this arch exists in the image, else null. */
  resolvePath(arch: ToolArch): string | null {
    const p = filePathFor(arch);
    try {
      return fs.existsSync(p) && fs.statSync(p).isFile() ? p : null;
    } catch {
      return null;
    }
  },

  /** sha256 (hex) of the arch binary, computed once and cached. null if absent. */
  sha256(arch: ToolArch): string | null {
    if (shaCache.has(arch)) return shaCache.get(arch) ?? null;
    let digest: string | null = null;
    const p = this.resolvePath(arch);
    if (p) {
      try {
        digest = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
      } catch (err) {
        logger.error(err, `smartctlAsset: failed to hash ${p}`);
      }
    }
    shaCache.set(arch, digest);
    return digest;
  },

  /** True if at least one arch binary is available to serve. */
  anyAvailable(): boolean {
    return ARCHES.some((a) => this.resolvePath(a) !== null);
  },

  // ── HMAC token bound to a device, valid TOKEN_TTL_SECONDS ──────────────────
  signToken(deviceId: number): string {
    const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
    const payload = `${deviceId}.${exp}`;
    const sig = crypto.createHmac('sha256', config.sessionSecret).update(payload).digest('hex');
    return `${payload}.${sig}`;
  },

  verifyToken(token: string | undefined): boolean {
    if (!token || typeof token !== 'string') return false;
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const [dev, exp, sig] = parts;
    if (!/^\d+$/.test(dev) || !/^\d+$/.test(exp)) return false;
    if (Number(exp) < Math.floor(Date.now() / 1000)) return false;
    const expected = crypto.createHmac('sha256', config.sessionSecret).update(`${dev}.${exp}`).digest('hex');
    try {
      return sig.length === expected.length &&
        crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    } catch {
      return false;
    }
  },
};
