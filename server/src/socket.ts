import { Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { config } from './config';
import { db } from './db';
import { logger } from './utils/logger';
import { SocketEvents } from '@obliance/shared';
import { processService } from './services/process.service';
import { fileExplorerService } from './services/fileExplorer.service';
import { oblireachHub } from './services/oblireachHub.service';
import crypto from 'crypto';

let io: SocketIOServer;

export function createSocketServer(server: HttpServer): SocketIOServer {
  io = new SocketIOServer(server, {
    cors: {
      origin: config.clientOrigin,
      credentials: true,
    },
    transports: ['websocket', 'polling'],
    maxHttpBufferSize: 150 * 1024 * 1024, // 150 MB for file explorer uploads (base64)
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

    // File explorer commands via WebSocket
    socket.on('FILE_EXPLORER_CMD', async (payload: { requestId?: string; deviceId: number; commandType: string; payload: Record<string, any>; audit?: any }) => {
      if (!payload?.deviceId || !payload?.commandType || !tenantId) return;
      const audit = payload.audit ? { ...payload.audit, userId: user.id } : undefined;
      await fileExplorerService.send(
        payload.deviceId, tenantId, socket.id,
        payload.commandType, payload.payload,
        audit,
        payload.requestId,
      );
    });

    // ── Chat ───────────────────────────────────────────────────────────────
    socket.on('chat:open', async (payload: { deviceUuid: string; sessionId?: number; operatorName: string }, ack?: (res: any) => void) => {
      if (!payload?.deviceUuid || !tenantId) return;
      const chatId = crypto.randomBytes(8).toString('hex');
      const device = await db('devices').where({ uuid: payload.deviceUuid }).first().catch(() => null);
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
      // Find device UUID for this chat — we need to route to the agent
      // The chatId is unique; the agent knows it. Push via all connected agents.
      // In practice, the chat was opened on a specific device, so we broadcast
      // the command to all agents (only the one with the matching chatId will handle it).
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
      oblireachHub.broadcastCommand(cmd);
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
      oblireachHub.broadcastCommand({
        type: 'close_chat',
        id: `cclose_${Date.now()}`,
        payload: { chatId: payload.chatId },
      });
    });

    socket.on('chat:file', (payload: { chatId: string; fileName: string; fileSize: number; fileData: string }) => {
      if (!payload?.chatId || !payload?.fileData) return;
      oblireachHub.broadcastCommand({
        type: 'chat_file',
        id: `cfile_${Date.now()}`,
        payload: { chatId: payload.chatId, fileName: payload.fileName, fileSize: payload.fileSize, fileData: payload.fileData },
      });
    });

    socket.on('chat:request_remote', (payload: { chatId: string; message?: string }) => {
      if (!payload?.chatId) return;
      oblireachHub.broadcastCommand({
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
