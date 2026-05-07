import { Knex } from 'knex';

// Phase 2 extension: extend the master fan-out model to two more
// tables that admins commonly want to push down to specific child
// tenants — custom sections (per-device dashboard widgets) and agent
// API keys (lets master pre-create a key + default group binding for
// a child tenant). Same column shape and read-scope semantics as
// migration 085.

const TABLES = ['custom_sections', 'agent_api_keys'] as const;

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
