import { Knex } from 'knex';

export const config = { transaction: false };

async function addEnumValue(knex: Knex, typeName: string, value: string): Promise<void> {
  const exists = await knex.raw(
    `SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = ? AND e.enumlabel = ? LIMIT 1`,
    [typeName, value],
  );
  if (!exists.rows || exists.rows.length === 0) {
    await knex.raw(`ALTER TYPE ${typeName} ADD VALUE '${value}'`);
  }
}

export async function up(knex: Knex): Promise<void> {
  await addEnumValue(knex, 'command_type', 'set_privacy_password');
  await addEnumValue(knex, 'command_type', 'change_privacy_password');
  await addEnumValue(knex, 'command_type', 'remove_privacy_password');
  await addEnumValue(knex, 'command_type', 'verify_privacy_password');

  const hasCol = await knex.schema.hasColumn('devices', 'privacy_password_set');
  if (!hasCol) {
    await knex.schema.alterTable('devices', (t) => {
      t.boolean('privacy_password_set').notNullable().defaultTo(false);
      t.timestamp('privacy_password_set_at', { useTz: true }).nullable();
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('devices', (t) => {
    t.dropColumn('privacy_password_set_at');
    t.dropColumn('privacy_password_set');
  });
}
