import { Knex } from 'knex';

// Self-reference on scripts so the library can render check → resolve chains
// (or any user-defined hierarchy) as indented trees. ON DELETE SET NULL so
// removing a parent script doesn't delete its children — they just float
// back to the top level. No cycle constraint at the DB level; the service
// validates that parent_script_id never points to a descendant.

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('scripts', (t) => {
    t.integer('parent_script_id').nullable()
      .references('id').inTable('scripts').onDelete('SET NULL');
    t.index(['parent_script_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('scripts', (t) => {
    t.dropColumn('parent_script_id');
  });
}
