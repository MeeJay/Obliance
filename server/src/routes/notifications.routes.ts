import { Router } from 'express';
import { notificationsController } from '../controllers/notifications.controller';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import {
  createChannelSchema,
  updateChannelSchema,
  addBindingSchema,
  removeBindingSchema,
} from '../validators/notification.schema';

const router = Router();

router.use(requireAuth);
router.use(requireRole('admin'));

// Plugin info
router.get('/plugins', notificationsController.plugins);

// Channels CRUD
router.get('/channels', notificationsController.listChannels);
router.get('/channels/:id', notificationsController.getChannel);
router.post('/channels', validate(createChannelSchema), notificationsController.createChannel);
router.put('/channels/:id', validate(updateChannelSchema), notificationsController.updateChannel);
router.delete('/channels/:id', notificationsController.deleteChannel);
router.post('/channels/:id/test', notificationsController.testChannel);
router.get('/channels/:id/tenants', notificationsController.getChannelTenants);
router.put('/channels/:id/tenants', notificationsController.setChannelTenants);

// Bindings
router.get('/bindings/resolved', notificationsController.resolvedBindings);
router.get('/bindings', notificationsController.listBindings);
router.post('/bindings', validate(addBindingSchema), notificationsController.addBinding);
router.delete('/bindings', validate(removeBindingSchema), notificationsController.removeBinding);

export default router;
