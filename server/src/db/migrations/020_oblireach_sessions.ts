import type { Knex } from 'knex';

/**
 * Adds a `sessions` column to oblireach_devices.
 *
 * Stores the last-known WTS session list reported by the Oblireach agent
 * on each push heartbeat (Windows only).  JSON array of:
 *   { id, username, state, stationName?, isConsole }
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('oblireach_devices', (t) => {
    t.text('sessions').nullable(); // JSON array of SessionInfo
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('oblireach_devices', (t) => {
    t.dropColumn('sessions');
  });
}
