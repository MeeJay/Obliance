import type { Knex } from 'knex';

/**
 * Native, server-driven disk-health collection.
 *
 * The SMART snapshot (migration 119) can be fed two ways:
 *   1. A user-created metric script + schedule (power users, custom cadence).
 *   2. The built-in `diskHealthCollector` service, which periodically ships an
 *      embedded probe to every eligible device with ZERO agent change and ZERO
 *      admin action (delivered in the Docker image).
 *
 * `devices.last_disk_probe_at` lets the collector cheaply pick the stalest
 * devices each tick and skip the ones it already probed within the interval —
 * INCLUDING disk-less devices (VMs, RAID controllers) that never produce a
 * `device_smart_disks` row, so we can't derive staleness from that table alone.
 */
export async function up(knex: Knex): Promise<void> {
  const has = await knex.schema.hasColumn('devices', 'last_disk_probe_at');
  if (!has) {
    await knex.schema.alterTable('devices', (t) => {
      t.timestamp('last_disk_probe_at', { useTz: true }).nullable();
    });
    // Ordering index for the "stalest first, NULLs first" eligibility scan.
    await knex.schema.alterTable('devices', (t) => {
      t.index(['last_disk_probe_at'], 'idx_devices_last_disk_probe_at');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const has = await knex.schema.hasColumn('devices', 'last_disk_probe_at');
  if (has) {
    await knex.schema.alterTable('devices', (t) => {
      t.dropIndex(['last_disk_probe_at'], 'idx_devices_last_disk_probe_at');
      t.dropColumn('last_disk_probe_at');
    });
  }
}
