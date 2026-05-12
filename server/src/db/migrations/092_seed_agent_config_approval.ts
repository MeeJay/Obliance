import { Knex } from 'knex';

// Bolt `agent_config:approval` onto the seeded 'admin' and 'user'
// permission_sets so the new approval flow is usable out of the box.
// Admins get it implicitly (their bypass short-circuits the cap
// lookup), but explicit presence keeps the matrix UI showing the
// toggle as ON. 'user' gets it because the typical N1 support
// profile needs to approve incoming agents on their assigned groups
// — operators who don't want this can untick it from the matrix.
// 'viewer' explicitly stays read-only.
//
// Idempotent: each row is only patched if the cap isn't already
// present.

export async function up(knex: Knex): Promise<void> {
  const rows = await knex('permission_sets')
    .whereIn('slug', ['admin', 'user'])
    .select('id', 'capabilities') as Array<{ id: number; capabilities: unknown }>;
  for (const r of rows) {
    const caps = parseCapsArray(r.capabilities);
    if (caps.includes('agent_config:approval')) continue;
    caps.push('agent_config:approval');
    await knex('permission_sets').where({ id: r.id }).update({ capabilities: JSON.stringify(caps) });
  }
}

export async function down(knex: Knex): Promise<void> {
  const rows = await knex('permission_sets')
    .select('id', 'capabilities') as Array<{ id: number; capabilities: unknown }>;
  for (const r of rows) {
    const caps = parseCapsArray(r.capabilities).filter((c) => c !== 'agent_config:approval');
    await knex('permission_sets').where({ id: r.id }).update({ capabilities: JSON.stringify(caps) });
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
