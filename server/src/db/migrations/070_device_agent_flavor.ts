import { Knex } from 'knex';

// Track whether a device runs the modern Go 1.22 agent or the Go 1.20
// legacy agent (Server 2008 R2 / 2012). Inference happens on each push —
// the legacy build omits the `distroFamily` field and has no WebSocket
// tunnel / ObliReach / software-compliance handlers. The server gates
// incompatible command types based on this flag.

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn('devices', 'agent_flavor'))) {
    await knex.schema.alterTable('devices', (t) => {
      t.string('agent_flavor', 16).notNullable().defaultTo('modern');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasColumn('devices', 'agent_flavor')) {
    await knex.schema.alterTable('devices', (t) => {
      t.dropColumn('agent_flavor');
    });
  }
}
