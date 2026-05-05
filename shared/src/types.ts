// =============================================================================
// Obliance RMM — Shared Types
// =============================================================================

// ─── USERS ────────────────────────────────────────────────────────────────────

export interface User {
  id: number;
  username: string;
  displayName: string | null;
  role: 'admin' | 'user';
  isActive: boolean;
  email: string | null;
  preferredLanguage: string;
  enrollmentVersion: number;
  preferences: UserPreferences;
  totpEnabled: boolean;
  emailOtpEnabled: boolean;
  createdAt: string;
  updatedAt: string;
  // SSO
  foreignSource: string | null;
  foreignId: number | null;
  foreignSourceUrl: string | null;
  hasPassword: boolean;
  avatar: string | null;
}

export interface UserWithPassword extends User {
  passwordHash: string;
  totpSecret: string | null;
}

export type AppTheme = 'obli-operator' | 'modern' | 'neon';

export interface UserPreferences {
  toastEnabled?: boolean;
  toastPosition?: 'top-center' | 'bottom-right';
  multiTenantNotifications?: boolean;
  sidebarFloating?: boolean;
  theme?: 'dark' | 'light';
  preferredTheme?: AppTheme;
  /** Preferred video codec for Oblireach remote sessions. Falls back to JPEG if unavailable. */
  preferredCodec?: 'h264' | 'h265' | 'vp9' | 'av1' | 'jpeg';
  /** Personal quick reply messages for the chat (operator-defined). */
  quickReplies?: string[];
  /** Anonymous mode — masks hostnames, IPs, usernames in the UI (for demos/screenshots). */
  anonymousMode?: boolean;
}

export interface QuickReplyTemplate {
  id: number;
  tenantId: number;
  translations: Record<string, string>;
  sortOrder: number;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
}

// ─── TENANTS ─────────────────────────────────────────────────────────────────

export interface Tenant {
  id: number;
  name: string;
  slug: string;
  /** When true, destructive batch/uninstall actions require a 2nd admin approval. */
  twoStepApproval?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TenantWithRole extends Tenant {
  role: 'admin' | 'member';
}

export interface TenantMembership {
  userId: number;
  tenantId: number;
  role: 'admin' | 'member';
}

// ─── DEVICE GROUPS ───────────────────────────────────────────────────────────

export interface DeviceGroup {
  id: number;
  tenantId: number;
  parentId: number | null;
  name: string;
  slug: string;
  description: string | null;
  sortOrder: number;
  groupNotifications: boolean;
  groupConfig: DeviceGroupConfig;
  /** Lot D.2 — per-group metric thresholds. Empty object means "use system
   *  default". Each metric key may set a `warn` and/or `crit` percentage. */
  thresholds: MetricThresholds;
  uuid: string;
  createdAt: string;
  updatedAt: string;
}

/** Lot D.2 — Pair of warn/crit percentages applied to a single metric.
 *  Either field may be undefined; the resolver substitutes the inherited
 *  level (group → tenant default) for any missing field. */
export interface MetricThreshold { warn?: number; crit?: number }

/** Lot D.2 — Map of metric kind → threshold pair. Stored verbatim in JSONB
 *  on both `device_groups.thresholds` and `devices.thresholds_override`. */
export type MetricThresholds = Partial<{
  disk: MetricThreshold;
  cpu: MetricThreshold;
  ram: MetricThreshold;
}>;

/** System defaults applied when neither the device nor the group sets a
 *  value. Hardcoded here so the agent and the dashboard stay aligned. The
 *  type forces every metric to carry both warn AND crit, so consumers
 *  (e.g. the threshold cascade resolver) can treat the system layer as
 *  a guaranteed fallback without extra null-checks. */
export const SYSTEM_DEFAULT_THRESHOLDS: Record<keyof MetricThresholds, Required<MetricThreshold>> = {
  disk: { warn: 85, crit: 95 },
  cpu:  { warn: 80, crit: 95 },
  ram:  { warn: 80, crit: 95 },
};

export interface DeviceGroupConfig {
  pushIntervalSeconds?: number;
  scanIntervalSeconds?: number;
  maxMissedPushes?: number;
  autoApprove?: boolean;
}

export interface DeviceGroupTreeNode extends DeviceGroup {
  children: DeviceGroupTreeNode[];
  deviceCount?: number;
  onlineCount?: number;
  offlineCount?: number;
  warningCount?: number;
  criticalCount?: number;
  /** Total device count (alias/aggregate) */
  total?: number;
  /** Optional kind discriminator for mixed-type trees */
  kind?: string;
}

// ─── DEVICES ─────────────────────────────────────────────────────────────────

export type DeviceStatus = 'pending' | 'online' | 'offline' | 'maintenance' | 'warning' | 'critical' | 'suspended' | 'pending_uninstall' | 'updating' | 'update_error';
export type OsType = 'windows' | 'macos' | 'linux' | 'freebsd' | 'other';
export type ApprovalStatus = 'pending' | 'approved' | 'refused';

export interface Device {
  id: number;
  uuid: string;
  tenantId: number;
  groupId: number | null;
  groupName?: string | null;
  apiKeyId: number | null;
  // Identity
  hostname: string;
  displayName: string | null;
  description: string | null;
  // Network
  ipLocal: string | null;
  ipPublic: string | null;
  macAddress: string | null;
  // OS
  osType: OsType;
  osName: string | null;
  osVersion: string | null;
  osBuild: string | null;
  osArch: string | null;
  // Hardware summary
  cpuModel: string | null;
  cpuCores: number | null;
  ramTotalGb: number | null;
  // Agent
  agentVersion: string | null;
  status: DeviceStatus;
  approvalStatus: ApprovalStatus;
  approvedBy: number | null;
  approvedAt: string | null;
  lastSeenAt: string | null;
  lastPushAt: string | null;
  // Config
  pushIntervalSeconds: number | null;
  scanIntervalSeconds: number | null;
  overrideGroupSettings: boolean;
  maxMissedPushes: number;
  complianceRemediationEnabled: boolean;
  privacyModeEnabled: boolean;
  privacyPasswordSet: boolean;
  privacyPasswordSetAt: string | null;
  airgapEnabled: boolean;
  airgapEnabledAt: string | null;
  /** Total count of watchdog-triggered agent restarts since install. */
  watchdogRestartCount: number;
  /** Timestamp of the last watchdog-triggered restart. */
  watchdogLastRestartAt: string | null;
  /** Which agent build is running on this device. "legacy" = Go 1.20 build
   *  for Server 2008 R2 / 2012 — lacks the remote tunnel, ObliReach,
   *  software-compliance and auto-update handlers. Inferred from the push
   *  body shape (no `distroFamily` field). */
  agentFlavor: 'modern' | 'legacy';
  customMetrics?: Array<{ scheduleId: number; name: string; value: string; unit: string | null; status: string }>;
  lastLoggedInUser: string | null;
  lastRebootAt: string | null;
  rebootPending: boolean;
  timezone: string | null;
  // Geolocation (resolved from ipPublic)
  geoLat: number | null;
  geoLng: number | null;
  geoCity: string | null;
  geoCountry: string | null;
  geoRegion: string | null;
  // Asset management
  purchaseDate: string | null;
  warrantyExpiry: string | null;
  warrantyVendor: string | null;
  warrantyStatus: 'active' | 'expired' | 'unknown';
  expectedLifetimeYears: number | null;
  lifecycleStatus: 'active' | 'aging' | 'end_of_life' | 'retired' | 'unknown';
  // Metadata
  tags: string[];
  customFields: Record<string, string>;
  /** Lot D.2 — per-device override of group-level metric thresholds.
   *  Fields not present here fall back to the group's setting, then to
   *  the system default. Empty object = inherit everything. */
  thresholdsOverride: MetricThresholds;
  displayConfig: DeviceDisplayConfig;
  sensorDisplayNames: Record<string, string>;
  notificationTypes: DeviceNotificationTypes;
  latestMetrics: DeviceMetrics;
  scheduleAlert: ScheduleAlert | null;
  uninstallAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleAlert {
  scheduleId: number;
  scheduleName: string;
  exitCode: number;
  stderr: string;
  failedAt: string;
}

// ─── LICENSES ────────────────────────────────────────────────────────────────

export interface DeviceLicense {
  id: number;
  deviceId: number;
  tenantId: number;
  softwareName: string;
  licenseKey: string | null;
  licenseType: 'per_device' | 'per_user' | 'volume' | 'subscription' | 'other' | null;
  seats: number | null;
  expiryDate: string | null;
  vendor: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── NETWORK DISCOVERY ───────────────────────────────────────────────────────

export interface DiscoveredDevice {
  id: number;
  tenantId: number;
  discoveredByDeviceId: number;
  ip: string;
  mac: string | null;
  hostname: string | null;
  ports: number[];
  ouiVendor: string | null;
  osGuess: string | null;
  deviceType: 'pc' | 'server' | 'printer' | 'iot' | 'network' | 'unknown';
  isManaged: boolean;
  managedDeviceId: number | null;
  subnet: string | null;
  firstSeen: string;
  lastSeen: string;
}

// ─── PATCH COMPLIANCE ────────────────────────────────────────────────────────

export interface PatchComplianceReport {
  totalDevices: number;
  fullyPatchedDevices: number;
  fullyPatchedPercent: number;
  bySeverity: Array<{ severity: string; total: number; patched: number; percent: number }>;
  byGroup: Array<{ groupId: number | null; groupName: string | null; total: number; patched: number; percent: number }>;
  byUpdate: Array<{ updateUid: string; title: string; severity: string; totalDevices: number; patchedDevices: number; percent: number }>;
}

export interface DeviceDisplayConfig {
  hideCpu?: boolean;
  hideMemory?: boolean;
  hideDisk?: boolean;
  hideNetwork?: boolean;
  hideTemps?: boolean;
  hideGpu?: boolean;
  renamedDisks?: Record<string, string>;
  renamedNetInterfaces?: Record<string, string>;
  // Rich per-section display config (used by AgentDisplayConfigModal)
  cpu: {
    hiddenCores: number[];
    hiddenCharts: string[];
    groupCoreThreads: boolean;
    tempSensor: string | null;
  };
  ram: {
    hideUsed: boolean;
    hideFree: boolean;
    hideSwap: boolean;
    hiddenCharts: string[];
  };
  gpu: {
    hiddenRows: string[];
    hiddenCharts: string[];
  };
  drives: {
    hiddenMounts: string[];
    renames: Record<string, string>;
    combineReadWrite: boolean;
  };
  network: {
    hiddenInterfaces: string[];
    renames?: Record<string, string>;
    combineInOut: boolean;
  };
  temps: {
    hiddenLabels: string[];
  };
}

export interface DeviceNotificationTypes {
  online?: boolean;
  offline?: boolean;
  warning?: boolean;
  critical?: boolean;
  update?: boolean;
}

export interface DeviceMetrics {
  cpu?: { percent: number; cores?: number[]; model?: string; freqMhz?: number };
  memory?: { usedMb: number; totalMb: number; percent: number; cachedMb?: number; buffersMb?: number; swapTotalMb?: number; swapUsedMb?: number };
  disks?: Array<{ mount: string; usedGb: number; totalGb: number; percent: number; readBytesPerSec?: number; writeBytesPerSec?: number }>;
  network?: { inBytesPerSec: number; outBytesPerSec: number; interfaces?: Array<{ name: string; inBytesPerSec: number; outBytesPerSec: number }> };
  gpus?: Array<{ model: string; utilizationPct: number; vramUsedMb: number; vramTotalMb: number; engines?: Array<{ label: string; pct: number }> }>;
  loadAvg?: number;
  updatedAt?: string;
}

// ─── AGENT API KEYS ──────────────────────────────────────────────────────────

export interface AgentApiKey {
  id: number;
  tenantId: number;
  name: string | null;
  key: string;
  defaultGroupId: number | null;
  defaultGroupName: string | null;
  createdBy: number | null;
  createdAt: string;
  lastUsedAt: string | null;
  deviceCount: number;
}

// ─── COMMAND QUEUE ────────────────────────────────────────────────────────────

export type CommandType =
  | 'run_script'
  | 'install_update'
  | 'install_updates'
  | 'cancel_script'
  | 'scan_inventory'
  | 'scan_updates'
  | 'check_compliance'
  | 'open_remote_tunnel'
  | 'close_remote_tunnel'
  | 'reboot'
  | 'shutdown'
  | 'sleep'
  | 'restart_agent'
  | 'list_services'
  | 'restart_service'
  | 'start_service'
  | 'stop_service'
  | 'install_software'
  | 'uninstall_software'
  | 'uninstall_agent'
  | 'install_oblireach'
  | 'list_processes'
  | 'kill_process'
  | 'list_wts_sessions'
  | 'enable_privacy_mode'
  | 'disable_privacy_mode'
  | 'start_custom_section'
  | 'stop_custom_section'
  | 'resize_custom_section'
  | 'enable_airgap'
  | 'disable_airgap'
  | 'set_privacy_password'
  | 'change_privacy_password'
  | 'remove_privacy_password'
  | 'verify_privacy_password'
  | 'list_directory'
  | 'create_directory'
  | 'rename_file'
  | 'delete_file'
  | 'download_file'
  | 'upload_file'
  | 'remediate_rule'
  | 'scan_network'
  | 'check_software_compliance';

export type CommandStatus = 'pending' | 'sent' | 'ack_running' | 'success' | 'failure' | 'timeout' | 'cancelled';
export type CommandPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface Command {
  id: string;
  deviceId: number;
  tenantId: number;
  type: CommandType;
  payload: Record<string, any>;
  status: CommandStatus;
  priority: CommandPriority;
  sentAt: string | null;
  ackedAt: string | null;
  finishedAt: string | null;
  expiresAt: string | null;
  result: CommandResult;
  retryCount: number;
  maxRetries: number;
  sourceType: string | null;
  sourceId: string | null;
  createdBy: number | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  durationMs: number | null;
}

export interface CommandResult {
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  error?: string;
  duration?: number;
}

// Service info returned by the agent for list_services / stored as latest_services
export interface ServiceInfo {
  name: string;
  displayName?: string;
  status: string;        // 'running' | 'stopped' | 'starting' | 'stopping' | ...
  startType?: string;    // 'auto' | 'manual' | 'disabled' | ...
  runAsUser?: string;    // account the service runs as (Windows: StartName, Linux: User=, macOS: ps user)
}

// Process info returned by the agent for list_processes
export interface ProcessInfo {
  pid: number;
  name: string;
  cpuPercent: number;
  memBytes: number;
  user: string;
  command?: string;
}

// Agent push protocol
export interface AgentPushEvent {
  type: string;
  timestamp: string;
  data?: Record<string, any>;
}

export interface AgentPushRequest {
  deviceUuid: string;
  metrics: DeviceMetrics;
  acks: CommandAck[];
  agentVersion?: string;
  events?: AgentPushEvent[];
  /** Number of watchdog-triggered restarts since the last successful push. */
  watchdogRestartCount?: number;
  /** ISO timestamp of the most recent watchdog restart (if count > 0). */
  watchdogLastRestartAt?: string;
}

export interface CommandAck {
  commandId: string;
  commandType?: string;
  status: 'ack_running' | 'success' | 'failure' | 'timeout';
  result?: CommandResult;
}

export interface AgentPushResponse {
  config: AgentConfig;
  commands: AgentCommand[];
  nextPollIn: number; // seconds until next push
  /** Piggybacked on every response so agents update without an extra round-trip. */
  latestVersion?: string;
}

export interface AgentConfig {
  pushIntervalSeconds: number;
  scanIntervalSeconds?: number;  // 0 = disabled, >0 = run all scans every N seconds
  taskRetrieveDelaySeconds?: number; // polling interval for lightweight command poll
  displayConfig: DeviceDisplayConfig;
  sensorDisplayNames: Record<string, string>;
  notificationTypes: DeviceNotificationTypes;
  remediationEnabled?: boolean; // false = skip auto-remediation scripts on this device
}

export interface AgentCommand {
  id: string;
  type: CommandType;
  payload: Record<string, any>;
  priority: CommandPriority;
}

// ─── SCRIPTS ─────────────────────────────────────────────────────────────────

export type ScriptPlatform = 'windows' | 'macos' | 'linux' | 'freebsd' | 'all';
export type ScriptRuntime = 'powershell' | 'pwsh' | 'cmd' | 'bash' | 'zsh' | 'sh' | 'python' | 'python3' | 'perl' | 'ruby';
export type ScriptPurpose = 'check' | 'resolve' | 'execute' | 'compliance' | 'metric';

export interface DeviceCustomMetric {
  id: number;
  deviceId: number;
  scheduleId: number;
  tenantId: number;
  name: string;
  value: string;
  unit: string | null;
  status: 'ok' | 'warning' | 'critical' | 'error';
  updatedAt: string;
}
export type ScriptParameterType = 'string' | 'number' | 'boolean' | 'secret' | 'select' | 'multiselect';

export interface ScriptCategory {
  id: number;
  tenantId: number | null;
  name: string;
  icon: string | null;
  color: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface ScriptParameter {
  id: number;
  scriptId: number;
  name: string;
  label: string;
  description: string | null;
  type: ScriptParameterType;
  options: string[];
  defaultValue: string | null;
  required: boolean;
  sortOrder: number;
}

export interface Script {
  id: number;
  uuid: string;
  tenantId: number | null;
  categoryId: number | null;
  /** Optional parent script — when set, the library renders this script
   *  indented directly under its parent (typical use: a `resolve` script
   *  parented by its matching `check` script). null = top-level. */
  parentScriptId: number | null;
  name: string;
  description: string | null;
  tags: string[];
  platform: ScriptPlatform;
  runtime: ScriptRuntime;
  content: string;
  timeoutSeconds: number;
  expectedExitCode: number;
  runAs: 'system' | 'user';
  scriptType: 'system' | 'user'; // 'system' = Obliance built-in, 'user' = tenant-created
  availableInReach: boolean;
  isBuiltin: boolean;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: string;
  updatedAt: string;
  purpose?: ScriptPurpose;
  parameters?: ScriptParameter[];
  category?: ScriptCategory | null;
}

// ─── SCRIPT SCHEDULES ────────────────────────────────────────────────────────

export type ScheduleTargetType = 'device' | 'group' | 'all';

export interface RunCondition {
  field: string;
  operator: 'eq' | 'neq' | 'gt' | 'lt' | 'contains' | 'in' | 'not_in';
  value: any;
}

export interface ScriptSchedule {
  id: number;
  uuid: string;
  tenantId: number;
  scriptId: number;
  name: string;
  description: string | null;
  targetType: ScheduleTargetType;
  targetIds: number[];
  cronExpression: string | null;
  fireOnceAt: string | null;
  timezone: string;
  parameterValues: Record<string, any>;
  catchupEnabled: boolean;
  catchupMax: number;
  runConditions: RunCondition[];
  assertPass: boolean;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdBy: number | null;
  createdByName?: string | null;
  updatedBy: number | null;
  updatedByName?: string | null;
  createdAt: string;
  updatedAt: string;
  onFailureScenarioId?: number | null;
  notificationChannels: AutomationNotificationBinding[];
  /** Overrides the script's default timeout. NULL = use script default. */
  timeoutSeconds?: number | null;
  /** If true, skip devices that still have a previous execution in progress. */
  skipIfInFlight: boolean;
  /** If true, only send one alert notification per device until recovery. */
  notifyOnce: boolean;
  /** Number of approved + alive devices this schedule actually resolves to. */
  resolvedDeviceCount?: number;
  script?: Script;
}

// ─── SCRIPT EXECUTIONS ───────────────────────────────────────────────────────

export type ExecutionStatus = 'pending' | 'sent' | 'running' | 'success' | 'failure' | 'timeout' | 'skipped' | 'cancelled';
export type ExecutionTrigger = 'schedule' | 'manual' | 'api' | 'catchup';

export interface ScriptExecution {
  id: string;
  tenantId: number;
  scriptId: number;
  deviceId: number;
  scheduleId: number | null;
  batchId: string | null;
  commandQueueId: string | null;
  scriptSnapshot: Pick<Script, 'id' | 'name' | 'platform' | 'runtime' | 'content' | 'timeoutSeconds' | 'runAs'>;
  parameterValues: Record<string, any>;
  status: ExecutionStatus;
  triggeredBy: ExecutionTrigger;
  triggeredByUserId: number | null;
  triggeredAt: string;
  sentAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  stdout: string | null;
  stderr: string | null;
  isCatchup: boolean;
  catchupForAt: string | null;
  createdAt: string;
  device?: Pick<Device, 'id' | 'hostname' | 'displayName' | 'osType'>;
  schedule?: Pick<ScriptSchedule, 'id' | 'name'>;
}

export interface ExecutionBatch {
  batchId: string;
  scriptId: number;
  scriptName: string;
  scheduleId: number | null;
  scheduleName: string | null;
  triggeredBy: ExecutionTrigger;
  triggeredByUsername: string | null;
  triggeredAt: string;
  totalCount: number;
  successCount: number;
  failureCount: number;
  pendingCount: number;
  runningCount: number;
}

// ─── UPDATES ─────────────────────────────────────────────────────────────────

export type UpdateSeverity = 'critical' | 'important' | 'moderate' | 'optional' | 'unknown';
export type UpdateSource = 'windows_update' | 'apt' | 'yum' | 'dnf' | 'pacman' | 'brew' | 'chocolatey' | 'winget' | 'other';
export type UpdateStatus = 'available' | 'approved' | 'pending_install' | 'installing' | 'installed' | 'pending_reboot' | 'failed' | 'excluded' | 'superseded';
export type RebootBehavior = 'never' | 'ask' | 'auto_immediate' | 'auto_delayed';

export interface UpdatePolicy {
  id: number;
  tenantId: number;
  name: string;
  description: string | null;
  targetType: 'device' | 'group' | 'all';
  targetId: number | null;
  autoApproveCritical: boolean;
  autoApproveSecurity: boolean;
  autoApproveOptional: boolean;
  approvalRequired: boolean;
  installWindowStart: string;
  installWindowEnd: string;
  installWindowDays: number[];
  timezone: string;
  rebootBehavior: RebootBehavior;
  rebootDelayMinutes: number;
  excludedUpdateIds: string[];
  excludedCategories: string[];
  enabled: boolean;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface DeviceUpdate {
  id: number;
  deviceId: number;
  tenantId: number;
  updateUid: string;
  title: string | null;
  description: string | null;
  severity: UpdateSeverity;
  category: string | null;
  source: UpdateSource;
  sizeBytes: number | null;
  requiresReboot: boolean;
  status: UpdateStatus;
  approvedBy: number | null;
  approvedAt: string | null;
  installedAt: string | null;
  installError: string | null;
  scannedAt: string;
  createdAt: string;
  updatedAt: string;
  /** Populated on tenant-wide listings (hostname or displayName) */
  deviceName?: string | null;
}

// ─── CONFIG TEMPLATES ────────────────────────────────────────────────────────

export type ConfigCheckMethod = 'registry' | 'file' | 'command' | 'service' | 'process' | 'policy';
export type ConfigCheckOperator = 'eq' | 'neq' | 'gt' | 'lt' | 'contains' | 'exists' | 'not_exists';
export type CheckSeverity = 'optional' | 'low' | 'moderate' | 'high' | 'critical';

export interface ConfigCheck {
  id: string;
  name: string;
  description?: string;
  method: ConfigCheckMethod;
  target: string;
  expectedValue: any;
  expectedType: 'string' | 'number' | 'boolean' | 'regex';
  operator: ConfigCheckOperator;
  severity: CheckSeverity;
  remediationScriptId: number | null;
}

export interface ConfigTemplate {
  id: number;
  uuid: string;
  tenantId: number | null;
  name: string;
  description: string | null;
  platform: ScriptPlatform;
  category: string;
  checks: ConfigCheck[];
  isBuiltin: boolean;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConfigCheckResult {
  checkId: string;
  actualValue: any;
  status: 'pass' | 'fail' | 'warning' | 'unknown' | 'skipped' | 'error';
  checkedAt: string;
}

export interface ConfigSnapshot {
  id: number;
  deviceId: number;
  templateId: number;
  results: ConfigCheckResult[];
  complianceScore: number;
  snappedAt: string;
}

// ─── COMPLIANCE ──────────────────────────────────────────────────────────────

export type ComplianceFramework = 'CIS' | 'NIST' | 'ISO27001' | 'PCI_DSS' | 'HIPAA' | 'SOC2' | 'custom';
export type ComplianceStatus = 'pass' | 'fail' | 'warning' | 'unknown' | 'skipped' | 'error';
export type ComplianceCheckType = 'registry' | 'file' | 'command' | 'service' | 'event_log' | 'process' | 'policy';

export type ComplianceOperator = 'eq' | 'neq' | 'gt' | 'lt' | 'contains' | 'not_contains' | 'exists' | 'not_exists' | 'regex';

export interface ComplianceRule {
  id: string;
  name: string;
  category?: string;
  checkType: ComplianceCheckType;
  targetPlatform: ScriptPlatform;
  target: string;            // e.g. reg key path, file path, command, service name…
  expected: any;             // expected value for comparison
  operator: ComplianceOperator;
  severity: CheckSeverity;
  autoRemediateScriptId: number | null;
  /** Inline remediation script — executed by the agent to fix a failing rule */
  remediationScript?: string;
  /** Minimum OS version required for this rule to apply (e.g. "Windows 10 1607", "macOS 12", "Ubuntu 20.04"). Agent skips rule if OS is older. */
  minOsVersion?: string;
}

export interface CompliancePreset {
  id: string;
  name: string;
  description: string;
  framework: ComplianceFramework;
  targetPlatform: ScriptPlatform;
  rules: ComplianceRule[];
}

export interface CompliancePolicy {
  id: number;
  uuid: string;
  tenantId: number;
  name: string;
  description: string | null;
  framework: ComplianceFramework;
  targetType: 'group' | 'all';
  targetIds: number[];
  targetPlatform: 'windows' | 'linux' | 'macos' | 'freebsd' | 'all';
  rules: ComplianceRule[];
  enabled: boolean;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ComplianceRuleResult {
  ruleId: string;
  /** Human-readable rule name, optionally sent by the agent for display purposes */
  ruleName?: string;
  status: ComplianceStatus;
  actualValue: any;
  checkedAt: string;
  remediationTriggered: boolean;
  ignored?: boolean;
}

export interface ComplianceResult {
  id: number;
  deviceId: number;
  deviceName: string | null;
  policyId: number;
  tenantId: number;
  results: ComplianceRuleResult[];
  complianceScore: number;
  checkedAt: string;
  createdAt: string;
  policy?: Pick<CompliancePolicy, 'id' | 'name' | 'framework'>;
}

// ─── SOFTWARE COMPLIANCE ────────────────────────────────────────────────────

export type SoftwareListType = 'whitelist' | 'blacklist';
export type SoftwareMatchType = 'exact' | 'contains' | 'regex';
export type SoftwareInstallSource = 'winget' | 'choco' | 'apt' | 'yum' | 'dnf' | 'brew' | 'pkg' | 'snap' | 'flatpak' | 'msi' | 'custom';
export type DistroScope = 'windows' | 'macos' | 'debian' | 'rhel' | 'fedora' | 'arch' | 'suse' | 'freebsd' | 'any';

export interface SoftwareEntrySourceConfig {
  id?: number;
  entryId?: number;
  packageManager: SoftwareInstallSource;
  packageId: string | null;
  msiUrl: string | null;
  repoPackageId: number | null;
  repoPackageUuid?: string | null;
  installScript: string | null;
  msiParams: string | null;
  platformScope: DistroScope;
  sortOrder: number;
}

export interface SoftwareRepoPackage {
  id: number;
  uuid: string;
  tenantId: number;
  filename: string;
  displayName: string | null;
  fileSize: number;
  fileHash: string;
  mimeType: string | null;
  platform: 'windows' | 'linux' | 'macos';
  uploadedBy: number | null;
  createdAt: string;
}

export interface SoftwareComplianceEntry {
  id: number;
  listId: number;
  name: string;
  matchType: SoftwareMatchType;
  publisher: string | null;
  minVersion: string | null;
  maxVersion: string | null;
  /** @deprecated Use sources[] instead */
  installSource: SoftwareInstallSource | null;
  /** @deprecated Use sources[] instead */
  installId: string | null;
  /** @deprecated Use sources[] instead */
  installScript: string | null;
  /** @deprecated Use sources[] instead */
  msiUrl: string | null;
  /** @deprecated Use sources[] instead */
  msiParams: string | null;
  sortOrder: number;
  sources: SoftwareEntrySourceConfig[];
}

/** Maps package managers to OS/distro families they can target */
export const PACKAGE_MANAGER_PLATFORM: Record<SoftwareInstallSource, DistroScope> = {
  winget: 'windows', choco: 'windows', msi: 'windows',
  apt: 'debian', yum: 'rhel', dnf: 'fedora',
  brew: 'macos', pkg: 'freebsd',
  snap: 'any', flatpak: 'any', custom: 'any',
};

export interface SoftwareComplianceList {
  id: number;
  uuid: string;
  tenantId: number;
  name: string;
  description: string | null;
  listType: SoftwareListType;
  targetType: 'group' | 'all';
  targetIds: number[];
  targetPlatform: 'windows' | 'linux' | 'macos' | 'freebsd' | 'all';
  autoRemediate: boolean;
  enabled: boolean;
  entries: SoftwareComplianceEntry[];
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface SoftwareComplianceEntryResult {
  entryId: number;
  entryName: string;
  status: 'compliant' | 'non_compliant' | 'remediated' | 'remediation_failed' | 'error';
  matchedSoftware: string | null;
  matchedVersion: string | null;
  remediationTriggered: boolean;
  detail: string | null;
  checkedAt: string;
}

export interface SoftwareComplianceResult {
  id: number;
  deviceId: number;
  deviceName: string | null;
  listId: number;
  tenantId: number;
  results: SoftwareComplianceEntryResult[];
  complianceScore: number;
  checkedAt: string;
  createdAt: string;
  list?: Pick<SoftwareComplianceList, 'id' | 'name' | 'listType'>;
}

export interface KnownSoftwareApp {
  name: string;
  publisher: string | null;
  source: string;
  packageId: string | null;
  osType: string;
  deviceCount: number;
  latestVersion: string | null;
}

// ─── REMOTE SESSIONS ─────────────────────────────────────────────────────────

export type RemoteProtocol = 'rdp' | 'ssh' | 'cmd' | 'powershell' | 'oblireach';
export type RemoteSessionStatus = 'waiting' | 'connecting' | 'active' | 'closed' | 'failed' | 'timeout' | 'expired';

export interface RemoteSession {
  id: string;
  deviceId: number;
  tenantId: number;
  protocol: RemoteProtocol;
  status: RemoteSessionStatus;
  sessionToken: string;
  startedBy: number;
  startedAt: string;
  connectedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  endReason: string | null;
  notes: string | null;
  createdAt: string;
  device?: Pick<Device, 'id' | 'hostname' | 'displayName' | 'osType'>;
  startedByUser?: Pick<User, 'id' | 'username' | 'displayName'>;
}

// ─── INVENTORY ───────────────────────────────────────────────────────────────

export interface CpuInfo {
  model: string;
  cores: number;
  threads: number;
  speed: number; // GHz
}

export interface MemoryInfo {
  total: number; // bytes
  slots: Array<{ size: number; type: string; speed: number; bank: string }>;
}

export interface DiskInfo {
  device: string;
  model: string | null;
  type: 'SSD' | 'HDD' | 'NVMe' | 'unknown';
  size: number; // bytes
  mounts: Array<{ mount: string; used: number; total: number }>;
}

export interface NetworkInterfaceInfo {
  name: string;
  mac: string;
  type: string;
  speed: number | null;
  addresses: string[];
}

export interface GpuInfo {
  name: string;
  vram: number; // bytes
  driver: string | null;
}

export interface MotherboardInfo {
  manufacturer: string | null;
  model: string | null;
  version: string | null;
  serial: string | null;
}

export interface BiosInfo {
  vendor: string | null;
  version: string | null;
  date: string | null;
}

export interface TpmInfo {
  present: boolean;
  manufacturerName?: string;
  version?: string;
  specVersion?: string;
  status?: string;
  activated?: boolean;
  enabled?: boolean;
  owned?: boolean;
}

export interface BitLockerVolume {
  driveLetter: string;
  status: string;              // FullyEncrypted, FullyDecrypted, EncryptionInProgress, DecryptionInProgress, etc.
  protectionStatus: string;    // On, Off, Unknown
  encryptionPercentage: number; // 0-100
  recoveryKeys: string[];
}

export interface OSDetailsInfo {
  edition?: string;
  displayVersion?: string;
  buildNumber?: string;
  windowsKey?: string;
  officeVersion?: string;
  officeKey?: string;
}

export interface BatteryHealth {
  present: boolean;
  designCapacity?: number;
  fullCapacity?: number;
  healthPercent?: number;
  cycleCount?: number;
  status?: string;
}

export interface HardwareInventory {
  id: number;
  deviceId: number;
  cpu: CpuInfo;
  memory: MemoryInfo;
  disks: DiskInfo[];
  networkInterfaces: NetworkInterfaceInfo[];
  gpu: GpuInfo[];
  motherboard: MotherboardInfo;
  bios: BiosInfo;
  tpm?: TpmInfo;
  os?: OSDetailsInfo;
  battery?: BatteryHealth;
  bitlocker?: BitLockerVolume[];
  raw: Record<string, any>;
  scannedAt: string;
}

export interface SoftwareEntry {
  id: number;
  deviceId: number;
  name: string;
  version: string | null;
  publisher: string | null;
  installDate: string | null;
  installLocation: string | null;
  source: string | null;
  packageId: string | null;
  scannedAt: string;
}

// ─── NOTIFICATIONS ───────────────────────────────────────────────────────────

export type NotificationChannelType =
  | 'telegram' | 'discord' | 'slack' | 'teams'
  | 'smtp' | 'webhook' | 'gotify' | 'ntfy' | 'pushover' | 'freemobile';

export type OverrideMode = 'merge' | 'replace' | 'exclude';

export interface NotificationChannel {
  id: number;
  tenantId: number;
  name: string;
  type: NotificationChannelType;
  config: Record<string, any>;
  uuid: string;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationBinding {
  id: number;
  tenantId: number;
  channelId: number;
  scope: 'global' | 'group' | 'device';
  scopeId: number | null;
  overrideMode: OverrideMode;
}

// ─── SETTINGS ────────────────────────────────────────────────────────────────

export type SettingScope = 'global' | 'group' | 'device';

export interface SettingValue {
  id: number;
  tenantId: number;
  scope: SettingScope;
  scopeId: number | null;
  key: string;
  value: any;
  createdAt: string;
  updatedAt: string;
}

// ─── MAINTENANCE ─────────────────────────────────────────────────────────────

export type MaintenanceScope = 'global' | 'group' | 'device';
export type MaintenanceScheduleType = 'one_time' | 'recurring';

export interface MaintenanceRecurrenceRule {
  frequency?: 'daily' | 'weekly';
  daysOfWeek?: number[];
  time?: string;
  duration?: number; // minutes
}

export interface MaintenanceWindow {
  id: number;
  tenantId: number;
  name: string;
  scopeType: MaintenanceScope;
  scopeId: number | null;
  scheduleType: MaintenanceScheduleType;
  startsAt: string;
  endsAt: string;
  /** @deprecated Use startsAt instead */
  startAt?: string;
  /** @deprecated Use endsAt instead */
  endAt?: string;
  recurrenceRule: MaintenanceRecurrenceRule;
  timezone: string;
  notificationChannels: number[];
  lastDedupKey: string | null;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
  // Additional fields returned by the API for effective/resolved windows
  startTime?: string | null;
  endTime?: string | null;
  recurrenceType?: MaintenanceRecurrenceType | null;
  daysOfWeek?: number[] | null;
  notifyChannelIds?: number[];
  active?: boolean;
  isActiveNow?: boolean;
  isDisabledHere?: boolean;
  /** Source of this window when fetching effective windows: 'local' | 'global' | 'group' */
  source?: 'local' | 'global' | 'group';
  sourceName?: string;
  /** Display name of the scope target */
  scopeName?: string;
  canEdit?: boolean;
  canDelete?: boolean;
  canDisable?: boolean;
  canEnable?: boolean;
}

// ─── TEAMS & RBAC ────────────────────────────────────────────────────────────

export interface UserTeam {
  id: number;
  tenantId: number;
  name: string;
  canCreate: boolean;
  uuid: string;
  createdAt: string;
  updatedAt: string;
  /** Optional: tenant name (populated when fetching all teams as platform admin) */
  tenantName?: string;
  /** Optional: team description */
  description?: string | null;
}

export interface TeamMembership {
  teamId: number;
  userId: number;
}

export type Capability = 'monitor' | 'execute' | 'remote' | 'files' | 'power';

export interface TeamPermission {
  id: number;
  tenantId: number;
  teamId: number;
  scope: 'group' | 'device';
  scopeId: number;
  level: 'ro' | 'rw';
  capabilities: Capability[];
}

// ─── SMTP ────────────────────────────────────────────────────────────────────

export interface SmtpServer {
  id: number;
  tenantId: number | null;
  name: string;
  host: string;
  port: number;
  secure: boolean;
  username: string | null;
  fromAddress: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── LIVE ALERTS ─────────────────────────────────────────────────────────────

export type AlertSeverity = 'info' | 'warning' | 'critical' | 'down' | 'up';

export interface LiveAlert {
  id: number;
  tenantId: number;
  severity: AlertSeverity;
  title: string;
  message: string | null;
  navigateTo: string | null;
  stableKey: string | null;
  readAt: string | null;
  createdAt: string;
  /** Optional: tenant name (populated for cross-tenant alerts) */
  tenantName?: string;
}

// ─── REPORTS ─────────────────────────────────────────────────────────────────

export type ReportType = 'fleet' | 'compliance' | 'scripts' | 'updates' | 'software' | 'custom';
export type ReportFormat = 'json' | 'csv' | 'pdf' | 'excel' | 'html';
export type ReportStatus = 'generating' | 'ready' | 'error';
export type ReportSection = 'hardware' | 'software' | 'updates' | 'compliance' | 'scripts_history' | 'network';

export interface Report {
  id: number;
  tenantId: number;
  name: string;
  description: string | null;
  type: ReportType;
  format: ReportFormat;
  scopeType: 'tenant' | 'group' | 'device';
  scopeId: number | null;
  sections: ReportSection[];
  filters: Record<string, any>;
  scheduleCron: string | null;
  timezone: string;
  isEnabled: boolean;
  lastGeneratedAt: string | null;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReportOutput {
  id: number;
  reportId: number;
  tenantId: number;
  status: ReportStatus;
  filePath: string | null;
  fileSizeBytes: number | null;
  rowCount: number | null;
  errorMessage: string | null;
  expiresAt: string | null;
  generatedAt: string | null;
  createdAt: string;
}

// ─── API RESPONSE ────────────────────────────────────────────────────────────

export interface ApiResponse<T = unknown> {
  data?: T;
  error?: string;
  message?: string;
}

// ─── USER REQUEST TYPES ──────────────────────────────────────────────────────

export interface CreateUserRequest {
  username: string;
  password: string;
  displayName?: string | null;
  email?: string | null;
  role?: 'admin' | 'user';
  preferredLanguage?: string;
}

export interface UpdateUserRequest {
  username?: string;
  displayName?: string | null;
  email?: string | null;
  role?: 'admin' | 'user';
  preferredLanguage?: string;
  isActive?: boolean;
}

// ─── TEAM REQUEST TYPES ──────────────────────────────────────────────────────

export interface CreateTeamRequest {
  name: string;
  description?: string | null;
  canCreate?: boolean;
}

export interface UpdateTeamRequest {
  name?: string;
  description?: string | null;
  canCreate?: boolean;
}

export interface SetTeamMembersRequest {
  memberIds: number[];
}

export interface SetTeamPermissionsRequest {
  permissions: Array<{
    scope: 'group' | 'device';
    scopeId: number;
    level: 'ro' | 'rw';
    capabilities?: Capability[];
  }>;
}

// ─── NOTIFICATION CHANNEL REQUEST TYPES ─────────────────────────────────────

export interface CreateNotificationChannelRequest {
  name: string;
  type: NotificationChannelType;
  config: Record<string, any>;
}

export interface UpdateNotificationChannelRequest {
  name?: string;
  config?: Record<string, any>;
}

// ─── APP CONFIG ──────────────────────────────────────────────────────────────

export interface AppConfigData {
  allow_2fa: string;
  force_2fa: string;
  otp_smtp_server_id: string | null;
  agent_auto_approve: string;
  default_push_interval: string;
  fast_poll_interval: string;
  remote_fast_poll_interval: string;
  task_retrieve_delay_seconds: string;
  remote_session_timeout_minutes: string;
  catchup_window_days: string;
  inventory_retention_days: string;
  app_name: string;
  default_language: string;
  // Obligate SSO gateway
  obligate_url?: string | null;
  obligate_enabled?: string;
}

export interface ObligateConfig {
  url: string | null;
  apiKeySet: boolean;
  enabled: boolean;
}

// ─── FLEET SUMMARY ───────────────────────────────────────────────────────────

export interface FleetSummary {
  total: number;
  online: number;
  offline: number;
  warning: number;
  critical: number;
  pending: number;
  suspended: number;
  pendingUpdates: number;
  complianceScore: number | null;
  agentUpToDate: number;
  agentOutdated: number;
  latestAgentVersion: string;
  osByType: { windows: number; macos: number; linux: number; other: number };
  /** Per-OS connectivity counts. Used by the dashboard "Connectivité par OS"
   *  card (horizontal stacked bars: online green, offline muted). */
  osConnectivity?: Record<'windows' | 'macos' | 'linux' | 'other', { online: number; total: number }>;
  activeRemoteSessions: number;
  upcomingSchedules: number;
  staleDevices: number;
  /** Day-over-day deltas computed from yesterday's fleet snapshot. Null
   *  values mean no snapshot is available yet (fresh deploy). */
  deltas?: {
    onlineVsYesterday:    number | null;
    offlineVsYesterday:   number | null;
    pendingUpdatesVsWeek: number | null;
    staleVsYesterday:     number | null;
    totalVsYesterday:     number | null;
  };
}

// ─── AUTH & USERS ─────────────────────────────────────────────────────────────

export interface LoginRequest {
  username: string;
  password: string;
  totpCode?: string;
  emailOtp?: string;
}

export type UserRole = 'admin' | 'user';

export type PermissionLevel = 'ro' | 'rw';

export interface UserPermissions {
  canCreate: boolean;
  teams: number[];
  permissions: Record<string, PermissionLevel>;
  /** Tenant-scoped capabilities aggregated across all the user's teams.
   *  Used by the client to gate non-device-scoped pages (e.g. the
   *  /admin/supervision tabs: 'supervision_remote', 'supervision_history',
   *  'manage_reports'). Always empty for platform admins — they bypass. */
  tenantCapabilities: string[];
}

export interface UserTenantAssignment {
  tenantId: number;
  tenantName: string;
  tenantSlug: string;
  isMember: boolean;
  role: 'admin' | 'member';
}

// ─── MAINTENANCE ──────────────────────────────────────────────────────────────

export type MaintenanceRecurrenceType = 'daily' | 'weekly';

export type MaintenanceScopeType = 'global' | 'group' | 'device';

export interface CreateMaintenanceWindowRequest {
  name: string;
  scopeType: MaintenanceScopeType;
  scopeId?: number | null;
  scheduleType: string;
  startAt?: string | null;
  endAt?: string | null;
  /** New canonical field name for one-time start (replaces startAt) */
  startsAt?: string;
  /** New canonical field name for one-time end (replaces endAt) */
  endsAt?: string;
  startTime?: string | null;
  endTime?: string | null;
  recurrenceType?: string | null;
  /** New canonical field name for recurring rule (replaces recurrenceType) */
  recurrenceRule?: MaintenanceRecurrenceRule | null;
  daysOfWeek?: number[] | null;
  timezone?: string;
  notifyChannelIds?: number[];
  /** New canonical field name for notification channels (replaces notifyChannelIds) */
  notificationChannels?: number[];
  active?: boolean;
}

export interface UpdateMaintenanceWindowRequest extends Partial<CreateMaintenanceWindowRequest> {}

// ─── NOTIFICATION PLUGINS ─────────────────────────────────────────────────────

export type NotificationConfigFieldType = 'text' | 'password' | 'number' | 'boolean' | 'select' | 'textarea' | 'url';

export interface NotificationConfigField {
  key: string;
  label: string;
  type: NotificationConfigFieldType;
  required?: boolean;
  placeholder?: string;
  helpText?: string;
  options?: { value: string; label: string }[];
  default?: string | number | boolean;
}

export interface NotificationPluginMeta {
  type: string;
  name: string;
  description: string;
  configFields: NotificationConfigField[];
}

// ─── SCENARIOS ──────────────────────────────────────────────────────────────

export type ScenarioTriggerType = 'session_login' | 'machine_boot' | 'agent_approved' | 'group_join' | 'schedule_failure' | 'manual';
export type ScenarioStatus = 'draft' | 'active' | 'disabled';
export type ScenarioRunStatus = 'pending' | 'running' | 'success' | 'failure' | 'cancelled' | 'timeout';
export type ScenarioStepRunStatus = 'pending' | 'check_running' | 'check_passed' | 'resolve_running' | 'recheck_running' | 'recheck_passed' | 'failed' | 'skipped' | 'success';

export interface ScenarioTriggerConfig {
  groupIds?: number[];
  scheduleId?: number;
}

export interface ScenarioRetryPolicy {
  maxRetries: number;
  retryDelaySeconds: number;
}

export type AutomationNotificationMode = 'on_error' | 'summary';

export interface AutomationNotificationBinding {
  channelId: number;
  mode: AutomationNotificationMode;
}

export interface CustomSection {
  id: number;
  tenantId: number;
  name: string;
  description: string | null;
  command: string;
  platform: 'all' | 'windows' | 'linux' | 'macos';
  runtime: 'bash' | 'sh' | 'powershell' | 'cmd';
  usePty: boolean;
  targetType: 'all' | 'group' | 'device';
  targetIds: number[];
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface Scenario {
  id: number;
  uuid: string;
  tenantId: number;
  name: string;
  description: string | null;
  triggerType: ScenarioTriggerType;
  triggerConfig: ScenarioTriggerConfig;
  /**
   * 'self'   — event triggers run on the originating device only (the
   *            sane default for session_login / machine_boot / agent_approved
   *            / group_join). targetIds is ignored.
   * 'all'    — every device in the tenant (rarely useful with event triggers).
   * 'group'  — devices that belong to one of `targetIds` or any descendant.
   * 'device' — devices whose id is in `targetIds`.
   */
  targetType: 'self' | 'all' | 'group' | 'device' | string;
  targetIds: number[];
  status: ScenarioStatus;
  retryPolicy: ScenarioRetryPolicy;
  timeoutSeconds: number;
  notifyOnSuccess: boolean;
  notifyOnFailure: boolean;
  notificationChannels: AutomationNotificationBinding[];
  variables: Record<string, string>;
  steps?: ScenarioStep[];
  /** Populated by the list endpoint (cheap COUNT subquery). The detail
   *  endpoint returns the full `steps` array instead. */
  stepCount?: number;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScenarioStep {
  id: number;
  scenarioId: number;
  sortOrder: number;
  name: string;
  description: string | null;
  checkScriptId: number | null;
  resolveScriptId: number | null;
  timeoutSeconds: number;
  retryCount: number;
  parameterOverrides: Record<string, string>;
  checkScript?: Pick<Script, 'id' | 'name' | 'platform' | 'runtime'>;
  resolveScript?: Pick<Script, 'id' | 'name' | 'platform' | 'runtime'>;
}

export interface ScenarioRun {
  id: string;
  tenantId: number;
  scenarioId: number;
  deviceId: number;
  triggerType: ScenarioTriggerType;
  triggerSource: string | null;
  status: ScenarioRunStatus;
  currentStep: number;
  variables: Record<string, string>;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
  retryAttempt: number;
  createdAt: string;
  scenario?: Pick<Scenario, 'id' | 'name'>;
  device?: { id: number; hostname: string; displayName: string | null; osType: string };
  stepRuns?: ScenarioStepRun[];
}

export interface ScenarioStepRun {
  id: string;
  runId: string;
  stepId: number;
  sortOrder: number;
  status: ScenarioStepRunStatus;
  checkExitCode: number | null;
  checkStdout: string | null;
  checkStderr: string | null;
  checkStartedAt: string | null;
  checkFinishedAt: string | null;
  resolveExitCode: number | null;
  resolveStdout: string | null;
  resolveStderr: string | null;
  resolveStartedAt: string | null;
  resolveFinishedAt: string | null;
  recheckExitCode: number | null;
  recheckStdout: string | null;
  recheckStderr: string | null;
  recheckStartedAt: string | null;
  recheckFinishedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  retryAttempt: number;
  step?: ScenarioStep;
}

