import { Router, type Request, type Response } from 'express';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import os from 'os';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { db } from '../db';

const router = Router();

// GET /api/system — system info for the About section (admin only)
router.get('/', requireAuth, requireRole('admin'), async (_req: Request, res: Response) => {
  // App version from package.json (same logic as app.ts)
  let appVersion = 'dev';
  try {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8')) as { version: string };
    appVersion = pkg.version;
  } catch { /* ignore */ }

  // Agent version from VERSION file (injected into Docker image at build time)
  let agentVersion = 'unknown';
  const agentVersionFile = join(process.cwd(), '..', 'agent', 'VERSION');
  try {
    if (existsSync(agentVersionFile)) {
      agentVersion = readFileSync(agentVersionFile, 'utf-8').trim();
    }
  } catch { /* ignore */ }

  // Memory
  const mem = process.memoryUsage();
  const processRssMb   = Math.round(mem.rss      / 1024 / 1024 * 10) / 10;
  const processHeapMb  = Math.round(mem.heapUsed  / 1024 / 1024 * 10) / 10;
  const systemTotalMb  = Math.round(os.totalmem() / 1024 / 1024);
  const systemFreeMb   = Math.round(os.freemem()  / 1024 / 1024);

  // CPU
  const [load1, load5, load15] = os.loadavg();
  const cores = os.cpus().length;

  // Environment
  const isDocker = existsSync('/.dockerenv');
  const platform = os.platform();

  // Database health
  let dbStatus: 'ok' | 'error' = 'error';
  try {
    await db.raw('SELECT 1');
    dbStatus = 'ok';
  } catch { /* ignore */ }

  res.json({
    appVersion,
    nodeVersion:   process.version,
    agentVersion,
    uptimeSeconds: Math.floor(process.uptime()),
    memory: { processRssMb, processHeapMb, systemTotalMb, systemFreeMb },
    cpu: {
      loadAvg1:  Math.round(load1  * 100) / 100,
      loadAvg5:  Math.round(load5  * 100) / 100,
      loadAvg15: Math.round(load15 * 100) / 100,
      cores,
    },
    environment: { isDocker, platform, dbStatus },
  });
});

export default router;
