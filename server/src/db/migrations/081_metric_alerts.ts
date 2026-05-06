import { Knex } from 'knex';

// Adds the columns needed to flip a device's status (online/warning/
// critical) from its push metrics, and to silence those alerts on
// specific groups/devices.
//
//   - devices.last_metric_status: 'ok' | 'warning' | 'critical'
//     (nullable). Diffed at every push so we only fire a notification
//     on transition, not at every kept-bad sample.
//
//   - devices.metric_alerts_enabled, device_groups.metric_alerts_enabled
//     (nullable booleans). Cascade: device > group > default(true). NULL
//     means "inherit" — keeps the toggle declarative without forcing a
//     value on every existing row.
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn('devices', 'last_metric_status'))) {
    await knex.schema.alterTable('devices', (t) => {
      t.string('last_metric_status', 16);
    });
  }
  if (!(await knex.schema.hasColumn('devices', 'metric_alerts_enabled'))) {
    await knex.schema.alterTable('devices', (t) => {
      t.boolean('metric_alerts_enabled');
    });
  }
  if (!(await knex.schema.hasColumn('device_groups', 'metric_alerts_enabled'))) {
    await knex.schema.alterTable('device_groups', (t) => {
      t.boolean('metric_alerts_enabled');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  for (const [table, col] of [
    ['devices', 'last_metric_status'],
    ['devices', 'metric_alerts_enabled'],
    ['device_groups', 'metric_alerts_enabled'],
  ] as const) {
    if (await knex.schema.hasColumn(table, col)) {
      await knex.schema.alterTable(table, (t) => t.dropColumn(col));
    }
  }
}
