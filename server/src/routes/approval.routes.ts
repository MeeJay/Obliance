import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { approvalService } from '../services/approval.service';
import { AppError } from '../middleware/errorHandler';

const router = Router();

// All approval routes require admin role — only admins can request, review,
// or cancel destructive-action approvals.
router.use(requireAuth, requireRole('admin'));

// List pending (default) or all approvals for the tenant.
router.get('/', async (req, res, next) => {
  try {
    const includeResolved = req.query.includeResolved === 'true';
    const limit = Math.min(200, parseInt((req.query.limit as string) || '50'));
    const items = await approvalService.list(req.tenantId!, { includeResolved, limit });
    res.json({ data: items });
  } catch (err) { next(err); }
});

// Approve a pending request. Body: { reason?: string }
router.post('/:id/approve', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const approved = await approvalService.approve({
      tenantId: req.tenantId!,
      approvalId: id,
      reviewerId: req.session.userId!,
      reason: req.body?.reason,
    });
    res.json({ data: approved });
  } catch (err: any) {
    if (err.status) return next(new AppError(err.status, err.message));
    next(err);
  }
});

// Deny a pending request. Body: { reason?: string }
router.post('/:id/deny', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const denied = await approvalService.deny({
      tenantId: req.tenantId!,
      approvalId: id,
      reviewerId: req.session.userId!,
      reason: req.body?.reason,
    });
    res.json({ data: denied });
  } catch (err: any) {
    if (err.status) return next(new AppError(err.status, err.message));
    next(err);
  }
});

// Requester cancels their own pending request.
router.post('/:id/cancel', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const cancelled = await approvalService.cancel({
      tenantId: req.tenantId!,
      approvalId: id,
      userId: req.session.userId!,
    });
    res.json({ data: cancelled });
  } catch (err: any) {
    if (err.status) return next(new AppError(err.status, err.message));
    next(err);
  }
});

export default router;
