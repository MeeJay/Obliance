import { z } from 'zod';

export const createTeamSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).nullable().optional(),
  canCreate: z.boolean().optional(),
});

export const updateTeamSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).nullable().optional(),
  canCreate: z.boolean().optional(),
});

export const setTeamMembersSchema = z.object({
  memberIds: z.array(z.number().int().positive()),
});

// Mirror of `Capability` in shared/types.ts. Adding a new cap requires
// updating BOTH this enum AND `VALID_CAPABILITIES` in team.service.ts;
// rowToPermission() uses that set as a defensive filter on read so
// stale DB values don't trip the validator on the GET → toggle → PUT
// round-trip (this is the bug fix from the team-permission "Validation
// failed" investigation).
export const CAPABILITY_VALUES = [
  'monitor', 'execute', 'remote', 'files', 'power',
  'supervision:read',
  'agent_config:custom_sections',
  'agent_config:discovery',
  'agent_config:keys',
  'agent_config:approval',
] as const;

export const setTeamPermissionsSchema = z.object({
  permissions: z.array(
    z.object({
      scope: z.enum(['group', 'device', 'ungrouped']),
      scopeId: z.number().int().positive(),
      level: z.enum(['ro', 'rw']),
      capabilities: z.array(z.enum(CAPABILITY_VALUES)).optional(),
    }),
  ),
});

export type CreateTeamInput = z.infer<typeof createTeamSchema>;
export type UpdateTeamInput = z.infer<typeof updateTeamSchema>;
export type SetTeamMembersInput = z.infer<typeof setTeamMembersSchema>;
export type SetTeamPermissionsInput = z.infer<typeof setTeamPermissionsSchema>;
