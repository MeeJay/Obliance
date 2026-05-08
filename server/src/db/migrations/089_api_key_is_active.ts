import { Knex } from 'knex';

// SECURITY: revocation flag for agent API keys. Without this, the only
// way to invalidate a leaked key was to DELETE it — which orphans every
// device that used it (devices.api_key_id → SET NULL → first push
// re-registers as fresh / pending). With `is_active`, an admin can
// pull the plug instantly while keeping the device row + history.
//
// Defaults to TRUE for the existing rows so behaviour is unchanged on
// upgrade. Auth paths now check `is_active` and reject revoked keys
// at HTTP push, WS command channel, and WS remote tunnel — the three
// places agents authenticate.

export async function up(knex: Knex): Promise<void> {
  const hasCol = await knex.schema.hasColumn('agent_api_keys', 'is_active');
  if (!hasCol) {
    await knex.schema.alterTable('agent_api_keys', (t) => {
      t.boolean('is_active').notNullable().defaultTo(true);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasCol = await knex.schema.hasColumn('agent_api_keys', 'is_active');
  if (hasCol) {
    await knex.schema.alterTable('agent_api_keys', (t) => {
      t.dropColumn('is_active');
    });
  }
}
