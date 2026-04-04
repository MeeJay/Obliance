import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Enums
  await knex.raw(`CREATE TYPE scenario_trigger_type AS ENUM ('session_login', 'machine_boot', 'agent_approved', 'group_join', 'schedule_failure', 'manual')`);
  await knex.raw(`CREATE TYPE scenario_status AS ENUM ('draft', 'active', 'disabled')`);
  await knex.raw(`CREATE TYPE scenario_run_status AS ENUM ('pending', 'running', 'success', 'failure', 'cancelled', 'timeout')`);
  await knex.raw(`CREATE TYPE scenario_step_run_status AS ENUM ('pending', 'check_running', 'check_passed', 'resolve_running', 'recheck_running', 'recheck_passed', 'failed', 'skipped', 'success')`);

  // scenarios
  await knex.schema.createTable('scenarios', (t) => {
    t.increments('id').primary();
    t.uuid('uuid').notNullable().unique().defaultTo(knex.raw('gen_random_uuid()'));
    t.integer('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    t.string('name', 300).notNullable();
    t.text('description');
    t.specificType('trigger_type', 'scenario_trigger_type').notNullable();
    t.jsonb('trigger_config').notNullable().defaultTo('{}');
    t.string('target_type', 20).notNullable().defaultTo('all');
    t.jsonb('target_ids').notNullable().defaultTo('[]');
    t.specificType('status', 'scenario_status').notNullable().defaultTo('draft');
    t.jsonb('retry_policy').notNullable().defaultTo('{"maxRetries": 0, "retryDelaySeconds": 60}');
    t.integer('timeout_seconds').notNullable().defaultTo(3600);
    t.boolean('notify_on_success').notNullable().defaultTo(false);
    t.boolean('notify_on_failure').notNullable().defaultTo(true);
    t.jsonb('variables').notNullable().defaultTo('{}');
    t.integer('created_by').references('id').inTable('users').onDelete('SET NULL');
    t.integer('updated_by').references('id').inTable('users').onDelete('SET NULL');
    t.timestamps(true, true);
    t.index(['tenant_id', 'status']);
    t.index(['tenant_id', 'trigger_type']);
  });

  // scenario_steps
  await knex.schema.createTable('scenario_steps', (t) => {
    t.increments('id').primary();
    t.integer('scenario_id').notNullable().references('id').inTable('scenarios').onDelete('CASCADE');
    t.integer('sort_order').notNullable().defaultTo(0);
    t.string('name', 300).notNullable();
    t.text('description');
    t.integer('check_script_id').references('id').inTable('scripts').onDelete('SET NULL');
    t.integer('resolve_script_id').references('id').inTable('scripts').onDelete('SET NULL');
    t.integer('timeout_seconds').notNullable().defaultTo(300);
    t.integer('retry_count').notNullable().defaultTo(0);
    t.jsonb('parameter_overrides').notNullable().defaultTo('{}');
    t.timestamps(true, true);
    t.index(['scenario_id', 'sort_order']);
  });

  // scenario_runs
  await knex.schema.createTable('scenario_runs', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.integer('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    t.integer('scenario_id').notNullable().references('id').inTable('scenarios').onDelete('CASCADE');
    t.integer('device_id').notNullable().references('id').inTable('devices').onDelete('CASCADE');
    t.specificType('trigger_type', 'scenario_trigger_type').notNullable();
    t.string('trigger_source', 200);
    t.specificType('status', 'scenario_run_status').notNullable().defaultTo('pending');
    t.integer('current_step').notNullable().defaultTo(0);
    t.jsonb('variables').notNullable().defaultTo('{}');
    t.timestamp('started_at', { useTz: true });
    t.timestamp('finished_at', { useTz: true });
    t.text('error_message');
    t.integer('retry_attempt').notNullable().defaultTo(0);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['device_id', 'scenario_id', 'created_at']);
    t.index(['tenant_id', 'status']);
    t.index(['scenario_id', 'created_at']);
  });

  // scenario_step_runs
  await knex.schema.createTable('scenario_step_runs', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('run_id').notNullable().references('id').inTable('scenario_runs').onDelete('CASCADE');
    t.integer('step_id').notNullable().references('id').inTable('scenario_steps').onDelete('CASCADE');
    t.integer('sort_order').notNullable();
    t.specificType('status', 'scenario_step_run_status').notNullable().defaultTo('pending');
    // Check phase
    t.uuid('check_command_id');
    t.integer('check_exit_code');
    t.text('check_stdout');
    t.text('check_stderr');
    t.timestamp('check_started_at', { useTz: true });
    t.timestamp('check_finished_at', { useTz: true });
    // Resolve phase
    t.uuid('resolve_command_id');
    t.integer('resolve_exit_code');
    t.text('resolve_stdout');
    t.text('resolve_stderr');
    t.timestamp('resolve_started_at', { useTz: true });
    t.timestamp('resolve_finished_at', { useTz: true });
    // Recheck phase
    t.uuid('recheck_command_id');
    t.integer('recheck_exit_code');
    t.text('recheck_stdout');
    t.text('recheck_stderr');
    t.timestamp('recheck_started_at', { useTz: true });
    t.timestamp('recheck_finished_at', { useTz: true });
    // Timing
    t.timestamp('started_at', { useTz: true });
    t.timestamp('finished_at', { useTz: true });
    t.integer('retry_attempt').notNullable().defaultTo(0);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['run_id', 'sort_order']);
  });

  // scenario_trigger_log — dedup one-time triggers
  await knex.schema.createTable('scenario_trigger_log', (t) => {
    t.increments('id').primary();
    t.integer('scenario_id').notNullable().references('id').inTable('scenarios').onDelete('CASCADE');
    t.integer('device_id').notNullable().references('id').inTable('devices').onDelete('CASCADE');
    t.specificType('trigger_type', 'scenario_trigger_type').notNullable();
    t.string('trigger_key', 500);
    t.timestamp('triggered_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['scenario_id', 'device_id', 'trigger_type', 'trigger_key']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('scenario_trigger_log');
  await knex.schema.dropTableIfExists('scenario_step_runs');
  await knex.schema.dropTableIfExists('scenario_runs');
  await knex.schema.dropTableIfExists('scenario_steps');
  await knex.schema.dropTableIfExists('scenarios');
  await knex.raw('DROP TYPE IF EXISTS scenario_step_run_status');
  await knex.raw('DROP TYPE IF EXISTS scenario_run_status');
  await knex.raw('DROP TYPE IF EXISTS scenario_status');
  await knex.raw('DROP TYPE IF EXISTS scenario_trigger_type');
}
