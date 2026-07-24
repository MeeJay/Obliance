import type { Knex } from 'knex';

/**
 * Per-table autovacuum tuning for the hottest tables under the push firehose.
 *
 * At 2000+ devices (~200 push/s) the `devices` table takes several hundred row
 * versions per second (metrics UPDATE on every push). With stock autovacuum
 * (vacuum_scale_factor 0.2 = "wait until 20% of the table is dead"), a
 * 2000-row table would only vacuum after ~400 dead tuples — reached in ~1s,
 * but the global cost-delay throttling makes it fall behind anyway, so the
 * heap + indexes bloat to many times their useful size and every UI SELECT on
 * `devices` (the table every listing/sidebar/dashboard joins) slows down.
 *
 * These per-table overrides make autovacuum wake on `devices` almost
 * continuously and never throttle, keeping the hot table compact. The same
 * applies (lighter) to the metric-history buckets which see high UPSERT churn.
 *
 * NOTE: setting autovacuum_vacuum_cost_delay = 0 disables the I/O throttle for
 * these tables specifically — appropriate for a table that MUST stay lean; the
 * global setting still protects the rest of the database.
 */

const HOT_TABLES = [
  'devices',
  'device_metric_5min',
  'device_metric_hourly',
  'device_disk_5min',
  'device_disk_hourly',
  'command_queue',
];

export async function up(knex: Knex): Promise<void> {
  for (const t of HOT_TABLES) {
    const exists = await knex.schema.hasTable(t);
    if (!exists) continue;
    await knex.raw(
      `ALTER TABLE ?? SET (
         autovacuum_vacuum_scale_factor = 0.01,
         autovacuum_analyze_scale_factor = 0.01,
         autovacuum_vacuum_cost_delay = 0,
         autovacuum_vacuum_threshold = 200
       )`,
      [t],
    );
  }
}

export async function down(knex: Knex): Promise<void> {
  for (const t of HOT_TABLES) {
    const exists = await knex.schema.hasTable(t);
    if (!exists) continue;
    await knex.raw(
      `ALTER TABLE ?? RESET (
         autovacuum_vacuum_scale_factor,
         autovacuum_analyze_scale_factor,
         autovacuum_vacuum_cost_delay,
         autovacuum_vacuum_threshold
       )`,
      [t],
    );
  }
}
