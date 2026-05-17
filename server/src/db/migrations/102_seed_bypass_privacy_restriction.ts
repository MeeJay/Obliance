import { Knex } from 'knex';

// Wire the bypass-privacy-mode toggle into the per-tenant action-restriction
// matrix. Default = 'restricted' (double-admin approval) so an admin
// flipping the switch can't single-handedly override a user's privacy
// choice — a second admin must sign off. Tenants that already configured
// these keys are left untouched.

const DEFAULTS: Record<string, string> = {
  'scenario.bypass_privacy_mode': 'restricted',
  'schedule.bypass_privacy_mode': 'restricted',
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
  // Leave seeded defaults in place; removing them after install would
  // silently grant bypass capability without admin oversight.
}
