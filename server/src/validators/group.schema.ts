import { z } from 'zod';

// Metric threshold pair — both ends optional so callers can clear one
// without touching the other (the cascade resolver falls back to the
// next layer when a side is undefined). 0–100 because the values are
// percentages.
const metricThresholdPair = z.object({
  warn: z.number().min(0).max(100).optional(),
  crit: z.number().min(0).max(100).optional(),
}).strict();

// Whole `MetricThresholds` JSONB blob (per-group / per-device). Empty
// object means "fall back to the next layer". `diskByMount` is a free-
// form map keyed by the mount path the agent reports (e.g. "C:\\",
// "/var") — we don't constrain the keys, only the value shape.
//
// IMPORTANT — every group-level field MUST be listed here. Zod's
// default mode strips unknown keys (the validate middleware then
// overwrites req.body with the parsed result), so missing one field
// silently drops it from the update payload. We hit this with
// `thresholds` initially: the editor saved, the controller never
// received it, and the UI reverted to defaults on reload. Same trap
// applies to `groupConfig` and `metricAlertsEnabled` — they're all
// listed below now.
export const metricThresholdsSchema = z.object({
  disk: metricThresholdPair.optional(),
  cpu: metricThresholdPair.optional(),
  ram: metricThresholdPair.optional(),
  diskByMount: z.record(z.string(), metricThresholdPair).optional(),
}).strict();

const groupConfigSchema = z.object({
  pushIntervalSeconds: z.number().int().positive().optional(),
  scanIntervalSeconds: z.number().int().positive().optional(),
  maxMissedPushes: z.number().int().positive().optional(),
  autoApprove: z.boolean().optional(),
}).strict();

export const createGroupSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).nullable().optional(),
  parentId: z.number().int().positive().nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
  isGeneral: z.boolean().optional(),
  groupNotifications: z.boolean().optional(),
  kind: z.enum(['monitor', 'agent']).optional(),
});

export const updateGroupSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
  isGeneral: z.boolean().optional(),
  groupNotifications: z.boolean().optional(),
  thresholds: metricThresholdsSchema.optional(),
  groupConfig: groupConfigSchema.optional(),
  // Tri-state: true = alerts on, false = off, null = inherit system default.
  metricAlertsEnabled: z.boolean().nullable().optional(),
});

export const moveGroupSchema = z.object({
  newParentId: z.number().int().positive().nullable(),
});

export type CreateGroupInput = z.infer<typeof createGroupSchema>;
export type UpdateGroupInput = z.infer<typeof updateGroupSchema>;
export type MoveGroupInput = z.infer<typeof moveGroupSchema>;
