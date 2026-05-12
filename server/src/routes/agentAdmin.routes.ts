import { Router } from 'express';
import { requireRole, requireAnyTenantCapability } from '../middleware/rbac';
import { listKeys, createKey, updateKey, deleteKey, agentInstallerWizard } from '../controllers/agent.controller';

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

// GET /api/agent/installer/wizard.exe[?keyId=N&server=URL] — streams the
// install wizard EXE with an optional pre-fill tail blob (server URL +
// API key). Sits under agentAdmin (requireAuth + requireTenant)
// because echoing back an API key needs the same gate as listing them.
// `requireAnyTenantCapability` matches the listKeys policy so the
// "Add agent" modal flow works for both API-key managers and
// device approvers.
router.get(
  '/installer/wizard.exe',
  requireAnyTenantCapability('agent_config:keys', 'agent_config:approval'),
  agentInstallerWizard,
);

export default router;
