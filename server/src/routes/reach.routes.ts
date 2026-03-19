import { Router } from 'express';
import { db } from '../db';
import { scriptService } from '../services/script.service';

const router = Router();

// ── Oblireach Desktop Client API ─────────────────────────────────────────────
// All routes require requireAuth + requireTenant (applied in index.ts).

const OR_ONLINE_THRESHOLD_MS = 2 * 60 * 1000;

/**
 * GET /reach/overview
 *
 * Returns all agent devices enriched with their Oblireach status, grouped by
 * device group. Used by the Oblireach desktop client device tree.
 *
 * Response:
 * {
 *   groups: Array<{
 *     id: number | null,   // null = ungrouped
 *     name: string,
 *     devices: Array<{
 *       id: number,
 *       uuid: string,
 *       hostname: string,
 *       status: string,
 *       osType: string,
 *       oblireach: {
 *         installed: boolean,
 *         online: boolean,
 *         sessions: ObliReachSession[],
 *       }
 *     }>
 *   }>
 * }
 */
router.get('/overview', async (req, res, next) => {
  try {
    const tenantId = req.tenantId!;

    // Fetch all agent devices for this tenant
    const devices = await db('agent_devices')
      .where({ tenant_id: tenantId })
      .orderBy('hostname');

    // Fetch all oblireach device records for this tenant
    const orRows = await db('oblireach_devices')
      .where({ tenant_id: tenantId });

    // Build a map: device_uuid → oblireach record
    const now = Date.now();
    const orMap = new Map<string, { online: boolean; sessions: any[] }>();
    for (const row of orRows) {
      orMap.set(row.device_uuid, {
        online: row.last_seen_at
          ? now - new Date(row.last_seen_at).getTime() < OR_ONLINE_THRESHOLD_MS
          : false,
        sessions: row.sessions ? JSON.parse(row.sessions) : [],
      });
    }

    // Fetch groups for the tenant
    const groups = await db('groups')
      .where({ tenant_id: tenantId })
      .orderBy('name');

    // Build group map
    const groupMap = new Map<number, { id: number; name: string; devices: any[] }>();
    for (const g of groups) {
      groupMap.set(g.id, { id: g.id, name: g.name, devices: [] });
    }

    const ungrouped: { id: number; name: string; devices: any[] } = {
      id: 0,
      name: 'Ungrouped',
      devices: [],
    };

    for (const dev of devices) {
      const or = orMap.get(dev.uuid);
      const enriched = {
        id: dev.id,
        uuid: dev.uuid,
        hostname: dev.hostname ?? dev.uuid,
        status: dev.status ?? 'unknown',
        osType: dev.os_type ?? 'unknown',
        oblireach: {
          installed: !!or,
          online: or?.online ?? false,
          sessions: or?.sessions ?? [],
        },
      };

      if (dev.group_id && groupMap.has(dev.group_id)) {
        groupMap.get(dev.group_id)!.devices.push(enriched);
      } else {
        ungrouped.devices.push(enriched);
      }
    }

    const result = [...groupMap.values()];
    if (ungrouped.devices.length > 0) {
      result.push(ungrouped);
    }

    // Sort each group's devices by hostname
    for (const g of result) {
      g.devices.sort((a, b) => a.hostname.localeCompare(b.hostname));
    }

    res.json({ data: { groups: result } });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /reach/scripts
 *
 * Returns all scripts marked as available_in_reach for the tenant.
 * Optionally filtered by platform.
 */
router.get('/scripts', async (req, res, next) => {
  try {
    const { platform } = req.query as { platform?: string };
    const scripts = await scriptService.getScripts(req.tenantId!, {
      platform: platform || undefined,
      availableInReach: true,
    });
    res.json({ data: { scripts } });
  } catch (err) {
    next(err);
  }
});

export default router;
