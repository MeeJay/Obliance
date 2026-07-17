import { Knex } from 'knex';

// Re-sync the `command_type` Postgres enum with the CommandType union in
// shared/src/types.ts.
//
// Why this exists: adding a command type touches several places (the TS union,
// the agent's two dispatch switches, the routes) and the DB enum is the one
// that is easy to forget — nothing fails at compile time, the type checks fine
// everywhere, and the bug only surfaces at runtime as a 500 when the row is
// inserted:
//
//   invalid input value for enum command_type: "update_agent"   (SQLSTATE 22P02)
//
// `update_agent` had drifted this way: the UI offered it, the route accepted
// it, the agent implemented it — and every single "update agent" click 500'd on
// the INSERT into command_queue. `start/stop/resize_custom_section` and the
// `*_vm_console` family had drifted too.
//
// The list below is a frozen snapshot of the union at the time of writing, and
// is deliberately NOT imported from @obliance/shared: a migration must be
// reproducible forever, so it cannot depend on a value that changes with the
// code. Adding an enum value that ends up unused is free; a missing one is a
// 500 — so we list everything rather than trying to guess which types actually
// reach command_queue (some are ephemeral WS-only pushes).
//
// Idempotent: each value is checked against pg_enum first, so this is safe to
// re-run and safe on installs where some values already exist.

export const config = { transaction: false };

const COMMAND_TYPES = [
  'run_script',
  'install_update',
  'install_updates',
  'cancel_script',
  'scan_inventory',
  'scan_updates',
  'check_compliance',
  'open_remote_tunnel',
  'close_remote_tunnel',
  'reboot',
  'shutdown',
  'sleep',
  'restart_agent',
  'update_agent',
  'list_services',
  'restart_service',
  'start_service',
  'stop_service',
  'install_software',
  'uninstall_software',
  'uninstall_agent',
  'install_oblireach',
  'list_processes',
  'kill_process',
  'list_wts_sessions',
  'enable_privacy_mode',
  'disable_privacy_mode',
  'start_custom_section',
  'stop_custom_section',
  'resize_custom_section',
  'enable_airgap',
  'disable_airgap',
  'set_privacy_password',
  'change_privacy_password',
  'remove_privacy_password',
  'verify_privacy_password',
  'list_directory',
  'create_directory',
  'rename_file',
  'delete_file',
  'download_file',
  'upload_file',
  'remediate_rule',
  'scan_network',
  'check_software_compliance',
  'hyperv_list_vms',
  'hyperv_control',
  'hyperv_console_thumbnail',
  'open_vm_console',
  'close_vm_console',
  'install_vm_console',
  'veeam_list_jobs',
  'veeam_control',
];

async function ensureEnumValue(knex: Knex, typeName: string, value: string): Promise<void> {
  const exists = await knex.raw(
    `SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = ? AND e.enumlabel = ? LIMIT 1`,
    [typeName, value],
  );
  if (!exists.rows || exists.rows.length === 0) {
    // DDL can't take bind parameters; values come from the frozen const above,
    // never from user input. Same shape as 055_ensure_enum_values.
    await knex.raw(`ALTER TYPE ${typeName} ADD VALUE '${value}'`);
  }
}

export async function up(knex: Knex): Promise<void> {
  for (const v of COMMAND_TYPES) {
    await ensureEnumValue(knex, 'command_type', v);
  }
}

export async function down(_knex: Knex): Promise<void> {
  // Dropping an enum value in Postgres requires rebuilding the type and
  // recasting every column that uses it — destructive and not worth it.
  // Extra values are inert, so down is a no-op.
}
