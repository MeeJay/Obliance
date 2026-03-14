import { z } from 'zod';

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
});

export const moveGroupSchema = z.object({
  newParentId: z.number().int().positive().nullable(),
});

export type CreateGroupInput = z.infer<typeof createGroupSchema>;
export type UpdateGroupInput = z.infer<typeof updateGroupSchema>;
export type MoveGroupInput = z.infer<typeof moveGroupSchema>;
