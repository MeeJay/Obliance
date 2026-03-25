import { Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { config } from './config';
import { db } from './db';
import { logger } from './utils/logger';
import { SocketEvents } from '@obliance/shared';
import { processService } from './services/process.service';
import { fileExplorerService } from './services/fileExplorer.service';
import { permissionService } from './services/permission.service';
import { oblireachHub } from './services/oblireachHub.service';
import crypto from 'crypto';

let io: SocketIOServer;

export function createSocketServer(server: HttpServer): SocketIOServer {
  io = new SocketIOServer(server, {
    cors: {
      // Reflect the request origin instead of a fixed string.
      // In production, nginx proxies everything (same-origin from the browser)
      // but WebSocket upgrades always send the Origin header (RFC 6455), so a
      // fixed CLIENT_ORIGIN that doesn't include the port (e.g. "http://localhost"
      // vs "http://localhost:3003") silently breaks the handshake.
      // Auth is enforced by the io.use() middleware below, not by CORS.
      origin: true,
      credentials: true,
    },
    transports: ['websocket', 'polling'],
    maxHttpBufferSize: 150 * 1024 * 1024, // 150 MB for file explorer uploads (base64)
  });

  // Authentication middleware — validate user + tenant membership
  io.use(async (socket, next) => {
    try {
      const { userId, tenantId } = socket.handshake.auth;
      if (!userId) return next(new Error('Unauthorized'));

      const user = await db('users').where({ id: userId, is_active: true }).first();
      if (!user) return next(new Error('Unauthorized'));

      // Validate tenant membership — prevent cross-tenant spoofing
      if (tenantId) {
        const membership = await db('user_tenants')
          .where({ user_id: user.id, tenant_id: tenantId })
          .first();
        if (!membership) return next(new Error('Unauthorized — not a member of this tenant'));
      }

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
    const isAdmin = user.role === 'admin';

    // Join rooms
    socket.join(`user:${user.id}`);
    if (tenantId) {
      socket.join(`tenant:${tenantId}`);
      socket.join(`tenant:${tenantId}:notifications`);
      if (isAdmin) {
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

    // ── Helper: verify device belongs to tenant ─────────────────────────────
    const verifyDevice = async (deviceId: number): Promise<boolean> => {
      if (!tenantId) return false;
      const device = await db('devices').where({ id: deviceId, tenant_id: tenantId }).first();
      return !!device;
    };

    // ── Process list subscriptions (with permission check) ──────────────────
    socket.on(SocketEvents.PROCESS_SUBSCRIBE, async (payload: { deviceId: number }) => {
      if (!payload?.deviceId || !tenantId) return;
      // Verify device belongs to tenant and user has read access
      if (!await verifyDevice(payload.deviceId)) return;
      if (!isAdmin) {
        const canRead = await permissionService.canReadDevice(user.id, payload.deviceId, false);
        if (!canRead) return;
      }
      processService.subscribe(payload.deviceId, tenantId, socket.id);
    });
    socket.on(SocketEvents.PROCESS_UNSUBSCRIBE, (payload: { deviceId: number }) => {
      if (payload?.deviceId) {
        processService.unsubscribe(payload.deviceId, socket.id);
      }
    });

    // ── File explorer commands (with permission check) ──────────────────────
    socket.on('FILE_EXPLORER_CMD', async (payload: { requestId?: string; deviceId: number; commandType: string; payload: Record<string, any>; audit?: any }) => {
      if (!payload?.deviceId || !payload?.commandType || !tenantId) return;
      // Verify device belongs to tenant
      if (!await verifyDevice(payload.deviceId)) return;
      // Check file explorer permission for non-admins
      if (!isAdmin) {
        const allowed = await permissionService.canUseCapability(user.id, payload.deviceId, false, 'files');
        if (!allowed) return;
      }
      const audit = payload.audit ? { ...payload.audit, userId: user.id } : undefined;
      await fileExplorerService.send(
        payload.deviceId, tenantId, socket.id,
        payload.commandType, payload.payload,
        audit,
        payload.requestId,
      );
    });

    // ── Chat (with tenant isolation) ────────────────────────────────────────
    socket.on('chat:open', async (payload: { deviceUuid: string; sessionId?: number; operatorName: string }, ack?: (res: any) => void) => {
      if (!payload?.deviceUuid || !tenantId) return;
      const chatId = crypto.randomBytes(8).toString('hex');
      // Tenant-scoped device lookup — prevents cross-tenant access
      const device = await db('devices').where({ uuid: payload.deviceUuid, tenant_id: tenantId }).first().catch(() => null);
      if (!device) { ack?.({ error: 'device not found' }); return; }

      // Look up operator's avatar
      const operatorUser = await db('users').where({ id: user.id }).first().catch(() => null);
      const operatorAvatar = operatorUser?.avatar || null;

      const cmd = {
        type: 'open_chat',
        id: `chat_${chatId}`,
        payload: {
          chatId,
          operatorName: payload.operatorName || user.displayName || user.username || 'Operator',
          operatorAvatar,
          sessionId: payload.sessionId,
        },
      };
      const delivered = oblireachHub.push(device.uuid, cmd);
      if (!delivered) { ack?.({ error: 'agent offline' }); return; }

      socket.join(`chat:${chatId}`);
      ack?.({ chatId });
      logger.info({ chatId, deviceUuid: payload.deviceUuid }, 'Chat session opened');
    });

    socket.on('chat:message', async (payload: { chatId: string; message: string; operatorName?: string }) => {
      if (!payload?.chatId || !payload?.message) return;
      const cmd = {
        type: 'chat_message',
        id: `cmsg_${Date.now()}`,
        payload: {
          chatId: payload.chatId,
          message: payload.message,
          operatorName: payload.operatorName || user.displayName || user.username || 'Operator',
          timestamp: Date.now(),
        },
      };
      // Broadcast scoped to tenant
      oblireachHub.broadcastCommandToTenant(tenantId, cmd);
      // Persist to DB
      try {
        await db('chat_messages').insert({
          chat_id: payload.chatId,
          tenant_id: tenantId,
          sender: payload.operatorName || user.displayName || user.username || 'Operator',
          message: payload.message,
          is_operator: true,
        });
      } catch {}
    });

    socket.on('chat:close', (payload: { chatId: string }) => {
      if (!payload?.chatId) return;
      oblireachHub.broadcastCommandToTenant(tenantId, {
        type: 'close_chat',
        id: `cclose_${Date.now()}`,
        payload: { chatId: payload.chatId },
      });
    });

    socket.on('chat:file', (payload: { chatId: string; fileName: string; fileSize: number; fileData: string }) => {
      if (!payload?.chatId || !payload?.fileData) return;
      oblireachHub.broadcastCommandToTenant(tenantId, {
        type: 'chat_file',
        id: `cfile_${Date.now()}`,
        payload: { chatId: payload.chatId, fileName: payload.fileName, fileSize: payload.fileSize, fileData: payload.fileData },
      });
    });

    socket.on('chat:request_remote', (payload: { chatId: string; message?: string }) => {
      if (!payload?.chatId) return;
      oblireachHub.broadcastCommandToTenant(tenantId, {
        type: 'request_remote',
        id: `creq_${Date.now()}`,
        payload: { chatId: payload.chatId, message: payload.message || '' },
      });
    });

    socket.on('join', (room: string) => {
      if (typeof room === 'string' && room.startsWith('chat:')) {
        socket.join(room);
      }
    });

    socket.on('disconnect', () => {
      processService.removeSocket(socket.id);
      fileExplorerService.removeSocket(socket.id);
      logger.debug({ userId: user.id }, 'Socket disconnected');
    });
  });

  return io;
}

export function getIO(): SocketIOServer {
  if (!io) throw new Error('Socket.io not initialized');
  return io;
}
