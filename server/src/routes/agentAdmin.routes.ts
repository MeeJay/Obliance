import { Router } from 'express';
import { requireRole } from '../middleware/rbac';
import { listKeys, createKey, deleteKey } from '../controllers/agent.controller';

const router = Router();

// GET  /api/agent/keys        — list API keys for the current tenant
// POST /api/agent/keys        — create a new API key
// DELETE /api/agent/keys/:id  — revoke an API key
router.get('/keys',     requireRole('admin'), listKeys);
router.post('/keys',    requireRole('admin'), createKey);
router.delete('/keys/:id', requireRole('admin'), deleteKey);

export default router;
