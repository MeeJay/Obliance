import type { Knex } from 'knex';

// Live alerts — resolution of incidents. Owner request: a recovery must
// replace (remove) the alert instead of adding a "back to normal" row, so
// a flapping device no longer floods the web bell / the mobile inbox.
//
//   live_alerts.resolved_at  NULL = active (listed, counted);
//                            set  = resolved: hidden from every list, never
//                                   deleted by this feature (the per-tenant
//                                   200-row trim still applies).
//
// Incidents (liveAlert.service): one device + one alert kind with a
// recovery — stable keys device:{id}:metric:warning|critical,
// device:{id}:offline, device:{id}:diskhealth:caution|bad,
// device:{id}:duplicate_agent_id.
//
// live_alerts is capped at 200 rows per tenant, so it stays small: adding
// a nullable column without default is catalog-only (no rewrite) and the
// partial indexes build instantly.
//   - (stable_key) WHERE resolved_at IS NULL: "active rows of an incident"
//     (every raise and every recovery);
//   - (tenant_id, id DESC) WHERE resolved_at IS NULL: the lists (ordered
//     by id, the serial the web and the phone use as high-water mark).
//
// Backfill, on rows still active only (a re-run changes nothing the
// current device state does not already dictate):
//   1. the legacy "back to normal" info rows (no stable key) are resolved:
//      the server no longer creates them and their incident is over;
//   2. incident rows of a device that already recovered are resolved
//      (alertable metric level ok, status not offline, disk health not
//      caution/bad, duplicate flag cleared), and those of a device that no
//      longer exists (it can never recover; deletions now resolve them);
//   3. for an incident still open, only its newest row stays active.

// Device id of an incident stable key, evaluated only for well-formed
// keys (CASE guarantees the cast never sees anything else).
const DEVICE_ID = `CASE WHEN la.stable_key ~ '^device:[0-9]{1,9}:' THEN split_part(la.stable_key, ':', 2)::int END`;

// Incident of a stable key (severity suffix stripped), NULL for others.
const INCIDENT = `CASE
  WHEN stable_key ~ '^device:[0-9]{1,9}:metric:(warning|critical)$' THEN regexp_replace(stable_key, ':(warning|critical)$', '')
  WHEN stable_key ~ '^device:[0-9]{1,9}:diskhealth:(caution|bad)$' THEN regexp_replace(stable_key, ':(caution|bad)$', '')
  WHEN stable_key ~ '^device:[0-9]{1,9}:(offline|duplicate_agent_id)$' THEN stable_key
END`;

const RECOVERED: Array<{ key: string; recovered: string }> = [
  {
    key: `^device:[0-9]{1,9}:metric:(warning|critical)$`,
    recovered: `COALESCE(d.last_metric_alert_status, d.last_metric_status, 'ok') NOT IN ('warning', 'critical')`,
  },
  { key: `^device:[0-9]{1,9}:offline$`, recovered: `d.status <> 'offline'` },
  {
    key: `^device:[0-9]{1,9}:diskhealth:(caution|bad)$`,
    recovered: `COALESCE(d.last_disk_health_status, 'good') NOT IN ('caution', 'bad')`,
  },
  { key: `^device:[0-9]{1,9}:duplicate_agent_id$`, recovered: `NOT COALESCE(d.duplicate_agent_id_suspected, false)` },
];

const LEGACY_RECOVERY_TITLES = [
  '%: retour à la normale',
  '%: De retour en ligne',
  '%: santé disque revenue à la normale',
];

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn('live_alerts', 'resolved_at'))) {
    await knex.schema.alterTable('live_alerts', (t) => {
      t.timestamp('resolved_at', { useTz: true }).nullable();
    });
  }
  await knex.raw(
    `CREATE INDEX IF NOT EXISTS live_alerts_active_stable_key_idx
       ON live_alerts (stable_key) WHERE resolved_at IS NULL`,
  );
  // (An early build of this migration indexed created_at; never deployed.)
  await knex.raw('DROP INDEX IF EXISTS live_alerts_active_tenant_created_idx');
  await knex.raw(
    `CREATE INDEX IF NOT EXISTS live_alerts_active_tenant_id_idx
       ON live_alerts (tenant_id, id DESC) WHERE resolved_at IS NULL`,
  );

  // 1. Legacy "back to normal" rows.
  await knex.raw(
    `UPDATE live_alerts SET resolved_at = now()
      WHERE resolved_at IS NULL
        AND stable_key IS NULL
        AND severity = 'info'
        AND (${LEGACY_RECOVERY_TITLES.map(() => 'title LIKE ?').join(' OR ')})`,
    LEGACY_RECOVERY_TITLES,
  );

  // 2. Incidents whose device already recovered.
  for (const { key, recovered } of RECOVERED) {
    await knex.raw(
      `UPDATE live_alerts la SET resolved_at = now()
        WHERE la.resolved_at IS NULL
          AND la.stable_key ~ '${key}'
          AND EXISTS (SELECT 1 FROM devices d WHERE d.id = ${DEVICE_ID} AND ${recovered})`,
    );
  }
  // ... and incidents of a device that no longer exists.
  await knex.raw(
    `UPDATE live_alerts la SET resolved_at = now()
      WHERE la.resolved_at IS NULL
        AND la.stable_key ~ '${RECOVERED.map((r) => `(${r.key})`).join('|')}'
        AND NOT EXISTS (SELECT 1 FROM devices d WHERE d.id = ${DEVICE_ID})`,
  );

  // 3. At most one active row per incident: the newest.
  await knex.raw(
    `UPDATE live_alerts SET resolved_at = now()
      WHERE id IN (
        SELECT id FROM (
          SELECT id, ${INCIDENT} AS incident,
                 row_number() OVER (PARTITION BY ${INCIDENT} ORDER BY id DESC) AS rn
            FROM live_alerts
           WHERE resolved_at IS NULL AND stable_key IS NOT NULL
        ) x
        WHERE x.incident IS NOT NULL AND x.rn > 1
      )`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS live_alerts_active_tenant_id_idx');
  await knex.raw('DROP INDEX IF EXISTS live_alerts_active_tenant_created_idx');
  await knex.raw('DROP INDEX IF EXISTS live_alerts_active_stable_key_idx');
  if (await knex.schema.hasColumn('live_alerts', 'resolved_at')) {
    await knex.schema.alterTable('live_alerts', (t) => t.dropColumn('resolved_at'));
  }
}
