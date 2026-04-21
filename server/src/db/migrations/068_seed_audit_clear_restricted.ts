import { Knex } from 'knex';

// Ensure `audit.clear` is at least `restricted` in every tenant's action
// policy. Clearing the audit log destroys accountability records — a
// second admin should always be in the loop. We do NOT downgrade a tenant
// that already set it to `sensitive`; we only fill in the blank.
//
// The other tenant-config actions (manage_users, manage_teams,
// manage_permissions, manage_settings, manage_profile, manage_restrictions)
// are deliberately NOT seeded here — the admin opts in once they've
// deployed TOTP across privileged accounts, otherwise a fresh instance
// could softlock itself.

export async function up(knex: Knex): Promise<void> {
  const rows = await knex('tenants').select('id', 'action_restrictions');
  for (const t of rows) {
    const raw = typeof t.action_restrictions === 'string'
      ? t.action_restrictions
      : JSON.stringify(t.action_restrictions || {});
    let map: Record<string, unknown> = {};
    try { map = JSON.parse(raw || '{}'); } catch { map = {}; }

    // Only set if absent — respect admin choices (including explicit None).
    if (!('audit.clear' in map)) {
      map['audit.clear'] = 'restricted';
      await knex('tenants').where({ id: t.id }).update({
        action_restrictions: JSON.stringify(map),
      });
    }
  }
}

export async function down(_knex: Knex): Promise<void> {
  // No-op — removing security policy on rollback is worse than leaving it.
}
