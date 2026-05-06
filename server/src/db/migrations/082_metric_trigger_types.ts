import { Knex } from 'knex';

export const config = { transaction: false };

// Adds the metric breach scenario trigger types so the engine can wire
// `trigger_metric_warning` / `trigger_metric_critical` nodes against
// the corresponding events fired from device.service.handlePush.
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
  await ensureEnumValue(knex, 'scenario_trigger_type', 'metric_warning');
  await ensureEnumValue(knex, 'scenario_trigger_type', 'metric_critical');
}

export async function down(_knex: Knex): Promise<void> {
  // Removing enum values requires recreating the type — leave them
  // intact, they're harmless when no node references them.
}
