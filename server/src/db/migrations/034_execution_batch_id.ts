import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('script_executions', (t) => {
    t.uuid('batch_id');
    t.index('batch_id');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('script_executions', (t) => {
    t.dropColumn('batch_id');
  });
}
