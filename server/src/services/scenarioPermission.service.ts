import { db } from '../db';
import { logger } from '../utils/logger';
import { permissionService } from './permission.service';

/**
 * Who may make a scenario run where.
 *
 * A scenario executes scripts / commands on devices, so a non-admin needs the
 * team `execute` capability on every device a run_script / run_command node
 * will hit (the run device, plus node-level override lists), and rw on the
 * override targets of tag_device / move_device_to_group — the same gate as
 * POST /api/scripts/:id/execute. The tenant capability `scripts.execute`
 * (route guard) is not a device scope.
 *
 * Manual runs are checked against the requesting user (routes). Automatic runs
 * (triggers, cron) are checked at run start against the ACCOUNTABLE user: the
 * last person who saved or enabled the scenario (`updated_by`, else
 * `created_by`). Admin-owned scenarios are unrestricted, as before.
 */

type ScenarioRef = { id: number; tenant_id: number };

export type ScenarioDenial = { capability: 'execute' | 'write'; deviceId: number };

async function devicesTouched(
  scenario: ScenarioRef,
  runDeviceIds: number[],
  onlyNodeId?: number,
): Promise<{ execIds: number[]; writeIds: number[] }> {
  const nodesQ = db('scenario_nodes')
    .where({ scenario_id: scenario.id })
    .whereIn('type', ['run_script', 'run_command', 'tag_device', 'move_device_to_group']);
  if (onlyNodeId != null) nodesQ.where({ id: onlyNodeId });
  const nodes = await nodesQ.select('id', 'type', 'config') as Array<{ id: number; type: string; config: unknown }>;

  const execIds = new Set<number>(runDeviceIds);
  const writeIds = new Set<number>();
  for (const node of nodes) {
    const cfg = (typeof node.config === 'string' ? JSON.parse(node.config) : node.config) as
      { targetMode?: string; targetDeviceIds?: unknown } | null;
    if (cfg?.targetMode !== 'devices' || !Array.isArray(cfg.targetDeviceIds)) continue;
    const ids = cfg.targetDeviceIds.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0);
    // Only ids the engine would actually act on (validateTargetsInTenant
    // drops stale / foreign ids at run time).
    const live: number[] = ids.length
      ? await db('devices').whereIn('id', ids).where({ tenant_id: scenario.tenant_id }).pluck('id')
      : [];
    const bucket = node.type === 'run_script' || node.type === 'run_command' ? execIds : writeIds;
    for (const id of live) bucket.add(Number(id));
  }
  return { execIds: [...execIds], writeIds: [...writeIds] };
}

/** First device the (non-admin) user may not act on, or null when all are allowed. */
export async function scenarioDenialFor(
  userId: number,
  scenario: ScenarioRef,
  runDeviceIds: number[],
  onlyNodeId?: number,
): Promise<ScenarioDenial | null> {
  const { execIds, writeIds } = await devicesTouched(scenario, runDeviceIds, onlyNodeId);
  const lacking = await permissionService.devicesLackingCapability(userId, execIds, 'execute');
  if (lacking.length) return { capability: 'execute', deviceId: lacking[0] };
  for (const id of writeIds) {
    if (!(await permissionService.canWriteDevice(userId, id, false))) return { capability: 'write', deviceId: id };
  }
  return null;
}

// Automatic triggers fire on agent pushes: cache the verdicts briefly. The key
// includes updated_at, so any save or enable of the scenario invalidates it.
const VERDICT_TTL_MS = 60_000;
const verdicts = new Map<string, { ok: boolean; at: number }>();
const roles = new Map<number, { admin: boolean; active: boolean; at: number }>();

async function roleOf(userId: number): Promise<{ admin: boolean; active: boolean }> {
  const cached = roles.get(userId);
  if (cached && Date.now() - cached.at < VERDICT_TTL_MS) return cached;
  const row = await db('users').where({ id: userId }).first('role', 'is_active') as { role: string; is_active: boolean } | undefined;
  const value = { admin: row?.role === 'admin', active: !!row?.is_active, at: Date.now() };
  roles.set(userId, value);
  return value;
}

/**
 * Gate of AUTOMATIC runs: may the accountable user of [scenario] make it run
 * on [deviceId]? No accountable user (legacy / system rows) = allowed, like
 * before; a deactivated accountable non-admin = refused.
 */
export async function accountableUserMayRun(
  scenario: ScenarioRef & { updated_by?: number | null; created_by?: number | null; updated_at?: Date | string | null },
  deviceId: number,
): Promise<boolean> {
  const userId = scenario.updated_by ?? scenario.created_by ?? null;
  if (userId == null) return true;
  const role = await roleOf(userId);
  if (role.admin && role.active) return true;
  if (!role.active) return false;

  const stamp = scenario.updated_at ? new Date(scenario.updated_at).getTime() : 0;
  const key = `${scenario.id}:${stamp}:${userId}:${deviceId}`;
  const hit = verdicts.get(key);
  if (hit && Date.now() - hit.at < VERDICT_TTL_MS) return hit.ok;

  const denial = await scenarioDenialFor(userId, scenario, [deviceId]);
  const ok = denial == null;
  if (verdicts.size > 10_000) verdicts.clear();
  verdicts.set(key, { ok, at: Date.now() });
  if (!ok) {
    logger.warn({ scenarioId: scenario.id, deviceId, userId, denial },
      'scenario run skipped: the user accountable for this scenario lacks the capability on the device');
  }
  return ok;
}
