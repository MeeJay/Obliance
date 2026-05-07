import { Knex } from 'knex';

// Cooldown is now a first-class graph node (`type='cooldown'`) instead
// of a per-trigger config field. The state lives here, keyed by
// (scenario_id, device_id, node_id) so a single scenario can host
// multiple cooldown nodes with independent windows. Sharing across
// upstream triggers happens naturally: any path that reaches the same
// cooldown node observes the same `last_pass_at`, so a manual fire 1h
// after a boot-trigger fire still sees the 5h gate as active.
//
// Also rewires existing data: every trigger node row whose config
// carries a non-zero `cooldownSeconds` is split into (a) the trigger
// without that field, (b) a freshly-inserted cooldown node, (c) a new
// edge that routes the original trigger->X chain through the cooldown
// node so behaviour is preserved on upgrade.

export async function up(knex: Knex): Promise<void> {
  // 1. Cooldown state table.
  const exists = await knex.schema.hasTable('scenario_cooldown_state');
  if (!exists) {
    await knex.schema.createTable('scenario_cooldown_state', (t) => {
      t.bigIncrements('id').primary();
      t.bigInteger('scenario_id').notNullable().references('id').inTable('scenarios').onDelete('CASCADE');
      t.bigInteger('device_id').notNullable().references('id').inTable('devices').onDelete('CASCADE');
      // node_id matches scenario_nodes.id; on node delete we drop the
      // state row so a re-imported scenario starts with a clean window.
      t.bigInteger('node_id').notNullable().references('id').inTable('scenario_nodes').onDelete('CASCADE');
      t.timestamp('last_pass_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.unique(['scenario_id', 'device_id', 'node_id']);
      t.index(['scenario_id', 'device_id'], 'idx_cooldown_lookup');
    });
  }

  // 2. Migrate existing trigger.cooldownSeconds → cooldown node.
  // We do this in JS rather than SQL because we need to mutate JSONB
  // configs and INSERT new rows + edges atomically per scenario.
  const triggerRows = await knex('scenario_nodes as n')
    .where(function() {
      this.where('n.type', 'trigger_manual')
        .orWhere('n.type', 'trigger_session_login')
        .orWhere('n.type', 'trigger_machine_boot')
        .orWhere('n.type', 'trigger_agent_approved')
        .orWhere('n.type', 'trigger_group_join')
        .orWhere('n.type', 'trigger_schedule_failure')
        .orWhere('n.type', 'trigger_schedule_cron')
        .orWhere('n.type', 'trigger_agent_back_online')
        .orWhere('n.type', 'trigger_metric_warning')
        .orWhere('n.type', 'trigger_metric_critical')
        .orWhere('n.type', 'trigger_metric_custom');
    })
    .whereRaw("(n.config->>'cooldownSeconds')::int > 0")
    .select('n.id', 'n.scenario_id', 'n.config', 'n.position_x', 'n.position_y');

  for (const tn of triggerRows) {
    const cfg = (typeof tn.config === 'string' ? JSON.parse(tn.config) : tn.config) ?? {};
    const seconds = Number(cfg.cooldownSeconds);
    if (!Number.isFinite(seconds) || seconds <= 0) continue;

    await knex.transaction(async (trx) => {
      // a) Insert cooldown node downstream of the trigger.
      const [cdRow] = await trx('scenario_nodes').insert({
        scenario_id: tn.scenario_id,
        type: 'cooldown',
        label: 'Cooldown (auto-migrated)',
        config: JSON.stringify({ duration: seconds, unit: 'seconds' }),
        position_x: (tn.position_x ?? 0) + 200,
        position_y: tn.position_y ?? 0,
      }).returning(['id']);

      // b) Re-point every existing edge that started at the trigger to
      //    start at the cooldown node instead.
      await trx('scenario_edges')
        .where({ scenario_id: tn.scenario_id, source_node_id: tn.id })
        .update({ source_node_id: cdRow.id });

      // c) Add a new edge trigger -> cooldown so the chain stays
      //    connected. `condition` defaults to `always` (kind: 'always').
      await trx('scenario_edges').insert({
        scenario_id: tn.scenario_id,
        source_node_id: tn.id,
        target_node_id: cdRow.id,
        condition: JSON.stringify({ kind: 'always' }),
        sort_order: 0,
      });

      // d) Strip cooldownSeconds from the trigger config so the new
      //    code path doesn't double-apply it.
      delete cfg.cooldownSeconds;
      await trx('scenario_nodes').where({ id: tn.id }).update({ config: JSON.stringify(cfg) });
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  // Best-effort reversal: collapse cooldown nodes back into a
  // cooldownSeconds field on the trigger immediately upstream. We
  // accept some lossiness — multi-trigger fan-in cooldowns can't be
  // expressed in the old shape, so they're dropped on downgrade.
  const cdNodes = await knex('scenario_nodes').where({ type: 'cooldown' }).select('id', 'scenario_id', 'config');
  for (const cd of cdNodes) {
    const cfg = (typeof cd.config === 'string' ? JSON.parse(cd.config) : cd.config) ?? {};
    const seconds = toSeconds(cfg.duration, cfg.unit);
    const inboundEdge = await knex('scenario_edges')
      .where({ scenario_id: cd.scenario_id, target_node_id: cd.id })
      .first();
    if (inboundEdge) {
      const trigger = await knex('scenario_nodes').where({ id: inboundEdge.source_node_id }).first();
      if (trigger && typeof trigger.type === 'string' && trigger.type.startsWith('trigger_')) {
        const tcfg = (typeof trigger.config === 'string' ? JSON.parse(trigger.config) : trigger.config) ?? {};
        tcfg.cooldownSeconds = seconds;
        await knex('scenario_nodes').where({ id: trigger.id }).update({ config: JSON.stringify(tcfg) });
      }
    }
    // Re-point cooldown's outbound edges back to the trigger.
    if (inboundEdge) {
      await knex('scenario_edges')
        .where({ scenario_id: cd.scenario_id, source_node_id: cd.id })
        .update({ source_node_id: inboundEdge.source_node_id });
    }
    await knex('scenario_edges').where({ target_node_id: cd.id }).del();
    await knex('scenario_nodes').where({ id: cd.id }).del();
  }
  await knex.schema.dropTableIfExists('scenario_cooldown_state');
}

function toSeconds(duration: unknown, unit: unknown): number {
  const n = Number(duration);
  if (!Number.isFinite(n) || n <= 0) return 0;
  switch (String(unit ?? 'seconds')) {
    case 'seconds': return Math.floor(n);
    case 'minutes': return Math.floor(n * 60);
    case 'hours':   return Math.floor(n * 3600);
    case 'days':    return Math.floor(n * 86400);
    case 'months':  return Math.floor(n * 86400 * 30);
    default:        return Math.floor(n);
  }
}
