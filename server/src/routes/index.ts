import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireTenant } from '../middleware/tenant';

// Route imports
import authRoutes from './auth.routes';
import twoFactorRoutes from './twoFactor.routes';
import ssoRoutes from './sso.routes';
import oblitoolsRoutes from './oblitools.routes';
import profileRoutes from './profile.routes';
import tenantRoutes from './tenant.routes';
import usersRoutes from './users.routes';
import teamsRoutes from './teams.routes';
import groupsRoutes from './groups.routes';
import settingsRoutes from './settings.routes';
import notificationsRoutes from './notifications.routes';
import maintenanceRoutes from './maintenance.routes';
import { liveAlertRouter as liveAlertsRoutes } from './liveAlert.routes';
import adminRoutes from './appConfig.routes';
import smtpRoutes from './smtpServer.routes';

// RMM core routes
import deviceRoutes from './device.routes';
import commandRoutes from './command.routes';
import inventoryRoutes from './inventory.routes';
import scriptRoutes from './script.routes';
import scheduleRoutes from './schedule.routes';
import executionRoutes from './execution.routes';
import updateRoutes from './update.routes';
import complianceRoutes from './compliance.routes';
import remoteRoutes from './remote.routes';
import reportRoutes from './report.routes';
import agentRoutes from './agent.routes';
import agentAdminRoutes from './agentAdmin.routes';
import oblianceRoutes from './obliance.routes';
import obliviewRoutes from './obliview.routes';
import obliguardRoutes from './obliguard.routes';
import oblimapRoutes from './oblimap.routes';
import systemRoutes from './system.routes';
import obliReachAgentRoutes, { obliReachDevicesRouter } from './oblireach-agent.routes';
import reachRoutes from './reach.routes';
import processRoutes from './process.routes';

const router = Router();

// ── Public / auth ────────────────────────────────────────────────────────────
router.use('/auth', authRoutes);
router.use('/sso', ssoRoutes);           // cross-app SSO (generate-token, validate-token, exchange, users)
router.use('/oblitools', oblitoolsRoutes); // ObliTools desktop manifest (auth required)
router.use('/agent', agentRoutes);       // agent push endpoint (uses agentAuth middleware internally)
router.use('/oblireach', obliReachAgentRoutes); // Oblireach agent push (agentAuth)
router.use('/obliance', oblianceRoutes);    // cross-app link endpoint (Bearer auth)
router.use('/obliview', obliviewRoutes);   // proxy to Obliview
router.use('/system', systemRoutes);       // system info / about (admin only, no tenant required)
router.use('/obliguard', obliguardRoutes); // proxy to Obliguard
router.use('/oblimap', oblimapRoutes);     // proxy to Oblimap

// ── Authenticated, no tenant required ───────────────────────────────────────
router.use('/profile/2fa', twoFactorRoutes); // must be before /profile (auth handled inside twoFactorRoutes)
router.use('/profile', requireAuth, profileRoutes);
router.use('/tenants', requireAuth, tenantRoutes);
router.use('/tenant', requireAuth, tenantRoutes);
router.use('/live-alerts', requireAuth, liveAlertsRoutes);

// ── Authenticated + tenant scoped ────────────────────────────────────────────
const tenantRouter = Router();
tenantRouter.use(requireAuth, requireTenant);

tenantRouter.use('/devices',     deviceRoutes);
tenantRouter.use('/commands',    commandRoutes);
tenantRouter.use('/inventory',   inventoryRoutes);
tenantRouter.use('/scripts',     scriptRoutes);
tenantRouter.use('/schedules',   scheduleRoutes);
tenantRouter.use('/executions',  executionRoutes);
tenantRouter.use('/updates',     updateRoutes);
tenantRouter.use('/compliance',  complianceRoutes);
tenantRouter.use('/remote',      remoteRoutes);
tenantRouter.use('/reports',     reportRoutes);
tenantRouter.use('/groups',      groupsRoutes);
tenantRouter.use('/settings',    settingsRoutes);
tenantRouter.use('/notifications', notificationsRoutes);
tenantRouter.use('/users',       usersRoutes);
tenantRouter.use('/teams',       teamsRoutes);
tenantRouter.use('/maintenance', maintenanceRoutes);
tenantRouter.use('/admin/config', adminRoutes);
tenantRouter.use('/admin/smtp-servers', smtpRoutes);
tenantRouter.use('/agent',       agentAdminRoutes);  // admin: API key management
tenantRouter.use('/oblireach/devices', obliReachDevicesRouter);
tenantRouter.use('/reach',           reachRoutes);        // Oblireach desktop client API
tenantRouter.use('/processes',      processRoutes);

router.use('/', tenantRouter);

export { router as routes };
