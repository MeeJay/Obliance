import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Add remediate_rule command type
  await knex.raw(`ALTER TYPE command_type ADD VALUE IF NOT EXISTS 'remediate_rule'`);

  // Table to store ignored compliance rules per device per policy
  await knex.schema.createTable('compliance_ignored_rules', (t) => {
    t.increments('id').primary();
    t.integer('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    t.integer('device_id').notNullable().references('id').inTable('devices').onDelete('CASCADE');
    t.integer('policy_id').notNullable().references('id').inTable('compliance_policies').onDelete('CASCADE');
    t.string('rule_id', 128).notNullable();
    t.integer('ignored_by').references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.unique(['device_id', 'policy_id', 'rule_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('compliance_ignored_rules');
}
