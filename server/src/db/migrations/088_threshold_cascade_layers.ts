import { Knex } from 'knex';

// Lot D.2 follow-up — extend the metric-threshold cascade from 3 layers
// (system → group → device) to 5 layers:
//
//   system (hardcoded SYSTEM_DEFAULT_THRESHOLDS in @obliance/shared)
//     ↓
//   global default (app_config.metric_thresholds_global, JSON string)
//     ↓
//   tenant default (tenants.metric_thresholds_default, JSONB column)
//     ↓
//   group           (device_groups.thresholds, already shipped)
//     ↓
//   device override (devices.thresholds_override, already shipped)
//
// Empty / missing slots fall through to the next layer below. The new
// columns are NULL by default so existing fleets see zero behaviour
// change until an admin opens /settings (global) or /policies (tenant)
// and dials in their own values.

const APP_CONFIG_KEY = 'metric_thresholds_global';

export async function up(knex: Knex): Promise<void> {
  // 1. tenants.metric_thresholds_default — JSONB so the cascade
  //    resolver can read it as-is. Index isn't needed (we only fetch
  //    by tenant id which is the PK).
  const hasCol = await knex.schema.hasColumn('tenants', 'metric_thresholds_default');
  if (!hasCol) {
    await knex.schema.alterTable('tenants', (t) => {
      t.jsonb('metric_thresholds_default').nullable();
    });
  }

  // 2. app_config row stays unset on first install — we treat the
  //    absence as "use the system default". No need to seed; the UI
  //    handles `null` cleanly. We just verify the table exists so
  //    upserts don't crash on a brand-new install where 001 hasn't run
  //    yet (defensive — Knex runs migrations in order so 001 always
  //    runs first, but the check is cheap).
  const hasAppConfig = await knex.schema.hasTable('app_config');
  if (!hasAppConfig) {
    throw new Error('migration 088: app_config table missing — 001_initial_schema must run first');
  }
  // No row insert: NULL/missing means "fall through to system default".
  // The PUT endpoint creates the row on first save.
  void APP_CONFIG_KEY;
}

export async function down(knex: Knex): Promise<void> {
  await knex('app_config').where({ key: APP_CONFIG_KEY }).del();
  const hasCol = await knex.schema.hasColumn('tenants', 'metric_thresholds_default');
  if (hasCol) {
    await knex.schema.alterTable('tenants', (t) => {
      t.dropColumn('metric_thresholds_default');
    });
  }
}
