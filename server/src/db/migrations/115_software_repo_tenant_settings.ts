import type { Knex } from 'knex';

/**
 * Per-tenant software-repository controls:
 *   - repo_enabled        : master can fully turn the depot off for a tenant.
 *                           When false, uploads AND downloads (UI, agent,
 *                           script access-key) are refused.
 *   - repo_quota_bytes     : hard storage cap per tenant. NULL = unlimited.
 *                           Enforced on upload (sum of package file_size).
 *   - repo_access_key_hash : sha256 of the tenant's script access key. Scripts
 *                            authenticate against /api/repo/download/:uuid with
 *                            this key (header X-Repo-Key or ?key=). Only the
 *                            hash is stored; the plaintext is shown once at
 *                            generation time.
 *   - repo_access_key_prefix : first chars of the key, for display in the UI
 *                              so an admin can recognise which key is active.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('tenants', (t) => {
    t.boolean('repo_enabled').notNullable().defaultTo(true);
    t.bigInteger('repo_quota_bytes').nullable();
    t.string('repo_access_key_hash', 128).nullable();
    t.string('repo_access_key_prefix', 32).nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('tenants', (t) => {
    t.dropColumn('repo_enabled');
    t.dropColumn('repo_quota_bytes');
    t.dropColumn('repo_access_key_hash');
    t.dropColumn('repo_access_key_prefix');
  });
}
