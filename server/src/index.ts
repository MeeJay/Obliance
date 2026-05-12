import './env';
import http from 'http';
import type { IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import { config } from './config';
import { db } from './db';
import { createApp } from './app';
import { createSocketServer } from './socket';
import { logger } from './utils/logger';
import { deviceService } from './services/device.service';
import { setLiveAlertIO } from './services/liveAlert.service';
import { scheduleService } from './services/schedule.service';
import { commandService } from './services/command.service';
import { remoteService } from './services/remote.service';
import { agentHub } from './services/agentHub.service';
import { oblireachHub } from './services/oblireachHub.service';
import { obligateService } from './services/obligate.service';

async function main() {
  // Run database migrations
  logger.info('Running database migrations...');
  await db.migrate.latest();
  logger.info('Migrations complete');

  // Ensure default admin exists
  await ensureDefaultAdmin();

  // Create Express app and HTTP server
  const app = createApp();
  const server = http.createServer(app);

  // Attach Socket.io — this registers its own 'upgrade' listener on `server`
  const io = createSocketServer(server);

  // ── Remote tunnel WebSocket ──────────────────────────────────────────────
  // socket.io/engine.io registers an upgrade handler that destroys sockets whose
  // path doesn't match "/socket.io/".  To safely handle tunnel upgrades on
  // the same HTTP port we intercept ALL upgrade events, route /api/remote/*
  // paths to our own WS server, and forward everything else to socket.io's
  // original listeners.
  const remoteWss = new WebSocketServer({ noServer: true, maxPayload: 150 * 1024 * 1024 });

  // Capture and remove the upgrade listeners socket.io just registered so we
  // can act as the sole dispatcher.
  const sioUpgradeListeners = server.rawListeners('upgrade').slice();
  server.removeAllListeners('upgrade');

  // Session-token pattern: 64 hex chars produced by crypto.randomBytes(32)
  const BROWSER_RE    = /^\/api\/remote\/tunnel\/([0-9a-f]{64})$/;
  const AGENT_RE      = /^\/api\/remote\/agent-tunnel\/([0-9a-f]{64})$/;
  const AGENT_CMD_RE       = /^\/api\/agent\/ws$/;
  const OBLIREACH_CMD_RE   = /^\/api\/oblireach\/ws$/;

  server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;

    // ── Browser remote tunnel ──────────────────────────────────────────────
    const browserMatch = BROWSER_RE.exec(pathname);
    if (browserMatch) {
      const sessionToken = browserMatch[1];
      remoteWss.handleUpgrade(request, socket, head, async (ws: WebSocket) => {
        try {
          const session = await db('remote_sessions')
            .where({ session_token: sessionToken })
            .first();
          if (!session || session.status === 'closed') {
            ws.close(4004, 'Session not found or already closed');
            return;
          }
          remoteService.registerBrowserTunnel(sessionToken, ws);
          logger.info({ sessionToken }, 'Browser remote tunnel connected');
        } catch (err) {
          logger.error(err, 'Browser remote tunnel setup error');
          ws.close(4000, 'Internal error');
        }
      });
      return; // handled — do NOT forward to socket.io
    }

    // ── Agent remote tunnel ────────────────────────────────────────────────
    const agentMatch = AGENT_RE.exec(pathname);
    if (agentMatch) {
      const sessionToken = agentMatch[1];
      const apiKey = request.headers['x-api-key'] as string | undefined;
      remoteWss.handleUpgrade(request, socket, head, async (ws: WebSocket) => {
        try {
          if (!apiKey) {
            ws.close(4003, 'Missing X-Api-Key header');
            return;
          }
          const keyRow = await db('agent_api_keys').where({ key: apiKey }).first();
          if (!keyRow || keyRow.is_active === false) {
            ws.close(4003, 'Invalid API key');
            return;
          }
          const session = await db('remote_sessions')
            .where({ session_token: sessionToken })
            .first();
          if (!session) {
            ws.close(4004, 'Session not found');
            return;
          }
          remoteService.registerAgentTunnel(sessionToken, ws);
          logger.info({ sessionToken }, 'Agent remote tunnel connected');
        } catch (err) {
          logger.error(err, 'Agent remote tunnel setup error');
          ws.close(4000, 'Internal error');
        }
      });
      return; // handled — do NOT forward to socket.io
    }

    // ── Agent command channel ───────────────────────────────────────────────
    if (AGENT_CMD_RE.test(pathname)) {
      const apiKey = request.headers['x-api-key'] as string | undefined;
      remoteWss.handleUpgrade(request, socket, head, async (ws: WebSocket) => {
        try {
          if (!apiKey) { ws.close(4003, 'Missing X-Api-Key'); return; }
          // Note: no is_active check here — matches agentAuth middleware which also omits it.
          // is_active may be NULL on older keys; requiring true would silently block WS while
          // HTTP push (which uses agentAuth) succeeds — causing the agent to reconnect every 10s.
          const keyRow = await db('agent_api_keys').where({ key: apiKey }).first();
          if (!keyRow || keyRow.is_active === false) { ws.close(4003, 'Invalid API key'); return; }
          const deviceUuid = request.headers['x-device-uuid'] as string | undefined;
          let device = deviceUuid
            ? await db('devices').where({ uuid: deviceUuid, tenant_id: keyRow.tenant_id }).first()
            : await db('devices').where({ api_key_id: keyRow.id }).first();

          // SECURITY: if a device row exists but was registered with a
          // DIFFERENT api_key_id, the agent is presenting a UUID it
          // doesn't own. Treat as auth failure rather than silently
          // letting a foreign key claim the device. (The previous
          // behaviour would have re-attached the device to whichever
          // key talked to it last — an attacker who knew a target
          // device's UUID + had any valid API key in the same tenant
          // could intercept its command channel.)
          if (device && device.api_key_id != null && device.api_key_id !== keyRow.id) {
            ws.close(4003, 'Device/API-key mismatch');
            return;
          }

          // No device row yet — this can happen if the WS channel reaches the
          // server before the first HTTP push (fresh install, flaky HTTP, HTTPS
          // misconfig on an HTTP-only agent, etc.). Auto-register a minimal
          // pending row here so the device actually appears in the admin UI
          // for approval rather than silently spinning on 4004 forever.
          // Subsequent HTTP pushes will fill in hostname, OS, metrics.
          if (!device && deviceUuid) {
            const { deviceId } = await deviceService.registerDevice({
              uuid: deviceUuid,
              hostname: deviceUuid,
              osType: 'other',
              apiKeyId: keyRow.id,
              tenantId: keyRow.tenant_id,
            });
            device = await db('devices').where({ id: deviceId }).first();
            logger.info({ deviceId, uuid: deviceUuid }, 'Auto-registered device via WS channel');
          }

          if (!device) { ws.close(4004, 'Device not found'); return; }
          const clientIp =
            (request.headers['x-forwarded-for'] as string | undefined)?.split(',')[0].trim() ??
            request.socket.remoteAddress ??
            '';
          await agentHub.register(device.id, device.tenant_id, ws, keyRow.id, device.uuid, clientIp);
        } catch (err) {
          logger.error(err, 'Agent command channel setup error');
          ws.close(4000, 'Internal error');
        }
      });
      return; // handled — do NOT forward to socket.io
    }

    // ── Oblireach agent command channel ────────────────────────────────────
    if (OBLIREACH_CMD_RE.test(pathname)) {
      const apiKey  = request.headers['x-api-key'] as string | undefined;
      const reqUrl  = new URL(request.url ?? '/', 'http://localhost');
      const devUuid = reqUrl.searchParams.get('uuid');
      remoteWss.handleUpgrade(request, socket, head, async (ws: WebSocket) => {
        try {
          if (!apiKey)  { ws.close(4003, 'Missing X-Api-Key'); return; }
          if (!devUuid) { ws.close(4000, 'Missing uuid query param'); return; }
          // No is_active check — matches agentAuth middleware (is_active may be NULL on older keys).
          const keyRow = await db('agent_api_keys').where({ key: apiKey }).first();
          if (!keyRow || keyRow.is_active === false) { ws.close(4003, 'Invalid API key'); return; }
          await oblireachHub.register(devUuid, keyRow.tenant_id, ws);
        } catch (err) {
          logger.error(err, 'ObliReach command channel setup error');
          ws.close(4000, 'Internal error');
        }
      });
      return; // handled — do NOT forward to socket.io
    }

    // ── Everything else → forward to socket.io's original listeners ─────────
    for (const listener of sioUpgradeListeners) {
      (listener as (...args: unknown[]) => void).call(server, request, socket, head);
    }
  });
  // ─────────────────────────────────────────────────────────────────────────

  // Initialize services that need the io instance
  deviceService.setIO(io);
  setLiveAlertIO(io);

  // Start background jobs
  scheduleService.start();    // Script scheduler + catch-up
  commandService.startCleanupJob();  // Expire timed-out commands

  // Start device offline detection job (every 30s)
  setInterval(() => deviceService.checkOfflineDevices(), 30_000);

  // Expire pending_uninstall devices whose 10-min timer has elapsed (every 30s)
  setInterval(() => deviceService.expireUninstalls(), 30_000);

  // Start inventory retention job (every 6h)
  setInterval(() => deviceService.pruneInventory(), 6 * 60 * 60 * 1000);

  // Daily fleet snapshot for the dashboard hero deltas + timeseries chart.
  // Run once on boot (idempotent via onConflict merge) so a fresh deploy has
  // a "today" row right away, then every 24h. The chart synthesises today's
  // live point regardless, so the cadence isn't user-visible.
  deviceService.snapshotFleetDaily().catch(() => {});
  setInterval(() => deviceService.snapshotFleetDaily(), 24 * 60 * 60 * 1000);

  // Hourly fleet snapshot — feeds the 24h "Activité du parc" view. Run once
  // on boot (so the dashboard has at least 1 historical point right away)
  // and every hour after that. Retention is handled by the job itself
  // (7 days of hourly history, kept ~168 rows per tenant max).
  deviceService.snapshotFleetHourly().catch(() => {});
  setInterval(() => deviceService.snapshotFleetHourly(), 60 * 60 * 1000);

  // Self-healing: purge orphaned records from tables whose device no longer exists (every 4h)
  deviceService.cleanOrphans().catch(() => {}); // run once at startup
  setInterval(() => deviceService.cleanOrphans(), 4 * 60 * 60 * 1000);

  // Clean up stale remote sessions (waiting/connecting with no activity) every 2 min
  remoteService.cleanupStaleSessions();                                    // run once at startup
  setInterval(() => remoteService.cleanupStaleSessions(), 2 * 60 * 1000); // then every 2 min

  // Sync built-in preset rules to existing policies (auto-update on deploy)
  const { complianceService } = require('./services/compliance.service');
  complianceService.syncPresetsToExistingPolicies()
    .then((n: number) => { if (n > 0) logger.info({ synced: n }, 'Compliance presets synced to existing policies'); })
    .catch(() => {});

  // Scheduled compliance checks — every 6h, skip devices checked within the window
  const COMPLIANCE_INTERVAL = 6 * 60 * 60 * 1000;
  setTimeout(() => complianceService.runScheduledChecks(COMPLIANCE_INTERVAL).catch(() => {}), 60_000); // first run 1 min after startup
  setInterval(() => complianceService.runScheduledChecks(COMPLIANCE_INTERVAL).catch(() => {}), COMPLIANCE_INTERVAL);

  // Scheduled software compliance checks — every 6h, same pattern
  const { softwareComplianceService } = require('./services/softwareCompliance.service');
  const SW_COMPLIANCE_INTERVAL = 6 * 60 * 60 * 1000;
  setTimeout(() => softwareComplianceService.runScheduledChecks(SW_COMPLIANCE_INTERVAL).catch(() => {}), 90_000); // first run 1.5 min after startup
  setInterval(() => softwareComplianceService.runScheduledChecks(SW_COMPLIANCE_INTERVAL).catch(() => {}), SW_COMPLIANCE_INTERVAL);

  // ── Scenarios v2 — boot migration + cron tick ──────────────────────────
  // Convert any leftover v1 (steps-based) scenarios to the new graph
  // model, then start a per-minute tick that fires schedule_cron triggers.
  // Both run with an exception barrier so a single broken scenario
  // doesn't take the boot down.
  (async () => {
    try {
      const { migrateAllV1Scenarios } = await import('./services/scenarioMigrate.service');
      await migrateAllV1Scenarios();
    } catch (err) { logger.error(err, 'Scenarios v2 boot migration failed'); }
    try {
      const { scenarioGraphCron } = await import('./services/scenarioGraphCron.service');
      scenarioGraphCron.start();
    } catch (err) { logger.error(err, 'Scenarios v2 cron scheduler failed to start'); }
    try {
      const { rearmWaitTimersOnBoot } = await import('./services/scenarioGraph.service');
      await rearmWaitTimersOnBoot();
    } catch (err) { logger.error(err, 'Scenarios v2 wait timer rearm failed'); }
  })();

  server.listen(config.port, () => {
    logger.info({ port: config.port, env: config.nodeEnv }, `Obliance RMM started`);

    // Sync preference schemas with Obligate (non-blocking)
    obligateService.syncPreferenceSchemas().catch(() => {});
    // Capability schemas USED to be pushed to Obligate so admins could
    // tick per-user capability boxes from there. Dropped: capabilities
    // live entirely in Obliance now (role = what / team = where), and
    // pushing them to Obligate created confusing user-level toggles
    // that didn't map to anything on the Obliance side. Obligate-side
    // cleanup is handled separately.
  });

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down...');
    scheduleService.stop();
    remoteWss.close();
    server.close(() => {
      db.destroy();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

async function ensureDefaultAdmin() {
  const existing = await db('users').where({ username: config.defaultAdminUsername }).first();
  if (existing) return;

  // SECURITY: refuse to bootstrap with the canonical "admin / admin123"
  // pair. A first install MUST supply DEFAULT_ADMIN_PASSWORD via env;
  // otherwise we fail loud rather than create a publicly-known
  // backdoor account. Once an admin exists this function returns
  // early (above) so the env var is only checked on a fresh DB.
  const isWeakDefaultPassword = config.defaultAdminPassword === 'admin123' || config.defaultAdminPassword.length < 12;
  if (isWeakDefaultPassword) {
    logger.fatal(
      'Refusing to create the default admin with the built-in password. ' +
      'Set DEFAULT_ADMIN_PASSWORD to a value of at least 12 characters before starting the server.',
    );
    process.exit(1);
  }

  const bcrypt = await import('bcryptjs');
  const hash = await bcrypt.hash(config.defaultAdminPassword, 12);
  const [user] = await db('users').insert({
    username: config.defaultAdminUsername,
    password_hash: hash,
    display_name: 'Administrator',
    role: 'admin',
    is_active: true,
  }).returning('id');
  const userId = user?.id ?? user;
  // Ensure default tenant exists
  let tenant = await db('tenants').where({ id: 1 }).first();
  if (!tenant) {
    [tenant] = await db('tenants').insert({ name: 'Default', slug: 'default' }).returning('*');
  }
  await db('user_tenants').insert({ user_id: userId, tenant_id: 1, role: 'admin' }).onConflict(['user_id','tenant_id']).ignore();
  logger.info({ username: config.defaultAdminUsername }, 'Default admin created');
}

main().catch((err) => {
  logger.error(err, 'Fatal error during startup');
  process.exit(1);
});
