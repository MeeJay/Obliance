import { Knex } from 'knex';

export const config = { transaction: false };

// Adds the `metric_custom` scenario trigger type so admins can build
// scenarios that fire on arbitrary CPU/RAM/Disk thresholds with a
// comparator (above/below) — distinct from the system-level warning/
// critical thresholds. Cf. `trigger_metric_custom` node config.
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
  await ensureEnumValue(knex, 'scenario_trigger_type', 'metric_custom');
}

export async function down(_knex: Knex): Promise<void> {
  // Removing enum values requires recreating the type — leave it intact.
}
