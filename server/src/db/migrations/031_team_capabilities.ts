import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('team_permissions', (t) => {
    // Capabilities: ['monitor', 'execute', 'remote', 'files', 'power']
    // Default for RO: ['monitor'], for RW: ['monitor', 'execute']
    t.jsonb('capabilities').defaultTo('["monitor"]');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('team_permissions', (t) => {
    t.dropColumn('capabilities');
  });
}
