import { Router } from 'express';
import { requireRole } from '../middleware/rbac';
import { customSectionService } from '../services/customSection.service';
import { AppError } from '../middleware/errorHandler';

const router = Router();

// GET /api/custom-sections — list all sections in tenant (admin)
router.get('/', requireRole('admin'), async (req, res, next) => {
  try {
    const sections = await customSectionService.list(req.tenantId!);
    res.json({ data: sections });
  } catch (err) { next(err); }
});

// GET /api/custom-sections/:id
router.get('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const s = await customSectionService.getById(parseInt(req.params.id), req.tenantId!);
    if (!s) throw new AppError(404, 'Not found');
    res.json({ data: s });
  } catch (err) { next(err); }
});

// POST /api/custom-sections — create (admin only)
router.post('/', requireRole('admin'), async (req, res, next) => {
  try {
    const data = req.body as any;
    if (!data.name || !data.command) throw new AppError(400, 'name and command are required');
    const s = await customSectionService.create(req.tenantId!, data, req.session.userId!);
    res.status(201).json({ data: s });
  } catch (err) { next(err); }
});

// PATCH /api/custom-sections/:id
router.patch('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const s = await customSectionService.update(parseInt(req.params.id), req.tenantId!, req.body);
    if (!s) throw new AppError(404, 'Not found');
    res.json({ data: s });
  } catch (err) { next(err); }
});

// DELETE /api/custom-sections/:id
router.delete('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    await customSectionService.delete(parseInt(req.params.id), req.tenantId!);
    res.json({ data: { success: true } });
  } catch (err) { next(err); }
});

export default router;
