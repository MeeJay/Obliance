import { Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { config } from './config';
import { db } from './db';
import { logger } from './utils/logger';

let io: SocketIOServer;

export function createSocketServer(server: HttpServer): SocketIOServer {
  io = new SocketIOServer(server, {
    cors: {
      origin: config.clientOrigin,
      credentials: true,
    },
  });

  // Authentication middleware
  io.use(async (socket, next) => {
    const { userId, tenantId } = socket.handshake.auth;
    if (!userId) return next(new Error('Unauthorized'));
    const user = await db('users').where({ id: userId, is_active: true }).first();
    if (!user) return next(new Error('Unauthorized'));
    (socket as any).user = user;
    (socket as any).tenantId = tenantId;
    next();
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

    socket.on('disconnect', () => {
      logger.debug({ userId: user.id }, 'Socket disconnected');
    });
  });

  return io;
}

export function getIO(): SocketIOServer {
  if (!io) throw new Error('Socket.io not initialized');
  return io;
}
