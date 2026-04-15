import { Knex } from 'knex';

export const config = { transaction: false };

async function ensureEnumValue(knex: Knex, typeName: string, value: string): Promise<void> {
  const exists = await knex.raw(
    `SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = ? AND e.enumlabel = ? LIMIT 1`,
    [typeName, value],
  );
  if (!exists.rows || exists.rows.length === 0) {
    await knex.raw(`ALTER TYPE ${typeName} ADD VALUE '${value}'`);
  }
}

export async function up(knex: Knex): Promise<void> {
  // New command types for the live output stream protocol
  await ensureEnumValue(knex, 'command_type', 'start_custom_section');
  await ensureEnumValue(knex, 'command_type', 'stop_custom_section');
  await ensureEnumValue(knex, 'command_type', 'resize_custom_section');

  const hasTable = await knex.schema.hasTable('custom_sections');
  if (!hasTable) {
    await knex.schema.createTable('custom_sections', (t) => {
      t.increments('id').primary();
      t.integer('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      t.string('name').notNullable();                 // tab label
      t.text('description').nullable();
      t.text('command').notNullable();                // shell command
      t.string('platform').notNullable().defaultTo('all'); // all | windows | linux | macos
      t.string('runtime').notNullable().defaultTo('bash'); // bash | sh | powershell | cmd
      t.boolean('use_pty').notNullable().defaultTo(true);  // needed for htop / top / less
      t.string('target_type').notNullable().defaultTo('all'); // all | group | device
      t.jsonb('target_ids').notNullable().defaultTo('[]');
      t.integer('created_by').nullable().references('id').inTable('users').onDelete('SET NULL');
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.index('tenant_id');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('custom_sections');
}
