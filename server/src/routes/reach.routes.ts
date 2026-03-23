import fs from 'fs';
import path from 'path';
import { Router } from 'express';
import { db } from '../db';
import { scriptService } from '../services/script.service';
import { oblireachHub } from '../services/oblireachHub.service';
import { permissionService } from '../services/permission.service';

const router = Router();

// ── Oblireach Desktop Client API ─────────────────────────────────────────────
// All routes require requireAuth + requireTenant (applied in index.ts).

const OR_ONLINE_THRESHOLD_MS = 2 * 60 * 1000;

// ── Version cache (shared with oblireach-agent.routes.ts logic) ──────────────
let _cachedLatestVersion: string | null = null;
let _cachedLatestVersionAt = 0;
const VERSION_TTL_MS = 60_000;

function getLatestObliReachVersion(): string | null {
  const now = Date.now();
  if (now - _cachedLatestVersionAt < VERSION_TTL_MS) return _cachedLatestVersion;
  try {
    const fp = path.resolve(__dirname, '../../../../agent/dist/oblireach-version.txt');
    _cachedLatestVersion = fs.readFileSync(fp, 'utf-8').trim() || null;
  } catch {
    _cachedLatestVersion = null;
  }
  _cachedLatestVersionAt = now;
  return _cachedLatestVersion;
}

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

    // Fetch all devices for this tenant
    const devices = await db('devices')
      .where({ tenant_id: tenantId })
      .orderBy('hostname');

    // Fetch all oblireach device records for this tenant
    const orRows = await db('oblireach_devices')
      .where({ tenant_id: tenantId });

    // Build a map: device_uuid → oblireach record
    const now = Date.now();
    const latestVersion = getLatestObliReachVersion();
    const orMap = new Map<string, { online: boolean; version: string | null; sessions: any[] }>();
    for (const row of orRows) {
      orMap.set(row.device_uuid, {
        online: oblireachHub.isConnected(row.device_uuid) || (row.last_seen_at
          ? now - new Date(row.last_seen_at).getTime() < OR_ONLINE_THRESHOLD_MS
          : false),
        version: row.version || null,
        sessions: row.sessions ? JSON.parse(row.sessions) : [],
      });
    }

    // Fetch groups for the tenant
    const groups = await db('device_groups')
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

    // Filter devices by user permissions
    let visibleDeviceIds: number[] | 'all' = 'all';
    if (req.session.role !== 'admin') {
      visibleDeviceIds = await permissionService.getVisibleDeviceIds(req.session.userId!, false) as number[] | 'all';
    }

    for (const dev of devices) {
      const or = orMap.get(dev.uuid);
      // Only include devices where the Oblireach agent has been installed
      if (!or) continue;
      // Permission filter
      if (visibleDeviceIds !== 'all' && !visibleDeviceIds.includes(dev.id)) continue;

      const enriched = {
        id: dev.id,
        uuid: dev.uuid,
        hostname: dev.display_name || dev.hostname,
        status: dev.status ?? 'unknown',
        osType: dev.os_type ?? 'unknown',
        oblireach: {
          installed: true,
          online: or.online,
          version: or.version,
          updateAvailable: !!(latestVersion && or.version && latestVersion !== or.version),
          sessions: or.sessions,
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
