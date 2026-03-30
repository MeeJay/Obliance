import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // ── Internal software repository ──────────────────────────────────────────
  await knex.schema.createTable('software_repo_packages', (t) => {
    t.increments('id').primary();
    t.uuid('uuid').notNullable().unique().defaultTo(knex.raw('gen_random_uuid()'));
    t.integer('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    t.string('filename', 500).notNullable();
    t.string('display_name', 500);
    t.bigInteger('file_size').notNullable();
    t.string('file_hash', 128).notNullable();
    t.string('mime_type', 100);
    t.string('platform', 20).notNullable(); // windows | linux | macos
    t.integer('uploaded_by').references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.index('tenant_id');
  });

  // ── Multi-source configs per entry ────────────────────────────────────────
  await knex.schema.createTable('software_compliance_entry_sources', (t) => {
    t.increments('id').primary();
    t.integer('entry_id').notNullable().references('id').inTable('software_compliance_entries').onDelete('CASCADE');
    t.string('package_manager', 20).notNullable(); // winget, choco, apt, yum, dnf, brew, pkg, snap, flatpak, msi, custom
    t.string('package_id', 500);
    t.text('msi_url');
    t.integer('repo_package_id').references('id').inTable('software_repo_packages').onDelete('SET NULL');
    t.text('install_script');
    t.text('msi_params');
    t.string('platform_scope', 50).notNullable(); // windows, macos, debian, rhel, fedora, arch, suse, freebsd, any
    t.integer('sort_order').notNullable().defaultTo(0);
    t.index('entry_id');
  });

  // ── Distro family on devices ──────────────────────────────────────────────
  const hasDistro = await knex.schema.hasColumn('devices', 'os_distro');
  if (!hasDistro) {
    await knex.schema.alterTable('devices', (t) => {
      t.string('os_distro', 100).nullable();
    });
  }

  // ── Migrate existing single-source entries to new sources table ───────────
  const entries = await knex('software_compliance_entries').whereNotNull('install_source');
  if (entries.length) {
    const sourceRows = entries.map((e: any) => {
      let platformScope = 'any';
      const src = e.install_source;
      if (src === 'winget' || src === 'choco' || src === 'msi') platformScope = 'windows';
      else if (src === 'apt') platformScope = 'debian';
      else if (src === 'dnf') platformScope = 'fedora';
      else if (src === 'brew') platformScope = 'macos';
      else if (src === 'pkg') platformScope = 'freebsd';
      return {
        entry_id: e.id,
        package_manager: e.install_source,
        package_id: e.install_id,
        msi_url: e.msi_url,
        install_script: e.install_script,
        msi_params: e.msi_params,
        platform_scope: platformScope,
        sort_order: 0,
      };
    });
    // Insert in batches
    for (let i = 0; i < sourceRows.length; i += 500) {
      await knex('software_compliance_entry_sources').insert(sourceRows.slice(i, i + 500));
    }
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('software_compliance_entry_sources');
  await knex.schema.dropTableIfExists('software_repo_packages');
  const hasDistro = await knex.schema.hasColumn('devices', 'os_distro');
  if (hasDistro) {
    await knex.schema.alterTable('devices', (t) => {
      t.dropColumn('os_distro');
    });
  }
}
