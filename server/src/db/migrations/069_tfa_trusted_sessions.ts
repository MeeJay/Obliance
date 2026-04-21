import { Knex } from 'knex';

// "Trusted IP" short-term cache for successful TOTP step-ups. After a user
// completes a 2FA prompt for a sensitive action, the (user_id, ip) pair is
// remembered for `trusted_until`; subsequent sensitive actions from the
// same user on the same IP skip the prompt until expiry.
//
// Intentionally per-(user, ip) — NOT tenant-scoped. The TOTP verification
// is about who's at the keyboard, not which tenant they're acting on.
// IPv6-mapped IPv4 (::ffff:x.x.x.x) is normalised before insert.

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('tfa_trusted_sessions', (t) => {
    t.increments('id').primary();
    t.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('ip_address', 64).notNullable();
    t.timestamp('trusted_until', { useTz: true }).notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['user_id', 'ip_address']);
    t.index('trusted_until');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('tfa_trusted_sessions');
}
