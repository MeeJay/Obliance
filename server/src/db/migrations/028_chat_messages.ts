import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('chat_messages', (t) => {
    t.increments('id').primary();
    t.string('chat_id', 32).notNullable().index();
    t.integer('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    t.integer('device_id').references('id').inTable('devices').onDelete('SET NULL');
    t.string('sender', 200).notNullable();
    t.text('message').notNullable();
    t.boolean('is_operator').notNullable().defaultTo(false);
    t.boolean('is_system').notNullable().defaultTo(false);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('chat_messages');
}
