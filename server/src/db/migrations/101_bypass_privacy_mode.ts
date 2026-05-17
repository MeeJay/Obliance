import { Knex } from 'knex';

// Adds a per-automation toggle that lets the scenario or schedule run on
// devices currently in privacy mode. Default off — without this flag the
// engine skips privacy-mode devices so an admin policy doesn't quietly
// override a user's privacy choice. Flipping it on is gated through the
// action-restriction matrix (see migration 102).

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn('scenarios', 'bypass_privacy_mode'))) {
    await knex.schema.alterTable('scenarios', (t) => {
      t.boolean('bypass_privacy_mode').notNullable().defaultTo(false);
    });
  }
  if (!(await knex.schema.hasColumn('script_schedules', 'bypass_privacy_mode'))) {
    await knex.schema.alterTable('script_schedules', (t) => {
      t.boolean('bypass_privacy_mode').notNullable().defaultTo(false);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasColumn('scenarios', 'bypass_privacy_mode')) {
    await knex.schema.alterTable('scenarios', (t) => {
      t.dropColumn('bypass_privacy_mode');
    });
  }
  if (await knex.schema.hasColumn('script_schedules', 'bypass_privacy_mode')) {
    await knex.schema.alterTable('script_schedules', (t) => {
      t.dropColumn('bypass_privacy_mode');
    });
  }
}
