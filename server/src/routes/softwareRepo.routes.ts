import { Router } from 'express';
import multer from 'multer';
import { softwareRepoService, RepoError } from '../services/softwareRepo.service';
import { requireRole } from '../middleware/rbac';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });

// GET /software-repo/packages — list all packages for tenant
router.get('/packages', async (req, res, next) => {
  try {
    const packages = await softwareRepoService.list(req.tenantId!);
    res.json({ data: packages });
  } catch (err) { next(err); }
});

// GET /software-repo/settings — depot state, quota + live usage, key prefix
router.get('/settings', async (req, res, next) => {
  try {
    const settings = await softwareRepoService.getSettings(req.tenantId!);
    res.json({ data: settings });
  } catch (err) { next(err); }
});

// PUT /software-repo/settings — enable/disable + quota (admin only).
// A platform admin sitting on the master tenant edits child tenants by
// switching into them, exactly like the metric-threshold defaults.
router.put('/settings', requireRole('admin'), async (req, res, next) => {
  try {
    const { enabled, quotaBytes } = req.body as { enabled?: boolean; quotaBytes?: number | null };
    const settings = await softwareRepoService.updateSettings(req.tenantId!, { enabled, quotaBytes });
    res.json({ data: settings });
  } catch (err) { next(err); }
});

// POST /software-repo/access-key — (re)generate the tenant script key (admin).
// Returns the plaintext ONCE; only the hash is persisted.
router.post('/access-key', requireRole('admin'), async (req, res, next) => {
  try {
    const result = await softwareRepoService.generateAccessKey(req.tenantId!);
    res.status(201).json({ data: result });
  } catch (err) { next(err); }
});

// DELETE /software-repo/access-key — revoke the tenant script key (admin)
router.delete('/access-key', requireRole('admin'), async (req, res, next) => {
  try {
    await softwareRepoService.revokeAccessKey(req.tenantId!);
    res.status(204).send();
  } catch (err) { next(err); }
});

// POST /software-repo/packages — upload (admin only)
router.post('/packages', requireRole('admin'), upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const platform = (req.body.platform || 'windows') as 'windows' | 'linux' | 'macos';
    const displayName = req.body.displayName || null;
    const pkg = await softwareRepoService.upload(
      req.tenantId!, req.file as any, platform, displayName, req.session.userId!,
    );
    res.status(201).json({ data: pkg });
  } catch (err) {
    // Surface precise HTTP codes for quota/disabled/type errors.
    if (err instanceof RepoError) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// DELETE /software-repo/packages/:id — delete (admin only)
router.delete('/packages/:id', requireRole('admin'), async (req, res, next) => {
  try {
    await softwareRepoService.delete(parseInt(req.params.id), req.tenantId!);
    res.status(204).send();
  } catch (err) { next(err); }
});

// GET /software-repo/packages/:uuid/download — download for UI preview.
// Blocked when the depot is disabled for the tenant.
router.get('/packages/:uuid/download', async (req, res, next) => {
  try {
    await softwareRepoService.assertEnabled(req.tenantId!);
    const result = await softwareRepoService.getFilePath(req.params.uuid, req.tenantId!);
    if (!result) return res.status(404).json({ error: 'Package not found' });
    res.set('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.set('Content-Type', result.mimeType);
    res.sendFile(result.filePath);
  } catch (err) {
    if (err instanceof RepoError) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

export default router;
