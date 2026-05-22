import { Knex } from 'knex';

// Extended per-VM consumption + info, kept in a single jsonb blob so we can
// grow the field set without a migration each time. Holds cpuUsagePercent,
// memoryDemandBytes, dynamicMemory, heartbeat, integrationSvcVer, version,
// statusText, guestOs, automaticStart, automaticStop.

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn('device_virtual_machines', 'metrics'))) {
    await knex.schema.alterTable('device_virtual_machines', (t) => {
      t.jsonb('metrics').notNullable().defaultTo('{}');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasColumn('device_virtual_machines', 'metrics')) {
    await knex.schema.alterTable('device_virtual_machines', (t) => {
      t.dropColumn('metrics');
    });
  }
}
