import { Router, type Request, type Response, type NextFunction } from 'express';
import { softwareRepoService, RepoError } from '../services/softwareRepo.service';

/**
 * Script-facing software-repository API. Unlike the session-authenticated
 * /api/software-repo routes (used by the UI), these endpoints authenticate
 * with a per-tenant access key so remediation / deployment scripts can pull
 * packages without a browser session.
 *
 *   Auth:  header  X-Repo-Key: <key>   (preferred)
 *          or query ?key=<key>          (fallback for dumb clients)
 *
 *   GET /api/repo/packages          → list the tenant's packages (metadata)
 *   GET /api/repo/download/:uuid    → stream a package file
 *
 * The key resolves the tenant; the depot must be enabled for that tenant,
 * otherwise every call 403s (disable = block upload AND download).
 */
const router = Router();

async function repoKeyAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const key = (req.headers['x-repo-key'] as string) || (req.query.key as string) || '';
    const tenantId = await softwareRepoService.resolveTenantByKey(key);
    if (!tenantId) return res.status(401).json({ error: 'Invalid or missing repository access key' });
    await softwareRepoService.assertEnabled(tenantId);
    (req as any).repoTenantId = tenantId;
    next();
  } catch (err) {
    if (err instanceof RepoError) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

router.get('/packages', repoKeyAuth, async (req, res, next) => {
  try {
    const tenantId = (req as any).repoTenantId as number;
    const packages = await softwareRepoService.list(tenantId);
    // Lean payload — no internal ids / uploader, just what a script needs.
    res.json({
      data: packages.map(p => ({
        uuid: p.uuid,
        filename: p.filename,
        displayName: p.displayName,
        platform: p.platform,
        fileSize: p.fileSize,
        fileHash: p.fileHash,
        createdAt: p.createdAt,
      })),
    });
  } catch (err) { next(err); }
});

router.get('/download/:uuid', repoKeyAuth, async (req, res, next) => {
  try {
    const tenantId = (req as any).repoTenantId as number;
    const result = await softwareRepoService.getFilePath(req.params.uuid, tenantId);
    if (!result) return res.status(404).json({ error: 'Package not found' });
    res.set('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.set('Content-Type', result.mimeType);
    res.sendFile(result.filePath);
  } catch (err) { next(err); }
});

export default router;
