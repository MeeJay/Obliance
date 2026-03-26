import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('devices', (t) => {
    // Geolocation (resolved from public IP)
    t.decimal('geo_lat', 9, 6).nullable();
    t.decimal('geo_lng', 9, 6).nullable();
    t.string('geo_city', 200).nullable();
    t.string('geo_country', 100).nullable();
    t.string('geo_region', 200).nullable();
    // Asset management
    t.date('purchase_date').nullable();
    t.date('warranty_expiry').nullable();
    t.string('warranty_vendor', 200).nullable();
    t.string('warranty_status', 20).defaultTo('unknown');
    t.integer('expected_lifetime_years').nullable();
    t.string('lifecycle_status', 20).defaultTo('unknown');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('devices', (t) => {
    t.dropColumn('geo_lat');
    t.dropColumn('geo_lng');
    t.dropColumn('geo_city');
    t.dropColumn('geo_country');
    t.dropColumn('geo_region');
    t.dropColumn('purchase_date');
    t.dropColumn('warranty_expiry');
    t.dropColumn('warranty_vendor');
    t.dropColumn('warranty_status');
    t.dropColumn('expected_lifetime_years');
    t.dropColumn('lifecycle_status');
  });
}
