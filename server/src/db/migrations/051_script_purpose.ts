import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`CREATE TYPE script_purpose AS ENUM ('check', 'resolve', 'execute', 'compliance')`);
  const hasCol = await knex.schema.hasColumn('scripts', 'purpose');
  if (!hasCol) {
    await knex.schema.alterTable('scripts', (t) => {
      t.specificType('purpose', 'script_purpose').notNullable().defaultTo('execute');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasCol = await knex.schema.hasColumn('scripts', 'purpose');
  if (hasCol) {
    await knex.schema.alterTable('scripts', (t) => {
      t.dropColumn('purpose');
    });
  }
  await knex.raw('DROP TYPE IF EXISTS script_purpose');
}
