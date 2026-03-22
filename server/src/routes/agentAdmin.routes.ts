import { Router } from 'express';
import { requireRole } from '../middleware/rbac';
import { listKeys, createKey, updateKey, deleteKey } from '../controllers/agent.controller';

const router = Router();

// GET    /api/agent/keys        — list API keys for the current tenant
// POST   /api/agent/keys        — create a new API key
// PUT    /api/agent/keys/:id    — update API key (name, default group)
// DELETE /api/agent/keys/:id    — revoke an API key
router.get('/keys',        requireRole('admin'), listKeys);
router.post('/keys',       requireRole('admin'), createKey);
router.put('/keys/:id',    requireRole('admin'), updateKey);
router.delete('/keys/:id', requireRole('admin'), deleteKey);

export default router;
