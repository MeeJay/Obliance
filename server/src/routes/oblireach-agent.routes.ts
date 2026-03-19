import { Router } from 'express';
import { agentAuth } from '../middleware/agentAuth';
import { db } from '../db';
import { logger } from '../utils/logger';

const router = Router();

/**
 * POST /api/oblireach/push
 *
 * Heartbeat endpoint for the Oblireach agent binary.
 * Authenticated with the same agent_api_keys as the Obliance agent.
 *
 * Body: { deviceUuid, hostname, os, arch, version }
 * Response: { status: "ok", command: { type, id, payload } | null }
 */
router.post('/push', agentAuth, async (req, res, next) => {
  try {
    const tenantId = req.agentTenantId!;
    const { deviceUuid, hostname, os, arch, version } = req.body as {
      deviceUuid?: string;
      hostname?: string;
      os?: string;
      arch?: string;
      version?: string;
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

    if (existing) {
      pendingCommand = existing.pending_command;

      await db('oblireach_devices')
        .where({ id: existing.id })
        .update({
          hostname,
          os,
          arch,
          version,
          last_seen_at: new Date(),
          // Clear pending command after we read it
          pending_command: null,
        });
    } else {
      await db('oblireach_devices').insert({
        tenant_id: tenantId,
        device_uuid: deviceUuid,
        hostname,
        os,
        arch,
        version,
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

/**
 * GET /oblireach/devices  (tenant-scoped — mounted separately in index.ts)
 * List all Oblireach devices for a tenant.
 */
import { Router as _Router } from 'express';
const devicesRouter = _Router();
devicesRouter.get('/', async (req, res, next) => {
  try {
    const tenantId = (req as any).tenantId as number;
    const rows = await db('oblireach_devices')
      .where({ tenant_id: tenantId })
      .orderBy('last_seen_at', 'desc');
    return res.json({ data: { items: rows } });
  } catch (err) {
    next(err);
  }
});
export { devicesRouter as obliReachDevicesRouter };
