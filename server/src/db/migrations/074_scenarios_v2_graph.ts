import { Knex } from 'knex';

// Phase 1A of the v2 graph-based scenario builder. Adds the new node + edge
// tables alongside the legacy `scenario_steps` / `scenario_step_runs` tables
// (kept around until the auto-migration job in Phase 1B runs and replaces
// every legacy scenario with its v2 equivalent — at which point a follow-up
// migration drops the legacy tables).

export async function up(knex: Knex): Promise<void> {
  // Add the schedule_cron trigger to the existing enum so v2 schedule nodes
  // can reuse the same trigger pipeline. The scenarios.trigger_type column
  // becomes the source-of-truth for which node fires the run.
  await knex.raw(`ALTER TYPE scenario_trigger_type ADD VALUE IF NOT EXISTS 'schedule_cron'`);

  // ── scenario_nodes ───────────────────────────────────────────────────────
  // Each row is a node on the canvas. `type` discriminates which executor
  // runs it (run_script, branch_exit_code, send_notification, …). `config`
  // is a free-form JSONB blob whose shape depends on `type` — validated
  // app-side to keep the migration footprint stable across feature growth.
  await knex.schema.createTable('scenario_nodes', (t) => {
    t.increments('id').primary();
    t.uuid('uuid').notNullable().unique().defaultTo(knex.raw('gen_random_uuid()'));
    t.integer('scenario_id').notNullable().references('id').inTable('scenarios').onDelete('CASCADE');
    t.string('type', 64).notNullable();
    t.string('label', 300);
    t.jsonb('config').notNullable().defaultTo('{}');
    t.integer('position_x').notNullable().defaultTo(0);
    t.integer('position_y').notNullable().defaultTo(0);
    t.timestamps(true, true);
    t.index(['scenario_id']);
    t.index(['scenario_id', 'type']);
  });

  // ── scenario_edges ───────────────────────────────────────────────────────
  // Directed edge between two nodes of the same scenario. `source_handle`
  // names the output port on the source node (a branch_exit_code node
  // exposes one handle per exit-code rule + 'default'). `condition` is the
  // declarative match used at run-time when the engine decides which edge
  // to follow given the previous node's result.
  await knex.schema.createTable('scenario_edges', (t) => {
    t.increments('id').primary();
    t.uuid('uuid').notNullable().unique().defaultTo(knex.raw('gen_random_uuid()'));
    t.integer('scenario_id').notNullable().references('id').inTable('scenarios').onDelete('CASCADE');
    t.integer('source_node_id').notNullable().references('id').inTable('scenario_nodes').onDelete('CASCADE');
    t.string('source_handle', 64);
    t.integer('target_node_id').notNullable().references('id').inTable('scenario_nodes').onDelete('CASCADE');
    t.jsonb('condition').notNullable().defaultTo('{}');
    t.integer('sort_order').notNullable().defaultTo(0);
    t.timestamps(true, true);
    t.index(['scenario_id']);
    t.index(['source_node_id']);
    t.index(['target_node_id']);
  });

  // ── scenario_runs additions ──────────────────────────────────────────────
  // Engine state for the v2 walk-graph: which node we're on, the last
  // node's output, per-node visit count for cycle protection, plus a
  // remediation counter so a notify_on_remediation hook can fire when
  // the run terminates successfully BUT had to traverse a resolve branch.
  // run_variables is reserved for Phase 2 (templating + conditional nodes).
  await knex.schema.alterTable('scenario_runs', (t) => {
    t.integer('current_node_id').references('id').inTable('scenario_nodes').onDelete('SET NULL');
    t.integer('last_exit_code');
    t.text('last_stdout');
    t.text('last_stderr');
    t.jsonb('visit_counts').notNullable().defaultTo('{}');
    t.integer('remediation_count').notNullable().defaultTo(0);
    t.jsonb('run_variables').notNullable().defaultTo('{}');
  });

  // ── scenario_node_runs ───────────────────────────────────────────────────
  // Per-node trace of a run — replaces scenario_step_runs as the audit
  // log for v2. Captures every node visit with its result so the UI can
  // animate the graph live and surface failures. Legacy step_runs stays
  // until the auto-migration job in Phase 1B has run on every tenant.
  await knex.schema.createTable('scenario_node_runs', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('run_id').notNullable().references('id').inTable('scenario_runs').onDelete('CASCADE');
    t.integer('node_id').notNullable().references('id').inTable('scenario_nodes').onDelete('CASCADE');
    t.string('node_type', 64).notNullable();
    t.string('status', 32).notNullable().defaultTo('pending');
    t.uuid('command_id'); // when the node fires an agent command (run_script / run_command)
    t.integer('exit_code');
    t.text('stdout');
    t.text('stderr');
    t.text('error_message');
    t.timestamp('started_at', { useTz: true });
    t.timestamp('finished_at', { useTz: true });
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['run_id', 'created_at']);
    t.index(['node_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('scenario_node_runs');
  await knex.schema.alterTable('scenario_runs', (t) => {
    t.dropColumn('run_variables');
    t.dropColumn('remediation_count');
    t.dropColumn('visit_counts');
    t.dropColumn('last_stderr');
    t.dropColumn('last_stdout');
    t.dropColumn('last_exit_code');
    t.dropColumn('current_node_id');
  });
  await knex.schema.dropTableIfExists('scenario_edges');
  await knex.schema.dropTableIfExists('scenario_nodes');
  // We don't remove the schedule_cron enum value — Postgres makes that
  // painful (must recreate the enum) and the type stays useful even if
  // the column reverts.
}
