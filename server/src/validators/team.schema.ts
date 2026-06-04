import { z } from 'zod';

export const createTeamSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).nullable().optional(),
  canCreate: z.boolean().optional(),
  // Master-only field — when a platform admin creates a team while
  // logged into the master tenant, this picks which child tenant the
  // team will operate in. The controller drops this field for any
  // non-master caller (security), so it's safe to accept here.
  tenantId: z.number().int().positive().optional(),
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
  // Hyper-V (device-scoped). view = see the VM list on hosts the team can
  // reach; power = start/stop/restart/save; manage = checkpoints, edit,
  // create, delete (each further gated by the action-restriction matrix).
  'hyperv:view',
  'hyperv:power',
  'hyperv:manage',
  // Veeam backups (device-scoped). view = read job list; control = run actions.
  'veeam:view',
  'veeam:control',
] as const;

export const setTeamPermissionsSchema = z.object({
  permissions: z.array(
    z.object({
      scope: z.enum(['group', 'device', 'ungrouped']),
      // scope='ungrouped' uses scope_id=0 by convention (no real row
      // to point at); 'group' / 'device' use the actual row id which
      // is always >= 1. Accept anything >= 0 here and let the service
      // verify the (scope, scope_id) pairing makes sense.
      scopeId: z.number().int().nonnegative(),
      level: z.enum(['ro', 'rw']),
      capabilities: z.array(z.enum(CAPABILITY_VALUES)).optional(),
    }),
  ),
});

export type CreateTeamInput = z.infer<typeof createTeamSchema>;
export type UpdateTeamInput = z.infer<typeof updateTeamSchema>;
export type SetTeamMembersInput = z.infer<typeof setTeamMembersSchema>;
export type SetTeamPermissionsInput = z.infer<typeof setTeamPermissionsSchema>;
