import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireTenant } from '../middleware/tenant';
import * as ctrl from '../controllers/liveAlert.controller';

export const liveAlertRouter = Router();

// All tenants accessible by this user (no requireTenant — cross-tenant)
liveAlertRouter.get('/all', requireAuth, ctrl.getAllTenantAlerts);

// Current-tenant endpoints
liveAlertRouter.get('/', requireAuth, requireTenant, ctrl.getAlerts);
liveAlertRouter.post('/read-all', requireAuth, requireTenant, ctrl.markAllRead);
liveAlertRouter.delete('/', requireAuth, requireTenant, ctrl.clearAll);

// Cross-tenant by alert id (ownership verified inside controller)
liveAlertRouter.patch('/:id/read', requireAuth, ctrl.markRead);
liveAlertRouter.delete('/:id', requireAuth, ctrl.deleteAlert);
