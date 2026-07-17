import type { Knex } from 'knex';

/**
 * MAC addresses per virtual machine (one entry per virtual NIC).
 *
 * Why a separate column from ip_addresses: the two have very different
 * availability. `ip_addresses` comes from the guest via integration services
 * and is empty for most VMs (no guest agent, VM off, Linux guest without the
 * KVP exchange). The MACs are known by the hypervisor itself, so they are the
 * only network identifier present for *every* VM — which makes them the
 * reliable key when correlating a VM with something seen on the wire.
 *
 * jsonb (not a joined table): the array is small (1-4 NICs), always read as a
 * whole with its VM, and rewritten wholesale on each agent enumeration —
 * exactly the shape ip_addresses already uses.
 */
export async function up(knex: Knex): Promise<void> {
  const has = await knex.schema.hasColumn('device_virtual_machines', 'mac_addresses');
  if (!has) {
    await knex.schema.alterTable('device_virtual_machines', (t) => {
      t.jsonb('mac_addresses').notNullable().defaultTo('[]');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const has = await knex.schema.hasColumn('device_virtual_machines', 'mac_addresses');
  if (has) {
    await knex.schema.alterTable('device_virtual_machines', (t) => {
      t.dropColumn('mac_addresses');
    });
  }
}
