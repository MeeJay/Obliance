import { Knex } from 'knex';

// Adds a `render_mode` discriminator to `custom_sections` so PowerShell
// (and any other runtime) can opt into HTML output instead of the xterm
// terminal stream. PowerShell scripts can emit a fully-formed HTML
// document on stdout — the client accumulates the bytes and renders
// them in a sandboxed iframe when this column is set to 'html'.
export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasColumn('custom_sections', 'render_mode');
  if (!exists) {
    await knex.schema.alterTable('custom_sections', (t) => {
      t.string('render_mode').notNullable().defaultTo('terminal');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasColumn('custom_sections', 'render_mode');
  if (exists) {
    await knex.schema.alterTable('custom_sections', (t) => {
      t.dropColumn('render_mode');
    });
  }
}
