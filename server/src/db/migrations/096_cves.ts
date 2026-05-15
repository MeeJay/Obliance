import { Knex } from 'knex';

// CVE (Common Vulnerabilities and Exposures) inventory.
//
//   cves          → catalog of known CVEs synced from public feeds. Master
//                   table, no tenant_id (CVEs are global). MVP source is
//                   CISA KEV (Known Exploited Vulnerabilities) — high-signal
//                   subset of ~1300 entries refreshed daily. NVD full feed
//                   can be added later as a second `source` value.
//   device_cves   → join table linking a device to a CVE it's affected by.
//                   Owned by a tenant (the device's tenant), so master tenant
//                   sees all rows, child tenants only their own. matched_*
//                   columns record the inventory row that triggered the match
//                   plus a confidence band for UI styling.
//
// Match confidence:
//   high   → vendor + product + version all matched a CISA KEV entry's CPE
//   medium → vendor + product matched, version unknown or out of declared range
//   low    → fuzzy match (substring on product name) — surface as "possibly
//            affected" so the admin can verify rather than treat as gospel

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('cves', (t) => {
    t.increments('id').primary();
    t.string('cve_id', 32).notNullable().unique();           // CVE-YYYY-NNNNN
    t.string('source', 32).notNullable().defaultTo('cisa_kev');
    t.string('vendor', 255).nullable();
    t.string('product', 255).nullable();
    t.text('name').nullable();                                // short title
    t.text('description').nullable();
    t.string('severity', 16).nullable();                     // critical | high | medium | low | unknown
    t.decimal('cvss_score', 3, 1).nullable();                // 0.0–10.0
    t.boolean('kev_flag').notNullable().defaultTo(false);    // CISA Known Exploited
    t.timestamp('published_at').nullable();
    t.timestamp('modified_at').nullable();
    t.timestamp('due_date').nullable();                      // CISA KEV remediation deadline
    t.text('required_action').nullable();                    // CISA KEV recommended action
    t.jsonb('references').notNullable().defaultTo(knex.raw("'[]'::jsonb"));
    t.jsonb('cpe_matches').notNullable().defaultTo(knex.raw("'[]'::jsonb")); // raw CPE strings for advanced matching
    t.timestamp('synced_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw('CREATE INDEX idx_cves_severity ON cves (severity)');
  await knex.raw('CREATE INDEX idx_cves_kev_flag ON cves (kev_flag) WHERE kev_flag = true');
  await knex.raw('CREATE INDEX idx_cves_vendor_product ON cves (vendor, product)');

  await knex.schema.createTable('device_cves', (t) => {
    t.increments('id').primary();
    t.integer('device_id').notNullable().references('id').inTable('devices').onDelete('CASCADE');
    t.integer('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    t.integer('cve_id').notNullable().references('id').inTable('cves').onDelete('CASCADE');
    t.integer('matched_software_id').nullable();             // device_inventory_software.id when available
    t.string('matched_vendor', 255).nullable();
    t.string('matched_product', 255).nullable();
    t.string('matched_version', 64).nullable();
    t.string('match_confidence', 16).notNullable().defaultTo('medium'); // high | medium | low
    // Set when an admin marks the match as a false positive — hidden from
    // the affected-devices list, but kept so the matcher doesn't keep
    // re-creating the same row on every scan.
    t.timestamp('dismissed_at').nullable();
    t.integer('dismissed_by').nullable();
    t.timestamp('matched_at').notNullable().defaultTo(knex.fn.now());
    t.unique(['device_id', 'cve_id', 'matched_product']);
  });

  await knex.raw('CREATE INDEX idx_device_cves_tenant ON device_cves (tenant_id)');
  await knex.raw('CREATE INDEX idx_device_cves_device ON device_cves (device_id)');
  await knex.raw('CREATE INDEX idx_device_cves_cve ON device_cves (cve_id)');
  // Partial index for "active" matches — drops dismissed rows from the hot
  // path (the affected-devices list query) without dragging down ANALYZE.
  await knex.raw(`
    CREATE INDEX idx_device_cves_active ON device_cves (tenant_id, cve_id)
    WHERE dismissed_at IS NULL
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('device_cves');
  await knex.schema.dropTableIfExists('cves');
}
