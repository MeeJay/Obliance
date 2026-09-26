import type { Knex } from 'knex';

// TOTP anti-replay + persisted code-failure caps (device-bound 2FA spec,
// docs/mobile/device-bound-2fa.md §5.1 / §6.0 P3 / §6.8).
//
// users.totp_last_step     last TOTP time step accepted for this user,
//                          floor(unix / 30). Every local TOTP check goes
//                          through acceptTotpStep() (services/deviceKey/
//                          stepUpProof.ts), one atomic UPDATE:
//                            strict  (login, TOTP management, enrolment):
//                                    step > totp_last_step
//                            stepup  (restriction envelope, requireFreshTotp):
//                                    step > totp_last_step, or the same
//                                    session and step >= totp_last_step - 4
//                                    (a typed code can be reused for a loop
//                                    of requests in that session only).
// users.totp_last_session  sha256(sessionID) of the session that used that
//                          step (never the raw session id).
//
// step_up_throttle         per-user failure counters, one row per kind:
//   kind 'code'   10 failures / 15 min -> 429; 30 / 24 h -> locked (code
//                 refused until a full sign-in or an admin MFA reset);
//                 e-mail on the 5th failure in 24 h (notified_at).
//   kind 'enrol'  reserved for the device-key enrolment lot (3 / 24 h,
//                 locked_until).
//
// Idempotent (hasColumn / hasTable guards); down() undoes everything.

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn('users', 'totp_last_step'))) {
    await knex.schema.alterTable('users', (t) => {
      t.bigInteger('totp_last_step');
    });
  }
  if (!(await knex.schema.hasColumn('users', 'totp_last_session'))) {
    await knex.schema.alterTable('users', (t) => {
      t.string('totp_last_session', 64);
    });
  }
  if (!(await knex.schema.hasTable('step_up_throttle'))) {
    await knex.schema.createTable('step_up_throttle', (t) => {
      t.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
      t.string('kind', 16).notNullable();                    // 'code' | 'enrol'
      t.timestamp('window_start', { useTz: true });          // 15-min window
      t.integer('window_failures').notNullable().defaultTo(0);
      t.timestamp('day_start', { useTz: true });             // 24-h window
      t.integer('day_failures').notNullable().defaultTo(0);
      t.boolean('locked').notNullable().defaultTo(false);   // code: until a full sign-in
      t.timestamp('locked_until', { useTz: true });          // enrol: 24 h
      t.timestamp('notified_at', { useTz: true });
      t.primary(['user_id', 'kind']);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('step_up_throttle');
  if (await knex.schema.hasColumn('users', 'totp_last_session')) {
    await knex.schema.alterTable('users', (t) => t.dropColumn('totp_last_session'));
  }
  if (await knex.schema.hasColumn('users', 'totp_last_step')) {
    await knex.schema.alterTable('users', (t) => t.dropColumn('totp_last_step'));
  }
}
