import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('script_schedules', (t) => {
    t.jsonb('target_ids').defaultTo('[]');
  });

  // Migrate existing target_id into target_ids array
  const rows = await knex('script_schedules').whereNotNull('target_id').where('target_type', 'group');
  for (const row of rows) {
    await knex('script_schedules')
      .where({ id: row.id })
      .update({ target_ids: JSON.stringify([row.target_id]) });
  }

  // Also migrate single-device targets
  const deviceRows = await knex('script_schedules').whereNotNull('target_id').where('target_type', 'device');
  for (const row of deviceRows) {
    await knex('script_schedules')
      .where({ id: row.id })
      .update({ target_ids: JSON.stringify([row.target_id]) });
  }

  await knex.schema.alterTable('script_schedules', (t) => {
    t.dropColumn('target_id');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('script_schedules', (t) => {
    t.integer('target_id');
  });

  // Restore first target_id from array
  const rows = await knex('script_schedules').whereRaw("jsonb_array_length(target_ids) > 0");
  for (const row of rows) {
    const ids = typeof row.target_ids === 'string' ? JSON.parse(row.target_ids) : row.target_ids;
    await knex('script_schedules')
      .where({ id: row.id })
      .update({ target_id: ids[0] });
  }

  await knex.schema.alterTable('script_schedules', (t) => {
    t.dropColumn('target_ids');
  });
}
