import { Router } from 'express';
import { networkDiscoveryService } from '../services/networkDiscovery.service';
import { requireRole } from '../middleware/rbac';

const router = Router();

// GET /api/network-discovery
// List discovered devices with optional filters.
router.get('/', async (req, res, next) => {
  try {
    const tenantId = req.tenantId!;
    const { isManaged, deviceType, subnet, page, limit } = req.query;

    const result = await networkDiscoveryService.list(tenantId, {
      isManaged: isManaged !== undefined ? isManaged === 'true' : undefined,
      deviceType: deviceType as string | undefined,
      subnet: subnet as string | undefined,
      page: page ? parseInt(page as string, 10) : undefined,
      limit: limit ? parseInt(limit as string, 10) : undefined,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/network-discovery/stats
// Aggregate stats for the dashboard.
router.get('/stats', async (req, res, next) => {
  try {
    const stats = await networkDiscoveryService.getStats(req.tenantId!);
    res.json(stats);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/network-discovery/:id
// Remove a single discovered device entry (admin only).
router.delete('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const deleted = await networkDiscoveryService.remove(
      parseInt(req.params.id, 10),
      req.tenantId!,
    );
    if (!deleted) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
