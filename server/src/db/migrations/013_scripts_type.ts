import type { Knex } from 'knex';

// Add script_type column to scripts table.
// 'system' = built-in Obliance scripts (visible to all, admins can edit)
// 'user'   = tenant-created scripts (default)

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('scripts', (t) => {
    t.string('script_type', 20).notNullable().defaultTo('user');
  });
  // Existing is_builtin scripts become 'system'
  await knex('scripts').where({ is_builtin: true }).update({ script_type: 'system' });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('scripts', (t) => {
    t.dropColumn('script_type');
  });
}
