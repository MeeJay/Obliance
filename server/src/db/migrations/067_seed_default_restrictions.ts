import { Knex } from 'knex';

// Seed the recommended default action restrictions for tenants that haven't
// configured any yet. Tenants with an existing map (even partial) are left
// untouched so we never silently overwrite admin choices.
//
// The defaults follow the product owner's spec:
//
//   Reboot               → Sensitive
//   Shutdown             → Sensitive
//   Sleep                → None
//   Restart agent        → None
//   Uninstall agent      → Restricted
//   Enable airgap        → Sensitive
//   Disable airgap       → Restricted
//   Enable privacy mode  → None
//   Disable privacy mode → Sensitive
//   Delete device        → Sensitive
//   Bulk change group    → Sensitive
//   Transfer tenant      → Sensitive
//   Install software     → Sensitive
//   Uninstall software   → Sensitive
//   Manual script run    → Sensitive
//   File explorer access → Sensitive (entry point only — one 2FA per session)
//
// Remote sessions, Services (start / stop / restart), Processes (kill),
// and individual file mutations (upload / delete / rename) default to
// None — admins opt in from the matrix.

const DEFAULTS: Record<string, string> = {
  'command.reboot':               'sensitive',
  'command.shutdown':             'sensitive',
  'command.uninstall_agent':      'restricted',
  'command.enable_airgap':        'sensitive',
  'command.disable_airgap':       'restricted',
  'command.disable_privacy_mode': 'sensitive',
  'device.delete':                'sensitive',
  'device.bulk_group_change':     'sensitive',
  'device.transfer_tenant':       'sensitive',
  'software.remediate_install':   'sensitive',
  'software.remediate_uninstall': 'sensitive',
  'script.execute_manual':        'sensitive',
  'command.list_directory':       'sensitive',
};

export async function up(knex: Knex): Promise<void> {
  const tenants = await knex('tenants').select('id', 'action_restrictions');
  const seeded = JSON.stringify(DEFAULTS);

  for (const t of tenants) {
    const raw = typeof t.action_restrictions === 'string'
      ? t.action_restrictions
      : JSON.stringify(t.action_restrictions || {});
    let existing: Record<string, unknown> = {};
    try { existing = JSON.parse(raw || '{}'); } catch { existing = {}; }

    if (!existing || Object.keys(existing).length === 0) {
      await knex('tenants').where({ id: t.id }).update({ action_restrictions: seeded });
    }
  }
}

export async function down(_knex: Knex): Promise<void> {
  // Leave the data in place — removing defaults after install could lock
  // admins out of features they were relying on.
}
