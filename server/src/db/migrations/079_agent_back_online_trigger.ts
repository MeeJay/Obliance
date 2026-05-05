import { Knex } from 'knex';

export const config = { transaction: false };

// Adds the 'agent_back_online' trigger type + a `last_offline_at`
// column on devices so the scenario engine can fire a graph only
// after a sustained outage (debounced against transient flaps).
//
// Flow:
//   - checkOfflineDevices flips a device online → offline → records
//     last_offline_at = now()
//   - on the next push, handlePush sees prevStatus='offline' and
//     computes (now - last_offline_at). If the duration is at least
//     the per-trigger-node `offlineDelaySeconds`, fireTrigger fires
//     scenarios with a `trigger_agent_back_online` node.

async function ensureEnumValue(knex: Knex, typeName: string, value: string): Promise<void> {
  const exists = await knex.raw(
    `SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = ? AND e.enumlabel = ? LIMIT 1`,
    [typeName, value],
  );
  if (!exists.rows || exists.rows.length === 0) {
    await knex.raw(`ALTER TYPE ${typeName} ADD VALUE '${value}'`);
  }
}

export async function up(knex: Knex): Promise<void> {
  await ensureEnumValue(knex, 'scenario_trigger_type', 'agent_back_online');

  const exists = await knex.schema.hasColumn('devices', 'last_offline_at');
  if (!exists) {
    await knex.schema.alterTable('devices', (t) => {
      t.timestamp('last_offline_at', { useTz: true });
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  // Removing an enum value in Postgres requires recreating the type;
  // we leave the value in place — it stays a no-op when no nodes
  // reference it. Drop only the column.
  const exists = await knex.schema.hasColumn('devices', 'last_offline_at');
  if (exists) {
    await knex.schema.alterTable('devices', (t) => {
      t.dropColumn('last_offline_at');
    });
  }
}
