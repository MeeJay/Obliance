import { z } from 'zod';

export const createChannelSchema = z.object({
  name: z.string().min(1).max(255),
  type: z.string().min(1).max(50),
  config: z.record(z.unknown()),
  isEnabled: z.boolean().optional(),
});

export const updateChannelSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  config: z.record(z.unknown()).optional(),
  isEnabled: z.boolean().optional(),
});

export const addBindingSchema = z.object({
  channelId: z.number().int().positive(),
  scope: z.enum(['global', 'group', 'monitor', 'agent']),
  scopeId: z.number().int().positive().nullable(),
  overrideMode: z.enum(['merge', 'replace', 'exclude']).optional(),
});

export const removeBindingSchema = z.object({
  channelId: z.number().int().positive(),
  scope: z.enum(['global', 'group', 'monitor', 'agent']),
  scopeId: z.number().int().positive().nullable(),
});

export type CreateChannelInput = z.infer<typeof createChannelSchema>;
export type UpdateChannelInput = z.infer<typeof updateChannelSchema>;
export type AddBindingInput = z.infer<typeof addBindingSchema>;
export type RemoveBindingInput = z.infer<typeof removeBindingSchema>;
