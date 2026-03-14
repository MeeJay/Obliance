import type { Request, Response, NextFunction } from 'express';
import { db } from '../db';
import { AppError } from '../middleware/errorHandler';
import { z } from 'zod';

export const REQUIRED_ENROLLMENT_VERSION = 1;

const enrollmentSchema = z.object({
  displayName: z.string().max(100).nullable().optional(),
  email: z.string().email().max(255),
  preferredLanguage: z.string().max(10).default('en'),
  toastEnabled: z.boolean().default(true),
  toastPosition: z.enum(['top-center', 'bottom-right']).default('bottom-right'),
});

export const enrollmentController = {
  async complete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsed = enrollmentSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(400, parsed.error.errors[0]?.message ?? 'Invalid input');
      }

      const { displayName, email, preferredLanguage, toastEnabled, toastPosition } = parsed.data;

      // Check if email is already used by another user
      const existing = await db('users')
        .where({ email })
        .whereNot({ id: req.session.userId })
        .first();
      if (existing) {
        throw new AppError(409, 'This email address is already in use');
      }

      const preferences = { toastEnabled, toastPosition };

      const [row] = await db('users')
        .where({ id: req.session.userId })
        .update({
          display_name: displayName !== undefined ? displayName : db.raw('display_name'),
          email,
          preferred_language: preferredLanguage,
          preferences: JSON.stringify(preferences),
          enrollment_version: REQUIRED_ENROLLMENT_VERSION,
          updated_at: new Date(),
        })
        .returning(['id', 'username', 'display_name', 'role', 'is_active', 'created_at', 'updated_at', 'preferences', 'email', 'preferred_language', 'enrollment_version']);

      if (!row) throw new AppError(404, 'User not found');

      res.json({
        success: true,
        data: {
          id: row.id,
          username: row.username,
          displayName: row.display_name,
          role: row.role,
          isActive: row.is_active,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          preferences: row.preferences ?? null,
          email: row.email,
          preferredLanguage: row.preferred_language,
          enrollmentVersion: row.enrollment_version,
        },
      });
    } catch (err) {
      next(err);
    }
  },
};
