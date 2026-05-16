import { Knex } from 'knex';

// Second backfill pass for macOS release names — covers macOS 26 (Tahoe)
// which the first sweep (migration 099) missed because Apple renumbered
// from 15 (Sequoia) straight to 26 at WWDC 2025 and we hadn't recorded
// the marketing name yet. Existing rows for 26.x still carry `darwin`
// in `os_name` until either this backfill or the next agent push from
// each Mac fixes them.
//
// Also catches future macOS majors (27, 28, …) reported as `darwin` —
// rewrites them to a generic `macOS N` so the dashboard's "Version"
// filter stays decipherable until we add their marketing name.

export async function up(knex: Knex): Promise<void> {
  // Tahoe — first known major under the new numbering.
  await knex('devices')
    .where('os_type', 'macos')
    .where(function () {
      this.where('os_version', 'like', '26.%').orWhere('os_version', '26');
    })
    .update({ os_name: 'Tahoe' });

  // Anything else >= 16 still showing "darwin" gets a generic name so
  // the filter is at least sortable. We sweep majors 16-99 since Apple
  // jumped to 26 — any future scheme stays under 100.
  // The CASE expression peels off the leading numeric chunk from
  // os_version and rewrites os_name to `macOS <major>`.
  await knex.raw(`
    UPDATE devices
    SET os_name = 'macOS ' || split_part(os_version, '.', 1)
    WHERE os_type = 'macos'
      AND os_name IN ('darwin', 'Darwin')
      AND os_version ~ '^[0-9]+(\\.|$)'
      AND CAST(split_part(os_version, '.', 1) AS int) BETWEEN 16 AND 99
      AND split_part(os_version, '.', 1) NOT IN ('26')
  `);
}

export async function down(_knex: Knex): Promise<void> {
  // Don't revert — `darwin` is strictly less useful than the
  // marketing / generic name we just put there.
}
