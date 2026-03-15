import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // ── 1. Allow password_hash to be NULL (foreign users have no local password) ─
  await knex.schema.alterTable('users', (t) => {
    t.string('password_hash', 255).nullable().alter();
    t.string('foreign_source', 64).nullable();       // e.g. 'obliview'
    t.integer('foreign_id').nullable();              // user ID on the source platform
    t.string('foreign_source_url', 512).nullable(); // base URL of source platform
  });

  // ── 2. One-time switch tokens for cross-app SSO ───────────────────────────
  await knex.schema.createTable('sso_tokens', (t) => {
    t.increments('id').primary();
    t.string('token', 128).notNullable().unique();
    t.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.timestamp('expires_at', { useTz: true }).notNullable();
    t.boolean('used').notNullable().defaultTo(false);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('sso_tokens');
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('foreign_source_url');
    t.dropColumn('foreign_id');
    t.dropColumn('foreign_source');
    // Restore NOT NULL (only safe if all users have a password hash)
    t.string('password_hash', 255).notNullable().alter();
  });
}
