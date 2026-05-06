import type { ScenarioNodeType } from '@obliance/shared';

// Declarative metadata for every v2 node type — drives the palette, the
// per-node config form, and the canvas styling. Adding a new node type =
// add an entry here + a default config + a renderer in ScenarioGraphEditor.

export interface NodeFieldDef {
  key: string;
  label: string;
  kind: 'text' | 'number' | 'textarea' | 'script' | 'cron' | 'channels' | 'osType' | 'select';
  placeholder?: string;
  /** When true, an empty value blocks the save. */
  required?: boolean;
  /** Options for `kind: 'select'` — value/label pairs. The empty-string
   *  value is treated as "no selection / wildcard" by most call sites. */
  options?: Array<{ value: string; label: string }>;
  /** Optional helper text rendered under the input — useful for
   *  describing semantics ("> threshold = match", etc). */
  hint?: string;
  /** When provided, the field is only rendered when this predicate
   *  returns true given the current node config. Lets us hide irrelevant
   *  fields (e.g. disk mount filter when metric is set to cpu/memory). */
  showWhen?: (config: Record<string, unknown>) => boolean;
}

// Standard cooldown field reused on every trigger node. Lives at the
// scenario_runs level — the engine queries `scenario_runs` for the
// last run on (scenario, device) before dispatching anything to the
// agent, so it's a built-in throttle that doesn't require any script
// or custom logic on the device side.
const COOLDOWN_FIELD: NodeFieldDef = {
  key: 'cooldownSeconds',
  label: 'Cooldown — minimum delay between two runs on the same machine',
  kind: 'select',
  options: [
    { value: '0',       label: 'No cooldown (every match starts a run)' },
    { value: '600',     label: '10 minutes' },
    { value: '1800',    label: '30 minutes' },
    { value: '3600',    label: '1 hour' },
    { value: '10800',   label: '3 hours' },
    { value: '21600',   label: '6 hours' },
    { value: '43200',   label: '12 hours' },
    { value: '86400',   label: '24 hours' },
    { value: '259200',  label: '3 days' },
    { value: '604800',  label: '7 days' },
  ],
  hint: 'Checked against scenario_runs before any command reaches the agent. Per-device.',
};

export interface NodeTypeMeta {
  type: ScenarioNodeType;
  label: string;
  category: 'trigger' | 'action' | 'logic' | 'terminator';
  /** Tailwind color class for the canvas node + palette pill. */
  accent: string;
  /** Short hint shown in the palette under the label. */
  hint: string;
  /** Default config emitted when the user drops a fresh node onto the canvas. */
  defaultConfig: Record<string, unknown>;
  /** Form fields rendered in the sidebar when the node is selected. */
  fields: NodeFieldDef[];
  /** Whether the node has multiple output handles (set by the renderer to
   *  spawn extra Source ports). branch_exit_code grows handles per rule. */
  dynamicHandles?: boolean;
}

export const NODE_TYPES: NodeTypeMeta[] = [
  // ── Triggers ─────────────────────────────────────────────────────────────
  { type: 'trigger_manual',           label: 'Manual',          category: 'trigger', accent: 'border-text-muted',   hint: 'Fired by an admin',
    defaultConfig: { cooldownSeconds: 0 },
    fields: [COOLDOWN_FIELD],
  },
  { type: 'trigger_session_login',    label: 'Session login',   category: 'trigger', accent: 'border-blue-400',     hint: 'Fires on every new WTS session',
    defaultConfig: { cooldownSeconds: 0 },
    fields: [COOLDOWN_FIELD],
  },
  { type: 'trigger_machine_boot',     label: 'Machine boot',    category: 'trigger', accent: 'border-blue-400',     hint: 'Fires when the agent starts after a boot',
    defaultConfig: { cooldownSeconds: 0 },
    fields: [COOLDOWN_FIELD],
  },
  { type: 'trigger_agent_approved',   label: 'Agent approved',  category: 'trigger', accent: 'border-blue-400',     hint: 'Fires once when an agent is first approved',
    defaultConfig: { cooldownSeconds: 0 },
    fields: [COOLDOWN_FIELD],
  },
  { type: 'trigger_group_join',       label: 'Group join',      category: 'trigger', accent: 'border-blue-400',     hint: 'Fires when a device moves into a group',
    defaultConfig: { cooldownSeconds: 0 },
    fields: [COOLDOWN_FIELD],
  },
  { type: 'trigger_schedule_failure', label: 'Schedule failure',category: 'trigger', accent: 'border-amber-400',    hint: 'Fires when a schedule assert-pass fails',
    defaultConfig: { cooldownSeconds: 0 },
    fields: [COOLDOWN_FIELD],
  },
  { type: 'trigger_schedule_cron',    label: 'Schedule (cron)', category: 'trigger', accent: 'border-purple-400',   hint: 'Fires on a cron expression',
    defaultConfig: { cronExpression: '0 0 * * *', timezone: 'UTC', cooldownSeconds: 0 },
    fields: [
      { key: 'cronExpression', label: 'Cron expression', kind: 'cron', placeholder: '0 0 * * *', required: true },
      { key: 'timezone',       label: 'Timezone',        kind: 'text', placeholder: 'UTC' },
      COOLDOWN_FIELD,
    ],
  },
  { type: 'trigger_agent_back_online', label: 'Agent back online', category: 'trigger', accent: 'border-emerald-400',
    hint: 'Fires when an agent comes back after a sustained outage (debounced against flaps)',
    defaultConfig: { offlineDelaySeconds: 60, cooldownSeconds: 0 },
    fields: [
      { key: 'offlineDelaySeconds', label: 'Minimum offline duration (seconds)', kind: 'number', placeholder: '60', required: true },
      COOLDOWN_FIELD,
    ],
  },
  { type: 'trigger_metric_warning',  label: 'Metric → warning', category: 'trigger', accent: 'border-amber-400',
    hint: 'Fires when CPU/RAM/Disk crosses the warn threshold — transition only (one fire per ok→warning edge)',
    defaultConfig: { metric: '', mount: '', cooldownSeconds: 0 },
    fields: [
      { key: 'metric', label: 'Metric', kind: 'select',
        options: [
          { value: '',    label: 'Any (CPU, RAM or Disk)' },
          { value: 'cpu', label: 'CPU' },
          { value: 'ram', label: 'RAM / Memory' },
          { value: 'disk', label: 'Disk' },
        ],
      },
      { key: 'mount', label: 'Disk mount filter (blank = any drive)', kind: 'text', placeholder: '/var or D:',
        showWhen: (c) => c.metric === 'disk' || c.metric === '' || c.metric == null,
        hint: 'Only relevant when the metric above is Disk (or Any).',
      },
      COOLDOWN_FIELD,
    ],
  },
  { type: 'trigger_metric_critical', label: 'Metric → critical', category: 'trigger', accent: 'border-red-400',
    hint: 'Fires when CPU/RAM/Disk crosses the crit threshold — transition only (one fire per non-crit→critical edge)',
    defaultConfig: { metric: '', mount: '', cooldownSeconds: 0 },
    fields: [
      { key: 'metric', label: 'Metric', kind: 'select',
        options: [
          { value: '',    label: 'Any (CPU, RAM or Disk)' },
          { value: 'cpu', label: 'CPU' },
          { value: 'ram', label: 'RAM / Memory' },
          { value: 'disk', label: 'Disk' },
        ],
      },
      { key: 'mount', label: 'Disk mount filter (blank = any drive)', kind: 'text', placeholder: '/var or D:',
        showWhen: (c) => c.metric === 'disk' || c.metric === '' || c.metric == null,
        hint: 'Only relevant when the metric above is Disk (or Any).',
      },
      COOLDOWN_FIELD,
    ],
  },
  { type: 'trigger_metric_custom', label: 'Metric → custom', category: 'trigger', accent: 'border-fuchsia-400',
    hint: 'Fires on EVERY push that matches the comparator. Pair with a cooldown to avoid loops. Match (start the run) = comparator returns true; no match = no run, scenario silent.',
    defaultConfig: { metric: 'cpu', comparator: 'above', threshold: 90, mount: '', cooldownSeconds: 3600 },
    fields: [
      { key: 'metric', label: 'Metric', kind: 'select', required: true,
        options: [
          { value: 'cpu', label: 'CPU' },
          { value: 'ram', label: 'RAM / Memory' },
          { value: 'disk', label: 'Disk' },
        ],
      },
      { key: 'comparator', label: 'Comparator', kind: 'select', required: true,
        options: [
          { value: 'above', label: 'Above (>) — fire when metric > threshold' },
          { value: 'below', label: 'Below (<) — fire when metric < threshold (e.g. CPU idle)' },
        ],
      },
      { key: 'threshold', label: 'Threshold (%)', kind: 'number', placeholder: '90', required: true,
        hint: 'Percentage value, 0–100. Examples: 90 = high load, 5 = idle.',
      },
      { key: 'mount', label: 'Disk mount filter (blank = worst disk on host)', kind: 'text', placeholder: '/var or D:',
        showWhen: (c) => c.metric === 'disk',
        hint: 'Removable / optical mounts are always excluded. Blank = whichever internal disk is the most extreme for the comparator.',
      },
      COOLDOWN_FIELD,
    ],
  },

  // ── Actions ──────────────────────────────────────────────────────────────
  { type: 'run_script', label: 'Run script', category: 'action', accent: 'border-accent', hint: 'Execute a script on the device',
    defaultConfig: { scriptId: null, timeoutSeconds: 300 },
    fields: [
      { key: 'scriptId',       label: 'Script',           kind: 'script', required: true },
      { key: 'timeoutSeconds', label: 'Timeout (seconds)', kind: 'number', placeholder: '300' },
    ],
  },
  { type: 'run_command', label: 'Run command', category: 'action', accent: 'border-orange-400', hint: 'Send a built-in command (reboot, shutdown, install update…)',
    defaultConfig: { commandType: 'reboot' },
    fields: [
      { key: 'commandType', label: 'Command type', kind: 'text', placeholder: 'reboot | shutdown | install_updates | …', required: true },
    ],
  },
  { type: 'send_notification', label: 'Send notification', category: 'action', accent: 'border-cyan-400', hint: 'Dispatch through configured channels',
    defaultConfig: { channels: [], subject: '', body: '' },
    fields: [
      { key: 'channels', label: 'Channels',  kind: 'channels' },
      { key: 'subject',  label: 'Subject',   kind: 'text', placeholder: 'Optional override' },
      { key: 'body',     label: 'Body',      kind: 'textarea', placeholder: 'Optional override' },
    ],
  },
  { type: 'wait', label: 'Wait', category: 'action', accent: 'border-text-muted', hint: 'Pause the run',
    defaultConfig: { seconds: 60 },
    fields: [
      { key: 'seconds', label: 'Seconds', kind: 'number', placeholder: '60', required: true },
    ],
  },
  { type: 'tag_device', label: 'Tag device', category: 'action', accent: 'border-text-muted', hint: 'Add or remove tags',
    defaultConfig: { add: [], remove: [] },
    fields: [
      { key: 'add',    label: 'Tags to add',    kind: 'text', placeholder: 'comma-separated' },
      { key: 'remove', label: 'Tags to remove', kind: 'text', placeholder: 'comma-separated' },
    ],
  },
  { type: 'move_device_to_group', label: 'Move device to group', category: 'action', accent: 'border-text-muted', hint: 'Reassign group_id',
    defaultConfig: { groupId: null },
    fields: [
      { key: 'groupId', label: 'Target group id', kind: 'number', required: true },
    ],
  },

  // ── Logic ────────────────────────────────────────────────────────────────
  { type: 'branch_exit_code', label: 'Branch on exit code', category: 'logic', accent: 'border-yellow-400',
    hint: 'Pick the next node based on the previous exit code',
    defaultConfig: {}, fields: [], dynamicHandles: true,
  },
  { type: 'branch_on_device', label: 'Branch on device', category: 'logic', accent: 'border-yellow-400',
    hint: 'Pick based on os_type / group / tag / status',
    defaultConfig: { match: 'os_type', value: 'windows' },
    fields: [
      { key: 'match', label: 'Match field', kind: 'text', placeholder: 'os_type | group | tag | status', required: true },
      { key: 'value', label: 'Match value', kind: 'text', required: true },
    ],
  },

  // ── Terminators ──────────────────────────────────────────────────────────
  { type: 'end_success', label: 'End — success', category: 'terminator', accent: 'border-green-400', hint: 'Mark the run as succeeded',
    defaultConfig: {}, fields: [
      { key: 'message', label: 'Message (optional)', kind: 'text' },
    ],
  },
  { type: 'end_failure', label: 'End — failure', category: 'terminator', accent: 'border-red-400', hint: 'Mark the run as failed',
    defaultConfig: { message: 'Scenario failed' }, fields: [
      { key: 'message', label: 'Failure message', kind: 'text', required: true },
    ],
  },
];

export const NODE_TYPE_BY_KEY: Record<ScenarioNodeType, NodeTypeMeta> =
  Object.fromEntries(NODE_TYPES.map((n) => [n.type, n])) as Record<ScenarioNodeType, NodeTypeMeta>;

/** True when the node represents the start of the graph. Exactly one
 *  trigger is allowed per scenario (validated at save time). */
export function isTriggerType(t: ScenarioNodeType): boolean {
  return NODE_TYPE_BY_KEY[t]?.category === 'trigger';
}
