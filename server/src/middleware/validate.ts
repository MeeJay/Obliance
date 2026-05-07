import type { Request, Response, NextFunction } from 'express';
import type { ZodSchema } from 'zod';

export function validate(schema: ZodSchema, source: 'body' | 'query' | 'params' = 'body') {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      // Flatten the Zod issue tree into a single human-readable summary
      // so admins get "permissions.0.capabilities: Invalid enum value"
      // in their UI toast, instead of the opaque "Validation failed".
      // The structured `details` field is preserved for clients that
      // want to render per-field UI errors.
      const issues = result.error.errors.map((e) => {
        const path = e.path.length ? e.path.join('.') : '<root>';
        return `${path}: ${e.message}`;
      });
      res.status(400).json({
        success: false,
        error: issues.length > 0 ? `Validation failed — ${issues.join('; ')}` : 'Validation failed',
        details: result.error.flatten().fieldErrors,
      });
      return;
    }

    req[source] = result.data;
    next();
  };
}
