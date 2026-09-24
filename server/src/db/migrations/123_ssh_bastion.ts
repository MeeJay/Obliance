import { Knex } from 'knex';

// SSH Bastion (ObliJump) — foundational tables (v1 = tiers T0 managed-shell +
// T1 ephemeral authorized_keys).
//
// user_ssh_keys: a user's registered SSH PUBLIC keys. The bastion's
// PublicKeyCallback maps a presented key's fingerprint -> the Obliance user.
// Fingerprint is globally UNIQUE so a key resolves to exactly one identity.
// Obliance only ever stores the PUBLIC half — the private key never leaves the
// user's machine. Local Obliance-owned field, settable by SSO users too (same
// pattern as the local set-password path).
//
// ssh_bastion_grants: lifecycle record of ONE authenticated jump to a device.
// It drives (a) the server-co-signed grant sent to the agent, (b) the janitor
// sweep (status + expires_at) that guarantees ephemeral authorized_keys never
// leak, and (c) audit. For T1 it carries the ephemeral key fingerprint + the
// detected target sshd port; for T0 (managed-shell) it is a plain PTY session.

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('user_ssh_keys', (t) => {
    t.increments('id').primary();
    t.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('name', 120).notNullable();                   // user-facing label
    t.string('key_type', 40);                              // ssh-ed25519 / ssh-rsa / ...
    t.text('public_key').notNullable();                    // full OpenSSH public key line
    t.string('fingerprint', 128).notNullable().unique();   // SHA256:... — global unique, maps key -> user
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('last_used_at', { useTz: true });
    t.index('user_id');
  });

  await knex.schema.createTable('ssh_bastion_grants', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.integer('device_id').notNullable().references('id').inTable('devices').onDelete('CASCADE');
    t.integer('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    t.string('tier', 32).notNullable();                    // 'managed_shell' | 'ephemeral_authkeys'
    t.string('target_user', 64);                           // 'obli' for T1; agent user (root) for T0
    t.string('status', 24).notNullable().defaultTo('pending'); // pending|active|closed|revoked|error
    t.string('source_ip', 64);                             // user's client IP at the bastion
    t.string('public_key_fp', 128);                        // ephemeral/user key fp injected on target (T1)
    t.integer('sshd_port');                                // detected target sshd listen port (T1)
    t.text('error');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('expires_at', { useTz: true });            // TTL — janitor / self-heal boundary
    t.timestamp('closed_at', { useTz: true });
    t.index(['device_id', 'status']);
    t.index(['status', 'expires_at']);                     // janitor sweep of stale / still-active grants
    t.index('user_id');
  });

  // Static IP allow-list for the bastion port — a PLATFORM-wide network policy
  // (the bastion is a single global service), so it is NOT tenant-scoped and
  // does not fit the tenant-scoped `settings` table. The `enforce` toggle
  // lives in app_config (a global flag, like force_2fa).
  await knex.schema.createTable('ssh_bastion_ip_allowlist', (t) => {
    t.increments('id').primary();
    t.string('cidr', 64).notNullable().unique();           // "203.0.113.4" or "10.0.0.0/24"
    t.string('label', 120);
    t.integer('created_by').references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  // Persistent bans (bruteforce / repeated not-allowed attempts). Survive a
  // restart; pushed upstream to Obliguard's shared banlist (P6).
  await knex.schema.createTable('ssh_bastion_bans', (t) => {
    t.increments('id').primary();
    t.string('ip', 64).notNullable().unique();
    t.string('reason', 64).notNullable();                  // 'bruteforce' | 'ip_not_allowed' | 'honeypot' | 'manual'
    t.timestamp('expires_at', { useTz: true });            // null = permanent
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('obliguard_pushed_at', { useTz: true });
    t.text('obliguard_error');
    t.index('expires_at');
  });

  // IP authorizations granted by the header "SSH" button (fresh 2FA). Kept
  // SEPARATE from tfa_trusted_sessions on purpose: an SSH authorization must
  // not also silence the 2FA prompt of sensitive web actions from that IP.
  await knex.schema.createTable('ssh_bastion_ip_grants', (t) => {
    t.increments('id').primary();
    t.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('ip', 64).notNullable();
    t.timestamp('expires_at', { useTz: true }).notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['user_id', 'ip']);
    t.index('expires_at');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('ssh_bastion_ip_grants');
  await knex.schema.dropTableIfExists('ssh_bastion_bans');
  await knex.schema.dropTableIfExists('ssh_bastion_ip_allowlist');
  await knex.schema.dropTableIfExists('ssh_bastion_grants');
  await knex.schema.dropTableIfExists('user_ssh_keys');
}
