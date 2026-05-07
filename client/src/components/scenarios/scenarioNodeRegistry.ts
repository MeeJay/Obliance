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

// Cooldown is its own node type now (`type: 'cooldown'`) — see the
// entry in NODE_TYPES below. The old per-trigger COOLDOWN_FIELD with
// preset durations was removed: triggers no longer carry a cooldown
// option, and a single cooldown node placed downstream of any trigger
// fan-in enforces the same window across every path. Existing
// scenarios are auto-migrated by Knex 087 + scenario.service.ts
// migrateV1ToV2.

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
    defaultConfig: {},
    fields: [],
  },
  { type: 'trigger_session_login',    label: 'Session login',   category: 'trigger', accent: 'border-blue-400',     hint: 'Fires on every new WTS session',
    defaultConfig: {},
    fields: [],
  },
  { type: 'trigger_machine_boot',     label: 'Machine boot',    category: 'trigger', accent: 'border-blue-400',     hint: 'Fires when the agent starts after a boot',
    defaultConfig: {},
    fields: [],
  },
  { type: 'trigger_agent_approved',   label: 'Agent approved',  category: 'trigger', accent: 'border-blue-400',     hint: 'Fires once when an agent is first approved',
    defaultConfig: {},
    fields: [],
  },
  { type: 'trigger_group_join',       label: 'Group join',      category: 'trigger', accent: 'border-blue-400',     hint: 'Fires when a device moves into a group',
    defaultConfig: {},
    fields: [],
  },
  { type: 'trigger_schedule_failure', label: 'Schedule failure',category: 'trigger', accent: 'border-amber-400',    hint: 'Fires when a schedule assert-pass fails',
    defaultConfig: {},
    fields: [],
  },
  { type: 'trigger_schedule_cron',    label: 'Schedule (cron)', category: 'trigger', accent: 'border-purple-400',   hint: 'Fires on a cron expression',
    defaultConfig: { cronExpression: '0 0 * * *', timezone: 'UTC' },
    fields: [
      { key: 'cronExpression', label: 'Cron expression', kind: 'cron', placeholder: '0 0 * * *', required: true },
      { key: 'timezone',       label: 'Timezone',        kind: 'text', placeholder: 'UTC' },
    ],
  },
  { type: 'trigger_agent_back_online', label: 'Agent back online', category: 'trigger', accent: 'border-emerald-400',
    hint: 'Fires when an agent comes back after a sustained outage (debounced against flaps)',
    defaultConfig: { offlineDelaySeconds: 60 },
    fields: [
      { key: 'offlineDelaySeconds', label: 'Minimum offline duration (seconds)', kind: 'number', placeholder: '60', required: true },
    ],
  },
  { type: 'trigger_metric_warning',  label: 'Metric → warning', category: 'trigger', accent: 'border-amber-400',
    hint: 'Fires when CPU/RAM/Disk crosses the warn threshold — transition only (one fire per ok→warning edge)',
    defaultConfig: { metric: '', mount: '' },
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
    ],
  },
  { type: 'trigger_metric_critical', label: 'Metric → critical', category: 'trigger', accent: 'border-red-400',
    hint: 'Fires when CPU/RAM/Disk crosses the crit threshold — transition only (one fire per non-crit→critical edge)',
    defaultConfig: { metric: '', mount: '' },
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
    ],
  },
  { type: 'trigger_metric_custom', label: 'Metric → custom', category: 'trigger', accent: 'border-fuchsia-400',
    hint: 'Fires on EVERY push that matches the comparator. PLACE A `cooldown` NODE DOWNSTREAM to avoid loops. Match (start the run) = comparator returns true; no match = no run, scenario silent.',
    defaultConfig: { metric: 'cpu', comparator: 'above', threshold: 90, mount: '' },
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

  // ── Gating ───────────────────────────────────────────────────────────────
  // Cooldown sits in the `logic` category for palette purposes — it
  // doesn't introduce a new bucket in the editor toolbar. Free-form
  // duration: numeric input + unit dropdown (seconds → months) so admins
  // can express any window precisely without choosing from a preset list.
  { type: 'cooldown', label: 'Cooldown', category: 'logic', accent: 'border-sky-400',
    hint: 'Skip the run if this device passed the same gate within the configured window. Shared across upstream triggers.',
    defaultConfig: { duration: 1, unit: 'hours' },
    fields: [
      { key: 'duration', label: 'Duration', kind: 'number', placeholder: '5', required: true,
        hint: 'How long the gate stays active per device after a successful pass. 0 = disabled (acts as pass-through).',
      },
      { key: 'unit', label: 'Unit', kind: 'select', required: true,
        options: [
          { value: 'seconds', label: 'Seconds' },
          { value: 'minutes', label: 'Minutes' },
          { value: 'hours',   label: 'Hours' },
          { value: 'days',    label: 'Days' },
          { value: 'months',  label: 'Months (~30 days)' },
        ],
      },
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
