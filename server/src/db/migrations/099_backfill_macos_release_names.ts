import { Knex } from 'knex';

// Backfill `os_name` for macOS devices so the dashboard "Version" filter
// shows marketing release names (Sonoma, Sequoia, …) instead of the
// useless "darwin" kernel string.
//
// The agent push handler now derives `os_name` from `os_version` for
// every macOS device (cf. routes/agent.routes.ts macOsRelease helper),
// so new pushes self-correct. This migration just plumbs the existing
// fleet so the dashboard is clean immediately after deploy without
// waiting one push cycle per Mac.
//
// "Build" stays as os_version (14.5.1, 15.2, …) — only the
// release-name layer is rewritten.

export async function up(knex: Knex): Promise<void> {
  // Reverse-major sweep so a Mac with os_version='15.2' gets rewritten
  // to 'Sequoia' even if it currently carries 'darwin' or NULL.
  const VERSIONS: Array<{ prefix: string; name: string }> = [
    { prefix: '15.', name: 'Sequoia' },
    { prefix: '14.', name: 'Sonoma' },
    { prefix: '13.', name: 'Ventura' },
    { prefix: '12.', name: 'Monterey' },
    { prefix: '11.', name: 'Big Sur' },
    { prefix: '10.15', name: 'Catalina' },
    { prefix: '10.14', name: 'Mojave' },
    { prefix: '10.13', name: 'High Sierra' },
    { prefix: '10.12', name: 'Sierra' },
    { prefix: '10.11', name: 'El Capitan' },
    { prefix: '10.10', name: 'Yosemite' },
  ];

  // Single-major Macs reporting just "14" / "15" without minor.
  const BARE_MAJORS: Array<{ exact: string; name: string }> = [
    { exact: '15', name: 'Sequoia' },
    { exact: '14', name: 'Sonoma' },
    { exact: '13', name: 'Ventura' },
    { exact: '12', name: 'Monterey' },
    { exact: '11', name: 'Big Sur' },
  ];

  for (const v of VERSIONS) {
    await knex('devices')
      .where('os_type', 'macos')
      .andWhere('os_version', 'like', `${v.prefix}%`)
      .update({ os_name: v.name });
  }
  for (const v of BARE_MAJORS) {
    await knex('devices')
      .where('os_type', 'macos')
      .andWhere('os_version', v.exact)
      .update({ os_name: v.name });
  }
}

export async function down(_knex: Knex): Promise<void> {
  // Don't roll back to 'darwin' — the new name is strictly more useful
  // and the previous value is recoverable from gopsutil on next push if
  // anyone really wants it back.
}
