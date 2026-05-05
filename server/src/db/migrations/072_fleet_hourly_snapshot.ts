import { Knex } from 'knex';

// Hourly fleet metrics snapshot — feeds the dashboard "Activité du parc"
// 24h view, which the daily snapshot table can't render (1 point per day).
//
// Row per (tenant_id, hour). The hourly granularity keeps the table small
// (~168 rows / tenant / week with the 7-day retention we run in the cron),
// so the dashboard query is cheap and we don't need to special-case
// resolution in the chart code beyond rendering hour labels on the X axis.

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('fleet_hourly_snapshot'))) {
    await knex.schema.createTable('fleet_hourly_snapshot', (t) => {
      t.increments('id').primary();
      t.integer('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      t.timestamp('hour').notNullable();
      t.integer('total').notNullable().defaultTo(0);
      t.integer('online').notNullable().defaultTo(0);
      t.integer('offline').notNullable().defaultTo(0);
      t.integer('warning').notNullable().defaultTo(0);
      t.integer('critical').notNullable().defaultTo(0);
      t.integer('pending_updates').notNullable().defaultTo(0);
      t.integer('stale_72h').notNullable().defaultTo(0);
      t.integer('active_remote_sessions').notNullable().defaultTo(0);
      t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      t.unique(['tenant_id', 'hour']);
      t.index(['tenant_id', 'hour']);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable('fleet_hourly_snapshot')) {
    await knex.schema.dropTable('fleet_hourly_snapshot');
  }
}
