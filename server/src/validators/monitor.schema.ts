import { z } from 'zod';
const MONITOR_TYPES = ['http', 'https', 'tcp', 'ping', 'dns', 'ssl', 'smtp', 'push', 'script'] as const;


const MIN_CHECK_INTERVAL = Math.max(1, parseInt(process.env.MIN_CHECK_INTERVAL ?? '10', 10));
const MIN_RETRY_INTERVAL = Math.max(1, parseInt(process.env.MIN_RETRY_INTERVAL ?? '5', 10));

export const createMonitorSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).nullable().optional(),
  type: z.enum(MONITOR_TYPES),
  groupId: z.number().int().positive().nullable().optional(),
  isActive: z.boolean().optional(),

  // Common config
  intervalSeconds: z.number().int().min(MIN_CHECK_INTERVAL).max(86400).nullable().optional(),
  retryIntervalSeconds: z.number().int().min(MIN_RETRY_INTERVAL).max(3600).nullable().optional(),
  maxRetries: z.number().int().min(0).max(20).nullable().optional(),
  timeoutMs: z.number().int().min(1000).max(60000).nullable().optional(),
  upsideDown: z.boolean().optional(),

  // HTTP / JSON API
  url: z.string().max(2048).nullable().optional(),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']).optional(),
  headers: z.record(z.string()).nullable().optional(),
  body: z.string().max(10000).nullable().optional(),
  expectedStatusCodes: z.array(z.number().int().min(100).max(599)).nullable().optional(),
  keyword: z.string().max(255).nullable().optional(),
  keywordIsPresent: z.boolean().nullable().optional(),

  // SSL verification
  ignoreSsl: z.boolean().optional(),

  // JSON API
  jsonPath: z.string().max(255).nullable().optional(),
  jsonExpectedValue: z.string().max(255).nullable().optional(),

  // Ping / TCP
  hostname: z.string().max(255).nullable().optional(),
  port: z.number().int().min(1).max(65535).nullable().optional(),

  // DNS
  dnsRecordType: z.enum(['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SOA', 'SRV', 'PTR']).nullable().optional(),
  dnsResolver: z.string().max(255).nullable().optional(),
  dnsExpectedValue: z.string().max(255).nullable().optional(),

  // SSL
  sslWarnDays: z.number().int().min(1).max(365).nullable().optional(),

  // SMTP
  smtpHost: z.string().max(255).nullable().optional(),
  smtpPort: z.number().int().min(1).max(65535).nullable().optional(),

  // Docker
  dockerHost: z.string().max(2048).nullable().optional(),
  dockerContainerName: z.string().max(255).nullable().optional(),

  // Game server
  gameType: z.string().max(32).nullable().optional(),
  gameHost: z.string().max(255).nullable().optional(),
  gamePort: z.number().int().min(1).max(65535).nullable().optional(),

  // Push
  pushMaxIntervalSec: z.number().int().min(30).max(86400).nullable().optional(),

  // Script
  scriptCommand: z.string().max(2048).nullable().optional(),
  scriptExpectedExit: z.number().int().min(0).max(255).nullable().optional(),

  // Browser (Playwright)
  browserUrl: z.string().max(2048).nullable().optional(),
  browserKeyword: z.string().max(255).nullable().optional(),
  browserKeywordIsPresent: z.boolean().nullable().optional(),
  browserWaitForSelector: z.string().max(255).nullable().optional(),
  browserScreenshotOnFailure: z.boolean().optional(),

  // Value Watcher
  valueWatcherUrl: z.string().max(2048).nullable().optional(),
  valueWatcherJsonPath: z.string().max(255).nullable().optional(),
  valueWatcherOperator: z.enum(['>', '<', '>=', '<=', '==', '!=', 'between', 'changed']).nullable().optional(),
  valueWatcherThreshold: z.number().nullable().optional(),
  valueWatcherThresholdMax: z.number().nullable().optional(),
  valueWatcherPreviousValue: z.string().max(1000).nullable().optional(),
  valueWatcherHeaders: z.record(z.string()).nullable().optional(),
});

export const updateMonitorSchema = createMonitorSchema.partial();

export const bulkUpdateSchema = z.object({
  monitorIds: z.array(z.number().int().positive()).min(1).max(100),
  changes: updateMonitorSchema,
});

export type CreateMonitorInput = z.infer<typeof createMonitorSchema>;
export type UpdateMonitorInput = z.infer<typeof updateMonitorSchema>;
export type BulkUpdateInput = z.infer<typeof bulkUpdateSchema>;
