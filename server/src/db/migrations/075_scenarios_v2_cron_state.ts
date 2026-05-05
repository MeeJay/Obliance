import { Knex } from 'knex';

// Phase 1B — cron-trigger state for the v2 scenario engine.
// Mirrors the script_schedules.next_run_at pattern: a tick reads every
// active scenario where next_cron_run_at <= NOW(), fires startRun for
// each target device, and recomputes next_cron_run_at via cron-parser.

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('scenarios', (t) => {
    t.timestamp('next_cron_run_at', { useTz: true }).nullable();
    t.timestamp('last_cron_fire_at', { useTz: true }).nullable();
    t.index(['trigger_type', 'next_cron_run_at']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('scenarios', (t) => {
    t.dropColumn('last_cron_fire_at');
    t.dropColumn('next_cron_run_at');
  });
}
