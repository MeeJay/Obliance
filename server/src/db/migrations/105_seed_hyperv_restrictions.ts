import { Knex } from 'knex';

// Seed the gated Hyper-V action keys into each tenant's action-restriction
// matrix. Only the non-'none' defaults are seeded (power actions stay
// un-gated / absent). Tenants that already configured a given key are left
// untouched. Mirrors migration 102 (bypass-privacy seeding).
//
//   checkpoint-apply / checkpoint-delete / edit / create → sensitive (2FA)
//   delete                                               → restricted (2 admins)

const DEFAULTS: Record<string, string> = {
  'hyperv.vm_checkpoint_apply':  'sensitive',
  'hyperv.vm_checkpoint_delete': 'sensitive',
  'hyperv.vm_edit':              'sensitive',
  'hyperv.vm_create':            'sensitive',
  'hyperv.vm_delete':            'restricted',
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
  // Leave seeded defaults in place — removing them could silently grant
  // bypass capability without admin oversight.
}
