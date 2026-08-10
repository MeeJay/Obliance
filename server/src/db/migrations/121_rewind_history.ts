import type { Knex } from 'knex';

/**
 * "Rewind" (time-machine) history — point-in-time snapshots of a device's
 * running PROCESSES and SERVICES, to complement the existing metric buckets
 * (device_metric_* / device_disk_*). Retained 7 days (see pruneRewindHistory).
 *
 * Storage strategy for 4000 devices: ONE jsonb row per snapshot (NOT one row
 * per process/service). Processes keep only a top-N slice. Services dedup on a
 * content hash so a stable machine writes ~nothing between changes.
 *
 * Snapshots are captured server-side with ZERO agent change:
 *   - processes: rewindCollector dispatches the existing `list_processes`
 *     command on a ~5-min cadence and stores the result.
 *   - services:  the existing POST /api/agent/services push also writes a
 *     history row (dedup by hash) alongside the latest_services overwrite.
 */
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('device_process_history'))) {
    await knex.schema.createTable('device_process_history', (t) => {
      t.bigIncrements('id').primary();
      t.integer('device_id').notNullable().references('id').inTable('devices').onDelete('CASCADE');
      t.integer('tenant_id').notNullable();
      t.timestamp('captured_at', { useTz: true }).notNullable();
      t.integer('process_count').notNullable().defaultTo(0); // total procs on the machine
      t.float('cpu_total').nullable();                        // sum of cpu% across all procs (if known)
      t.float('mem_used_mb').nullable();                      // sum of RSS across all procs (if known)
      t.jsonb('procs').notNullable();                         // top-N: [{pid,name,cpu,memMb,user}]
      t.index(['device_id', 'captured_at']);
    });
  }

  if (!(await knex.schema.hasTable('device_service_history'))) {
    await knex.schema.createTable('device_service_history', (t) => {
      t.bigIncrements('id').primary();
      t.integer('device_id').notNullable().references('id').inTable('devices').onDelete('CASCADE');
      t.integer('tenant_id').notNullable();
      t.timestamp('captured_at', { useTz: true }).notNullable();
      t.string('content_hash', 64).notNullable();             // sha256 of the service set → dedup
      t.integer('service_count').notNullable().defaultTo(0);
      t.integer('running_count').notNullable().defaultTo(0);
      t.jsonb('services').notNullable();                      // [{name,displayName,status,startType,user}]
      t.index(['device_id', 'captured_at']);
    });
  }

  const hasCol = await knex.schema.hasColumn('devices', 'last_process_snapshot_at');
  if (!hasCol) {
    await knex.schema.alterTable('devices', (t) => {
      t.timestamp('last_process_snapshot_at', { useTz: true }).nullable();
      t.index(['last_process_snapshot_at'], 'idx_devices_last_process_snapshot_at');
    });
  }

  // These tables see steady inserts + a rolling 6h delete slice at prune time.
  // Nudge autovacuum so post-delete dead tuples are reclaimed promptly.
  await knex.raw('ALTER TABLE device_process_history SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.02)');
  await knex.raw('ALTER TABLE device_service_history SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.02)');
}

export async function down(knex: Knex): Promise<void> {
  const hasCol = await knex.schema.hasColumn('devices', 'last_process_snapshot_at');
  if (hasCol) {
    await knex.schema.alterTable('devices', (t) => {
      t.dropIndex(['last_process_snapshot_at'], 'idx_devices_last_process_snapshot_at');
      t.dropColumn('last_process_snapshot_at');
    });
  }
  await knex.schema.dropTableIfExists('device_service_history');
  await knex.schema.dropTableIfExists('device_process_history');
}
