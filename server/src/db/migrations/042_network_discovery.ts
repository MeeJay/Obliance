import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TYPE command_type ADD VALUE IF NOT EXISTS 'scan_network'`);

  await knex.schema.createTable('discovered_devices', (t) => {
    t.increments('id').primary();
    t.integer('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    t.integer('discovered_by_device_id').notNullable().references('id').inTable('devices').onDelete('CASCADE');
    t.string('ip', 45).notNullable();
    t.string('mac', 17).nullable();
    t.string('hostname', 500).nullable();
    t.jsonb('ports').defaultTo('[]');
    t.string('oui_vendor', 200).nullable();
    t.string('os_guess', 100).nullable();
    t.string('device_type', 50).defaultTo('unknown'); // pc, server, printer, iot, network, unknown
    t.boolean('is_managed').defaultTo(false);
    t.integer('managed_device_id').nullable().references('id').inTable('devices').onDelete('SET NULL');
    t.string('subnet', 50).nullable();
    t.timestamp('first_seen').notNullable().defaultTo(knex.fn.now());
    t.timestamp('last_seen').notNullable().defaultTo(knex.fn.now());
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.unique(['tenant_id', 'ip', 'mac']);
    t.index(['tenant_id', 'discovered_by_device_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('discovered_devices');
}
