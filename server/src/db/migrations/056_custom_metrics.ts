import { Knex } from 'knex';

// Two concerns here: adding the 'metric' value to the script_purpose enum
// (needs to run outside a transaction because of Postgres ALTER TYPE
// semantics) and creating the device_custom_metrics table. Split into two
// migration files would be cleaner but keeping them together is acceptable
// given how small both parts are.
export const config = { transaction: false };

export async function up(knex: Knex): Promise<void> {
  // 1. Extend script_purpose enum
  const exists = await knex.raw(
    `SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = 'script_purpose' AND e.enumlabel = 'metric' LIMIT 1`,
  );
  if (!exists.rows || exists.rows.length === 0) {
    await knex.raw(`ALTER TYPE script_purpose ADD VALUE 'metric'`);
  }

  // 2. Create the custom-metrics table (one row per (device, schedule))
  const hasTable = await knex.schema.hasTable('device_custom_metrics');
  if (!hasTable) {
    await knex.schema.createTable('device_custom_metrics', (t) => {
      t.increments('id').primary();
      t.integer('device_id').notNullable().references('id').inTable('devices').onDelete('CASCADE');
      t.integer('schedule_id').notNullable().references('id').inTable('script_schedules').onDelete('CASCADE');
      t.integer('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      t.string('name').notNullable();               // display label (script-supplied or schedule name)
      t.text('value').notNullable();                // raw value as produced by the script
      t.string('unit').nullable();                  // e.g. "it/s", "%", "MB"
      t.string('status').notNullable().defaultTo('ok'); // ok | warning | critical | error
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.unique(['device_id', 'schedule_id']);
      t.index('device_id');
      t.index('tenant_id');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('device_custom_metrics');
}
