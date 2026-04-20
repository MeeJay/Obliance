import { Knex } from 'knex';

// Per-action restriction policy. Replaces the coarse tenant-level
// `two_step_approval` boolean with a fine-grained JSONB map:
//
//   { "command.reboot": "restricted", "device.uninstall": "sensitive", ... }
//
// Levels:
//   - "none"       (or absent)  — no extra check.
//   - "restricted" — triggers the 2nd-admin approval flow already in place.
//   - "sensitive"  — requires a fresh 2FA code from the acting user at the
//                    moment of execution. If the user has no 2FA configured,
//                    the action is refused outright.
//
// Upgrade path: tenants with two_step_approval=true are seeded with the
// canonical destructive actions at 'restricted'. Admin can tighten some to
// 'sensitive' from the Restrictions UI later.

const DESTRUCTIVE_ACTIONS = [
  'command.reboot',
  'command.shutdown',
  'command.sleep',
  'command.restart_agent',
  'command.uninstall_agent',
  'command.enable_airgap',
  'command.disable_airgap',
  'command.enable_privacy_mode',
  'command.disable_privacy_mode',
  'device.delete',
  'device.bulk_group_change',
  'device.transfer_tenant',
  'software.remediate_install',
  'software.remediate_uninstall',
];

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn('tenants', 'action_restrictions'))) {
    await knex.schema.alterTable('tenants', (t) => {
      t.jsonb('action_restrictions').notNullable().defaultTo('{}');
    });
  }

  // Seed restricted-level for tenants that previously had two_step_approval.
  const hasLegacy = await knex.schema.hasColumn('tenants', 'two_step_approval');
  if (hasLegacy) {
    const rows = await knex('tenants').select('id', 'two_step_approval', 'action_restrictions');
    for (const row of rows) {
      const existing = typeof row.action_restrictions === 'string'
        ? JSON.parse(row.action_restrictions || '{}')
        : (row.action_restrictions || {});
      if (row.two_step_approval && Object.keys(existing).length === 0) {
        const seeded: Record<string, string> = {};
        for (const a of DESTRUCTIVE_ACTIONS) seeded[a] = 'restricted';
        await knex('tenants').where({ id: row.id }).update({ action_restrictions: JSON.stringify(seeded) });
      }
    }
  }
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasColumn('tenants', 'action_restrictions')) {
    await knex.schema.alterTable('tenants', (t) => {
      t.dropColumn('action_restrictions');
    });
  }
}
