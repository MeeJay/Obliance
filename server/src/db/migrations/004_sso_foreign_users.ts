import type { Knex } from 'knex';

/**
 * 004_sso_foreign_users.ts
 *
 * Adds a `sso_foreign_users` join table so one local user can be linked to
 * multiple SSO sources (Obliview, Obliguard, Oblimap…) without the current
 * `users.foreign_source` single-column overwrite problem.
 *
 * Existing rows in `users` that already have a foreign_source are migrated
 * into the new table automatically.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('sso_foreign_users', (t) => {
    t.increments('id').primary();
    t.string('foreign_source', 64).notNullable();
    t.integer('foreign_user_id').notNullable();
    t.integer('local_user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.timestamps(true, true);
    t.unique(['foreign_source', 'foreign_user_id']);
  });

  // Migrate existing linked users
  const linked = await knex('users')
    .whereNotNull('foreign_source')
    .whereNotNull('foreign_id')
    .select('id', 'foreign_source', 'foreign_id');

  if (linked.length > 0) {
    await knex('sso_foreign_users').insert(
      linked.map((r: { id: number; foreign_source: string; foreign_id: number }) => ({
        foreign_source: r.foreign_source,
        foreign_user_id: r.foreign_id,
        local_user_id: r.id,
      })),
    );
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('sso_foreign_users');
}
