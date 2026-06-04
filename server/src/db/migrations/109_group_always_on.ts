import { Knex } from 'knex';

// "Always On" group flag. When true, every device in the group (and its
// sub-groups, via inheritance) is expected to be permanently powered on:
// if one stops responding to Obliance, that's treated as a CRITICAL fault
// and fires an immediate channel notification (Slack/email/etc.), and the
// in-app bell alert is raised at 'critical' severity instead of the benign
// 'info' used for ordinary user workstations.

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn('device_groups', 'always_on'))) {
    await knex.schema.alterTable('device_groups', (t) => {
      t.boolean('always_on').notNullable().defaultTo(false);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasColumn('device_groups', 'always_on')) {
    await knex.schema.alterTable('device_groups', (t) => {
      t.dropColumn('always_on');
    });
  }
}
