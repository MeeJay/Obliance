import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('device_licenses', (t) => {
    t.increments('id').primary();
    t.integer('device_id').notNullable().references('id').inTable('devices').onDelete('CASCADE');
    t.integer('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    t.string('software_name', 500).notNullable();
    t.string('license_key', 500).nullable();
    t.string('license_type', 50).nullable(); // per_device, per_user, volume, subscription, other
    t.integer('seats').nullable();
    t.date('expiry_date').nullable();
    t.string('vendor', 200).nullable();
    t.text('notes').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.index(['tenant_id', 'device_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('device_licenses');
}
