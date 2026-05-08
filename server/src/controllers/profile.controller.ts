import type { Request, Response, NextFunction } from 'express';
import { db } from '../db';
import { comparePassword, hashPassword } from '../utils/crypto';
import { AppError } from '../middleware/errorHandler';
import type { UpdateProfileInput, ChangePasswordInput } from '../validators/profile.schema';

function buildUserResponse(row: Record<string, unknown>) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    preferences: row.preferences ?? null,
    email: row.email ?? null,
    preferredLanguage: row.preferred_language ?? 'en',
    enrollmentVersion: row.enrollment_version ?? 0,
    hasPassword: !!row.password_hash,
    avatar: row.avatar ?? null,
  };
}

export const profileController = {
  async get(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const row = await db('users')
        .select('id', 'username', 'display_name', 'role', 'is_active', 'created_at', 'updated_at', 'preferences', 'email', 'preferred_language', 'enrollment_version', 'password_hash', 'avatar')
        .where({ id: req.session.userId })
        .first();

      if (!row) throw new AppError(404, 'User not found');

      res.json({ success: true, data: buildUserResponse(row) });
    } catch (err) {
      next(err);
    }
  },

  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = req.body as UpdateProfileInput;

      const updatePayload: Record<string, unknown> = { updated_at: new Date() };

      if ('displayName' in data) updatePayload.display_name = data.displayName;
      if ('preferences' in data) {
        if (data.preferences === null || data.preferences === undefined) {
          updatePayload.preferences = null;
        } else {
          // Merge with existing preferences so partial updates don't
          // wipe other fields. Strip prototype-mutating keys before
          // the spread to defuse any
          // `{__proto__: {admin: true}}` payload — the merge target
          // is a plain object, so a normal spread would otherwise
          // attach to Object.prototype (Node treats `__proto__` as
          // setter on plain objects).
          const sanitise = (obj: any): Record<string, unknown> => {
            if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
            const out: Record<string, unknown> = Object.create(null);
            for (const [k, v] of Object.entries(obj)) {
              if (k === '__proto__' || k === 'prototype' || k === 'constructor') continue;
              out[k] = v;
            }
            return out;
          };
          const currentRow = await db('users').select('preferences').where({ id: req.session.userId }).first();
          const existing = currentRow?.preferences
            ? (typeof currentRow.preferences === 'string' ? JSON.parse(currentRow.preferences) : currentRow.preferences)
            : {};
          const merged = { ...sanitise(existing), ...sanitise(data.preferences) };
          // Cap size: 100 KB is more than enough for user prefs and
          // protects the row from being weaponised as DB bloat.
          const json = JSON.stringify(merged);
          if (json.length > 100_000) {
            throw new AppError(400, 'Preferences payload exceeds 100 KB limit');
          }
          updatePayload.preferences = json;
        }
      }
      if ('email' in data) updatePayload.email = data.email || null;
      if ('preferredLanguage' in data) updatePayload.preferred_language = data.preferredLanguage;

      // If email changes and email OTP is enabled, disable it for security
      if ('email' in data && data.email) {
        const current = await db('users').select('email', 'email_otp_enabled').where({ id: req.session.userId }).first();
        if (current?.email_otp_enabled && current.email !== data.email) {
          updatePayload.email_otp_enabled = false;
        }
      }

      const [row] = await db('users')
        .where({ id: req.session.userId })
        .update(updatePayload)
        .returning(['id', 'username', 'display_name', 'role', 'is_active', 'created_at', 'updated_at', 'preferences', 'email', 'preferred_language', 'enrollment_version']);

      if (!row) throw new AppError(404, 'User not found');

      res.json({ success: true, data: buildUserResponse(row) });
    } catch (err) {
      next(err);
    }
  },

  async changePassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { currentPassword, newPassword } = req.body as ChangePasswordInput;

      const user = await db('users').select('password_hash').where({ id: req.session.userId }).first();
      if (!user) throw new AppError(404, 'User not found');

      const valid = await comparePassword(currentPassword, user.password_hash);
      if (!valid) throw new AppError(400, 'Current password is incorrect');

      const newHash = await hashPassword(newPassword);
      await db('users').where({ id: req.session.userId }).update({ password_hash: newHash, updated_at: new Date() });

      res.json({ success: true, message: 'Password changed successfully' });
    } catch (err) {
      next(err);
    }
  },

  async uploadAvatar(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { avatar } = req.body as { avatar: string };
      if (!avatar || !avatar.startsWith('data:image/')) {
        throw new AppError(400, 'Invalid image data — must be a base64 data URI');
      }
      // Limit to ~500KB base64 (~375KB image)
      if (avatar.length > 500_000) {
        throw new AppError(400, 'Image too large — max 375KB');
      }

      await db('users').where({ id: req.session.userId }).update({ avatar, updated_at: new Date() });

      res.json({ success: true, avatar });
    } catch (err) {
      next(err);
    }
  },

  async deleteAvatar(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      await db('users').where({ id: req.session.userId }).update({ avatar: null, updated_at: new Date() });
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
};
