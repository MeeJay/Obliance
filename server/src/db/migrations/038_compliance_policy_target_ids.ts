import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Add target_ids jsonb column
  await knex.schema.alterTable('compliance_policies', (t) => {
    t.jsonb('target_ids').defaultTo('[]');
  });

  // Migrate existing target_id → target_ids
  await knex.raw(`
    UPDATE compliance_policies
    SET target_ids = CASE
      WHEN target_id IS NOT NULL THEN jsonb_build_array(target_id)
      ELSE '[]'::jsonb
    END
  `);

  // Convert target_type 'device' to 'all' (no longer supported)
  await knex.raw(`
    UPDATE compliance_policies SET target_type = 'all' WHERE target_type = 'device'
  `);

  // Drop old column
  await knex.schema.alterTable('compliance_policies', (t) => {
    t.dropColumn('target_id');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('compliance_policies', (t) => {
    t.integer('target_id').nullable();
  });
  await knex.raw(`
    UPDATE compliance_policies
    SET target_id = (target_ids->>0)::integer
    WHERE jsonb_array_length(target_ids) > 0
  `);
  await knex.schema.alterTable('compliance_policies', (t) => {
    t.dropColumn('target_ids');
  });
}
