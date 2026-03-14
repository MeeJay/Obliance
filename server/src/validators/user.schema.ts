import { z } from 'zod';

export const createUserSchema = z.object({
  username: z.string().min(3).max(64).regex(/^[a-zA-Z0-9_.-]+$/, 'Only letters, numbers, _, ., -'),
  password: z.string().min(6).max(128),
  displayName: z.string().max(128).nullable().optional(),
  role: z.enum(['admin', 'user']).optional(),
});

export const updateUserSchema = z.object({
  username: z.string().min(3).max(64).regex(/^[a-zA-Z0-9_.-]+$/, 'Only letters, numbers, _, ., -').optional(),
  displayName: z.string().max(128).nullable().optional(),
  role: z.enum(['admin', 'user']).optional(),
  isActive: z.boolean().optional(),
});

export const changePasswordSchema = z.object({
  password: z.string().min(6).max(128),
});

export const setGroupAssignmentsSchema = z.object({
  groupIds: z.array(z.number().int().positive()),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type SetGroupAssignmentsInput = z.infer<typeof setGroupAssignmentsSchema>;
