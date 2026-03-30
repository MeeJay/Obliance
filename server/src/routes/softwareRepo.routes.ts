import { Router } from 'express';
import multer from 'multer';
import { softwareRepoService } from '../services/softwareRepo.service';
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
  } catch (err) { next(err); }
});

// DELETE /software-repo/packages/:id — delete (admin only)
router.delete('/packages/:id', requireRole('admin'), async (req, res, next) => {
  try {
    await softwareRepoService.delete(parseInt(req.params.id), req.tenantId!);
    res.status(204).send();
  } catch (err) { next(err); }
});

// GET /software-repo/packages/:uuid/download — download for UI preview
router.get('/packages/:uuid/download', async (req, res, next) => {
  try {
    const result = await softwareRepoService.getFilePath(req.params.uuid, req.tenantId!);
    if (!result) return res.status(404).json({ error: 'Package not found' });
    res.set('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.set('Content-Type', result.mimeType);
    res.sendFile(result.filePath);
  } catch (err) { next(err); }
});

export default router;
