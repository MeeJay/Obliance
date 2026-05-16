import { Knex } from 'knex';

// Capture the version ranges that NVD's cpeMatch entries describe so we
// can surface "patched in X.Y.Z" / "vulnerable from A.B.C up to (but not
// including) X.Y.Z" in the UI. Without these ranges the operator only
// gets a CVE name and has to dig into NVD manually to know what version
// fixes it.
//
// Each row in the JSONB array carries:
//   {
//     product:         "core",
//     vendor:          "mobileiron",
//     versionStartIncluding: "4.0.0",
//     versionStartExcluding: null,
//     versionEndIncluding:    null,
//     versionEndExcluding:   "10.6.0.2",   // first patched version
//     cpe:                   "cpe:2.3:a:mobileiron:core:*"
//   }
//
// We expose a derived `firstPatchedVersion` text column too — handy for
// the table view that doesn't need the full structured ranges.

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('cves', (t) => {
    t.jsonb('affected_versions').notNullable().defaultTo(knex.raw("'[]'::jsonb"));
    t.string('first_patched_version', 64).nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('cves', (t) => {
    t.dropColumn('affected_versions');
    t.dropColumn('first_patched_version');
  });
}
