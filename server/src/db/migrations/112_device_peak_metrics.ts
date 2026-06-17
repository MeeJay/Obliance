import type { Knex } from 'knex';

/**
 * Per-device peak (max) resource usage, accumulated server-side on every push.
 *
 * `latest_metrics` only holds the current snapshot, so the device export had no
 * way to surface "how hard did this machine ever run" — needed for a micro
 * inventory (CPU/RAM/Disk total + max per machine). We keep a tiny running max
 * in a dedicated JSONB column rather than a full time-series table: cheap to
 * update (element-wise max in handlePush, no extra row writes) and enough for
 * the export. Shape:
 *   { cpu: number, ram: number, disk: number, since: string(ISO) }
 * where cpu/ram/disk are the highest percentages ever observed and `since` is
 * when tracking started (so the export can show the peak window).
 *
 * Peaks only accumulate from this migration onward — there is no backfill.
 */
export async function up(knex: Knex): Promise<void> {
  const has = await knex.schema.hasColumn('devices', 'peak_metrics');
  if (!has) {
    await knex.schema.alterTable('devices', (t) => {
      t.jsonb('peak_metrics').nullable();
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const has = await knex.schema.hasColumn('devices', 'peak_metrics');
  if (has) {
    await knex.schema.alterTable('devices', (t) => {
      t.dropColumn('peak_metrics');
    });
  }
}
