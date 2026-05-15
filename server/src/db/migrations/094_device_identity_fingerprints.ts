import { Knex } from 'knex';

// Detection of duplicate agent IDs (multiple physical machines sharing the
// same machine_uuid — typically caused by VM cloning without machine-id
// regen, or KVM guests where systemd-machine-id-setup seeds from a
// duplicated SMBIOS UUID).
//
// We don't change the agent: it can't know that another box is using its
// UUID. The server infers it from the symptom — when push updates show
// rapid alternation in (hostname, ipLocal, ipPublic, macAddress) on a
// single device row, it's two machines fighting over the same identity.
//
//   - identity_fingerprints       Rolling buffer of the last ~10 distinct
//                                 fingerprints observed. JSONB array of
//                                 {hostname, ipLocal, ipPublic, mac,
//                                 observedAt}. Pruned in the service
//                                 layer to bound size.
//   - duplicate_agent_id_suspected Computed flag set when the buffer
//                                 shows >=3 distinct hostnames OR ips in
//                                 a 30-minute window.
//   - duplicate_agent_id_acknowledged_at  Admin override timestamp. When
//                                 set, suppresses the suspected flag and
//                                 re-fires of the notification until the
//                                 next confirmed alternation.

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('devices', (t) => {
    t.jsonb('identity_fingerprints').notNullable().defaultTo(knex.raw("'[]'::jsonb"));
    t.boolean('duplicate_agent_id_suspected').notNullable().defaultTo(false);
    t.timestamp('duplicate_agent_id_acknowledged_at').nullable();
  });

  // Index for the admin "show me all flagged devices" view — partial on
  // the flag so the index stays tiny in healthy fleets.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_devices_duplicate_agent_id_suspected
    ON devices (tenant_id, id)
    WHERE duplicate_agent_id_suspected = true
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS idx_devices_duplicate_agent_id_suspected');
  await knex.schema.alterTable('devices', (t) => {
    t.dropColumn('identity_fingerprints');
    t.dropColumn('duplicate_agent_id_suspected');
    t.dropColumn('duplicate_agent_id_acknowledged_at');
  });
}
