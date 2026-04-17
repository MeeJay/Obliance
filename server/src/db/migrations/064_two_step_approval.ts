import { Knex } from 'knex';

// Two-step approval for destructive commands. Tenant opts in via a flag;
// when enabled, batch power operations (reboot/shutdown/restart_agent on
// multiple devices) and single-device uninstall require a second admin to
// approve before the commands are dispatched to agents.

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn('tenants', 'two_step_approval'))) {
    await knex.schema.alterTable('tenants', (t) => {
      t.boolean('two_step_approval').notNullable().defaultTo(false);
    });
  }

  if (!(await knex.schema.hasTable('pending_approvals'))) {
    await knex.schema.createTable('pending_approvals', (t) => {
      t.increments('id').primary();
      t.integer('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      t.integer('requested_by').notNullable().references('id').inTable('users').onDelete('CASCADE');
      // 'batch_command' | 'device_uninstall' — extensible
      t.string('request_type', 64).notNullable();
      // Human-readable description shown to the reviewer.
      t.string('description', 500).notNullable();
      // JSON: { action, deviceIds: number[], groupId?: number, payload?: ... }
      t.jsonb('payload').notNullable();
      // 'pending' | 'approved' | 'denied' | 'executed' | 'expired' | 'cancelled'
      t.string('status', 16).notNullable().defaultTo('pending');
      t.integer('reviewed_by').nullable().references('id').inTable('users').onDelete('SET NULL');
      t.timestamp('reviewed_at', { useTz: true }).nullable();
      t.string('review_reason', 500).nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('expires_at', { useTz: true }).notNullable();
      t.timestamp('executed_at', { useTz: true }).nullable();
      t.index(['tenant_id', 'status']);
      t.index(['expires_at']);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('pending_approvals');
  if (await knex.schema.hasColumn('tenants', 'two_step_approval')) {
    await knex.schema.alterTable('tenants', (t) => {
      t.dropColumn('two_step_approval');
    });
  }
}
