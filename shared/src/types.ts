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
}

export interface UserWithPassword extends User {
  passwordHash: string;
  totpSecret: string | null;
}

export type AppTheme = 'modern' | 'neon';

export interface UserPreferences {
  toastEnabled?: boolean;
  toastPosition?: 'top-center' | 'bottom-right';
  multiTenantNotifications?: boolean;
  sidebarFloating?: boolean;
  theme?: 'dark' | 'light';
  preferredTheme?: AppTheme;
}

// ─── TENANTS ─────────────────────────────────────────────────────────────────

export interface Tenant {
  id: number;
  name: string;
  slug: string;
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
  uuid: string;
  createdAt: string;
  updatedAt: string;
}

export interface DeviceGroupConfig {
  pushIntervalSeconds?: number;
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

export type DeviceStatus = 'pending' | 'online' | 'offline' | 'maintenance' | 'warning' | 'critical' | 'suspended';
export type OsType = 'windows' | 'macos' | 'linux' | 'other';
export type ApprovalStatus = 'pending' | 'approved' | 'refused';

export interface Device {
  id: number;
  uuid: string;
  tenantId: number;
  groupId: number | null;
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
  overrideGroupSettings: boolean;
  maxMissedPushes: number;
  // Metadata
  tags: string[];
  customFields: Record<string, string>;
  displayConfig: DeviceDisplayConfig;
  sensorDisplayNames: Record<string, string>;
  notificationTypes: DeviceNotificationTypes;
  latestMetrics: DeviceMetrics;
  createdAt: string;
  updatedAt: string;
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
  createdBy: number | null;
  createdAt: string;
  lastUsedAt: string | null;
  deviceCount: number;
}

// ─── COMMAND QUEUE ────────────────────────────────────────────────────────────

export type CommandType =
  | 'run_script'
  | 'install_update'
  | 'scan_inventory'
  | 'scan_updates'
  | 'check_compliance'
  | 'open_remote_tunnel'
  | 'close_remote_tunnel'
  | 'reboot'
  | 'shutdown'
  | 'restart_agent'
  | 'list_services'
  | 'restart_service'
  | 'install_software'
  | 'uninstall_software';

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
  createdAt: string;
  updatedAt: string;
}

export interface CommandResult {
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  error?: string;
  duration?: number;
}

// Agent push protocol
export interface AgentPushRequest {
  deviceUuid: string;
  metrics: DeviceMetrics;
  acks: CommandAck[];
  agentVersion?: string;
}

export interface CommandAck {
  commandId: string;
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
  displayConfig: DeviceDisplayConfig;
  sensorDisplayNames: Record<string, string>;
  notificationTypes: DeviceNotificationTypes;
}

export interface AgentCommand {
  id: string;
  type: CommandType;
  payload: Record<string, any>;
  priority: CommandPriority;
}

// ─── SCRIPTS ─────────────────────────────────────────────────────────────────

export type ScriptPlatform = 'windows' | 'macos' | 'linux' | 'all';
export type ScriptRuntime = 'powershell' | 'pwsh' | 'cmd' | 'bash' | 'zsh' | 'sh' | 'python' | 'python3' | 'perl' | 'ruby';
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
  name: string;
  description: string | null;
  tags: string[];
  platform: ScriptPlatform;
  runtime: ScriptRuntime;
  content: string;
  timeoutSeconds: number;
  expectedExitCode: number;
  runAs: 'system' | 'user';
  isBuiltin: boolean;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: string;
  updatedAt: string;
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
  targetId: number | null;
  cronExpression: string | null;
  fireOnceAt: string | null;
  timezone: string;
  parameterValues: Record<string, any>;
  catchupEnabled: boolean;
  catchupMax: number;
  runConditions: RunCondition[];
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: string;
  updatedAt: string;
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

// ─── UPDATES ─────────────────────────────────────────────────────────────────

export type UpdateSeverity = 'critical' | 'important' | 'moderate' | 'optional' | 'unknown';
export type UpdateSource = 'windows_update' | 'apt' | 'yum' | 'dnf' | 'pacman' | 'brew' | 'chocolatey' | 'winget' | 'other';
export type UpdateStatus = 'available' | 'approved' | 'pending_install' | 'installing' | 'installed' | 'failed' | 'excluded' | 'superseded';
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
}

// ─── CONFIG TEMPLATES ────────────────────────────────────────────────────────

export type ConfigCheckMethod = 'registry' | 'file' | 'command' | 'service' | 'process' | 'policy';
export type ConfigCheckOperator = 'eq' | 'neq' | 'gt' | 'lt' | 'contains' | 'exists' | 'not_exists';
export type CheckSeverity = 'low' | 'medium' | 'high' | 'critical';

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

export interface ComplianceRule {
  id: string;
  name: string;
  category?: string;
  checkType: ComplianceCheckType;
  targetPlatform: ScriptPlatform;
  target: string;
  expected: any;
  operator: string;
  severity: CheckSeverity;
  autoRemediateScriptId: number | null;
}

export interface CompliancePolicy {
  id: number;
  uuid: string;
  tenantId: number;
  name: string;
  description: string | null;
  framework: ComplianceFramework;
  targetType: 'device' | 'group' | 'all';
  targetId: number | null;
  rules: ComplianceRule[];
  enabled: boolean;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ComplianceRuleResult {
  ruleId: string;
  status: ComplianceStatus;
  actualValue: any;
  checkedAt: string;
  remediationTriggered: boolean;
}

export interface ComplianceResult {
  id: number;
  deviceId: number;
  policyId: number;
  tenantId: number;
  results: ComplianceRuleResult[];
  complianceScore: number;
  checkedAt: string;
  createdAt: string;
  policy?: Pick<CompliancePolicy, 'id' | 'name' | 'framework'>;
}

// ─── REMOTE SESSIONS ─────────────────────────────────────────────────────────

export type RemoteProtocol = 'vnc' | 'rdp' | 'ssh';
export type RemoteSessionStatus = 'waiting' | 'connecting' | 'active' | 'closed' | 'failed' | 'timeout';

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
}

export interface BiosInfo {
  vendor: string | null;
  version: string | null;
  date: string | null;
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

export interface TeamPermission {
  id: number;
  tenantId: number;
  teamId: number;
  scope: 'group' | 'device';
  scopeId: number;
  level: 'ro' | 'rw';
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
  remote_session_timeout_minutes: string;
  catchup_window_days: string;
  inventory_retention_days: string;
  app_name: string;
  default_language: string;
  // Cross-app SSO integration
  obliview_url?: string | null;
  obliguard_url?: string | null;
  oblimap_url?: string | null;
  enable_foreign_sso?: boolean;
  enable_obliguard_sso?: boolean;
  enable_oblimap_sso?: boolean;
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

// ─── SSO CONFIG ──────────────────────────────────────────────────────────────

export interface SsoIntegrationConfig {
  url: string | null;
  apiKeySet: boolean;
}
