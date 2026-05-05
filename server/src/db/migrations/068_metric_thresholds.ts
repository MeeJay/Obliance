import { Knex } from 'knex';

// Lot D.2 — Per-group + per-device metric thresholds.
//
// Two JSONB columns: one on `device_groups` (group default applied to every
// device that doesn't override) and one on `devices` (per-device override
// that wins when present). Both default to '{}' meaning "use the system
// fallback" so existing rows keep their current behaviour.
//
// Resolved cascade at read-time:
//   device.thresholds_override → group.thresholds → system default
//
// Expected shape (validated app-side, kept loose at the DB level so future
// metric kinds don't require a migration):
//   { "disk": { "warn": 90, "crit": 95 }, "cpu": {...}, "ram": {...} }

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('device_groups', (t) => {
    t.jsonb('thresholds').notNullable().defaultTo('{}');
  });
  await knex.schema.alterTable('devices', (t) => {
    t.jsonb('thresholds_override').notNullable().defaultTo('{}');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('devices', (t) => { t.dropColumn('thresholds_override'); });
  await knex.schema.alterTable('device_groups', (t) => { t.dropColumn('thresholds'); });
}
