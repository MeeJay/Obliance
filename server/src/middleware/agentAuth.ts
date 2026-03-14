import { Request, Response, NextFunction } from 'express';
import { db } from '../db';
import { AppError } from './errorHandler';

declare global {
  namespace Express {
    interface Request {
      agentApiKeyId?: number;
      agentTenantId?: number;
    }
  }
}

export async function agentAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const apiKey = req.headers['x-api-key'] as string;
    if (!apiKey) throw new AppError(401, 'Missing API key');

    const keyRow = await db('agent_api_keys').where({ key: apiKey }).first();
    if (!keyRow) throw new AppError(401, 'Invalid API key');

    req.agentApiKeyId = keyRow.id;
    req.agentTenantId = keyRow.tenant_id;

    // Update last_used_at async (fire and forget)
    db('agent_api_keys')
      .where({ id: keyRow.id })
      .update({ last_used_at: new Date() })
      .catch(() => {});

    next();
  } catch (err) {
    next(err);
  }
}
