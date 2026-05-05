import type { ScenarioNodeType } from '@obliance/shared';

// Declarative metadata for every v2 node type — drives the palette, the
// per-node config form, and the canvas styling. Adding a new node type =
// add an entry here + a default config + a renderer in ScenarioGraphEditor.

export interface NodeFieldDef {
  key: string;
  label: string;
  kind: 'text' | 'number' | 'textarea' | 'script' | 'cron' | 'channels' | 'osType';
  placeholder?: string;
  /** When true, an empty value blocks the save. */
  required?: boolean;
}

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
  { type: 'trigger_manual',           label: 'Manual',          category: 'trigger', accent: 'border-text-muted',   hint: 'Fired by an admin', defaultConfig: {}, fields: [] },
  { type: 'trigger_session_login',    label: 'Session login',   category: 'trigger', accent: 'border-blue-400',     hint: 'Fires on every new WTS session', defaultConfig: {}, fields: [] },
  { type: 'trigger_machine_boot',     label: 'Machine boot',    category: 'trigger', accent: 'border-blue-400',     hint: 'Fires when the agent starts after a boot', defaultConfig: {}, fields: [] },
  { type: 'trigger_agent_approved',   label: 'Agent approved',  category: 'trigger', accent: 'border-blue-400',     hint: 'Fires once when an agent is first approved', defaultConfig: {}, fields: [] },
  { type: 'trigger_group_join',       label: 'Group join',      category: 'trigger', accent: 'border-blue-400',     hint: 'Fires when a device moves into a group', defaultConfig: {}, fields: [] },
  { type: 'trigger_schedule_failure', label: 'Schedule failure',category: 'trigger', accent: 'border-amber-400',    hint: 'Fires when a schedule assert-pass fails', defaultConfig: {}, fields: [] },
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
