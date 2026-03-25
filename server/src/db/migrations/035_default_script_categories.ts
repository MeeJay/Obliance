import { Knex } from 'knex';

const DEFAULT_CATEGORIES = [
  { name: 'Monitoring', sort_order: 1 },
  { name: 'Maintenance', sort_order: 2 },
  { name: 'Security', sort_order: 3 },
  { name: 'Network', sort_order: 4 },
  { name: 'Inventory', sort_order: 5 },
  { name: 'Deployment', sort_order: 6 },
  { name: 'Backup', sort_order: 7 },
  { name: 'Compliance', sort_order: 8 },
];

export async function up(knex: Knex): Promise<void> {
  // Insert global categories (tenant_id = null) if they don't exist
  for (const cat of DEFAULT_CATEGORIES) {
    const exists = await knex('script_categories')
      .whereNull('tenant_id')
      .where({ name: cat.name })
      .first();
    if (!exists) {
      await knex('script_categories').insert({
        tenant_id: null,
        name: cat.name,
        sort_order: cat.sort_order,
      });
    }
  }

  // Auto-categorize existing system scripts by keyword matching
  const scripts = await knex('scripts').where({ script_type: 'system' }).whereNull('category_id');
  for (const script of scripts) {
    const name = (script.name || '').toLowerCase();
    const content = (script.content || '').toLowerCase();
    let catName: string | null = null;

    if (/monitor|health|check|status|uptime|disk.?space|cpu|memory|ram/.test(name + content)) catName = 'Monitoring';
    else if (/clean|update|patch|restart|reboot|maintenance|temp|cache/.test(name + content)) catName = 'Maintenance';
    else if (/security|firewall|antivirus|audit|password|encrypt|bitlocker|defender/.test(name + content)) catName = 'Security';
    else if (/network|dns|ping|traceroute|ip|port|wifi|adapter/.test(name + content)) catName = 'Network';
    else if (/inventory|hardware|software|installed|system.?info/.test(name + content)) catName = 'Inventory';
    else if (/deploy|install|setup|configure|provision/.test(name + content)) catName = 'Deployment';
    else if (/backup|restore|snapshot|copy|archive/.test(name + content)) catName = 'Backup';
    else if (/compliance|policy|cis|nist|iso|hipaa|soc|pci/.test(name + content)) catName = 'Compliance';

    if (catName) {
      const cat = await knex('script_categories').whereNull('tenant_id').where({ name: catName }).first();
      if (cat) {
        await knex('scripts').where({ id: script.id }).update({ category_id: cat.id });
      }
    }
  }
}

export async function down(knex: Knex): Promise<void> {
  // Uncategorize scripts
  await knex('scripts').whereIn('category_id',
    knex('script_categories').whereNull('tenant_id').whereIn('name', DEFAULT_CATEGORIES.map((c) => c.name)).select('id')
  ).update({ category_id: null });

  // Remove default categories
  await knex('script_categories')
    .whereNull('tenant_id')
    .whereIn('name', DEFAULT_CATEGORIES.map((c) => c.name))
    .delete();
}
