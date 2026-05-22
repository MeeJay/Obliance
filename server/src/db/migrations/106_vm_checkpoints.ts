import { Knex } from 'knex';

// Store per-VM checkpoint details (name / created / parent) so the
// checkpoint-manager UI can list, apply and delete specific checkpoints.
// The agent enumerates these alongside the VM list.

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn('device_virtual_machines', 'checkpoints'))) {
    await knex.schema.alterTable('device_virtual_machines', (t) => {
      t.jsonb('checkpoints').notNullable().defaultTo('[]');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasColumn('device_virtual_machines', 'checkpoints')) {
    await knex.schema.alterTable('device_virtual_machines', (t) => {
      t.dropColumn('checkpoints');
    });
  }
}
