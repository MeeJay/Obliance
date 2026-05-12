import { Router } from 'express';
import { requireRole, requireAnyTenantCapability } from '../middleware/rbac';
import { listKeys, createKey, updateKey, deleteKey } from '../controllers/agent.controller';

const router = Router();

// GET    /api/agent/keys        — list API keys for the current tenant
// POST   /api/agent/keys        — create a new API key
// PUT    /api/agent/keys/:id    — update API key (name, default group)
// DELETE /api/agent/keys/:id    — revoke an API key
//
// GET is needed by the "Add agent" modal to populate the key picker —
// we accept either `agent_config:keys` (existing manage cap) or
// `agent_config:approval` (since approving agents naturally implies
// being able to enroll them too). CUD on keys stays admin-only —
// minting and revoking enrolment credentials is takeover-level.
router.get('/keys', requireAnyTenantCapability('agent_config:keys', 'agent_config:approval'), listKeys);
router.post('/keys',       requireRole('admin'), createKey);
router.put('/keys/:id',    requireRole('admin'), updateKey);
router.delete('/keys/:id', requireRole('admin'), deleteKey);

export default router;
