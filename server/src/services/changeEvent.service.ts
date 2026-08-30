import type { Knex } from 'knex';
import { z } from 'zod';
import { db } from '../db';
import { isMasterTenant } from '@obliance/shared';
import { logger } from '../utils/logger';

/**
 * Change-event timeline — "what changed on this device, when, and who did it".
 *
 * Sibling of `rewind.service.ts` (same guard, same tenant-scoping rules, same
 * route family). Rewind answers "what did the machine LOOK like at T"; this
 * answers "what was DONE to the machine around T", so an incident can be
 * correlated with the change that caused it (Oblidesk's Blame Ribbon).
 *
 * ── Endpoints (registered in `routes/device.routes.ts`) ──────────────────────
 *
 *   GET /api/devices/:id/change-events?from=<iso>&to=<iso>&kinds=<csv>&limit=<n>
 *     → { data: { formatVersion, deviceId, from, to, order, kinds, limit,
 *                 truncated, count, events: ChangeEvent[] } }
 *
 *   GET /api/devices/:id/change-events/summary?from=<iso>&to=<iso>
 *     → { data: { formatVersion, deviceId, from, to, kinds, total,
 *                 counts: Record<ChangeEventKind, number> } }
 *
 *   Guard: `requireDeviceRead()` — identical to the /rewind/* routes.
 *   `from`/`to` accept ISO-8601 or epoch-ms. Defaults: to = now, from = to-24h.
 *   Window is capped at 30 days and the list at 2000 rows; hitting the row cap
 *   sets `truncated: true` and drops the OLDEST events (the ribbon cares about
 *   what happened closest to the incident), never silently.
 *   Events are returned NEWEST FIRST (`order: 'desc'`), like every other
 *   listing in this codebase.
 *
 * ── Read-through union, no new storage ──────────────────────────────────────
 * Nothing is ingested, backfilled or denormalised: every kind is a live read
 * over the table that already owns that fact.
 *
 *   patch_deployed     device_updates (installed_at) + command_queue
 *                      (install_update/install_updates that FAILED — a failed
 *                      install nulls installed_at, so it has no timestamp of
 *                      its own in device_updates)
 *   script_run         script_executions WHERE schedule_id IS NULL
 *   schedule_run       script_executions WHERE schedule_id IS NOT NULL
 *   scenario_run       scenario_runs
 *   compliance_drift   compliance_results (rows with >=1 fail/error rule)
 *   agent_upgraded     command_queue (update_agent)
 *   remote_session     remote_sessions
 *   config_change      audit_logs                      ← ADMIN ONLY, see below
 *   schedule_run       script_executions (see above)
 *   reboot             command_queue (reboot) + devices.last_reboot_at
 *   software_installed command_queue (install_software)
 *   software_removed   command_queue (uninstall_software)
 *
 * ── Permissions ─────────────────────────────────────────────────────────────
 * `requireDeviceRead()` is necessary but not sufficient: two sources are
 * protected more tightly elsewhere and MUST NOT become readable here.
 *   - `audit_logs` is admin-only (`routes/audit.routes.ts` mounts
 *     `requireRole('admin')` on the whole router), so `config_change` is
 *     dropped for non-admins.
 *   - `remote_sessions` hides other users' sessions from plain users
 *     (`remoteService.getSessions`), so non-admins only see sessions they
 *     started.
 * The kinds actually served are echoed back in `kinds` so the caller can tell
 * "no events" apart from "not allowed to see that kind".
 *
 * ── formatVersion ───────────────────────────────────────────────────────────
 * Currently 1. Per CLAUDE.md, never change the exported shape silently — bump
 * `FORMAT_VERSION` below (and tell Oblidesk) when a field is renamed, removed
 * or restructured. `title`/`detail` are English fallbacks: consumers should
 * localise from `kind` + `payload`, which are the stable machine-readable part.
 */

const FORMAT_VERSION = 1 as const;

export const CHANGE_EVENT_KINDS = [
  'patch_deployed',
  'script_run',
  'scenario_run',
  'compliance_drift',
  'agent_upgraded',
  'remote_session',
  'config_change',
  'schedule_run',
  'reboot',
  'software_installed',
  'software_removed',
] as const;

export type ChangeEventKind = (typeof CHANGE_EVENT_KINDS)[number];
export type ChangeEventActorType = 'user' | 'schedule' | 'scenario' | 'agent' | 'api' | 'system';
export type ChangeEventSeverityHint = 'info' | 'low' | 'medium' | 'high' | 'critical';

export interface ChangeEvent {
  id: string;
  kind: ChangeEventKind;
  at: string;
  title: string;
  detail: string | null;
  actor: string | null;
  actorType: ChangeEventActorType;
  severityHint: ChangeEventSeverityHint;
  resourceType: string | null;
  resourceId: string | null;
  resourcePath: string | null;
  payload: Record<string, unknown>;
}

const MAX_WINDOW_DAYS = 30;
const MAX_WINDOW_MS = MAX_WINDOW_DAYS * 24 * 60 * 60 * 1000;
const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;

/** Command rows that actually reached the agent. 'pending' never ran and
 *  'cancelled' was pulled before delivery — neither changed the machine. */
const DELIVERED_COMMAND_STATUSES = ['sent', 'ack_running', 'success', 'failure', 'timeout'];

/** audit_logs actions that another kind already sources from its own table —
 *  listing them under config_change too would double-count the same change. */
const AUDIT_ACTIONS_OWNED_ELSEWHERE = [
  'command.reboot',
  'command.update_agent',
  'command.install_update',
  'command.install_updates',
  'command.install_software',
  'command.uninstall_software',
  'command.run_script',
  'remote.session_ended',
];

// ── Query helpers ────────────────────────────────────────────────────────────

/** Tenant-scoped base query on an aliased device-owned table. Master tenant
 *  (id=1) is the god view and keeps the device filter only — same rule as
 *  rewind.service.scope(). */
function scope(table: string, alias: string, deviceId: number, tenantId: number): Knex.QueryBuilder {
  const q = db(`${table} as ${alias}`).where(`${alias}.device_id`, deviceId);
  if (!isMasterTenant(tenantId)) q.where(`${alias}.tenant_id`, tenantId);
  return q;
}

/** Event instant of a command_queue row: when it finished, else the furthest
 *  point it reached. Used both as the window predicate and as `at`. */
const CMD_AT = 'COALESCE(c.finished_at, c.acked_at, c.sent_at, c.created_at)';

function betweenRaw(q: Knex.QueryBuilder, expr: string, from: Date, to: Date): Knex.QueryBuilder {
  return q.whereRaw(`${expr} >= ? AND ${expr} <= ?`, [from, to]);
}

function toIso(v: unknown): string {
  return new Date(v as any).toISOString();
}

function toObj(v: unknown): Record<string, unknown> {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  if (typeof v === 'string') {
    try {
      const p = JSON.parse(v);
      return p && typeof p === 'object' && !Array.isArray(p) ? p : {};
    } catch { return {}; }
  }
  return {};
}

function toArr(v: unknown): any[] {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; } }
  return [];
}

function actorName(row: any): string | null {
  return row.actor_display_name || row.actor_username || null;
}

/** Truncate free text so a single stderr-ish blob can't bloat the timeline. */
function short(v: unknown, max = 300): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

const UPDATE_SEVERITY_HINT: Record<string, ChangeEventSeverityHint> = {
  critical: 'critical', important: 'high', moderate: 'medium', optional: 'low', unknown: 'info',
};

/** Terminal states of script_executions / scenario_runs / command_queue share
 *  the same vocabulary, so one mapping covers all three. */
function runSeverityHint(status: string): ChangeEventSeverityHint {
  if (status === 'failure' || status === 'timeout') return 'high';
  if (status === 'cancelled' || status === 'skipped') return 'low';
  return 'info';
}

function executionActorType(triggeredBy: string): ChangeEventActorType {
  if (triggeredBy === 'manual') return 'user';
  if (triggeredBy === 'api') return 'api';
  return 'schedule'; // schedule | catchup (a catchup IS a replayed schedule)
}

function scenarioActorType(triggerType: string): ChangeEventActorType {
  if (triggerType === 'manual') return 'user';
  if (triggerType === 'session_login' || triggerType === 'machine_boot') return 'agent';
  return 'system';
}

/** Destroying/moving a device or cutting its network is a far better blame
 *  candidate than a routine setting tweak. */
function auditSeverityHint(action: string): ChangeEventSeverityHint {
  if (/\.(deleted|refused|suspended|transferred|cleared)$/.test(action)) return 'high';
  if (action === 'command.enable_airgap' || action === 'command.enable_privacy_mode') return 'high';
  return 'medium';
}

// ── Sources ──────────────────────────────────────────────────────────────────

interface EventSource {
  /** Source table — echoed in the event id so a row is always traceable. */
  table: string;
  /** WHERE predicates only; no select/order/limit (the count path reuses it). */
  base: () => Knex.QueryBuilder;
  /** Columns for the list path — must include the event instant `as at`. */
  columns: (string | Knex.Raw)[];
  /** Raw SQL expression the rows are ordered/windowed on. */
  order: string;
  /** Column counted by the summary path. */
  countOn: string;
  map: (row: any) => ChangeEvent;
}

interface SourceContext {
  deviceId: number;
  tenantId: number;
  from: Date;
  to: Date;
  callerUserId: number;
  callerIsAdmin: boolean;
}

const USER_COLUMNS = ['u.username as actor_username', 'u.display_name as actor_display_name'];

/** command_queue-backed source shared by reboot / agent_upgraded / software_*
 *  / failed patch installs — same window expression, same delivery filter. */
function commandSource(
  ctx: SourceContext,
  types: string[],
  map: (row: any) => ChangeEvent,
  statuses: string[] = DELIVERED_COMMAND_STATUSES,
): EventSource {
  return {
    table: 'command_queue',
    base: () => betweenRaw(
      scope('command_queue', 'c', ctx.deviceId, ctx.tenantId)
        .whereIn('c.type', types)
        .whereIn('c.status', statuses),
      CMD_AT, ctx.from, ctx.to,
    ),
    columns: [
      'c.id', 'c.type', 'c.status', 'c.payload', 'c.result', 'c.created_by',
      ...USER_COLUMNS, db.raw(`${CMD_AT} as at`),
    ],
    order: CMD_AT,
    countOn: 'c.id',
    map,
  };
}

function commandJoinUser(q: Knex.QueryBuilder): Knex.QueryBuilder {
  return q.leftJoin('users as u', 'u.id', 'c.created_by');
}

/** Every source for a kind, in the order they are merged. A kind absent from
 *  the returned map is one the caller is not allowed to read (config_change
 *  for non-admins) — never one that silently returned nothing. */
function buildSources(ctx: SourceContext): Partial<Record<ChangeEventKind, EventSource[]>> {
  const { deviceId, tenantId, from, to } = ctx;

  const sources: Partial<Record<ChangeEventKind, EventSource[]>> = {
    // ── patch_deployed ───────────────────────────────────────────────────────
    patch_deployed: [
      {
        table: 'device_updates',
        base: () => scope('device_updates', 'du', deviceId, tenantId)
          .leftJoin('users as u', 'u.id', 'du.approved_by')
          .whereNotNull('du.installed_at')
          .whereBetween('du.installed_at', [from, to]),
        columns: [
          'du.id', 'du.update_uid', 'du.title', 'du.severity', 'du.category', 'du.source',
          'du.requires_reboot', 'du.approved_by', ...USER_COLUMNS, 'du.installed_at as at',
        ],
        order: 'du.installed_at',
        countOn: 'du.id',
        map: (r) => ({
          id: `patch_deployed:device_updates:${r.id}`,
          kind: 'patch_deployed',
          at: toIso(r.at),
          title: `Patch installed — ${r.title || r.update_uid}`,
          detail: [r.category, r.source, r.requires_reboot ? 'requires reboot' : null]
            .filter(Boolean).join(' · ') || null,
          actor: actorName(r),
          actorType: r.approved_by ? 'user' : 'system',
          severityHint: UPDATE_SEVERITY_HINT[r.severity] ?? 'info',
          resourceType: 'update',
          resourceId: String(r.id),
          resourcePath: r.update_uid,
          payload: {
            updateUid: r.update_uid, severity: r.severity, category: r.category,
            source: r.source, requiresReboot: !!r.requires_reboot, outcome: 'installed',
          },
        }),
      },
      // A failed install nulls device_updates.installed_at, so the attempt only
      // has a timestamp on the command that carried it.
      {
        ...commandSource(ctx, ['install_update', 'install_updates'], (r) => {
          const payload = toObj(r.payload);
          const result = toObj(r.result);
          const uids = payload.updateUids ? toArr(payload.updateUids) : (payload.updateUid ? [payload.updateUid] : []);
          return {
            id: `patch_deployed:command_queue:${r.id}`,
            kind: 'patch_deployed',
            at: toIso(r.at),
            title: uids.length === 1
              ? `Patch install failed — ${uids[0]}`
              : `Patch install failed — ${uids.length} update(s)`,
            detail: short(result.error ?? result.stderr) ?? `Command ended as '${r.status}'`,
            actor: actorName(r),
            actorType: r.created_by ? 'user' : 'system',
            severityHint: 'high',
            resourceType: 'update',
            resourceId: String(r.id),
            resourcePath: uids.length === 1 ? String(uids[0]) : null,
            payload: { commandId: r.id, commandType: r.type, status: r.status, updateUids: uids, outcome: 'failed' },
          };
        }, ['failure', 'timeout']),
      },
    ],

    // ── script_run / schedule_run ────────────────────────────────────────────
    script_run: [executionSource(ctx, 'script_run')],
    schedule_run: [executionSource(ctx, 'schedule_run')],

    // ── scenario_run ─────────────────────────────────────────────────────────
    scenario_run: [{
      table: 'scenario_runs',
      base: () => betweenRaw(
        scope('scenario_runs', 'sr', deviceId, tenantId)
          .leftJoin('scenarios as sc', 'sc.id', 'sr.scenario_id'),
        'COALESCE(sr.started_at, sr.created_at)', from, to,
      ),
      columns: [
        'sr.id', 'sr.scenario_id', 'sr.status', 'sr.trigger_type', 'sr.trigger_source',
        'sr.started_at', 'sr.finished_at', 'sr.error_message', 'sc.name as scenario_name',
        db.raw('COALESCE(sr.started_at, sr.created_at) as at'),
      ],
      order: 'COALESCE(sr.started_at, sr.created_at)',
      countOn: 'sr.id',
      map: (r) => ({
        id: `scenario_run:scenario_runs:${r.id}`,
        kind: 'scenario_run',
        at: toIso(r.at),
        title: `Scenario ${r.status} — ${r.scenario_name || `#${r.scenario_id}`}`,
        detail: short(r.error_message) ?? `Triggered by ${r.trigger_type}`,
        actor: r.trigger_source ?? null,
        actorType: scenarioActorType(r.trigger_type),
        severityHint: runSeverityHint(r.status),
        resourceType: 'scenario',
        resourceId: String(r.scenario_id),
        resourcePath: null,
        payload: {
          runId: r.id, scenarioId: r.scenario_id, status: r.status,
          triggerType: r.trigger_type, triggerSource: r.trigger_source ?? null,
          startedAt: r.started_at ? toIso(r.started_at) : null,
          finishedAt: r.finished_at ? toIso(r.finished_at) : null,
        },
      }),
    }],

    // ── compliance_drift ─────────────────────────────────────────────────────
    // Only rows that actually carry a fail/error rule — a clean re-check is
    // not a change. `jsonb_typeof` guards the array expansion against a
    // malformed legacy row.
    compliance_drift: [{
      table: 'compliance_results',
      base: () => scope('compliance_results', 'cr', deviceId, tenantId)
        .leftJoin('compliance_policies as cp', 'cp.id', 'cr.policy_id')
        .whereBetween('cr.checked_at', [from, to])
        .whereRaw(`jsonb_typeof(cr.results) = 'array'`)
        .whereRaw(`EXISTS (SELECT 1 FROM jsonb_array_elements(cr.results) AS r WHERE r->>'status' IN ('fail', 'error'))`),
      columns: [
        'cr.id', 'cr.policy_id', 'cr.results', 'cr.compliance_score',
        'cp.name as policy_name', 'cp.framework as policy_framework', 'cr.checked_at as at',
      ],
      order: 'cr.checked_at',
      countOn: 'cr.id',
      map: (r) => {
        const failed = toArr(r.results).filter((x: any) => x?.status === 'fail' || x?.status === 'error');
        const score = r.compliance_score == null ? null : Number(r.compliance_score);
        return {
          id: `compliance_drift:compliance_results:${r.id}`,
          kind: 'compliance_drift',
          at: toIso(r.at),
          title: `Compliance drift — ${r.policy_name || `policy #${r.policy_id}`}`,
          detail: `${failed.length} rule(s) failing${score == null ? '' : ` · score ${score}%`}`,
          actor: null,
          actorType: 'system',
          severityHint: score == null ? 'medium' : score < 50 ? 'high' : score < 90 ? 'medium' : 'low',
          resourceType: 'compliance_policy',
          resourceId: String(r.policy_id),
          resourcePath: null,
          payload: {
            policyId: r.policy_id, framework: r.policy_framework ?? null, score,
            failedCount: failed.length,
            // Rule NAMES live on compliance_policies.rules — kept out to avoid
            // re-reading a large jsonb per row; resolve them via /api/compliance.
            failedRuleIds: failed.slice(0, 25).map((x: any) => x?.rule_id ?? null),
          },
        };
      },
    }],

    // ── agent_upgraded ───────────────────────────────────────────────────────
    agent_upgraded: [commandSource(ctx, ['update_agent'], (r) => {
      const payload = toObj(r.payload);
      const version = payload.version ? String(payload.version) : null;
      return {
        id: `agent_upgraded:command_queue:${r.id}`,
        kind: 'agent_upgraded',
        at: toIso(r.at),
        title: version ? `Agent updated to ${version}` : 'Agent update',
        detail: `Command ended as '${r.status}'`,
        actor: actorName(r),
        actorType: r.created_by ? 'user' : 'system',
        severityHint: r.status === 'success' ? 'medium' : runSeverityHint(r.status),
        resourceType: 'agent',
        resourceId: String(r.id),
        resourcePath: version,
        payload: { commandId: r.id, status: r.status, targetVersion: version },
      };
    })],

    // ── remote_session ───────────────────────────────────────────────────────
    remote_session: [{
      table: 'remote_sessions',
      base: () => {
        const q = scope('remote_sessions', 'rs', deviceId, tenantId)
          .leftJoin('users as u', 'u.id', 'rs.started_by')
          .whereBetween('rs.started_at', [from, to]);
        // Mirrors remoteService.getSessions: a plain user must not see other
        // users' sessions on a shared device.
        if (!ctx.callerIsAdmin) q.where('rs.started_by', ctx.callerUserId);
        return q;
      },
      columns: [
        'rs.id', 'rs.protocol', 'rs.status', 'rs.started_by', 'rs.connected_at', 'rs.ended_at',
        'rs.duration_seconds', 'rs.end_reason', ...USER_COLUMNS, 'rs.started_at as at',
      ],
      order: 'rs.started_at',
      countOn: 'rs.id',
      map: (r) => ({
        id: `remote_session:remote_sessions:${r.id}`,
        kind: 'remote_session',
        at: toIso(r.at),
        title: `Remote session (${r.protocol}) — ${r.status}`,
        detail: [
          r.duration_seconds != null ? `${r.duration_seconds}s` : null,
          r.end_reason || null,
        ].filter(Boolean).join(' · ') || null,
        actor: actorName(r),
        actorType: 'user',
        severityHint: 'medium',
        resourceType: 'remote_session',
        resourceId: String(r.id),
        resourcePath: r.protocol,
        payload: {
          sessionId: r.id, protocol: r.protocol, status: r.status,
          connectedAt: r.connected_at ? toIso(r.connected_at) : null,
          endedAt: r.ended_at ? toIso(r.ended_at) : null,
          durationSeconds: r.duration_seconds ?? null,
          endReason: r.end_reason ?? null,
        },
      }),
    }],

    // ── reboot ───────────────────────────────────────────────────────────────
    reboot: [
      commandSource(ctx, ['reboot'], (r) => ({
        id: `reboot:command_queue:${r.id}`,
        kind: 'reboot',
        at: toIso(r.at),
        title: 'Reboot commanded',
        detail: `Command ended as '${r.status}'`,
        actor: actorName(r),
        actorType: r.created_by ? 'user' : 'system',
        severityHint: 'high',
        resourceType: 'command',
        resourceId: String(r.id),
        resourcePath: null,
        payload: { commandId: r.id, status: r.status, observed: false },
      })),
      // Boot time observed by the agent (devices.last_reboot_at is a single
      // column, so at most ONE such event exists — the most recent boot).
      {
        table: 'devices',
        base: () => {
          const q = db('devices as dv')
            .where('dv.id', deviceId)
            .whereNotNull('dv.last_reboot_at')
            .whereBetween('dv.last_reboot_at', [from, to]);
          if (!isMasterTenant(tenantId)) q.where('dv.tenant_id', tenantId);
          return q;
        },
        columns: ['dv.id', 'dv.last_reboot_at as at'],
        order: 'dv.last_reboot_at',
        countOn: 'dv.id',
        map: (r) => ({
          id: `reboot:devices:${r.id}`,
          kind: 'reboot',
          at: toIso(r.at),
          title: 'Device booted',
          detail: 'Boot time reported by the agent',
          actor: null,
          actorType: 'agent',
          severityHint: 'high',
          resourceType: 'device',
          resourceId: String(r.id),
          resourcePath: null,
          payload: { observed: true },
        }),
      },
    ],

    // ── software_installed / software_removed ────────────────────────────────
    software_installed: [commandSource(ctx, ['install_software'], (r) => softwareEvent(r, 'software_installed'))],
    software_removed: [commandSource(ctx, ['uninstall_software'], (r) => softwareEvent(r, 'software_removed'))],
  };

  // audit_logs is admin-only everywhere else (routes/audit.routes.ts) — do not
  // widen it here. Non-admins simply get the kind omitted from `kinds`.
  if (ctx.callerIsAdmin) {
    sources.config_change = [{
      table: 'audit_logs',
      base: () => scope('audit_logs', 'al', deviceId, tenantId)
        .leftJoin('users as u', 'u.id', 'al.user_id')
        .whereBetween('al.created_at', [from, to])
        .whereNotIn('al.action', AUDIT_ACTIONS_OWNED_ELSEWHERE)
        .whereRaw(`al.action NOT LIKE 'remote.session_started.%'`),
      columns: [
        'al.id', 'al.action', 'al.resource_type', 'al.resource_path', 'al.details',
        'al.user_id', 'al.ip_address', ...USER_COLUMNS, 'al.created_at as at',
      ],
      order: 'al.created_at',
      countOn: 'al.id',
      map: (r) => ({
        id: `config_change:audit_logs:${r.id}`,
        kind: 'config_change',
        at: toIso(r.at),
        title: `Configuration change — ${r.action}`,
        detail: short(r.resource_path),
        actor: actorName(r),
        actorType: r.user_id ? 'user' : 'system',
        severityHint: auditSeverityHint(r.action),
        resourceType: r.resource_type ?? null,
        resourceId: r.resource_path ?? null,
        resourcePath: (r.resource_type === 'file' || r.resource_type === 'directory') ? r.resource_path : null,
        payload: { action: r.action, details: toObj(r.details), ipAddress: r.ip_address ?? null },
      }),
    }];
  }

  return sources;
}

function softwareEvent(r: any, kind: 'software_installed' | 'software_removed'): ChangeEvent {
  const payload = toObj(r.payload);
  const result = toObj(r.result);
  const name = payload.entryName ? String(payload.entryName) : null;
  const verb = kind === 'software_installed' ? 'installed' : 'removed';
  return {
    id: `${kind}:command_queue:${r.id}`,
    kind,
    at: toIso(r.at),
    title: `Software ${verb} — ${name ?? 'unknown package'}`,
    detail: short(result.error ?? result.stderr) ?? `Command ended as '${r.status}'`,
    actor: actorName(r),
    actorType: r.created_by ? 'user' : 'system',
    severityHint: r.status === 'success'
      ? (kind === 'software_removed' ? 'high' : 'medium')
      : 'high',
    resourceType: 'software',
    resourceId: String(r.id),
    resourcePath: name,
    payload: {
      commandId: r.id, status: r.status, entryName: name,
      listId: payload.listId ?? null, entryId: payload.entryId ?? null,
      exitCode: result.exitCode ?? null,
    },
  };
}

/** script_executions serves two kinds; the schedule_id split is what
 *  distinguishes "someone ran a script" from "a schedule fired". */
function executionSource(ctx: SourceContext, kind: 'script_run' | 'schedule_run'): EventSource {
  const { deviceId, tenantId, from, to } = ctx;
  return {
    table: 'script_executions',
    base: () => {
      const q = scope('script_executions', 'se', deviceId, tenantId)
        .leftJoin('users as u', 'u.id', 'se.triggered_by_user_id')
        .leftJoin('script_schedules as ss', 'ss.id', 'se.schedule_id')
        .whereBetween('se.triggered_at', [from, to]);
      return kind === 'schedule_run' ? q.whereNotNull('se.schedule_id') : q.whereNull('se.schedule_id');
    },
    columns: [
      'se.id', 'se.script_id', 'se.schedule_id', 'se.script_snapshot', 'se.status',
      'se.triggered_by', 'se.triggered_by_user_id', 'se.started_at', 'se.finished_at',
      'se.exit_code', 'se.batch_id', 'ss.name as schedule_name', ...USER_COLUMNS,
      'se.triggered_at as at',
    ],
    order: 'se.triggered_at',
    countOn: 'se.id',
    map: (r) => {
      const snapshot = toObj(r.script_snapshot);
      const scriptName = snapshot.name ? String(snapshot.name) : `script #${r.script_id}`;
      return {
        id: `${kind}:script_executions:${r.id}`,
        kind,
        at: toIso(r.at),
        title: kind === 'schedule_run'
          ? `Schedule ran — ${r.schedule_name || `schedule #${r.schedule_id}`}`
          : `Script ${r.status} — ${scriptName}`,
        detail: [
          kind === 'schedule_run' ? scriptName : null,
          r.exit_code == null ? null : `exit ${r.exit_code}`,
          kind === 'schedule_run' ? r.status : null,
        ].filter(Boolean).join(' · ') || null,
        actor: actorName(r),
        actorType: executionActorType(r.triggered_by),
        severityHint: runSeverityHint(r.status),
        resourceType: kind === 'schedule_run' ? 'schedule' : 'script',
        resourceId: String(kind === 'schedule_run' ? r.schedule_id : r.script_id),
        resourcePath: null,
        payload: {
          // stdout/stderr are deliberately not inlined — drill down via
          // /api/executions/:id when the ribbon needs the output.
          executionId: r.id, scriptId: r.script_id, scriptName,
          scheduleId: r.schedule_id ?? null, scheduleName: r.schedule_name ?? null,
          status: r.status, exitCode: r.exit_code ?? null,
          triggeredBy: r.triggered_by, batchId: r.batch_id ?? null,
          startedAt: r.started_at ? toIso(r.started_at) : null,
          finishedAt: r.finished_at ? toIso(r.finished_at) : null,
        },
      };
    },
  };
}

/** Joins that `columns` references but `base()` doesn't set up itself. */
function withJoins(src: EventSource, q: Knex.QueryBuilder): Knex.QueryBuilder {
  return src.table === 'command_queue' ? commandJoinUser(q) : q;
}

// ── Validation ───────────────────────────────────────────────────────────────

/** Accepts ISO-8601 or epoch-ms, like the sibling /rewind/* routes. */
const tsParam = z.preprocess(
  (v) => (typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v),
  z.coerce.date(),
);

const kindsParam = z
  .string()
  .max(500)
  .transform((s) => s.split(',').map((k) => k.trim()).filter(Boolean))
  .pipe(z.array(z.enum(CHANGE_EVENT_KINDS)).min(1));

function refineWindow(w: { from: Date; to: Date }, ctx: z.RefinementCtx): void {
  if (w.from.getTime() >= w.to.getTime()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '`from` must be strictly before `to`' });
  } else if (w.to.getTime() - w.from.getTime() > MAX_WINDOW_MS) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Window too large — max ${MAX_WINDOW_DAYS} days` });
  }
}

export const changeEventsQuerySchema = z
  .object({
    from: tsParam.optional(),
    to: tsParam.optional(),
    kinds: kindsParam.optional(),
    limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
  })
  .transform((q) => {
    const to = q.to ?? new Date();
    return { to, from: q.from ?? new Date(to.getTime() - DEFAULT_WINDOW_MS), kinds: q.kinds, limit: q.limit ?? DEFAULT_LIMIT };
  })
  .superRefine(refineWindow);

export const changeEventsSummaryQuerySchema = z
  .object({
    from: tsParam.optional(),
    to: tsParam.optional(),
  })
  .transform((q) => {
    const to = q.to ?? new Date();
    return { to, from: q.from ?? new Date(to.getTime() - DEFAULT_WINDOW_MS) };
  })
  .superRefine(refineWindow);

export interface ChangeEventQueryOptions {
  from: Date;
  to: Date;
  kinds?: ChangeEventKind[];
  limit?: number;
  callerUserId: number;
  callerIsAdmin: boolean;
}

// ── Service ──────────────────────────────────────────────────────────────────

export const changeEventService = {
  /** One ordered timeline (NEWEST FIRST) unioning every change kind the caller
   *  is allowed to read. Each source is fetched with `limit + 1` rows so the
   *  merge can tell "exactly full" from "truncated": since every source is
   *  ordered newest-first, a row dropped by a per-source cap is necessarily
   *  older than `limit + 1` rows already in the merge, so it could never have
   *  survived the final slice anyway. */
  async getTimeline(deviceId: number, tenantId: number, opts: ChangeEventQueryOptions) {
    const limit = Math.min(MAX_LIMIT, Math.max(1, opts.limit ?? DEFAULT_LIMIT));
    const ctx: SourceContext = {
      deviceId, tenantId, from: opts.from, to: opts.to,
      callerUserId: opts.callerUserId, callerIsAdmin: opts.callerIsAdmin,
    };
    const sources = buildSources(ctx);
    const kinds = resolveKinds(sources, opts.kinds);

    const batches = await Promise.all(
      kinds.flatMap((kind) => (sources[kind] ?? []).map(async (src) => {
        const rows = await withJoins(src, src.base())
          .select(src.columns)
          .orderByRaw(`${src.order} DESC`)
          .limit(limit + 1);
        return rows.map(src.map);
      })),
    );

    const merged = batches.flat().sort((a, b) => {
      const d = Date.parse(b.at) - Date.parse(a.at);
      return d !== 0 ? d : a.id.localeCompare(b.id); // stable across identical instants
    });

    const truncated = merged.length > limit;
    if (truncated) {
      logger.warn({ deviceId, tenantId, limit, found: merged.length }, 'change-events timeline truncated');
    }

    return {
      formatVersion: FORMAT_VERSION,
      deviceId,
      from: opts.from.toISOString(),
      to: opts.to.toISOString(),
      order: 'desc' as const,
      kinds,
      limit,
      truncated,
      count: Math.min(merged.length, limit),
      events: truncated ? merged.slice(0, limit) : merged,
    };
  },

  /** Exact counts per kind — no row cap applies, so the Blame Ribbon can size
   *  itself without pulling the timeline. */
  async getSummary(deviceId: number, tenantId: number, opts: Omit<ChangeEventQueryOptions, 'kinds' | 'limit'>) {
    const ctx: SourceContext = {
      deviceId, tenantId, from: opts.from, to: opts.to,
      callerUserId: opts.callerUserId, callerIsAdmin: opts.callerIsAdmin,
    };
    const sources = buildSources(ctx);
    const kinds = resolveKinds(sources, undefined);

    const counts = {} as Record<ChangeEventKind, number>;
    await Promise.all(kinds.map(async (kind) => {
      const perSource = await Promise.all((sources[kind] ?? []).map(async (src) => {
        const [row] = await src.base().count<{ c: string }[]>({ c: src.countOn });
        return parseInt((row as any)?.c ?? '0', 10);
      }));
      counts[kind] = perSource.reduce((a, b) => a + b, 0);
    }));

    return {
      formatVersion: FORMAT_VERSION,
      deviceId,
      from: opts.from.toISOString(),
      to: opts.to.toISOString(),
      kinds,
      counts,
      total: Object.values(counts).reduce((a: number, b: number) => a + b, 0),
    };
  },
};

/** Requested kinds ∩ kinds the caller may read, in canonical order. An
 *  explicitly requested but forbidden kind is dropped rather than 403'd — the
 *  response echoes `kinds`, so the caller can see it was not served. */
function resolveKinds(
  sources: Partial<Record<ChangeEventKind, EventSource[]>>,
  requested: ChangeEventKind[] | undefined,
): ChangeEventKind[] {
  const wanted = requested ? new Set(requested) : null;
  return CHANGE_EVENT_KINDS.filter((k) => sources[k] && (!wanted || wanted.has(k)));
}
