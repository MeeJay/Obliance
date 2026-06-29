import type { Knex } from 'knex';

/**
 * Per-device metric HISTORY via pre-aggregated rolling buckets.
 *
 * No raw per-push samples: each push folds into ONE bucket per granularity via
 * an atomic UPSERT (device.service.recordMetricHistory). 5-min buckets feed the
 * 1h window, hourly buckets the 24h window, daily buckets the 7d/30d windows. A
 * prune job keeps 5-min ≤3h, hourly ≤72h, daily ≤40d.
 *
 *  - CPU/RAM are DEVICE-level → device_metric_hourly / _daily.
 *  - Disk is PER-VOLUME (a full system disk ≠ a calm data disk) → device_disk_
 *    hourly / _daily, keyed by (device_id, mount, bucket).
 *
 * Columns are plain numerics (not JSONB) so AVG/MAX/MIN/SUM run in SQL. The
 * metric columns are intentionally NOT indexed, so the hot current bucket gets
 * HOT updates without index bloat. `*_sum` + `samples` → avg; `*_max/_min` →
 * peak/trough; `used_gb_last/total_gb_last` (last sample of the bucket) → the
 * capacity + the per-window "disk delta" (used_now − used at the oldest bucket).
 */
const CPU_RAM_COLS = (t: Knex.CreateTableBuilder) => {
  t.bigIncrements('id').primary();
  t.integer('device_id').notNullable().references('id').inTable('devices').onDelete('CASCADE');
  t.integer('tenant_id').notNullable();
  t.timestamp('bucket', { useTz: true }).notNullable();
  t.float('cpu_sum').notNullable().defaultTo(0);
  t.float('ram_sum').notNullable().defaultTo(0);
  t.integer('samples').notNullable().defaultTo(0);
  t.float('cpu_max').notNullable().defaultTo(0);
  t.float('cpu_min').notNullable().defaultTo(0);
  t.float('ram_max').notNullable().defaultTo(0);
  t.float('ram_min').notNullable().defaultTo(0);
  t.unique(['device_id', 'bucket']);
  t.index(['tenant_id', 'bucket']);
};

const DISK_COLS = (t: Knex.CreateTableBuilder) => {
  t.bigIncrements('id').primary();
  t.integer('device_id').notNullable().references('id').inTable('devices').onDelete('CASCADE');
  t.integer('tenant_id').notNullable();
  t.string('mount', 256).notNullable(); // "/", "C:", "/data", …
  t.timestamp('bucket', { useTz: true }).notNullable();
  t.float('pct_sum').notNullable().defaultTo(0);
  t.integer('samples').notNullable().defaultTo(0);
  t.float('pct_max').notNullable().defaultTo(0);
  t.float('pct_min').notNullable().defaultTo(0);
  t.float('used_gb_last').notNullable().defaultTo(0);
  t.float('total_gb_last').notNullable().defaultTo(0);
  t.unique(['device_id', 'mount', 'bucket']);
  t.index(['tenant_id', 'bucket']);
};

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('device_metric_5min'))) await knex.schema.createTable('device_metric_5min', CPU_RAM_COLS);
  if (!(await knex.schema.hasTable('device_metric_hourly'))) await knex.schema.createTable('device_metric_hourly', CPU_RAM_COLS);
  if (!(await knex.schema.hasTable('device_metric_daily'))) await knex.schema.createTable('device_metric_daily', CPU_RAM_COLS);
  if (!(await knex.schema.hasTable('device_disk_5min'))) await knex.schema.createTable('device_disk_5min', DISK_COLS);
  if (!(await knex.schema.hasTable('device_disk_hourly'))) await knex.schema.createTable('device_disk_hourly', DISK_COLS);
  if (!(await knex.schema.hasTable('device_disk_daily'))) await knex.schema.createTable('device_disk_daily', DISK_COLS);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('device_disk_daily');
  await knex.schema.dropTableIfExists('device_disk_hourly');
  await knex.schema.dropTableIfExists('device_disk_5min');
  await knex.schema.dropTableIfExists('device_metric_daily');
  await knex.schema.dropTableIfExists('device_metric_hourly');
  await knex.schema.dropTableIfExists('device_metric_5min');
}
