import { Knex } from 'knex';

// Master-tenant fan-out: lets a row owned by tenant T1 (typically the
// master tenant) be ALSO visible to a list of additional target
// tenants. tenant_id stays the *owner* (who can edit/delete);
// target_tenant_ids is the *audience*. Read queries become:
//   WHERE tenant_id = $tid OR $tid = ANY(target_tenant_ids)
//
// Limited to entities the user explicitly asked to fan out: scripts,
// scenarios, schedules (script_schedules), compliance policies. Teams
// stay strictly mono-tenant by design — to grant a user access to
// multiple tenants, the admin creates one team per tenant.
//
// GIN index on the array column so the membership filter scales when
// hundreds of fan-out rows pile up.

const TABLES = [
  'scripts',
  'scenarios',
  'script_schedules',
  'compliance_policies',
] as const;

export async function up(knex: Knex): Promise<void> {
  for (const t of TABLES) {
    const exists = await knex.schema.hasTable(t);
    if (!exists) continue;
    const hasCol = await knex.schema.hasColumn(t, 'target_tenant_ids');
    if (hasCol) continue;
    await knex.schema.alterTable(t, (tb) => {
      tb.specificType('target_tenant_ids', 'integer[]').nullable();
    });
    await knex.raw(
      `CREATE INDEX IF NOT EXISTS idx_${t}_target_tenant_ids ON ${t} USING gin (target_tenant_ids)`,
    );
  }
}

export async function down(knex: Knex): Promise<void> {
  for (const t of TABLES) {
    const exists = await knex.schema.hasTable(t);
    if (!exists) continue;
    await knex.raw(`DROP INDEX IF EXISTS idx_${t}_target_tenant_ids`);
    const hasCol = await knex.schema.hasColumn(t, 'target_tenant_ids');
    if (hasCol) {
      await knex.schema.alterTable(t, (tb) => { tb.dropColumn('target_tenant_ids'); });
    }
  }
}
