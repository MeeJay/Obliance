import { Knex } from 'knex';

// Backup-host support (Veeam B&R first, extensible).
//
//   - devices.backup_host_type : null = not a backup host; 'veeam' = the
//     agent detected a Veeam B&R server. Drives the conditional Backups tab.
//   - device_backup_jobs       : one row per job managed on the host.
//     Refreshed wholesale from the agent push (delete-missing + upsert).
//   - command_type enum        : two new values for the agent.

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn('devices', 'backup_host_type'))) {
    await knex.schema.alterTable('devices', (t) => {
      t.string('backup_host_type', 16).nullable();
    });
  }

  if (!(await knex.schema.hasTable('device_backup_jobs'))) {
    await knex.schema.createTable('device_backup_jobs', (t) => {
      t.increments('id').primary();
      t.integer('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      t.integer('host_device_id').notNullable().references('id').inTable('devices').onDelete('CASCADE');
      t.string('host_type', 16).notNullable().defaultTo('veeam');
      // Veeam VBR job Id (GUID) — stable across renames.
      t.string('job_id', 128).notNullable();
      t.string('name', 300).notNullable();
      t.string('job_type', 64).nullable();
      t.string('state', 24).notNullable().defaultTo('unknown');
      t.string('raw_state', 64).nullable();
      t.string('last_result', 16).notNullable().defaultTo('none');
      t.boolean('schedule_enabled').notNullable().defaultTo(true);
      t.timestamp('last_run_start', { useTz: true }).nullable();
      t.timestamp('last_run_end', { useTz: true }).nullable();
      t.timestamp('next_run', { useTz: true }).nullable();
      t.integer('progress_percent').nullable();
      t.bigInteger('processed_bytes').nullable();
      t.bigInteger('transferred_bytes').nullable();
      t.bigInteger('duration_seconds').nullable();
      t.string('repository', 300).nullable();
      t.text('description').nullable();
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.unique(['host_device_id', 'job_id']);
      t.index(['tenant_id', 'last_result']);
      t.index(['host_device_id']);
    });
  }

  await knex.raw(`ALTER TYPE command_type ADD VALUE IF NOT EXISTS 'veeam_list_jobs'`);
  await knex.raw(`ALTER TYPE command_type ADD VALUE IF NOT EXISTS 'veeam_control'`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('device_backup_jobs');
  if (await knex.schema.hasColumn('devices', 'backup_host_type')) {
    await knex.schema.alterTable('devices', (t) => {
      t.dropColumn('backup_host_type');
    });
  }
}
