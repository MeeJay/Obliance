import { Router } from 'express';
import { agentAuth } from '../middleware/agentAuth';
import { db } from '../db';
import { logger } from '../utils/logger';

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

    logger.debug({ deviceUuid, tenantId, version }, 'Oblireach agent push');

    return res.json({
      status: 'ok',
      command: pendingCommand ?? null,
    });
  } catch (err) {
    next(err);
  }
});

export default router;

// ── Devices listing router (tenant-scoped, mounted in index.ts) ──────────────

const devicesRouter = Router();

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

export { devicesRouter as obliReachDevicesRouter };
