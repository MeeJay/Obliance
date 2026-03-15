import type { Knex } from 'knex';

/**
 * 003_sso_link_tokens.ts
 *
 * Adds sso_link_tokens table for cross-platform account linking flow.
 * When an SSO user's username collides with an existing local account,
 * a link token is issued so the user can verify ownership via local password.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('sso_link_tokens', (t) => {
    t.increments('id').primary();
    t.string('link_token', 128).notNullable().unique();
    t.string('foreign_source', 64).notNullable();
    t.integer('foreign_id').notNullable();
    t.text('foreign_source_url').notNullable();
    t.string('foreign_username', 64).notNullable();
    t.string('foreign_display_name', 128).nullable();
    t.string('foreign_role', 16).notNullable();
    t.string('foreign_email', 255).nullable();
    t.string('conflicting_username', 64).notNullable();
    t.timestamp('expires_at').notNullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('sso_link_tokens');
}
