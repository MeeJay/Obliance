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
          if (!keyRow) {
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
          if (!keyRow) { ws.close(4003, 'Invalid API key'); return; }
          const deviceUuid = request.headers['x-device-uuid'] as string | undefined;
          const device = deviceUuid
            ? await db('devices').where({ uuid: deviceUuid, tenant_id: keyRow.tenant_id }).first()
            : await db('devices').where({ api_key_id: keyRow.id }).first();
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
          if (!keyRow) { ws.close(4003, 'Invalid API key'); return; }
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

  // Self-healing: purge orphaned records from tables whose device no longer exists (every 4h)
  deviceService.cleanOrphans().catch(() => {}); // run once at startup
  setInterval(() => deviceService.cleanOrphans(), 4 * 60 * 60 * 1000);

  // Clean up stale remote sessions (waiting/connecting with no activity) every 2 min
  remoteService.cleanupStaleSessions();                                    // run once at startup
  setInterval(() => remoteService.cleanupStaleSessions(), 2 * 60 * 1000); // then every 2 min

  server.listen(config.port, () => {
    logger.info({ port: config.port, env: config.nodeEnv }, `Obliance RMM started`);

    // Sync preference schemas with Obligate (non-blocking)
    obligateService.syncPreferenceSchemas().catch(() => {});
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
  if (!existing) {
    const bcrypt = await import('bcrypt');
    const hash = await bcrypt.hash(config.defaultAdminPassword, 10);
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
}

main().catch((err) => {
  logger.error(err, 'Fatal error during startup');
  process.exit(1);
});
