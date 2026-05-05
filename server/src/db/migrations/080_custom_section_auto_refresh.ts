import { Knex } from 'knex';

// Adds auto-refresh fields to `custom_sections`. Used only for the
// HTML render mode (the terminal mode is always live by definition):
// when the user toggles the switch, the client re-opens the stream
// every `auto_refresh_interval_seconds` after the script exits, so
// the panel works as a self-updating dashboard.
export async function up(knex: Knex): Promise<void> {
  const hasA = await knex.schema.hasColumn('custom_sections', 'auto_refresh_enabled');
  const hasB = await knex.schema.hasColumn('custom_sections', 'auto_refresh_interval_seconds');
  if (!hasA || !hasB) {
    await knex.schema.alterTable('custom_sections', (t) => {
      if (!hasA) t.boolean('auto_refresh_enabled').notNullable().defaultTo(false);
      if (!hasB) t.integer('auto_refresh_interval_seconds').notNullable().defaultTo(30);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasA = await knex.schema.hasColumn('custom_sections', 'auto_refresh_enabled');
  const hasB = await knex.schema.hasColumn('custom_sections', 'auto_refresh_interval_seconds');
  if (hasA || hasB) {
    await knex.schema.alterTable('custom_sections', (t) => {
      if (hasA) t.dropColumn('auto_refresh_enabled');
      if (hasB) t.dropColumn('auto_refresh_interval_seconds');
    });
  }
}
