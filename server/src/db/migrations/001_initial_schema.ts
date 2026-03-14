import type { Knex } from 'knex';

// =============================================================================
// Obliance RMM — Initial Schema
// Single migration that creates the full database structure from scratch.
// Subsequent features will add new migrations on top of this baseline.
// =============================================================================

export async function up(knex: Knex): Promise<void> {

  // ===========================================================================
  // ENUMS
  // ===========================================================================
  await knex.raw(`
    -- Users & auth
    CREATE TYPE user_role        AS ENUM ('admin', 'user');
    CREATE TYPE tenant_role      AS ENUM ('admin', 'member');
    CREATE TYPE team_scope       AS ENUM ('group', 'device');
    CREATE TYPE team_level       AS ENUM ('ro', 'rw');
    CREATE TYPE approval_status  AS ENUM ('pending', 'approved', 'refused');

    -- Devices
    CREATE TYPE os_type          AS ENUM ('windows', 'macos', 'linux', 'other');
    CREATE TYPE device_status    AS ENUM (
      'pending', 'online', 'offline', 'maintenance', 'warning', 'critical', 'suspended'
    );

    -- Command queue (push-based bidirectional protocol)
    CREATE TYPE command_type     AS ENUM (
      'run_script',
      'install_update',
      'scan_inventory',
      'scan_updates',
      'check_compliance',
      'open_remote_tunnel',
      'close_remote_tunnel',
      'reboot',
      'shutdown',
      'install_software',
      'uninstall_software'
    );
    CREATE TYPE command_status   AS ENUM (
      'pending', 'sent', 'ack_running', 'success', 'failure', 'timeout', 'cancelled'
    );
    CREATE TYPE command_priority AS ENUM ('low', 'normal', 'high', 'urgent');

    -- Scripts
    CREATE TYPE script_platform  AS ENUM ('windows', 'macos', 'linux', 'all');
    CREATE TYPE script_runtime   AS ENUM (
      'powershell', 'pwsh', 'cmd', 'bash', 'zsh', 'sh', 'python', 'python3', 'perl', 'ruby'
    );

    -- Script executions
    CREATE TYPE execution_status  AS ENUM (
      'pending', 'sent', 'running', 'success', 'failure', 'timeout', 'skipped', 'cancelled'
    );
    CREATE TYPE execution_trigger AS ENUM ('schedule', 'manual', 'api', 'catchup');

    -- Updates
    CREATE TYPE update_severity  AS ENUM ('critical', 'important', 'moderate', 'optional', 'unknown');
    CREATE TYPE update_source    AS ENUM (
      'windows_update', 'apt', 'yum', 'dnf', 'pacman', 'brew', 'chocolatey', 'winget', 'other'
    );
    CREATE TYPE update_status    AS ENUM (
      'available', 'approved', 'pending_install', 'installing',
      'installed', 'failed', 'excluded', 'superseded'
    );
    CREATE TYPE reboot_behavior  AS ENUM ('never', 'ask', 'auto_immediate', 'auto_delayed');

    -- Compliance
    CREATE TYPE compliance_framework AS ENUM (
      'CIS', 'NIST', 'ISO27001', 'PCI_DSS', 'HIPAA', 'SOC2', 'custom'
    );
    CREATE TYPE compliance_status    AS ENUM ('pass', 'fail', 'warning', 'unknown', 'skipped', 'error');

    -- Remote access
    CREATE TYPE remote_protocol       AS ENUM ('vnc', 'rdp', 'ssh');
    CREATE TYPE remote_session_status AS ENUM (
      'waiting', 'connecting', 'active', 'closed', 'failed', 'timeout'
    );

    -- Notifications
    CREATE TYPE notification_channel_type AS ENUM (
      'telegram', 'discord', 'slack', 'teams', 'smtp',
      'webhook', 'gotify', 'ntfy', 'pushover', 'freemobile'
    );
    CREATE TYPE override_mode    AS ENUM ('merge', 'replace', 'exclude');
    CREATE TYPE alert_severity   AS ENUM ('info', 'warning', 'critical');

    -- Maintenance
    CREATE TYPE maintenance_scope    AS ENUM ('global', 'group', 'device');
    CREATE TYPE maintenance_schedule AS ENUM ('one_time', 'recurring');

    -- Reports
    CREATE TYPE report_type   AS ENUM ('fleet', 'compliance', 'scripts', 'updates', 'software', 'custom');
    CREATE TYPE report_format AS ENUM ('json', 'csv', 'pdf', 'excel', 'html');
    CREATE TYPE report_status AS ENUM ('generating', 'ready', 'error');
  `);

  // ===========================================================================
  // SESSION  (connect-pg-simple)
  // ===========================================================================
  await knex.schema.createTable('session', (t) => {
    t.string('sid').primary().notNullable();
    t.json('sess').notNullable();
    t.timestamp('expire', { useTz: false }).notNullable().index();
  });

  // ===========================================================================
  // USERS
  // ===========================================================================
  await knex.schema.createTable('users', (t) => {
    t.increments('id').primary();
    t.string('username', 100).notNullable().unique();
    t.string('password_hash').notNullable();
    t.string('display_name', 200);
    t.specificType('role', 'user_role').notNullable().defaultTo('user');
    t.boolean('is_active').notNullable().defaultTo(true);
    t.string('email').unique();
    t.string('preferred_language', 10).defaultTo('en');
    t.integer('enrollment_version').defaultTo(0);
    t.jsonb('preferences').defaultTo('{}');
    // 2FA
    t.string('totp_secret');
    t.boolean('totp_enabled').notNullable().defaultTo(false);
    t.boolean('email_otp_enabled').notNullable().defaultTo(false);
    t.timestamps(true, true);
  });

  // ===========================================================================
  // TENANTS  (workspaces)
  // ===========================================================================
  await knex.schema.createTable('tenants', (t) => {
    t.increments('id').primary();
    t.string('name', 200).notNullable();
    t.string('slug', 100).notNullable().unique();
    t.timestamps(true, true);
  });

  await knex.schema.createTable('user_tenants', (t) => {
    t.integer('user_id').notNullable()
      .references('id').inTable('users').onDelete('CASCADE');
    t.integer('tenant_id').notNullable()
      .references('id').inTable('tenants').onDelete('CASCADE');
    t.specificType('role', 'tenant_role').notNullable().defaultTo('member');
    t.primary(['user_id', 'tenant_id']);
  });

  await knex.schema.createTable('password_reset_tokens', (t) => {
    t.increments('id').primary();
    t.integer('user_id').notNullable()
      .references('id').inTable('users').onDelete('CASCADE');
    t.string('token_hash').notNullable().unique();
    t.timestamp('expires_at').notNullable();
    t.timestamp('used_at');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });

  // ===========================================================================
  // APP CONFIG  (global key-value settings)
  // ===========================================================================
  await knex.schema.createTable('app_config', (t) => {
    t.string('key').primary();
    t.text('value');
  });

  // ===========================================================================
  // DEVICE GROUPS  (hierarchical, replaces monitor_groups)
  // ===========================================================================
  await knex.schema.createTable('device_groups', (t) => {
    t.increments('id').primary();
    t.integer('tenant_id').notNullable()
      .references('id').inTable('tenants').onDelete('CASCADE');
    t.integer('parent_id')
      .references('id').inTable('device_groups').onDelete('SET NULL');
    t.string('name', 200).notNullable();
    t.string('slug', 200).notNullable();
    t.text('description');
    t.integer('sort_order').defaultTo(0);
    // Aggregate alerting: one alert when first device in group goes critical
    t.boolean('group_notifications').notNullable().defaultTo(false);
    // RMM group-level config (push interval, default policies, etc.)
    t.jsonb('group_config').defaultTo('{}');
    t.uuid('uuid').notNullable().defaultTo(knex.raw('gen_random_uuid()')).unique();
    t.timestamps(true, true);
    t.unique(['slug', 'tenant_id']);
  });

  // Closure table: efficient hierarchical ancestor/descendant queries
  await knex.schema.createTable('device_group_closure', (t) => {
    t.integer('ancestor_id').notNullable()
      .references('id').inTable('device_groups').onDelete('CASCADE');
    t.integer('descendant_id').notNullable()
      .references('id').inTable('device_groups').onDelete('CASCADE');
    t.integer('depth').notNullable();
    t.primary(['ancestor_id', 'descendant_id']);
  });

  // ===========================================================================
  // TEAMS & RBAC
  // ===========================================================================
  await knex.schema.createTable('user_teams', (t) => {
    t.increments('id').primary();
    t.integer('tenant_id').notNullable()
      .references('id').inTable('tenants').onDelete('CASCADE');
    t.string('name', 200).notNullable();
    t.boolean('can_create').notNullable().defaultTo(false);
    t.uuid('uuid').notNullable().defaultTo(knex.raw('gen_random_uuid()')).unique();
    t.timestamps(true, true);
  });

  await knex.schema.createTable('team_memberships', (t) => {
    t.integer('team_id').notNullable()
      .references('id').inTable('user_teams').onDelete('CASCADE');
    t.integer('user_id').notNullable()
      .references('id').inTable('users').onDelete('CASCADE');
    t.primary(['team_id', 'user_id']);
  });

  await knex.schema.createTable('team_permissions', (t) => {
    t.increments('id').primary();
    t.integer('tenant_id').notNullable()
      .references('id').inTable('tenants').onDelete('CASCADE');
    t.integer('team_id').notNullable()
      .references('id').inTable('user_teams').onDelete('CASCADE');
    t.specificType('scope', 'team_scope').notNullable();
    t.integer('scope_id').notNullable(); // group_id or device_id
    t.specificType('level', 'team_level').notNullable().defaultTo('ro');
  });

  // ===========================================================================
  // SETTINGS  (cascading: global → group → device)
  // ===========================================================================
  await knex.schema.createTable('settings', (t) => {
    t.increments('id').primary();
    t.integer('tenant_id').notNullable()
      .references('id').inTable('tenants').onDelete('CASCADE');
    t.string('scope', 20).notNullable();   // 'global' | 'group' | 'device'
    t.integer('scope_id');                 // null for global
    t.string('key', 100).notNullable();
    t.jsonb('value');
    t.timestamps(true, true);
    t.unique(['tenant_id', 'scope', 'scope_id', 'key']);
  });

  // ===========================================================================
  // SMTP SERVERS
  // ===========================================================================
  await knex.schema.createTable('smtp_servers', (t) => {
    t.increments('id').primary();
    t.integer('tenant_id')
      .references('id').inTable('tenants').onDelete('CASCADE');
    t.string('name', 200).notNullable();
    t.string('host').notNullable();
    t.integer('port').notNullable().defaultTo(587);
    t.boolean('secure').notNullable().defaultTo(false);
    t.string('username');
    t.string('password');
    t.string('from_address');
    t.timestamps(true, true);
  });

  // ===========================================================================
  // NOTIFICATION CHANNELS
  // ===========================================================================
  await knex.schema.createTable('notification_channels', (t) => {
    t.increments('id').primary();
    t.integer('tenant_id').notNullable()
      .references('id').inTable('tenants').onDelete('CASCADE');
    t.string('name', 200).notNullable();
    t.specificType('type', 'notification_channel_type').notNullable();
    t.jsonb('config').notNullable().defaultTo('{}');
    t.uuid('uuid').notNullable().defaultTo(knex.raw('gen_random_uuid()')).unique();
    t.timestamps(true, true);
  });

  // Cross-workspace channel sharing
  await knex.schema.createTable('notification_channel_tenants', (t) => {
    t.integer('channel_id').notNullable()
      .references('id').inTable('notification_channels').onDelete('CASCADE');
    t.integer('tenant_id').notNullable()
      .references('id').inTable('tenants').onDelete('CASCADE');
    t.primary(['channel_id', 'tenant_id']);
    t.index(['tenant_id']);
  });

  // Bind channels at global / group / device level with inheritance modes
  await knex.schema.createTable('notification_bindings', (t) => {
    t.increments('id').primary();
    t.integer('tenant_id').notNullable()
      .references('id').inTable('tenants').onDelete('CASCADE');
    t.integer('channel_id').notNullable()
      .references('id').inTable('notification_channels').onDelete('CASCADE');
    t.string('scope', 20).notNullable();   // 'global' | 'group' | 'device'
    t.integer('scope_id');
    t.specificType('override_mode', 'override_mode').notNullable().defaultTo('merge');
  });

  await knex.schema.createTable('notification_log', (t) => {
    t.increments('id').primary();
    t.integer('channel_id')
      .references('id').inTable('notification_channels').onDelete('SET NULL');
    t.string('scope', 20);
    t.integer('scope_id');
    t.string('event_type', 100);
    t.string('status', 20);
    t.text('error_message');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });

  // ===========================================================================
  // LIVE ALERTS  (in-app real-time notifications via Socket.io)
  // ===========================================================================
  await knex.schema.createTable('live_alerts', (t) => {
    t.increments('id').primary();
    t.integer('tenant_id').notNullable()
      .references('id').inTable('tenants').onDelete('CASCADE');
    t.specificType('severity', 'alert_severity').notNullable().defaultTo('info');
    t.string('title', 500).notNullable();
    t.text('message');
    t.string('navigate_to', 500);
    t.string('stable_key', 500);  // for deduplication
    t.timestamp('read_at');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['tenant_id', 'created_at']);
    t.index(['tenant_id', 'stable_key']);
  });

  // ===========================================================================
  // MAINTENANCE WINDOWS
  // ===========================================================================
  await knex.schema.createTable('maintenance_windows', (t) => {
    t.increments('id').primary();
    t.integer('tenant_id').notNullable()
      .references('id').inTable('tenants').onDelete('CASCADE');
    t.string('name', 200).notNullable();
    t.specificType('scope_type', 'maintenance_scope').notNullable().defaultTo('global');
    t.integer('scope_id');   // null when scope_type = 'global'
    t.specificType('schedule_type', 'maintenance_schedule').notNullable().defaultTo('one_time');
    t.timestamp('starts_at').notNullable();
    t.timestamp('ends_at').notNullable();
    t.jsonb('recurrence_rule').defaultTo('{}');
    t.string('timezone', 100).defaultTo('UTC');
    t.jsonb('notification_channels').defaultTo('[]');
    t.string('last_dedup_key', 500);
    t.integer('created_by').references('id').inTable('users').onDelete('SET NULL');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('maintenance_window_disables', (t) => {
    t.increments('id').primary();
    t.integer('window_id').notNullable()
      .references('id').inTable('maintenance_windows').onDelete('CASCADE');
    t.string('scope_type', 20).notNullable();  // 'group' | 'device'
    t.integer('scope_id').notNullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });

  // ===========================================================================
  // AGENT API KEYS
  // ===========================================================================
  await knex.schema.createTable('agent_api_keys', (t) => {
    t.increments('id').primary();
    t.integer('tenant_id').notNullable()
      .references('id').inTable('tenants').onDelete('CASCADE');
    t.string('name', 200);
    t.string('key', 200).notNullable().unique();
    t.integer('created_by').references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('last_used_at');
  });

  // ===========================================================================
  // DEVICES  (core RMM entity — replaces agent_devices + monitors)
  // ===========================================================================
  await knex.schema.createTable('devices', (t) => {
    t.increments('id').primary();
    t.uuid('uuid').notNullable().unique().defaultTo(knex.raw('gen_random_uuid()'));
    t.integer('tenant_id').notNullable()
      .references('id').inTable('tenants').onDelete('CASCADE');
    t.integer('group_id')
      .references('id').inTable('device_groups').onDelete('SET NULL');
    t.integer('api_key_id')
      .references('id').inTable('agent_api_keys').onDelete('SET NULL');

    // Identity
    t.string('hostname', 500).notNullable();
    t.string('display_name', 500);
    t.text('description');

    // Network
    t.string('ip_local', 45);
    t.string('ip_public', 45);
    t.string('mac_address', 50);

    // OS
    t.specificType('os_type', 'os_type').notNullable().defaultTo('other');
    t.string('os_name', 200);
    t.string('os_version', 200);
    t.string('os_build', 200);
    t.string('os_arch', 50);

    // Hardware summary (full detail in device_inventory_hardware)
    t.string('cpu_model', 500);
    t.integer('cpu_cores');
    t.decimal('ram_total_gb', 10, 2);

    // Agent
    t.string('agent_version', 50);
    t.specificType('status', 'device_status').notNullable().defaultTo('pending');
    t.specificType('approval_status', 'approval_status').notNullable().defaultTo('pending');
    t.integer('approved_by').references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('approved_at');
    t.timestamp('last_seen_at');
    t.timestamp('last_push_at');

    // Push config overrides (null = use group/global setting)
    t.integer('push_interval_seconds');
    t.boolean('override_group_settings').notNullable().defaultTo(false);
    t.integer('max_missed_pushes').defaultTo(3);

    // RMM metadata
    t.jsonb('tags').defaultTo('[]');
    t.jsonb('custom_fields').defaultTo('{}');

    // Agent display & sensor config
    t.jsonb('display_config').defaultTo('{}');
    t.jsonb('sensor_display_names').defaultTo('{}');
    t.jsonb('notification_types').defaultTo('{}');

    // Latest metrics snapshot (written on every push — fast read for dashboards)
    t.jsonb('latest_metrics').defaultTo('{}');
    /*
      latest_metrics shape:
      {
        cpu: { total: number, cores: number[] },
        memory: { used: number, total: number, pct: number },
        disks: [{ mount: string, used: number, total: number, pct: number }],
        network: [{ iface: string, in: number, out: number }],
        temps: [{ label: string, value: number }],
        gpu: [{ name: string, util: number, vram_used: number, temp: number }],
        updatedAt: string (ISO)
      }
    */

    t.timestamps(true, true);
    t.index(['tenant_id', 'status']);
    t.index(['tenant_id', 'group_id']);
    t.index(['approval_status']);
  });

  // ===========================================================================
  // DEVICE INVENTORY
  // ===========================================================================

  // Hardware snapshot (one row per scan, keeps last N scans)
  await knex.schema.createTable('device_inventory_hardware', (t) => {
    t.increments('id').primary();
    t.integer('device_id').notNullable()
      .references('id').inTable('devices').onDelete('CASCADE');
    t.jsonb('cpu').defaultTo('{}');
    t.jsonb('memory').defaultTo('{}');
    t.jsonb('disks').defaultTo('[]');
    t.jsonb('network_interfaces').defaultTo('[]');
    t.jsonb('gpu').defaultTo('[]');
    t.jsonb('motherboard').defaultTo('{}');
    t.jsonb('bios').defaultTo('{}');
    t.jsonb('raw').defaultTo('{}');  // full raw payload for future parsing
    t.timestamp('scanned_at').notNullable().defaultTo(knex.fn.now());
    t.index(['device_id', 'scanned_at']);
  });

  // Software inventory (upserted on each scan — one row per installed app per device)
  await knex.schema.createTable('device_inventory_software', (t) => {
    t.increments('id').primary();
    t.integer('device_id').notNullable()
      .references('id').inTable('devices').onDelete('CASCADE');
    t.string('name', 500).notNullable();
    t.string('version', 200);
    t.string('publisher', 500);
    t.string('install_date', 50);
    t.text('install_location');
    // Source: registry | dpkg | rpm | pacman | brew | winget | chocolatey | snap | flatpak
    t.string('source', 50);
    // Package manager ID for programmatic install/uninstall
    t.string('package_id', 500);
    t.timestamp('scanned_at').notNullable().defaultTo(knex.fn.now());
    t.index(['device_id', 'scanned_at']);
    t.index(['device_id', 'name']);
  });

  // ===========================================================================
  // COMMAND QUEUE  (push-based command delivery with ACK)
  //
  // Flow:
  //   1. Server inserts command → status: pending
  //   2. Agent pushes metrics → Server includes command in response → status: sent
  //   3. Agent ACKs (next push) → status: ack_running | success | failure
  //   4. Server sets nextPollIn=5 while queue non-empty, else pushInterval
  // ===========================================================================
  await knex.schema.createTable('command_queue', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.integer('device_id').notNullable()
      .references('id').inTable('devices').onDelete('CASCADE');
    t.integer('tenant_id').notNullable()
      .references('id').inTable('tenants').onDelete('CASCADE');
    t.specificType('type', 'command_type').notNullable();
    t.jsonb('payload').notNullable().defaultTo('{}');
    t.specificType('status', 'command_status').notNullable().defaultTo('pending');
    t.specificType('priority', 'command_priority').notNullable().defaultTo('normal');

    // Timing
    t.timestamp('sent_at');      // when included in push response
    t.timestamp('acked_at');     // when agent sent first ACK
    t.timestamp('finished_at');  // when terminal status reached
    t.timestamp('expires_at');   // auto-cancel if not ACKed by this time

    // Result payload: { exitCode, stdout, stderr, error, duration }
    t.jsonb('result').defaultTo('{}');

    // Retry logic (0 = no retry)
    t.integer('retry_count').notNullable().defaultTo(0);
    t.integer('max_retries').notNullable().defaultTo(0);

    // Source linking (script_execution, update_deployment, etc.)
    t.string('source_type', 100);
    t.string('source_id', 100);

    t.integer('created_by').references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    t.index(['device_id', 'status']);
    t.index(['tenant_id', 'status']);
    t.index(['status', 'created_at']);
  });

  // ===========================================================================
  // SCRIPTS  (library)
  // ===========================================================================
  await knex.schema.createTable('script_categories', (t) => {
    t.increments('id').primary();
    t.integer('tenant_id')   // null = built-in global category
      .references('id').inTable('tenants').onDelete('CASCADE');
    t.string('name', 200).notNullable();
    t.string('icon', 100);
    t.string('color', 20).defaultTo('#6366f1');
    t.integer('sort_order').defaultTo(0);
    t.timestamps(true, true);
  });

  await knex.schema.createTable('scripts', (t) => {
    t.increments('id').primary();
    t.uuid('uuid').notNullable().defaultTo(knex.raw('gen_random_uuid()')).unique();
    t.integer('tenant_id')   // null = built-in script
      .references('id').inTable('tenants').onDelete('CASCADE');
    t.integer('category_id')
      .references('id').inTable('script_categories').onDelete('SET NULL');
    t.string('name', 300).notNullable();
    t.text('description');
    t.jsonb('tags').defaultTo('[]');
    t.specificType('platform', 'script_platform').notNullable().defaultTo('all');
    t.specificType('runtime', 'script_runtime').notNullable().defaultTo('bash');
    t.text('content').notNullable();
    t.integer('timeout_seconds').notNullable().defaultTo(300);
    // 'system' = run as SYSTEM/root, 'user' = run as logged-in user
    t.string('run_as', 20).notNullable().defaultTo('system');
    t.boolean('is_builtin').notNullable().defaultTo(false);
    t.integer('created_by').references('id').inTable('users').onDelete('SET NULL');
    t.integer('updated_by').references('id').inTable('users').onDelete('SET NULL');
    t.timestamps(true, true);
    t.index(['tenant_id', 'platform']);
  });

  // Typed parameters — injected into script as {{PARAM_NAME}} at runtime
  await knex.schema.createTable('script_parameters', (t) => {
    t.increments('id').primary();
    t.integer('script_id').notNullable()
      .references('id').inTable('scripts').onDelete('CASCADE');
    t.string('name', 100).notNullable();      // variable name: {{PARAM_NAME}}
    t.string('label', 200).notNullable();     // UI display label
    t.text('description');
    // string | number | boolean | secret | select | multiselect
    t.string('type', 50).notNullable().defaultTo('string');
    t.jsonb('options').defaultTo('[]');       // choices for select/multiselect
    t.text('default_value');
    t.boolean('required').notNullable().defaultTo(false);
    t.integer('sort_order').notNullable().defaultTo(0);
  });

  // ===========================================================================
  // SCRIPT SCHEDULES
  // ===========================================================================
  await knex.schema.createTable('script_schedules', (t) => {
    t.increments('id').primary();
    t.uuid('uuid').notNullable().defaultTo(knex.raw('gen_random_uuid()')).unique();
    t.integer('tenant_id').notNullable()
      .references('id').inTable('tenants').onDelete('CASCADE');
    t.integer('script_id').notNullable()
      .references('id').inTable('scripts').onDelete('CASCADE');
    t.string('name', 300).notNullable();
    t.text('description');

    // Target: device | group | all
    t.string('target_type', 20).notNullable().defaultTo('device');
    t.integer('target_id');   // device_id or group_id (null when target_type='all')

    // Schedule (mutually exclusive)
    t.string('cron_expression', 200);  // recurring (5-field cron, server local TZ)
    t.timestamp('fire_once_at');       // one-time execution

    t.string('timezone', 100).notNullable().defaultTo('UTC');
    t.jsonb('parameter_values').defaultTo('{}');

    // Catch-up: replay missed executions when device comes back online
    t.boolean('catchup_enabled').notNullable().defaultTo(true);
    t.integer('catchup_max').notNullable().defaultTo(3);   // max missed to replay

    // Optional run conditions (e.g. only if os_version >= "10.0.0")
    t.jsonb('run_conditions').defaultTo('[]');

    t.boolean('enabled').notNullable().defaultTo(true);
    t.timestamp('last_run_at');
    t.timestamp('next_run_at');
    t.integer('created_by').references('id').inTable('users').onDelete('SET NULL');
    t.integer('updated_by').references('id').inTable('users').onDelete('SET NULL');
    t.timestamps(true, true);

    t.index(['tenant_id', 'enabled']);
    t.index(['next_run_at']);
  });

  // ===========================================================================
  // SCRIPT EXECUTIONS  (history + real-time status)
  // ===========================================================================
  await knex.schema.createTable('script_executions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.integer('tenant_id').notNullable()
      .references('id').inTable('tenants').onDelete('CASCADE');
    t.integer('script_id').notNullable()
      .references('id').inTable('scripts').onDelete('CASCADE');
    t.integer('device_id').notNullable()
      .references('id').inTable('devices').onDelete('CASCADE');
    t.integer('schedule_id')
      .references('id').inTable('script_schedules').onDelete('SET NULL');
    t.uuid('command_queue_id')
      .references('id').inTable('command_queue').onDelete('SET NULL');

    // Full script snapshot at time of execution (survives script edits/deletes)
    t.jsonb('script_snapshot').notNullable();
    t.jsonb('parameter_values').defaultTo('{}');

    // Status & trigger
    t.specificType('status', 'execution_status').notNullable().defaultTo('pending');
    t.specificType('triggered_by', 'execution_trigger').notNullable().defaultTo('manual');
    t.integer('triggered_by_user_id')
      .references('id').inTable('users').onDelete('SET NULL');

    // Timing
    t.timestamp('triggered_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('sent_at');
    t.timestamp('started_at');
    t.timestamp('finished_at');

    // Result
    t.integer('exit_code');
    t.text('stdout');
    t.text('stderr');

    // Catch-up tracking
    t.boolean('is_catchup').notNullable().defaultTo(false);
    t.timestamp('catchup_for_at');  // the original missed scheduled time

    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

    t.index(['device_id', 'created_at']);
    t.index(['tenant_id', 'status']);
    t.index(['schedule_id', 'created_at']);
  });

  // ===========================================================================
  // UPDATE POLICIES
  // ===========================================================================
  await knex.schema.createTable('update_policies', (t) => {
    t.increments('id').primary();
    t.integer('tenant_id').notNullable()
      .references('id').inTable('tenants').onDelete('CASCADE');
    t.string('name', 300).notNullable();
    t.text('description');

    // Target scope
    t.string('target_type', 20).notNullable().defaultTo('all');  // device | group | all
    t.integer('target_id');

    // Approval rules
    t.boolean('auto_approve_critical').notNullable().defaultTo(false);
    t.boolean('auto_approve_security').notNullable().defaultTo(false);
    t.boolean('auto_approve_optional').notNullable().defaultTo(false);
    t.boolean('approval_required').notNullable().defaultTo(true);

    // Install window (time of day when installs are allowed)
    t.time('install_window_start').defaultTo('22:00:00');
    t.time('install_window_end').defaultTo('06:00:00');
    t.jsonb('install_window_days').defaultTo('[1,2,3,4,5]');  // 1=Mon … 7=Sun
    t.string('timezone', 100).defaultTo('UTC');

    // Reboot behavior after install
    t.specificType('reboot_behavior', 'reboot_behavior').notNullable().defaultTo('ask');
    t.integer('reboot_delay_minutes').defaultTo(30);

    // Exclusions
    t.jsonb('excluded_update_ids').defaultTo('[]');   // KBxxxxxx, package names…
    t.jsonb('excluded_categories').defaultTo('[]');

    t.boolean('enabled').notNullable().defaultTo(true);
    t.integer('created_by').references('id').inTable('users').onDelete('SET NULL');
    t.timestamps(true, true);
  });

  // ===========================================================================
  // DEVICE UPDATES  (available/installed updates per device)
  // ===========================================================================
  await knex.schema.createTable('device_updates', (t) => {
    t.increments('id').primary();
    t.integer('device_id').notNullable()
      .references('id').inTable('devices').onDelete('CASCADE');
    t.integer('tenant_id').notNullable()
      .references('id').inTable('tenants').onDelete('CASCADE');

    // Update identity
    t.string('update_uid', 500).notNullable();  // KB article ID, package name, etc.
    t.string('title', 1000);
    t.text('description');
    t.specificType('severity', 'update_severity').defaultTo('unknown');
    t.string('category', 100);
    t.specificType('source', 'update_source').notNullable().defaultTo('other');
    t.bigInteger('size_bytes');
    t.boolean('requires_reboot').defaultTo(false);

    // Status
    t.specificType('status', 'update_status').notNullable().defaultTo('available');
    t.integer('approved_by').references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('approved_at');
    t.timestamp('installed_at');
    t.text('install_error');

    t.timestamp('scanned_at').notNullable().defaultTo(knex.fn.now());
    t.timestamps(true, true);

    t.unique(['device_id', 'update_uid']);
    t.index(['device_id', 'status']);
    t.index(['tenant_id', 'status']);
    t.index(['tenant_id', 'severity']);
  });

  // ===========================================================================
  // CONFIGURATION TEMPLATES
  // ===========================================================================
  await knex.schema.createTable('config_templates', (t) => {
    t.increments('id').primary();
    t.uuid('uuid').notNullable().defaultTo(knex.raw('gen_random_uuid()')).unique();
    t.integer('tenant_id')   // null = built-in template
      .references('id').inTable('tenants').onDelete('CASCADE');
    t.string('name', 300).notNullable();
    t.text('description');
    t.specificType('platform', 'script_platform').notNullable().defaultTo('all');
    t.string('category', 100).defaultTo('custom');  // security|network|system|application|custom
    /*
      checks: Array<{
        id: string            // stable UUID
        name: string
        description?: string
        method: 'registry' | 'file' | 'command' | 'service' | 'process' | 'policy'
        target: string        // registry path | file path | command | service name
        expected_value: any
        expected_type: 'string' | 'number' | 'boolean' | 'regex'
        operator: 'eq' | 'neq' | 'gt' | 'lt' | 'contains' | 'exists' | 'not_exists'
        severity: 'low' | 'medium' | 'high' | 'critical'
        remediation_script_id: number | null
      }>
    */
    t.jsonb('checks').notNullable().defaultTo('[]');
    t.boolean('is_builtin').notNullable().defaultTo(false);
    t.integer('created_by').references('id').inTable('users').onDelete('SET NULL');
    t.timestamps(true, true);
  });

  // One snapshot per (device × template) per scan run
  await knex.schema.createTable('config_snapshots', (t) => {
    t.increments('id').primary();
    t.integer('device_id').notNullable()
      .references('id').inTable('devices').onDelete('CASCADE');
    t.integer('template_id').notNullable()
      .references('id').inTable('config_templates').onDelete('CASCADE');
    /*
      results: Array<{
        check_id: string
        actual_value: any
        status: 'pass' | 'fail' | 'warning' | 'unknown' | 'skipped' | 'error'
        checked_at: string (ISO)
      }>
    */
    t.jsonb('results').notNullable().defaultTo('[]');
    t.decimal('compliance_score', 5, 2).defaultTo(0);  // 0-100
    t.timestamp('snapped_at').notNullable().defaultTo(knex.fn.now());
    t.index(['device_id', 'template_id', 'snapped_at']);
  });

  // ===========================================================================
  // COMPLIANCE POLICIES
  // ===========================================================================
  await knex.schema.createTable('compliance_policies', (t) => {
    t.increments('id').primary();
    t.uuid('uuid').notNullable().defaultTo(knex.raw('gen_random_uuid()')).unique();
    t.integer('tenant_id').notNullable()
      .references('id').inTable('tenants').onDelete('CASCADE');
    t.string('name', 300).notNullable();
    t.text('description');
    t.specificType('framework', 'compliance_framework').notNullable().defaultTo('custom');

    // Target scope
    t.string('target_type', 20).notNullable().defaultTo('all');  // device | group | all
    t.integer('target_id');

    /*
      rules: Array<{
        id: string
        name: string
        category?: string
        check_type: 'registry' | 'file' | 'command' | 'service' | 'event_log' | 'process' | 'policy'
        target_platform: 'windows' | 'macos' | 'linux' | 'all'
        target: string
        expected: any
        operator: string
        severity: 'low' | 'medium' | 'high' | 'critical'
        auto_remediate_script_id: number | null
      }>
    */
    t.jsonb('rules').notNullable().defaultTo('[]');
    t.boolean('enabled').notNullable().defaultTo(true);
    t.integer('created_by').references('id').inTable('users').onDelete('SET NULL');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('compliance_results', (t) => {
    t.increments('id').primary();
    t.integer('device_id').notNullable()
      .references('id').inTable('devices').onDelete('CASCADE');
    t.integer('policy_id').notNullable()
      .references('id').inTable('compliance_policies').onDelete('CASCADE');
    t.integer('tenant_id').notNullable()
      .references('id').inTable('tenants').onDelete('CASCADE');
    /*
      results: Array<{
        rule_id: string
        status: compliance_status
        actual_value: any
        checked_at: string (ISO)
        remediation_triggered: boolean
      }>
    */
    t.jsonb('results').notNullable().defaultTo('[]');
    t.decimal('compliance_score', 5, 2).defaultTo(0);
    t.timestamp('checked_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['device_id', 'policy_id']);
    t.index(['tenant_id', 'checked_at']);
  });

  // ===========================================================================
  // REMOTE SESSIONS  (on-demand WebSocket tunnel — only active during session)
  //
  // Flow:
  //   1. Technician requests session → record created (status: waiting)
  //   2. Agent receives command 'open_remote_tunnel' on next push (≤3s)
  //   3. Agent opens WS to /api/remote/tunnel/:sessionToken
  //   4. Server bridges browser (noVNC) ↔ agent tunnel ↔ local VNC/RDP
  //   5. Session ends → agent receives 'close_remote_tunnel' → WS torn down
  // ===========================================================================
  await knex.schema.createTable('remote_sessions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.integer('device_id').notNullable()
      .references('id').inTable('devices').onDelete('CASCADE');
    t.integer('tenant_id').notNullable()
      .references('id').inTable('tenants').onDelete('CASCADE');
    t.specificType('protocol', 'remote_protocol').notNullable().defaultTo('vnc');
    t.specificType('status', 'remote_session_status').notNullable().defaultTo('waiting');
    t.string('session_token', 500).notNullable().unique();
    t.integer('started_by').notNullable()
      .references('id').inTable('users').onDelete('CASCADE');
    t.timestamp('started_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('connected_at');
    t.timestamp('ended_at');
    t.integer('duration_seconds');
    // user_disconnect | agent_disconnect | timeout | error
    t.string('end_reason', 100);
    t.text('notes');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['device_id', 'status']);
    t.index(['tenant_id', 'created_at']);
  });

  // ===========================================================================
  // REPORTS  (fleet state export — multi-format, schedulable)
  // ===========================================================================
  await knex.schema.createTable('reports', (t) => {
    t.increments('id').primary();
    t.integer('tenant_id').notNullable()
      .references('id').inTable('tenants').onDelete('CASCADE');
    t.string('name', 300).notNullable();
    t.text('description');
    t.specificType('type', 'report_type').notNullable().defaultTo('fleet');
    t.specificType('format', 'report_format').notNullable().defaultTo('pdf');

    // Scope
    t.string('scope_type', 20).notNullable().defaultTo('tenant');  // tenant | group | device
    t.integer('scope_id');

    // Sections to include
    t.jsonb('sections').defaultTo('["hardware","software","updates","compliance","scripts_history"]');
    t.jsonb('filters').defaultTo('{}');

    // Optional recurring schedule (cron, null = on-demand only)
    t.string('schedule_cron', 200);
    t.string('timezone', 100).defaultTo('UTC');
    t.boolean('is_enabled').notNullable().defaultTo(true);
    t.timestamp('last_generated_at');

    t.integer('created_by').references('id').inTable('users').onDelete('SET NULL');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('report_outputs', (t) => {
    t.increments('id').primary();
    t.integer('report_id').notNullable()
      .references('id').inTable('reports').onDelete('CASCADE');
    t.integer('tenant_id').notNullable()
      .references('id').inTable('tenants').onDelete('CASCADE');
    t.specificType('status', 'report_status').notNullable().defaultTo('generating');
    t.string('file_path', 1000);
    t.bigInteger('file_size_bytes');
    t.integer('row_count');
    t.text('error_message');
    t.timestamp('expires_at');
    t.timestamp('generated_at');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['report_id', 'created_at']);
  });

  // ===========================================================================
  // SEEDS
  // ===========================================================================

  // App-wide configuration
  await knex('app_config').insert([
    { key: 'allow_2fa',                       value: 'true'     },
    { key: 'force_2fa',                        value: 'false'    },
    { key: 'otp_smtp_server_id',              value: null       },
    { key: 'agent_auto_approve',              value: 'false'    },
    { key: 'default_push_interval',           value: '60'       },
    { key: 'fast_poll_interval',              value: '5'        },  // seconds, when commands pending
    { key: 'remote_fast_poll_interval',       value: '3'        },  // seconds, when remote session waiting
    { key: 'remote_session_timeout_minutes',  value: '60'       },
    { key: 'catchup_window_days',             value: '7'        },  // look back N days for missed executions
    { key: 'inventory_retention_days',        value: '90'       },
    { key: 'app_name',                        value: 'Obliance' },
    { key: 'default_language',                value: 'en'       },
  ]);

  // Default workspace
  await knex('tenants').insert({ id: 1, name: 'Default', slug: 'default' });
}

// =============================================================================
export async function down(knex: Knex): Promise<void> {
  const tables = [
    'report_outputs',
    'reports',
    'remote_sessions',
    'compliance_results',
    'compliance_policies',
    'config_snapshots',
    'config_templates',
    'device_updates',
    'update_policies',
    'script_executions',
    'script_schedules',
    'script_parameters',
    'scripts',
    'script_categories',
    'command_queue',
    'device_inventory_software',
    'device_inventory_hardware',
    'devices',
    'agent_api_keys',
    'maintenance_window_disables',
    'maintenance_windows',
    'live_alerts',
    'notification_log',
    'notification_bindings',
    'notification_channel_tenants',
    'notification_channels',
    'smtp_servers',
    'settings',
    'team_permissions',
    'team_memberships',
    'user_teams',
    'device_group_closure',
    'device_groups',
    'password_reset_tokens',
    'user_tenants',
    'tenants',
    'app_config',
    'users',
    'session',
  ];

  for (const table of tables) {
    await knex.schema.dropTableIfExists(table);
  }

  await knex.raw(`
    DROP TYPE IF EXISTS
      user_role, tenant_role, team_scope, team_level, approval_status,
      os_type, device_status,
      command_type, command_status, command_priority,
      script_platform, script_runtime,
      execution_status, execution_trigger,
      update_severity, update_source, update_status, reboot_behavior,
      compliance_framework, compliance_status,
      remote_protocol, remote_session_status,
      notification_channel_type, override_mode, alert_severity,
      maintenance_scope, maintenance_schedule,
      report_type, report_format, report_status
    CASCADE;
  `);
}
