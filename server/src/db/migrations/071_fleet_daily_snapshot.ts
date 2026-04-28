import { Knex } from 'knex';

// Daily fleet metrics snapshot used by the dashboard hero row (deltas vs
// yesterday/last week) and the "Activité du parc" timeseries chart. A row
// per (tenant_id, day) is written by the device.service nightly job; the
// dashboard reads up to N days back to render sparklines.

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('fleet_daily_snapshot'))) {
    await knex.schema.createTable('fleet_daily_snapshot', (t) => {
      t.increments('id').primary();
      t.integer('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      t.date('day').notNullable();
      t.integer('total').notNullable().defaultTo(0);
      t.integer('online').notNullable().defaultTo(0);
      t.integer('offline').notNullable().defaultTo(0);
      t.integer('warning').notNullable().defaultTo(0);
      t.integer('critical').notNullable().defaultTo(0);
      t.integer('pending_updates').notNullable().defaultTo(0);
      t.integer('stale_72h').notNullable().defaultTo(0);
      t.integer('active_remote_sessions').notNullable().defaultTo(0);
      t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      t.unique(['tenant_id', 'day']);
      t.index(['tenant_id', 'day']);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable('fleet_daily_snapshot')) {
    await knex.schema.dropTable('fleet_daily_snapshot');
  }
}
