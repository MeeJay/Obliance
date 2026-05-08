import { Knex } from 'knex';

// Lot — sidebar reorg: introduce 4 page-gate capabilities so non-admin
// users can be granted read access to Supervision (Reports / History
// / Remote sessions) and Agent config (Custom Sections / Discovery /
// API Keys) without being given platform admin.
//
// The capability list itself is enforced by the Zod validator in
// validators/team.schema.ts and the rowToPermission filter in
// services/team.service.ts — this migration just patches existing
// data:
//
//   1. Every team_permission row that today has the `monitor` cap
//      receives `supervision:read` too. Rationale: a user who can
//      already see device metrics has a legitimate reason to read
//      reports/history/remote sessions on those devices. Tighten
//      manually if a tenant doesn't want this.
//
//   2. Every team_permission row owned by a team where AT LEAST ONE
//      member is a tenant admin (user_tenants.role='admin' for the
//      team's tenant) receives all three `agent_config:*` caps. We
//      don't grant agent_config to plain users by default — those
//      caps create / revoke API keys, that's takeover-level.
//
// Both seedings are idempotent — running migrations again is safe.

export async function up(knex: Knex): Promise<void> {
  // 1. supervision:read — bolt onto every team_permission that has `monitor`.
  const monitorRows = await knex('team_permissions').select('id', 'capabilities') as Array<{
    id: number; capabilities: unknown;
  }>;
  for (const r of monitorRows) {
    const caps = parseCapsArray(r.capabilities);
    if (!caps.includes('monitor')) continue;
    if (caps.includes('supervision:read')) continue;
    caps.push('supervision:read');
    await knex('team_permissions').where({ id: r.id }).update({ capabilities: JSON.stringify(caps) });
  }

  // 2. agent_config:* — every team where at least one member is a
  //    tenant admin gets the 3 agent_config caps on its rows.
  const adminTeamIds = await knex('user_teams as t')
    .join('team_memberships as tm', 'tm.team_id', 't.id')
    .join('user_tenants as ut', function () {
      this.on('ut.user_id', '=', 'tm.user_id').andOn('ut.tenant_id', '=', 't.tenant_id');
    })
    .where('ut.role', 'admin')
    .pluck('t.id') as number[];
  const uniqueAdminTeamIds = [...new Set(adminTeamIds)];

  if (uniqueAdminTeamIds.length > 0) {
    const adminTeamPerms = await knex('team_permissions')
      .whereIn('team_id', uniqueAdminTeamIds)
      .select('id', 'capabilities') as Array<{ id: number; capabilities: unknown }>;
    for (const r of adminTeamPerms) {
      const caps = parseCapsArray(r.capabilities);
      let changed = false;
      for (const c of ['agent_config:custom_sections', 'agent_config:discovery', 'agent_config:keys']) {
        if (!caps.includes(c)) { caps.push(c); changed = true; }
      }
      if (changed) {
        await knex('team_permissions').where({ id: r.id }).update({ capabilities: JSON.stringify(caps) });
      }
    }
  }
}

export async function down(knex: Knex): Promise<void> {
  // Strip the new caps from every row so the schema enum can shrink
  // back without leaving orphan values in the data.
  const rows = await knex('team_permissions').select('id', 'capabilities') as Array<{
    id: number; capabilities: unknown;
  }>;
  const NEW_CAPS = new Set([
    'supervision:read',
    'agent_config:custom_sections',
    'agent_config:discovery',
    'agent_config:keys',
  ]);
  for (const r of rows) {
    const caps = parseCapsArray(r.capabilities);
    const trimmed = caps.filter((c) => !NEW_CAPS.has(c));
    if (trimmed.length !== caps.length) {
      await knex('team_permissions').where({ id: r.id }).update({ capabilities: JSON.stringify(trimmed) });
    }
  }
}

function parseCapsArray(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === 'string');
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === 'string');
    } catch { /* legacy junk — drop */ }
  }
  return [];
}
