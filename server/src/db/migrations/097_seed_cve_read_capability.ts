import { Knex } from 'knex';

// Seed the new `cve:read` capability onto the 'admin' permission set
// only. CVE data leaks sensitive infrastructure detail (versions,
// products, exposed vendors) and routinely names the active CVEs that
// would let an attacker move laterally — we keep it off the default
// 'user' bundle so the operator profile has to be explicitly granted
// the cap by an admin via the PermissionSets matrix.
//
// 'admin' implicitly bypasses the runtime check anyway; the seed just
// makes the matrix UI show the toggle as ticked-on for admins so the
// state is honest. 'user' / 'viewer' stay un-ticked.
//
// Idempotent.

const CAP = 'cve:read';

export async function up(knex: Knex): Promise<void> {
  const rows = await knex('permission_sets')
    .where({ slug: 'admin' })
    .select('id', 'capabilities') as Array<{ id: number; capabilities: unknown }>;
  for (const r of rows) {
    const caps = parseCapsArray(r.capabilities);
    if (caps.includes(CAP)) continue;
    caps.push(CAP);
    await knex('permission_sets').where({ id: r.id }).update({ capabilities: JSON.stringify(caps) });
  }
}

export async function down(knex: Knex): Promise<void> {
  const rows = await knex('permission_sets').select('id', 'capabilities') as Array<{ id: number; capabilities: unknown }>;
  for (const r of rows) {
    const caps = parseCapsArray(r.capabilities).filter((c) => c !== CAP);
    await knex('permission_sets').where({ id: r.id }).update({ capabilities: JSON.stringify(caps) });
  }
}

function parseCapsArray(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === 'string');
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === 'string');
    } catch { /* legacy junk — drop */ }
  }
  return [];
}
