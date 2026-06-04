import { Knex } from 'knex';

// Seed the gated Veeam action keys into each tenant's action-restriction
// matrix. Only the non-'none' defaults are seeded (start/retry/enable stay
// un-gated / absent). Tenants that already configured a given key are left
// untouched. Mirrors migrations 102 / 105.
//
//   stop a running job / disable a job schedule → sensitive (2FA)

const DEFAULTS: Record<string, string> = {
  'veeam.job_stop':    'sensitive',
  'veeam.job_disable': 'sensitive',
};

export async function up(knex: Knex): Promise<void> {
  const tenants = await knex('tenants').select('id', 'action_restrictions');
  for (const t of tenants) {
    const raw = typeof t.action_restrictions === 'string'
      ? t.action_restrictions
      : JSON.stringify(t.action_restrictions || {});
    let existing: Record<string, unknown> = {};
    try { existing = JSON.parse(raw || '{}'); } catch { existing = {}; }

    let dirty = false;
    for (const [key, value] of Object.entries(DEFAULTS)) {
      if (existing[key] === undefined) {
        existing[key] = value;
        dirty = true;
      }
    }
    if (dirty) {
      await knex('tenants').where({ id: t.id }).update({ action_restrictions: JSON.stringify(existing) });
    }
  }
}

export async function down(_knex: Knex): Promise<void> {
  // Leave seeded defaults in place.
}
