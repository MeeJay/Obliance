import { Knex } from 'knex';

// Command type for capturing a VM console thumbnail (the "A" console layer:
// a VMware-style framebuffer preview via Hyper-V's
// GetVirtualSystemThumbnailImage). Pushed ephemerally over the WS channel
// while a console preview/viewer is open — never persisted to task history.

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TYPE command_type ADD VALUE IF NOT EXISTS 'hyperv_console_thumbnail'`);
}

export async function down(_knex: Knex): Promise<void> {
  // Enum values can't be dropped without a type rebuild — left in place.
}
