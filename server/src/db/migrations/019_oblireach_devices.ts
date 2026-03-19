import type { Knex } from 'knex';

/**
 * Adds the oblireach_devices table.
 *
 * The Oblireach agent is a separate binary deployed alongside the Obliance
 * agent.  It registers itself here on each push heartbeat so the server knows
 * the Oblireach agent is installed on a device and can queue commands for it.
 *
 * pending_command: JSON blob set by the server, cleared after delivery.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('oblireach_devices', (t) => {
    t.increments('id');
    t.integer('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    t.text('device_uuid').notNullable();       // hardware UUID — matches devices.uuid
    t.text('hostname');
    t.text('os');
    t.text('arch');
    t.text('version');
    t.jsonb('pending_command').nullable();     // next command to deliver to Oblireach agent
    t.timestamp('last_seen_at').defaultTo(knex.fn.now());
    t.timestamp('created_at').defaultTo(knex.fn.now());

    t.unique(['device_uuid', 'tenant_id']);
  });

  await knex.schema.alterTable('app_config', (_t) => {
    // No schema change needed — we use the key/value store.
    // Default 'integrated_oblireach_enabled' = 'true' is inserted below.
  });

  // Insert default app_config setting if it doesn't exist
  const exists = await knex('app_config').where({ key: 'integrated_oblireach_enabled' }).first();
  if (!exists) {
    await knex('app_config').insert({ key: 'integrated_oblireach_enabled', value: 'true' });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('oblireach_devices');
  await knex('app_config').where({ key: 'integrated_oblireach_enabled' }).delete();
}
