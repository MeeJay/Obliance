import type { Knex } from 'knex';

// Per-metric alerts switch (`notify` in the threshold JSON) — separate
// transition memory for NOTIFICATIONS.
//
//   - devices.last_metric_status (081) keeps driving the scenario triggers
//     metric_warning / metric_critical: it is the level of EVERY breach.
//   - devices.last_metric_alert_status (new) is the ALERTABLE level: the
//     same evaluation restricted to the metrics whose alerts are on. The
//     notification channels and the live alerts (web bell, mobile
//     "À traiter") fire on its transitions only.
//
// Nullable, no default: adding it is a catalog-only change in PostgreSQL
// (no table rewrite). A NULL value is read as `last_metric_status`.
// Backfill = copy of last_metric_status so the deploy produces no spurious
// alert or recovery (nothing is muted before this feature exists), done
// in bounded batches so a large `devices` table is never locked row-wide
// in one statement. Idempotent: the column guard and the
// `IS NULL` filter make a re-run a no-op.
const BATCH = 5000;

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn('devices', 'last_metric_alert_status'))) {
    await knex.schema.alterTable('devices', (t) => {
      t.string('last_metric_alert_status', 16).nullable();
    });
  }

  for (;;) {
    const res = await knex.raw(
      `UPDATE devices
          SET last_metric_alert_status = last_metric_status
        WHERE id IN (
          SELECT id FROM devices
           WHERE last_metric_alert_status IS NULL
             AND last_metric_status IS NOT NULL
           LIMIT ?
        )`,
      [BATCH],
    ) as { rowCount?: number | null };
    if (!res.rowCount) break;
  }
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasColumn('devices', 'last_metric_alert_status')) {
    await knex.schema.alterTable('devices', (t) => t.dropColumn('last_metric_alert_status'));
  }
}
