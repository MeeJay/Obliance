import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('permission_sets', (t) => {
    t.increments('id').primary();
    t.string('name', 64).notNullable();
    t.string('slug', 64).notNullable().unique();
    t.jsonb('capabilities').notNullable().defaultTo('[]');
    t.boolean('is_default').notNullable().defaultTo(false);
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // Seed default permission sets
  await knex('permission_sets').insert([
    {
      name: 'Admin',
      slug: 'admin',
      capabilities: JSON.stringify([
        'monitoring',
        'devices.manage',
        'groups.manage',
        'scripts.manage',
        'scripts.execute',
        'compliance',
        'remote',
        'files',
        'power',
        'updates',
        'reports',
        'settings',
        'users.manage',
      ]),
      is_default: true,
    },
    {
      name: 'User',
      slug: 'user',
      capabilities: JSON.stringify([
        'monitoring',
        'scripts.execute',
        'remote',
        'files',
        'power',
        'updates',
      ]),
      is_default: true,
    },
    {
      name: 'Viewer',
      slug: 'viewer',
      capabilities: JSON.stringify(['monitoring']),
      is_default: true,
    },
  ]);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('permission_sets');
}
