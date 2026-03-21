import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // New command types for file explorer
  await knex.raw(`ALTER TYPE command_type ADD VALUE IF NOT EXISTS 'list_directory'`);
  await knex.raw(`ALTER TYPE command_type ADD VALUE IF NOT EXISTS 'create_directory'`);
  await knex.raw(`ALTER TYPE command_type ADD VALUE IF NOT EXISTS 'rename_file'`);
  await knex.raw(`ALTER TYPE command_type ADD VALUE IF NOT EXISTS 'delete_file'`);
  await knex.raw(`ALTER TYPE command_type ADD VALUE IF NOT EXISTS 'download_file'`);
  await knex.raw(`ALTER TYPE command_type ADD VALUE IF NOT EXISTS 'upload_file'`);

  // Audit log table — tracks file explorer actions and other auditable operations
  await knex.schema.createTable('audit_logs', (t) => {
    t.increments('id').primary();
    t.integer('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    t.integer('user_id').references('id').inTable('users').onDelete('SET NULL');
    t.integer('device_id').references('id').inTable('devices').onDelete('SET NULL');
    t.string('action', 100).notNullable(); // e.g. 'file_explorer.open', 'file_explorer.delete', 'file_explorer.upload'
    t.string('resource_type', 50); // e.g. 'file', 'directory'
    t.text('resource_path'); // e.g. 'C:\Users\john\file.txt'
    t.jsonb('details'); // extra context (old name for rename, file size, etc.)
    t.string('ip_address', 45);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.raw('CREATE INDEX idx_audit_logs_tenant ON audit_logs (tenant_id)');
  await knex.schema.raw('CREATE INDEX idx_audit_logs_device ON audit_logs (device_id)');
  await knex.schema.raw('CREATE INDEX idx_audit_logs_action ON audit_logs (action)');
  await knex.schema.raw('CREATE INDEX idx_audit_logs_created ON audit_logs (created_at)');
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('audit_logs');
}
