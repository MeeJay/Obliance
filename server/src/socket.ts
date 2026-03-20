import { Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { config } from './config';
import { db } from './db';
import { logger } from './utils/logger';
import { SocketEvents } from '@obliance/shared';
import { processService } from './services/process.service';

let io: SocketIOServer;

export function createSocketServer(server: HttpServer): SocketIOServer {
  io = new SocketIOServer(server, {
    cors: {
      origin: config.clientOrigin,
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  // Authentication middleware
  io.use(async (socket, next) => {
    try {
      const { userId, tenantId } = socket.handshake.auth;
      if (!userId) return next(new Error('Unauthorized'));
      const user = await db('users').where({ id: userId, is_active: true }).first();
      if (!user) return next(new Error('Unauthorized'));
      (socket as any).user = user;
      (socket as any).tenantId = tenantId;
      next();
    } catch (err) {
      logger.error(err, 'Socket auth error');
      next(new Error('Authentication failed'));
    }
  });

  io.on('connection', (socket) => {
    const user = (socket as any).user;
    const tenantId = (socket as any).tenantId;

    // Join rooms
    socket.join(`user:${user.id}`);
    if (tenantId) {
      socket.join(`tenant:${tenantId}`);
      socket.join(`tenant:${tenantId}:notifications`);
      if (user.role === 'admin') {
        socket.join(`tenant:${tenantId}:admin`);
        socket.join('role:admin');
      }
    }
    socket.join('general');

    // Join all accessible tenant rooms (for multi-tenant live alerts)
    db('user_tenants').where({ user_id: user.id }).then((memberships) => {
      for (const m of memberships) {
        socket.join(`tenant:${m.tenant_id}:notifications`);
      }
    }).catch(() => {});

    logger.debug({ userId: user.id, tenantId }, 'Socket connected');

    // Process list subscriptions
    socket.on(SocketEvents.PROCESS_SUBSCRIBE, (payload: { deviceId: number }) => {
      if (payload?.deviceId && tenantId) {
        processService.subscribe(payload.deviceId, tenantId, socket.id);
      }
    });
    socket.on(SocketEvents.PROCESS_UNSUBSCRIBE, (payload: { deviceId: number }) => {
      if (payload?.deviceId) {
        processService.unsubscribe(payload.deviceId, socket.id);
      }
    });

    socket.on('disconnect', () => {
      processService.removeSocket(socket.id);
      logger.debug({ userId: user.id }, 'Socket disconnected');
    });
  });

  return io;
}

export function getIO(): SocketIOServer {
  if (!io) throw new Error('Socket.io not initialized');
  return io;
}
