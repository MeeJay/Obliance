import { Router } from 'express';
import { cveService } from '../services/cve.service';
import { requireRole, requireDeviceRead, requireTenantCapability } from '../middleware/rbac';
import { permissionService } from '../services/permission.service';

const router = Router();

// Every CVE endpoint is gated on the `cve:read` capability. Admins
// bypass via the role check inside requireTenantCapability; non-admin
// users must have the capability explicitly granted via the
// PermissionSets matrix. Write actions (sync / rescan / dismiss)
// stay admin-only on top of that.
router.use(requireTenantCapability('cve:read'));

// GET /api/cves — aggregated fleet view. One row per CVE with affected
// device counts split by match confidence. Tenant-scoped (master sees
// all). Mirrors /api/updates/aggregated.
router.get('/', async (req, res, next) => {
  try {
    const { severity, kevOnly, search, page, pageSize } = req.query as any;
    const result = await cveService.getAggregatedCves(req.tenantId!, {
      severity,
      kevOnly: kevOnly === 'true' || kevOnly === '1',
      search,
      page: page ? parseInt(page) : undefined,
      pageSize: pageSize ? parseInt(pageSize) : undefined,
    });
    res.json({ data: result });
  } catch (err) { next(err); }
});

// GET /api/cves/stats — header counters for the Security page tab.
router.get('/stats', async (req, res, next) => {
  try {
    const stats = await cveService.getStats(req.tenantId!);
    res.json({ data: stats });
  } catch (err) { next(err); }
});

// GET /api/cves/:cveId/devices — affected device list for the chosen CVE.
// `cveId` here is the cves.id primary key (not the public CVE-YYYY-NNNNN
// string) to match the way the aggregated list links back.
router.get('/:cveId/devices', async (req, res, next) => {
  try {
    const cveId = parseInt(req.params.cveId);
    let devices = await cveService.getCveAffectedDevices(req.tenantId!, cveId);

    // Non-admin users only see devices their team has access to.
    if (req.session.role !== 'admin') {
      const visibleIds = await permissionService.getVisibleDeviceIds(req.session.userId!, false);
      if (Array.isArray(visibleIds)) {
        const set = new Set(visibleIds);
        devices = devices.filter((d) => set.has(d.deviceId));
      }
    }
    res.json({ data: devices });
  } catch (err) { next(err); }
});

// GET /api/cves/device/:deviceId — per-device CVE list. Used on the
// device detail page Security section.
router.get('/device/:deviceId', requireDeviceRead('deviceId'), async (req, res, next) => {
  try {
    const cves = await cveService.getDeviceCves(parseInt(req.params.deviceId), req.tenantId!);
    res.json({ data: cves });
  } catch (err) { next(err); }
});

// POST /api/cves/device-cve/:id/dismiss — admin marks a single match as
// a false positive. Hidden from lists, preserved in the table so the
// matcher won't recreate it.
router.post('/device-cve/:id/dismiss', requireRole('admin'), async (req, res, next) => {
  try {
    const ok = await cveService.dismissDeviceCve(
      parseInt(req.params.id), req.tenantId!, req.session.userId!,
    );
    if (!ok) return res.status(404).json({ error: 'Match not found' });
    res.json({ data: { ok: true } });
  } catch (err) { next(err); }
});

// POST /api/cves/sync — manual trigger for the CISA KEV catalog sync.
// Admin-only since it hits an external endpoint and can be expensive on
// re-rescan if abused. The same routine is also scheduled by index.ts to
// run daily, this endpoint is for force-refresh.
//
// We surface the underlying error message to the client (not just a
// generic 500) so the admin can debug network / proxy issues without
// having to shell into the container for logs.
router.post('/sync', requireRole('admin'), async (_req, res) => {
  try {
    const result = await cveService.syncCisaKev();
    res.json({ data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'CVE sync failed';
    res.status(500).json({ error: msg });
  }
});

// POST /api/cves/rescan — re-match the entire fleet against the catalog.
// Master tenant triggers a fleet-wide rescan across all child tenants.
router.post('/rescan', requireRole('admin'), async (req, res, next) => {
  try {
    const result = await cveService.rescanFleet(req.tenantId!);
    res.json({ data: result });
  } catch (err) { next(err); }
});

export default router;
