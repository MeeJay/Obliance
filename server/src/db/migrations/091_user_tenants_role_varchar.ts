import { Knex } from 'knex';

// Switch user_tenants.role from the `tenant_role` enum (admin / member)
// to a free-form VARCHAR(64). The role is now a permission_set slug —
// Obligate sends 'admin', 'user', 'viewer' or any custom slug the
// operator created in the PermissionSets UI, and the runtime check
// (permission.service.userHasTenantCapability) joins user_tenants.role
// against permission_sets.slug to resolve the actual capability set.
//
// Existing rows with role='member' are backfilled to 'user' since the
// seeded permission_sets table uses 'user' as the default non-admin
// slug — leaving them as 'member' would orphan the lookup.

export async function up(knex: Knex): Promise<void> {
  // 1. Drop the default so the type change doesn't trip on the enum literal.
  await knex.raw(`ALTER TABLE user_tenants ALTER COLUMN role DROP DEFAULT`);
  // 2. Convert enum → varchar (USING cast preserves the existing values).
  await knex.raw(`ALTER TABLE user_tenants ALTER COLUMN role TYPE VARCHAR(64) USING role::text`);
  // 3. Backfill 'member' → 'user' to match the seeded permission_set slug.
  await knex('user_tenants').where({ role: 'member' }).update({ role: 'user' });
  // 4. Restore a sane default. 'user' is the default non-admin slug.
  await knex.raw(`ALTER TABLE user_tenants ALTER COLUMN role SET DEFAULT 'user'`);
  // 5. Drop the now-unused enum type.
  await knex.raw(`DROP TYPE IF EXISTS tenant_role`);
}

export async function down(knex: Knex): Promise<void> {
  // Recreate the enum and shoehorn data back into it. Any custom-slug
  // roles introduced after the migration ran are downgraded to 'member'
  // since the enum can't represent them.
  await knex.raw(`CREATE TYPE tenant_role AS ENUM ('admin', 'member')`);
  await knex.raw(`ALTER TABLE user_tenants ALTER COLUMN role DROP DEFAULT`);
  // Coerce anything other than 'admin' to 'member' before the type change.
  await knex.raw(`UPDATE user_tenants SET role = 'member' WHERE role <> 'admin'`);
  await knex.raw(`ALTER TABLE user_tenants ALTER COLUMN role TYPE tenant_role USING role::tenant_role`);
  await knex.raw(`ALTER TABLE user_tenants ALTER COLUMN role SET DEFAULT 'member'`);
}
