import { Knex } from 'knex';

// SSH bastion T1 (native ProxyJump): enum values.
//
//   remote_protocol  'sshjump'         — raw TCP relay agent -> local sshd
//   command_type     'ssh_jump_grant'  — install an ephemeral authorized_keys line
//                    'ssh_jump_revoke' — remove it
//
// The two commands are live WS request/response (agentHub.request) and never
// reach command_queue today, but a missing enum value is a 500 the day one
// does (see 117_sync_command_type_enum) — so they are registered anyway.
// Idempotent (pg_enum check), no transaction (ALTER TYPE ... ADD VALUE).

export const config = { transaction: false };

async function ensureEnumValue(knex: Knex, typeName: string, value: string): Promise<void> {
  const exists = await knex.raw(
    `SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = ? AND e.enumlabel = ? LIMIT 1`,
    [typeName, value],
  );
  if (!exists.rows || exists.rows.length === 0) {
    // Frozen constants below, never user input.
    await knex.raw(`ALTER TYPE ${typeName} ADD VALUE '${value}'`);
  }
}

export async function up(knex: Knex): Promise<void> {
  await ensureEnumValue(knex, 'remote_protocol', 'sshjump');
  await ensureEnumValue(knex, 'command_type', 'ssh_jump_grant');
  await ensureEnumValue(knex, 'command_type', 'ssh_jump_revoke');
}

export async function down(_knex: Knex): Promise<void> {
  // Enum values cannot be dropped without rebuilding the type; extra values are inert.
}
