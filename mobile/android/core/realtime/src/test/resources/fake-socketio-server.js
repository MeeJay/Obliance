// Minimal Socket.IO 4.x server reproducing the Obliance handshake rules
// (server/src/socket.ts): identity from the session cookie only, 'Unauthorized'
// otherwise. Used by RealtimeProofTest; prints "PORT <n>" once listening.
const http = require('http');
const { Server } = require('socket.io');

const server = http.createServer();
const io = new Server(server, { transports: ['websocket', 'polling'] });

io.use((socket, next) => {
  const cookie = socket.request.headers.cookie || '';
  if (!/(^|;\s*)connect\.sid=s%3Agood-session/.test(cookie)) return next(new Error('Unauthorized'));
  next();
});

io.on('connection', (socket) => {
  socket.emit('NOTIFICATION_NEW', { id: 512, title: 'SRV-AD2: Hors ligne', severity: 'critical', tenantId: 4 });
  socket.on('PROCESS_SUBSCRIBE', (payload, ack) => {
    if (typeof ack === 'function') ack({ ok: true, deviceId: payload && payload.deviceId });
    socket.emit('DEVICE_PROCESSES_UPDATED', { deviceId: payload.deviceId, processes: [{ pid: 7312, name: 'EBP.Compta.exe' }] });
  });
  socket.on('KICK', () => socket.disconnect(true));
});

server.listen(0, '127.0.0.1', () => {
  console.log('PORT ' + server.address().port);
});
process.stdin.on('end', () => process.exit(0));
process.stdin.resume();
