import { Knex } from 'knex';

// Phase 2 of the v2 graph engine: a scenario can now hold multiple
// trigger nodes (manual + schedule + a second schedule + …). The cron
// state therefore moves from the scenario row to the per-node row, so
// each `trigger_schedule_cron` node fires on its own clock.
//
// We keep the scenarios.next_cron_run_at columns around to avoid any
// data-loss risk if a redeploy partially rolls back; they're simply
// no longer read by the cron tick after this migration runs.

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('scenario_nodes', (t) => {
    t.timestamp('next_cron_run_at', { useTz: true }).nullable();
    t.timestamp('last_cron_fire_at', { useTz: true }).nullable();
    t.index(['type', 'next_cron_run_at']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('scenario_nodes', (t) => {
    t.dropColumn('last_cron_fire_at');
    t.dropColumn('next_cron_run_at');
  });
}
