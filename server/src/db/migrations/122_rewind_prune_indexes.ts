import type { Knex } from 'knex';

/**
 * Prune-supporting indexes for the metric/rewind time tables.
 *
 * pruneMetricHistory range-deletes on `bucket` / `captured_at`, but every
 * existing index on these tables LEADS with device_id or tenant_id, so a btree
 * can't seek on the time column and the 6-hourly prune fell back to a full scan.
 * Harmless at the old 3h/72h retention, but a real cost once 5-min retention
 * went to 7d and hourly to 30d (multi-million-row tables at 4000 devices).
 *
 * BRIN (not btree) on purpose: these tables are append-ordered in time, so a
 * BRIN index on the time column is tiny, self-maintaining (negligible overhead
 * on the hot UPSERT/insert path), and lets the prune skip most of the heap.
 */
const BRIN = [
  ['device_metric_5min', 'bucket'],
  ['device_metric_hourly', 'bucket'],
  ['device_metric_daily', 'bucket'],
  ['device_disk_5min', 'bucket'],
  ['device_disk_hourly', 'bucket'],
  ['device_disk_daily', 'bucket'],
  ['device_process_history', 'captured_at'],
  ['device_service_history', 'captured_at'],
] as const;

export async function up(knex: Knex): Promise<void> {
  for (const [table, col] of BRIN) {
    const idx = `idx_${table}_${col}_brin`;
    await knex.raw(`CREATE INDEX IF NOT EXISTS ?? ON ?? USING BRIN (??)`, [idx, table, col]);
  }
}

export async function down(knex: Knex): Promise<void> {
  for (const [table, col] of BRIN) {
    await knex.raw(`DROP INDEX IF EXISTS ??`, [`idx_${table}_${col}_brin`]);
  }
}
