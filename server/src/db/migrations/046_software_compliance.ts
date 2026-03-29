import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TYPE command_type ADD VALUE IF NOT EXISTS 'check_software_compliance'`);

  await knex.schema.createTable('software_compliance_lists', (t) => {
    t.increments('id').primary();
    t.uuid('uuid').notNullable().defaultTo(knex.raw('gen_random_uuid()')).unique();
    t.integer('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    t.string('name', 300).notNullable();
    t.text('description').nullable();
    t.string('list_type', 20).notNullable(); // 'whitelist' | 'blacklist'
    t.string('target_type', 20).notNullable().defaultTo('all'); // 'group' | 'all'
    t.jsonb('target_ids').notNullable().defaultTo('[]');
    t.string('target_platform', 20).notNullable().defaultTo('all'); // 'windows' | 'linux' | 'macos' | 'freebsd' | 'all'
    t.boolean('auto_remediate').notNullable().defaultTo(false);
    t.boolean('enabled').notNullable().defaultTo(true);
    t.integer('created_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('software_compliance_entries', (t) => {
    t.increments('id').primary();
    t.integer('list_id').notNullable().references('id').inTable('software_compliance_lists').onDelete('CASCADE');
    t.string('name', 500).notNullable();
    t.string('match_type', 20).notNullable().defaultTo('contains'); // 'exact' | 'contains' | 'regex'
    t.string('publisher', 500).nullable();
    t.string('min_version', 100).nullable();
    t.string('max_version', 100).nullable();
    t.string('install_source', 100).nullable(); // 'winget' | 'choco' | 'apt' | 'dnf' | 'brew' | 'pkg' | 'custom'
    t.string('install_id', 500).nullable();
    t.text('install_script').nullable();
    t.text('msi_url').nullable();
    t.text('msi_params').nullable();
    t.integer('sort_order').notNullable().defaultTo(0);
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('software_compliance_results', (t) => {
    t.increments('id').primary();
    t.integer('device_id').notNullable().references('id').inTable('devices').onDelete('CASCADE');
    t.integer('list_id').notNullable().references('id').inTable('software_compliance_lists').onDelete('CASCADE');
    t.integer('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    t.jsonb('results').notNullable().defaultTo('[]');
    t.decimal('compliance_score', 5, 2).defaultTo(0);
    t.timestamp('checked_at').defaultTo(knex.fn.now());
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.index(['device_id', 'list_id']);
    t.index(['tenant_id', 'checked_at']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('software_compliance_results');
  await knex.schema.dropTableIfExists('software_compliance_entries');
  await knex.schema.dropTableIfExists('software_compliance_lists');
}
