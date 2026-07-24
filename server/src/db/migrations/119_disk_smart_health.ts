import type { Knex } from 'knex';

/**
 * Disk health (SMART) storage.
 *
 * A dedicated table — deliberately NOT a JSONB blob on `devices`, whose
 * autovacuum was tightened in migration 118 for the metrics write-churn:
 * piling a SMART blob there would regenerate row versions on every scan.
 *
 * Fed out-of-band by a scheduled metric script (see command.service.ts) — the
 * 10s metrics push is never touched. One row per physical disk, replaced on
 * each report (unique on device_id + serial).
 *
 * `devices.last_disk_health_status` is the transition marker (mirrors
 * `last_metric_status`) so we only notify on state changes, not every scan.
 */
export async function up(knex: Knex): Promise<void> {
  const hasTable = await knex.schema.hasTable('device_smart_disks');
  if (!hasTable) {
    await knex.schema.createTable('device_smart_disks', (t) => {
      t.increments('id').primary();
      t.integer('device_id').notNullable().references('id').inTable('devices').onDelete('CASCADE');
      t.integer('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      t.string('serial', 200).notNullable().defaultTo('');
      t.string('model', 300).nullable();
      t.string('disk_type', 20).nullable();            // SSD | HDD | NVMe | unknown
      t.string('status', 10).notNullable().defaultTo('unknown'); // good | caution | bad | unknown
      t.integer('temperature_c').nullable();
      t.integer('health_percent').nullable();          // 0-100
      t.integer('wear_percent').nullable();            // 0-100 (SSD wear / NVMe % used)
      t.bigInteger('power_on_hours').nullable();
      t.bigInteger('reallocated_sectors').nullable();
      t.bigInteger('pending_sectors').nullable();
      t.jsonb('raw').nullable();                       // extra attributes for debug/future UI
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.unique(['device_id', 'serial']);
      t.index(['device_id']);
    });
  }

  const hasCol = await knex.schema.hasColumn('devices', 'last_disk_health_status');
  if (!hasCol) {
    await knex.schema.alterTable('devices', (t) => {
      t.string('last_disk_health_status', 10).nullable();
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('device_smart_disks');
  const hasCol = await knex.schema.hasColumn('devices', 'last_disk_health_status');
  if (hasCol) {
    await knex.schema.alterTable('devices', (t) => {
      t.dropColumn('last_disk_health_status');
    });
  }
}
