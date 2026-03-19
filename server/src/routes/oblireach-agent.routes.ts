import fs from 'fs';
import path from 'path';
import { Router } from 'express';
import { agentAuth } from '../middleware/agentAuth';
import { db } from '../db';
import { logger } from '../utils/logger';

// ── Auto-update version check ─────────────────────────────────────────────────

// Cached latest version read from agent/dist/oblireach-version.txt
// Written by 000-Build-Agent.bat each time a new MSI is built.
let _cachedOrVersion: string | null | undefined;

function getLatestObliReachVersion(): string | null {
  if (_cachedOrVersion !== undefined) return _cachedOrVersion;
  try {
    const fp = path.join(process.cwd(), 'agent', 'dist', 'oblireach-version.txt');
    _cachedOrVersion = fs.readFileSync(fp, 'utf-8').trim() || null;
  } catch {
    _cachedOrVersion = null;
  }
  return _cachedOrVersion;
}

/** Returns true when `current` is strictly older than `latest` (semver x.y.z). */
function isOlderVersion(current: string, latest: string): boolean {
  const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number);
  const [cm, cmi, cp] = parse(current);
  const [lm, lmi, lp] = parse(latest);
  if (cm !== lm) return cm < lm;
  if (cmi !== lmi) return cmi < lmi;
  return cp < lp;
}

/** Download filename for a given OS/arch. */
function obliReachDownloadName(agentOS?: string, agentArch?: string): string {
  if (agentOS === 'windows') return 'oblireach-agent.msi';
  if (agentOS === 'darwin') return agentArch === 'arm64'
    ? 'oblireach-agent-darwin-arm64'
    : 'oblireach-agent-darwin-amd64';
  return 'oblireach-agent-linux-amd64';
}

// ── Agent push router (public, agentAuth) ────────────────────────────────────
const router = Router();

/**
 * POST /api/oblireach/push
 *
 * Heartbeat endpoint for the Oblireach agent binary.
 * Authenticated with the same agent_api_keys as the Obliance agent.
 *
 * Body: { deviceUuid, hostname, os, arch, version, sessions? }
 * Response: { status: "ok", command: { type, id, payload } | null }
 */
router.post('/push', agentAuth, async (req, res, next) => {
  try {
    const tenantId = req.agentTenantId!;
    const { deviceUuid, hostname, os, arch, version, sessions } = req.body as {
      deviceUuid?: string;
      hostname?: string;
      os?: string;
      arch?: string;
      version?: string;
      sessions?: Array<{
        id: number;
        username: string;
        state: string;
        stationName?: string;
        isConsole: boolean;
      }>;
    };

    if (!deviceUuid) {
      return res.status(400).json({ error: 'deviceUuid required' });
    }

    // Check feature flag
    const flag = await db('app_config').where({ key: 'integrated_oblireach_enabled' }).first();
    if (flag && flag.value === 'false') {
      return res.status(403).json({ error: 'Integrated Oblireach is disabled on this server' });
    }

    // Upsert the device record
    const existing = await db('oblireach_devices')
      .where({ device_uuid: deviceUuid, tenant_id: tenantId })
      .first();

    let pendingCommand = null;
    const sessionsJson = sessions ? JSON.stringify(sessions) : null;

    if (existing) {
      pendingCommand = existing.pending_command;
      await db('oblireach_devices')
        .where({ id: existing.id })
        .update({
          hostname,
          os,
          arch,
          version,
          sessions: sessionsJson,
          last_seen_at: new Date(),
          pending_command: null, // clear after reading
        });
    } else {
      await db('oblireach_devices').insert({
        tenant_id: tenantId,
        device_uuid: deviceUuid,
        hostname,
        os,
        arch,
        version,
        sessions: sessionsJson,
        last_seen_at: new Date(),
      });
    }

    // ── Auto-update injection ──────────────────────────────────────────────
    // If no pending command is queued and the agent is running an older version,
    // synthesise an update command so the agent installs the new MSI.
    if (!pendingCommand && version) {
      const latest = getLatestObliReachVersion();
      if (latest && isOlderVersion(version, latest)) {
        const filename = obliReachDownloadName(os, arch);
        pendingCommand = JSON.stringify({
          type: 'update',
          id: `auto_update_${Date.now()}`,
          payload: {
            version: latest,
            url: `/api/agent/download/${filename}`,
          },
        });
        logger.info({ deviceUuid, version, latest }, 'Oblireach agent update queued');
      }
    }

    logger.debug({ deviceUuid, tenantId, version }, 'Oblireach agent push');

    return res.json({
      status: 'ok',
      command: pendingCommand ? JSON.parse(pendingCommand) : null,
    });
  } catch (err) {
    next(err);
  }
});

export default router;

// ── Devices listing router (tenant-scoped, mounted in index.ts) ──────────────

const devicesRouter = Router();

/**
 * GET /latest-version  (mounted at /oblireach/devices in the tenant router)
 * Returns the latest available Oblireach agent version from the build artefact.
 * Registered before /:deviceUuid so the static segment wins.
 */
devicesRouter.get('/latest-version', (_req, res) => {
  const version = getLatestObliReachVersion();
  return res.json({ data: { version } });
});

/**
 * GET /  (mounted at /oblireach/devices in the tenant router)
 * List all Oblireach devices for a tenant.
 */
// Oblireach agent pushes every 30 s — consider it online if seen within 2 minutes.
const OR_ONLINE_THRESHOLD_MS = 2 * 60 * 1000;

devicesRouter.get('/', async (req, res, next) => {
  try {
    const tenantId = (req as any).tenantId as number;
    const rows = await db('oblireach_devices')
      .where({ tenant_id: tenantId })
      .orderBy('last_seen_at', 'desc');
    const now = Date.now();
    const items = rows.map((r: any) => ({
      ...r,
      sessions: r.sessions ? JSON.parse(r.sessions) : [],
      is_online: r.last_seen_at
        ? now - new Date(r.last_seen_at).getTime() < OR_ONLINE_THRESHOLD_MS
        : false,
    }));
    return res.json({ data: { items } });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /:deviceUuid/sessions  (mounted at /oblireach/devices in the tenant router)
 * Returns the last-known session list for a specific Oblireach device.
 */
devicesRouter.get('/:deviceUuid/sessions', async (req, res, next) => {
  try {
    const tenantId = (req as any).tenantId as number;
    const { deviceUuid } = req.params;
    const row = await db('oblireach_devices')
      .where({ tenant_id: tenantId, device_uuid: deviceUuid })
      .first();
    if (!row) {
      return res.status(404).json({ error: 'device not found' });
    }
    const sessions = row.sessions ? JSON.parse(row.sessions) : [];
    return res.json({ data: { sessions } });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /:deviceUuid  (mounted at /oblireach/devices in the tenant router)
 * Returns the device record for a specific Oblireach device (version, os, arch, …).
 */
devicesRouter.get('/:deviceUuid', async (req, res, next) => {
  try {
    const tenantId = (req as any).tenantId as number;
    const { deviceUuid } = req.params;
    const row = await db('oblireach_devices')
      .where({ tenant_id: tenantId, device_uuid: deviceUuid })
      .first();
    if (!row) return res.status(404).json({ error: 'device not found' });
    const now = Date.now();
    return res.json({
      data: {
        device: {
          ...row,
          sessions: row.sessions ? JSON.parse(row.sessions) : [],
          is_online: row.last_seen_at
            ? now - new Date(row.last_seen_at).getTime() < OR_ONLINE_THRESHOLD_MS
            : false,
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /:deviceUuid/command  (mounted at /oblireach/devices in the tenant router)
 * Queues a command (currently only `update`) for a specific Oblireach device.
 * Delivered on the device's next push heartbeat, then cleared.
 */
devicesRouter.post('/:deviceUuid/command', async (req, res, next) => {
  try {
    const tenantId = (req as any).tenantId as number;
    const { deviceUuid } = req.params;
    const { type } = req.body as { type: string };

    if (type !== 'update') {
      return res.status(400).json({ error: `unsupported command type: ${type}` });
    }

    const row = await db('oblireach_devices')
      .where({ tenant_id: tenantId, device_uuid: deviceUuid })
      .first();
    if (!row) return res.status(404).json({ error: 'device not found' });

    const latest = getLatestObliReachVersion();
    const filename = obliReachDownloadName(row.os, row.arch);
    const command = JSON.stringify({
      type: 'update',
      id: `manual_update_${Date.now()}`,
      payload: {
        version: latest ?? 'latest',
        url: `/api/agent/download/${filename}`,
      },
    });

    await db('oblireach_devices')
      .where({ id: row.id })
      .update({ pending_command: command });

    logger.info({ deviceUuid, tenantId, latest }, 'Oblireach update command queued manually');
    return res.json({ status: 'ok' });
  } catch (err) {
    next(err);
  }
});

export { devicesRouter as obliReachDevicesRouter };
