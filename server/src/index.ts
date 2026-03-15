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

  // ── VNC WebSocket tunnel ──────────────────────────────────────────────────
  // socket.io/engine.io registers an upgrade handler that destroys sockets whose
  // path doesn't match "/socket.io/".  To safely handle VNC tunnel upgrades on
  // the same HTTP port we intercept ALL upgrade events, route /api/remote/*
  // paths to our own WS server, and forward everything else to socket.io's
  // original listeners.
  const vncWss = new WebSocketServer({ noServer: true });

  // Capture and remove the upgrade listeners socket.io just registered so we
  // can act as the sole dispatcher.
  const sioUpgradeListeners = server.rawListeners('upgrade').slice();
  server.removeAllListeners('upgrade');

  // Session-token pattern: 64 hex chars produced by crypto.randomBytes(32)
  const BROWSER_RE    = /^\/api\/remote\/tunnel\/([0-9a-f]{64})$/;
  const AGENT_RE      = /^\/api\/remote\/agent-tunnel\/([0-9a-f]{64})$/;
  const AGENT_CMD_RE  = /^\/api\/agent\/ws$/;

  server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;

    // ── Browser VNC viewer ──────────────────────────────────────────────────
    const browserMatch = BROWSER_RE.exec(pathname);
    if (browserMatch) {
      const sessionToken = browserMatch[1];
      vncWss.handleUpgrade(request, socket, head, async (ws: WebSocket) => {
        try {
          const session = await db('remote_sessions')
            .where({ session_token: sessionToken })
            .first();
          if (!session || session.status === 'closed') {
            ws.close(4004, 'Session not found or already closed');
            return;
          }
          remoteService.registerBrowserTunnel(sessionToken, ws);
          logger.info({ sessionToken }, 'Browser VNC tunnel connected');
        } catch (err) {
          logger.error(err, 'VNC browser tunnel setup error');
          ws.close(4000, 'Internal error');
        }
      });
      return; // handled — do NOT forward to socket.io
    }

    // ── Agent VNC tunnel ────────────────────────────────────────────────────
    const agentMatch = AGENT_RE.exec(pathname);
    if (agentMatch) {
      const sessionToken = agentMatch[1];
      const apiKey = request.headers['x-api-key'] as string | undefined;
      vncWss.handleUpgrade(request, socket, head, async (ws: WebSocket) => {
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
          logger.info({ sessionToken }, 'Agent VNC tunnel connected');
        } catch (err) {
          logger.error(err, 'VNC agent tunnel setup error');
          ws.close(4000, 'Internal error');
        }
      });
      return; // handled — do NOT forward to socket.io
    }

    // ── Agent command channel ───────────────────────────────────────────────
    if (AGENT_CMD_RE.test(pathname)) {
      const apiKey = request.headers['x-api-key'] as string | undefined;
      vncWss.handleUpgrade(request, socket, head, async (ws: WebSocket) => {
        try {
          if (!apiKey) { ws.close(4003, 'Missing X-Api-Key'); return; }
          const keyRow = await db('agent_api_keys').where({ key: apiKey, is_active: true }).first();
          if (!keyRow) { ws.close(4003, 'Invalid API key'); return; }
          const device = await db('devices').where({ api_key_id: keyRow.id }).first();
          if (!device) { ws.close(4004, 'Device not found'); return; }
          agentHub.register(device.id, device.tenant_id, ws);
        } catch (err) {
          logger.error(err, 'Agent command channel setup error');
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

  // Start inventory retention job (every 6h)
  setInterval(() => deviceService.pruneInventory(), 6 * 60 * 60 * 1000);

  // Clean up stale remote sessions (waiting/connecting with no activity) every 2 min
  remoteService.cleanupStaleSessions();                                    // run once at startup
  setInterval(() => remoteService.cleanupStaleSessions(), 2 * 60 * 1000); // then every 2 min

  server.listen(config.port, () => {
    logger.info({ port: config.port, env: config.nodeEnv }, `Obliance RMM started`);
  });

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down...');
    scheduleService.stop();
    vncWss.close();
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
