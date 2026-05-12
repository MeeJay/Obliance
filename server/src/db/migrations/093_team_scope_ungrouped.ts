import { Knex } from 'knex';

// Add 'ungrouped' to the team_scope enum so team_permissions can carry
// a row that grants access to devices whose group_id IS NULL — useful
// for tenants whose API keys don't pre-assign a default group on
// enrolment, and for catching genuinely orphan devices (the agent
// was reassigned away from its group without picking a new one).
//
// scope_id is left at 0 by convention when scope='ungrouped' (there's
// no FK on scope_id, just a discriminator next to the scope value).
//
// Postgres requires ADD VALUE to run OUTSIDE of a transaction — Knex
// wraps each migration in a transaction by default, so we surface
// the toggle via `config.transaction = false`.

export const config = { transaction: false };

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TYPE team_scope ADD VALUE IF NOT EXISTS 'ungrouped'`);
}

export async function down(_knex: Knex): Promise<void> {
  // Removing an enum value in Postgres requires recreating the type
  // + recasting every column — destructive and rarely worth it. Down
  // is a no-op; the value stays in the enum but UI no longer offers
  // it, and any 'ungrouped' rows are inert without service support.
}
