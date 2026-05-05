import { Knex } from 'knex';

// Adds the missing `updated_at` column to `scenario_runs`. Migration
// 050 created the table with only `created_at` but the application
// code (executeNode, _completeNode, markRunSuccess, markRunFailure,
// cancelRun) has been writing `updated_at: new Date()` since the v2
// engine landed. Postgres throws on every such UPDATE because the
// column doesn't exist, leaving runs permanently stuck in 'running'
// status with no stdout/stderr — and breaking cancel attempts with
// a generic 500.
//
// The fix backfills the column with `created_at` for existing rows
// and adds a trigger-free default so downstream writes work without
// further code changes.
export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasColumn('scenario_runs', 'updated_at');
  if (!exists) {
    await knex.schema.alterTable('scenario_runs', (t) => {
      t.timestamp('updated_at', { useTz: true });
    });
    // Backfill so existing rows have a sensible value (matches their
    // creation timestamp). Future writes from the engine will keep it
    // current.
    await knex.raw('UPDATE scenario_runs SET updated_at = created_at WHERE updated_at IS NULL');
    // NOT NULL + default now that the backfill is done.
    await knex.raw("ALTER TABLE scenario_runs ALTER COLUMN updated_at SET DEFAULT NOW()");
    await knex.raw('ALTER TABLE scenario_runs ALTER COLUMN updated_at SET NOT NULL');
  }
}

export async function down(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasColumn('scenario_runs', 'updated_at');
  if (exists) {
    await knex.schema.alterTable('scenario_runs', (t) => {
      t.dropColumn('updated_at');
    });
  }
}
