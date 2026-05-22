import { Knex } from 'knex';

// Virtualization-host support (Hyper-V first, extensible to ESXi/Proxmox/KVM).
//
//   - devices.virtualization_host_type : null = not a host; 'hyperv' = the
//     agent detected the Hyper-V role. Drives the conditional Hyper-V tab.
//   - device_virtual_machines          : one row per VM hosted on a device.
//     Refreshed wholesale from the agent push (delete-missing + upsert).
//   - command_type enum                : two new values for the agent.

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn('devices', 'virtualization_host_type'))) {
    await knex.schema.alterTable('devices', (t) => {
      t.string('virtualization_host_type', 16).nullable();
    });
  }

  if (!(await knex.schema.hasTable('device_virtual_machines'))) {
    await knex.schema.createTable('device_virtual_machines', (t) => {
      t.increments('id').primary();
      t.integer('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      t.integer('host_device_id').notNullable().references('id').inTable('devices').onDelete('CASCADE');
      t.string('host_type', 16).notNullable().defaultTo('hyperv');
      // Hypervisor-native VM id (Hyper-V VMId GUID) — stable across renames.
      t.string('vm_id', 128).notNullable();
      t.string('name', 300).notNullable();
      t.string('state', 24).notNullable().defaultTo('unknown');
      t.string('raw_state', 64).nullable();
      t.integer('cpu_count').nullable();
      t.bigInteger('memory_bytes').nullable();
      t.bigInteger('uptime_seconds').nullable();
      t.integer('checkpoint_count').nullable();
      t.jsonb('ip_addresses').notNullable().defaultTo('[]');
      t.integer('generation').nullable();
      t.text('notes').nullable();
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.unique(['host_device_id', 'vm_id']);
      t.index(['tenant_id', 'state']);
      t.index(['host_device_id']);
    });
  }

  await knex.raw(`ALTER TYPE command_type ADD VALUE IF NOT EXISTS 'hyperv_list_vms'`);
  await knex.raw(`ALTER TYPE command_type ADD VALUE IF NOT EXISTS 'hyperv_control'`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('device_virtual_machines');
  if (await knex.schema.hasColumn('devices', 'virtualization_host_type')) {
    await knex.schema.alterTable('devices', (t) => {
      t.dropColumn('virtualization_host_type');
    });
  }
  // Enum values are not removed — Postgres can't drop enum values without a
  // type rebuild, and leaving them is harmless.
}
