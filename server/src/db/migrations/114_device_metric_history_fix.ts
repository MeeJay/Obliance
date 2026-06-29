import type { Knex } from 'knex';

/**
 * Self-healing fix for migration 113.
 *
 * 113 was edited after it had already been applied on some installs (device-
 * level disk → per-volume → +5-min tier). Knex tracks migrations by FILENAME,
 * so the later 113 revisions never ran on those DBs: the per-volume tables
 * (device_disk_*) and the 5-min tier (device_metric_5min / device_disk_5min)
 * were missing. The deployed code then failed to read/write them on EVERY push
 * (connection-pool churn → global slowness) and the device-detail "History"
 * endpoint 500'd (section vanished).
 *
 * This migration idempotently (re)creates EVERY table the current code needs,
 * guarded by hasTable — a no-op where 113 already created them, a heal where it
 * didn't. Tables that 113 created with extra/legacy columns are left untouched
 * (the writers only reference columns that exist in every revision).
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
  t.string('mount', 256).notNullable();
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

async function ensure(knex: Knex, table: string, cols: (t: Knex.CreateTableBuilder) => void) {
  if (!(await knex.schema.hasTable(table))) {
    await knex.schema.createTable(table, cols);
  }
}

export async function up(knex: Knex): Promise<void> {
  await ensure(knex, 'device_metric_5min', CPU_RAM_COLS);
  await ensure(knex, 'device_metric_hourly', CPU_RAM_COLS);
  await ensure(knex, 'device_metric_daily', CPU_RAM_COLS);
  await ensure(knex, 'device_disk_5min', DISK_COLS);
  await ensure(knex, 'device_disk_hourly', DISK_COLS);
  await ensure(knex, 'device_disk_daily', DISK_COLS);
}

export async function down(): Promise<void> {
  // No-op: tables are owned by migration 113's down(). This migration only heals.
}
