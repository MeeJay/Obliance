import type { Knex } from 'knex';

/**
 * Clean up orphaned records left by devices that were deleted before
 * proper CASCADE constraints were in place, or via polymorphic references
 * (target_id / scope_id) that cannot carry a DB-level FK.
 *
 * This migration is a one-time purge; the server cron handles future orphans.
 */
export async function up(knex: Knex): Promise<void> {
  // ── 1. Tables with a real device_id FK (should be covered by CASCADE,
  //       but purge any stragglers in case the constraint was missing) ──────
  const fkTables = [
    'device_updates',
    'command_queue',
    'script_executions',
    'remote_sessions',
    'compliance_results',
    'config_snapshots',
  ];

  for (const table of fkTables) {
    const hasTable = await knex.schema.hasTable(table);
    if (!hasTable) continue;
    await knex.raw(`
      DELETE FROM "${table}"
      WHERE device_id IS NOT NULL
        AND device_id NOT IN (SELECT id FROM devices)
    `);
  }

  // ── 2. Polymorphic references (no FK possible) ───────────────────────────

  // script_schedules targeting a deleted device
  await knex.raw(`
    DELETE FROM script_schedules
    WHERE target_type = 'device'
      AND target_id IS NOT NULL
      AND target_id NOT IN (SELECT id FROM devices)
  `);

  // update_policies scoped to a deleted device
  await knex.raw(`
    DELETE FROM update_policies
    WHERE target_type = 'device'
      AND target_id IS NOT NULL
      AND target_id NOT IN (SELECT id FROM devices)
  `);

  // reports scoped to a deleted device
  await knex.raw(`
    DELETE FROM reports
    WHERE scope_type = 'device'
      AND scope_id IS NOT NULL
      AND scope_id NOT IN (SELECT id FROM devices)
  `);
}

export async function down(_knex: Knex): Promise<void> {
  // Purge migrations are not reversible
}
