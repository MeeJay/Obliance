import { db } from '../db';
import { logger } from '../utils/logger';
import { permissionService } from './permission.service';
import { toDbId } from '../utils/dbId';

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
 * `created_by`). Platform-admin-owned scenarios are unrestricted, as before
 * (also once that admin is deactivated: their automations keep running, like
 * when the account is deleted and the FK nulls the column).
 *
 * Only scenarios saved or enabled since this rule exists are checked (see
 * initScenarioAccountability): before it, enabling a scenario and saving its
 * graph did not record who did it, so the stored `updated_by` of an older row
 * may name someone else. Those rows run as before until someone saves or
 * enables them again — which records that person, after checking their rights.
 */

type ScenarioRef = { id: number; tenant_id: number };

export type ScenarioDenial = { capability: 'execute' | 'write'; deviceId: number };

export type ScenarioNodeLike = { type: string; config?: unknown };
const ACTING_TYPES = ['run_script', 'run_command', 'tag_device', 'move_device_to_group'];

async function devicesTouched(
  scenario: ScenarioRef,
  runDeviceIds: number[],
  onlyNodeId?: number,
  /** Nodes about to be saved (graph PUT); default: the stored graph. */
  pendingNodes?: ScenarioNodeLike[],
): Promise<{ execIds: number[]; writeIds: number[] }> {
  let nodes: ScenarioNodeLike[];
  if (pendingNodes) {
    nodes = pendingNodes.filter((n) => ACTING_TYPES.includes(n.type));
  } else {
    const nodesQ = db('scenario_nodes')
      .where({ scenario_id: scenario.id })
      .whereIn('type', ACTING_TYPES);
    if (onlyNodeId != null) nodesQ.where({ id: onlyNodeId });
    nodes = await nodesQ.select('id', 'type', 'config') as ScenarioNodeLike[];
  }

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
  pendingNodes?: ScenarioNodeLike[],
): Promise<ScenarioDenial | null> {
  // An id that is not a plain positive integer cannot be checked — and the
  // query that would run on it may read it differently (utils/dbId.ts).
  // Callers normalise first; anything left over is a denial, never a pass.
  for (const id of runDeviceIds) {
    if (toDbId(id) == null) return { capability: 'execute', deviceId: Number(id) };
  }
  const { execIds, writeIds } = await devicesTouched(scenario, runDeviceIds, onlyNodeId, pendingNodes);
  const lacking = await permissionService.devicesLackingCapability(userId, execIds, 'execute');
  if (lacking.length) return { capability: 'execute', deviceId: lacking[0] };
  for (const id of writeIds) {
    if (!(await permissionService.canWriteDevice(userId, id, false))) return { capability: 'write', deviceId: id };
  }
  return null;
}

// ── Accountability epoch ─────────────────────────────────────────────────────
// First boot of a version with the gate below, stored once in app_config.
// A scenario whose updated_at is older was last saved / enabled by code that
// did not record who did it: it is not checked (runs as before).
const EPOCH_KEY = 'scenario_accountability_since';
let epochMs: number | null = null;

/** Called at boot, before the HTTP server accepts requests (index.ts). */
export async function initScenarioAccountability(): Promise<void> {
  await db('app_config').insert({ key: EPOCH_KEY, value: new Date().toISOString() }).onConflict('key').ignore();
  const row = await db('app_config').where({ key: EPOCH_KEY }).first('value') as { value: string | null } | undefined;
  const parsed = Date.parse(row?.value ?? '');
  epochMs = Number.isFinite(parsed) ? parsed : Date.now();
}

// Automatic triggers fire on agent pushes: cache the verdicts briefly. The key
// includes updated_at, so any save or enable of the scenario invalidates it.
const VERDICT_TTL_MS = 60_000;
const verdicts = new Map<string, { denial: string | null; at: number }>();
const roles = new Map<number, { admin: boolean; active: boolean; username: string; at: number }>();

async function roleOf(userId: number): Promise<{ admin: boolean; active: boolean; username: string }> {
  const cached = roles.get(userId);
  if (cached && Date.now() - cached.at < VERDICT_TTL_MS) return cached;
  const row = await db('users').where({ id: userId }).first('role', 'is_active', 'username') as
    { role: string; is_active: boolean; username: string } | undefined;
  const value = { admin: row?.role === 'admin', active: !!row?.is_active, username: row?.username ?? `#${userId}`, at: Date.now() };
  roles.set(userId, value);
  return value;
}

/**
 * Gate of AUTOMATIC runs: why the accountable user of [scenario] may NOT make
 * it run on [deviceId], or null when the run is allowed. No accountable user
 * (legacy / system rows), a scenario last saved before the accountability
 * epoch, or a platform admin = allowed, like before; a deactivated non-admin =
 * refused.
 */
export async function accountableUserDenial(
  scenario: ScenarioRef & { updated_by?: number | null; created_by?: number | null; updated_at?: Date | string | null },
  deviceId: number,
): Promise<string | null> {
  const userId = scenario.updated_by ?? scenario.created_by ?? null;
  if (userId == null) return null;
  if (epochMs == null) await initScenarioAccountability();
  const stamp = scenario.updated_at ? new Date(scenario.updated_at).getTime() : 0;
  if (!(stamp >= (epochMs as number))) return null;

  const role = await roleOf(userId);
  if (role.admin) return null;

  const key = `${scenario.id}:${stamp}:${userId}:${deviceId}`;
  const hit = verdicts.get(key);
  if (hit && Date.now() - hit.at < VERDICT_TTL_MS) return hit.denial;

  let reason: string | null = null;
  let denial: ScenarioDenial | null = null;
  if (!role.active) {
    reason = `Not run: ${role.username}, the user accountable for this scenario (last to save or enable it), is deactivated. `
      + 'Someone allowed to run it on this device must enable it again.';
  } else {
    denial = await scenarioDenialFor(userId, scenario, [deviceId]);
    if (denial) {
      reason = `Not run: ${role.username}, the user accountable for this scenario (last to save or enable it), lacks `
        + `${denial.capability === 'execute' ? "the 'execute' capability" : 'write access'} on device #${denial.deviceId}. `
        + 'Grant it to their team, or have someone allowed on this device enable the scenario again.';
    }
  }
  if (verdicts.size > 10_000) verdicts.clear();
  verdicts.set(key, { denial: reason, at: Date.now() });
  if (reason) {
    logger.warn({ scenarioId: scenario.id, deviceId, userId, active: role.active, denial },
      'scenario run skipped: the user accountable for this scenario may not run it on the device');
  }
  return reason;
}

// A skipped automatic run is recorded in the scenario's run history, at most
// once per scenario and device per hour (metric triggers can fire on every
// push).
const SKIP_RECORD_INTERVAL_MS = 60 * 60 * 1000;
const skipRecordedAt = new Map<string, number>();
export function shouldRecordSkippedRun(scenarioId: number, deviceId: number): boolean {
  const key = `${scenarioId}:${deviceId}`;
  const last = skipRecordedAt.get(key);
  if (last != null && Date.now() - last < SKIP_RECORD_INTERVAL_MS) return false;
  if (skipRecordedAt.size > 20_000) skipRecordedAt.clear();
  skipRecordedAt.set(key, Date.now());
  return true;
}
