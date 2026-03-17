import type { Knex } from 'knex';

/**
 * PostgreSQL treats NULL != NULL in unique constraints, so the standard
 * UNIQUE(tenant_id, scope, scope_id, key) index never detects conflicts when
 * scope_id IS NULL (global settings).  Duplicate global rows accumulate on
 * every call to settingsService.set() for the global scope.
 *
 * Fix:
 *  1. Remove duplicate global rows (keep the most-recently-updated one).
 *  2. Drop the old composite unique constraint.
 *  3. Add a partial index for global rows   (scope_id IS NULL).
 *  4. Add a partial index for scoped rows   (scope_id IS NOT NULL).
 */
export async function up(knex: Knex): Promise<void> {
  // 1. Deduplicate global rows – keep the row with the highest id per key.
  await knex.raw(`
    DELETE FROM settings a
    USING settings b
    WHERE a.id < b.id
      AND a.tenant_id = b.tenant_id
      AND a.scope     = b.scope
      AND a.key       = b.key
      AND a.scope_id IS NULL
      AND b.scope_id IS NULL
  `);

  // 2. Drop the old (broken for NULLs) unique constraint.
  await knex.raw(`
    ALTER TABLE settings
      DROP CONSTRAINT IF EXISTS settings_tenant_id_scope_scope_id_key_unique
  `);

  // 3. Partial unique index for global scope  (scope_id IS NULL).
  await knex.raw(`
    CREATE UNIQUE INDEX settings_global_uq
      ON settings (tenant_id, scope, key)
      WHERE scope_id IS NULL
  `);

  // 4. Partial unique index for scoped rows  (scope_id IS NOT NULL).
  await knex.raw(`
    CREATE UNIQUE INDEX settings_scoped_uq
      ON settings (tenant_id, scope, scope_id, key)
      WHERE scope_id IS NOT NULL
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`DROP INDEX IF EXISTS settings_global_uq`);
  await knex.raw(`DROP INDEX IF EXISTS settings_scoped_uq`);
  await knex.raw(`
    ALTER TABLE settings
      ADD CONSTRAINT settings_tenant_id_scope_scope_id_key_unique
      UNIQUE (tenant_id, scope, scope_id, key)
  `);
}
