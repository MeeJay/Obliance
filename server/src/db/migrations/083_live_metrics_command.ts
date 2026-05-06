import { Knex } from 'knex';

export const config = { transaction: false };

// Adds a `live_metrics` command type that the server pushes to the agent
// over the WS command channel. Two payload shapes:
//
//   { mode: 'push_now' }       — fire one immediate push (refresh button)
//   { mode: 'live', windowSec } — switch to fast-push mode for the next
//                                 N seconds; agent reverts to its
//                                 configured push_interval when the
//                                 window expires.
//
// The single-value enum keeps the agent dispatch table simple while
// letting both modes share the same plumbing.
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TYPE command_type ADD VALUE IF NOT EXISTS 'live_metrics'`);
}

export async function down(_knex: Knex): Promise<void> {
  // Removing enum values requires recreating the type — leave it.
}
