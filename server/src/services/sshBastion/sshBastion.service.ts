import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import { db } from '../../db';
import { userKeysService, fingerprintBlob } from './userKeys.service';
import { startMaisonShell, handleCommand, type BastionUser } from './maisonShell';
import { managedShellJump } from './managedShellJump';
import { handleProxyJump, takeLastJumpFailure, startGrantJanitor } from './proxyJump';
import { bastionGate } from './bastionGate.service';
import { bastionAudit, clean } from './bastionUtil';

// ─── SSH Bastion (ObliJump) ───────────────────────────────────────────────────
//
// A real SSH server (ssh2) fronting the agent tunnels. Opt-in via .env
// (SSH_BASTION_ENABLED / SSH_BASTION_PORT) — binds only when enabled.
//
//   auth    publickey only -> Obliance identity (user_ssh_keys fingerprint),
//           signature verified; banned IPs refused before auth.
//   gate    static allow-list / SSH-button grant / web 2FA trust; enforce
//           (default ON) refuses others and bans on the 3rd attempt.
//   shell   the "SSH maison" (list / jump); T0 managed-shell jump.
//   limits  global + per-IP connection caps, auth timeout, auth-attempt cap,
//           idle timeout, max session length; unauthenticated connections
//           count toward a bruteforce ban.

const MAX_CONNECTIONS = 200;
const MAX_CONNECTIONS_PER_IP = 10;
const AUTH_TIMEOUT_MS = 30_000;
const MAX_AUTH_ATTEMPTS = 10;
const IDLE_TIMEOUT_MS = 30 * 60_000;
const MAX_SESSION_MS = 8 * 60 * 60_000;

const HOST_KEY_DIR = path.join(config.customDir, 'ssh-bastion');
const HOST_KEY_PATH = path.join(HOST_KEY_DIR, 'host_rsa');

// ssh2 1.x only parses PKCS#1 ("BEGIN RSA PRIVATE KEY") — NOT PKCS#8
// ("BEGIN PRIVATE KEY"): with a PKCS#8 host key the server cannot start. So
// the key is generated as PKCS#1, and a PKCS#8 file left by an earlier build
// is converted IN PLACE (same key => same fingerprint users already pinned).
function ensureHostKey(): string {
  const { utils } = require('ssh2') as typeof import('ssh2');
  if (fs.existsSync(HOST_KEY_PATH)) {
    let pem = fs.readFileSync(HOST_KEY_PATH, 'utf8');
    if (utils.parseKey(pem) instanceof Error) {
      pem = crypto.createPrivateKey(pem).export({ type: 'pkcs1', format: 'pem' }).toString();
      fs.writeFileSync(HOST_KEY_PATH, pem, { mode: 0o600 });
      logger.info('[ssh-bastion] converted host key to PKCS#1');
    }
    return pem;
  }
  fs.mkdirSync(HOST_KEY_DIR, { recursive: true });
  const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 3072,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  fs.writeFileSync(HOST_KEY_PATH, privateKey, { mode: 0o600 });
  logger.info('[ssh-bastion] generated persistent host key');
  return privateKey;
}

async function loadUser(userId: number, sourceIp?: string): Promise<BastionUser | null> {
  const row = await db('users').where({ id: userId }).first('username', 'role', 'is_active');
  if (!row || row.is_active === false) return null;
  return { userId, isAdmin: row.role === 'admin', username: row.username, sourceIp };
}

// Network gate, applied identically to interactive shells AND exec commands.
// Returns false (and has already answered + closed the stream) when refused.
async function passGate(stream: any, u: BastionUser, isExec: boolean): Promise<boolean> {
  const gate = await bastionGate.evaluate(u.sourceIp, u.userId);
  const ip = clean(u.sourceIp || '?', 64);
  const out = (s: string) => { try { stream.write(s); } catch { /* */ } };
  if (gate.allowed || !gate.enforce) {
    bastionGate.clearStrikes(u.sourceIp);
    u.gateVia = gate.allowed ? `${gate.via}${gate.entry ? ` ${gate.entry}` : ''}` : 'not_enforced';
    // Shown on every interactive login: which IP the bastion sees and which
    // rule let it in — makes a relayed/NATed setup visible immediately.
    if (!isExec) {
      const why = !gate.allowed ? 'IP restriction disabled by an administrator'
        : gate.via === 'allowlist' ? `allow-list ${clean(gate.entry || '', 64)}`
        : '"SSH" button authorization';
      out(`\r\nConnected from ${ip} — access granted by: ${why}\r\n`);
    }
    return true;
  }
  if (gate.infra) {
    // Relayed connection: the real client IP is unknown -> fail closed, no strike.
    out(`\r\nAccess refused: the bastion sees ${ip}, an address of the server's own network.\r\n` +
      'The connection is relayed (proxy, Docker IPv6 proxy, NAT loopback...), so your real IP\r\n' +
      'cannot be checked. Ask an administrator to publish the SSH port directly.\r\n');
    bastionAudit('ip_refused_relayed', { userId: u.userId, ip: u.sourceIp });
    if (isExec) { try { stream.exit(1); } catch { /* */ } }
    stream.end();
    return false;
  }
  out(`\r\nYour IP (${ip}) is not allowed.\r\nAuthorize it from the "SSH" button in Obliance (2FA), then reconnect.\r\n`);
  bastionAudit('ip_refused', { userId: u.userId, ip: u.sourceIp });
  if (await bastionGate.strike(u.sourceIp)) out('This IP has been banned after repeated attempts.\r\n');
  if (isExec) { try { stream.exit(1); } catch { /* */ } }
  stream.end();
  return false;
}

// Public identity of the bastion, shown in the UI so users can check the
// fingerprint their client prints on first connection (TOFU). Same format as
// `ssh-keygen -lf`. null until the host key exists (bastion never started).
export function getHostKeyInfo(): { type: string; fingerprint: string } | null {
  try {
    if (!fs.existsSync(HOST_KEY_PATH)) return null;
    const { utils } = require('ssh2') as typeof import('ssh2');
    const parsed = utils.parseKey(fs.readFileSync(HOST_KEY_PATH, 'utf8')) as any;
    if (!parsed || parsed instanceof Error) return null;
    const key = Array.isArray(parsed) ? parsed[0] : parsed;
    const blob: Buffer = key.getPublicSSH();
    return {
      type: String(key.type),
      fingerprint: 'SHA256:' + crypto.createHash('sha256').update(blob).digest('base64').replace(/=+$/, ''),
    };
  } catch {
    return null;
  }
}

export function isBastionRunning(): boolean {
  return started;
}

let started = false;
let openConnections = 0;
const perIpConnections = new Map<string, number>();

export function startSshBastion(): void {
  if (started || !config.sshBastion.enabled) return;
  try {
    // Lazy require so ssh2 is only loaded when the bastion is enabled.
    const { Server, utils } = require('ssh2') as typeof import('ssh2');
    const hostKey = ensureHostKey();

    const server = new Server({ hostKeys: [hostKey] }, (client, info) => {
      const sourceIp = bastionGate.normalize((info as any)?.ip);

      // ── Connection caps (before any work) ───────────────────────────────
      const ipCount = perIpConnections.get(sourceIp) || 0;
      if (openConnections >= MAX_CONNECTIONS || ipCount >= MAX_CONNECTIONS_PER_IP) {
        try { client.end(); } catch { /* */ }
        return;
      }
      openConnections++;
      perIpConnections.set(sourceIp, ipCount + 1);

      let authenticated = false;
      let userId: number | null = null;
      let authKeyBlob: Buffer | null = null; // key the user proved possession of (T1 grant)
      let authAttempts = 0;
      let idleTimer: NodeJS.Timeout | null = null;
      let sessionTimer: NodeJS.Timeout | null = null;

      const authTimer = setTimeout(() => { if (!authenticated) { try { client.end(); } catch { /* */ } } }, AUTH_TIMEOUT_MS);

      client.on('close', () => {
        clearTimeout(authTimer);
        if (idleTimer) clearTimeout(idleTimer);
        if (sessionTimer) clearTimeout(sessionTimer);
        openConnections = Math.max(0, openConnections - 1);
        const n = (perIpConnections.get(sourceIp) || 1) - 1;
        if (n <= 0) perIpConnections.delete(sourceIp); else perIpConnections.set(sourceIp, n);
        // Scanner / wrong key / aborted handshake -> bruteforce accounting.
        if (!authenticated) void bastionGate.recordFailedConnection(sourceIp);
      });
      client.on('error', () => { /* client reset — ignore */ });

      // Banned IP: drop immediately (the auth handler re-checks as well).
      void bastionGate.isBanned(sourceIp).then((banned) => { if (banned) { try { client.end(); } catch { /* */ } } });

      client.on('authentication', async (ctx) => {
        try {
          if (++authAttempts > MAX_AUTH_ATTEMPTS) { ctx.reject(); try { client.end(); } catch { /* */ } return; }
          if (await bastionGate.isBanned(sourceIp)) return ctx.reject();
          if (ctx.method !== 'publickey') return ctx.reject(['publickey']);

          const key = (ctx as any).key as { algo: string; data: Buffer };
          const resolved = await userKeysService.resolveByFingerprint(fingerprintBlob(key.data));
          if (!resolved) return ctx.reject();

          const signature = (ctx as any).signature as Buffer | undefined;
          if (!signature) return ctx.accept(); // probe: key acceptable, client must now sign

          const pub = utils.parseKey(`${key.algo} ${key.data.toString('base64')}`);
          if (pub instanceof Error) return ctx.reject();
          if (!(pub as any).verify((ctx as any).blob, signature, (ctx as any).hashAlgo)) return ctx.reject();

          userId = resolved.userId; // identity only after a verified signature
          authKeyBlob = Buffer.from(key.data);
          ctx.accept();
        } catch (err) {
          logger.error(err, '[ssh-bastion] auth error');
          ctx.reject();
        }
      });

      client.on('ready', () => {
        // T1 native ProxyJump: 'ssh -J' opens a direct-tcpip channel to
        // MACHINE:port. Same gate as shells; a refusal is a plain channel
        // reject (the reason is shown at the next interactive login).
        client.on('tcpip', async (accept: any, reject: any, tInfo: any) => {
          try {
            const u = userId != null ? await loadUser(userId, sourceIp) : null;
            if (!u || !authKeyBlob) { reject(); return; }
            const gate = await bastionGate.evaluate(u.sourceIp, u.userId);
            if (!(gate.allowed || !gate.enforce)) {
              bastionAudit(gate.infra ? 'ip_refused_relayed' : 'ip_refused', { userId: u.userId, ip: sourceIp, details: { mode: 'proxyjump' } });
              if (!gate.infra) await bastionGate.strike(sourceIp);
              reject();
              return;
            }
            bastionGate.clearStrikes(sourceIp);
            await handleProxyJump(u, authKeyBlob, tInfo, accept, reject);
          } catch (err) {
            logger.error(err, '[ssh-bastion] proxyjump error');
            try { reject(); } catch { /* already accepted */ }
          }
        });

        authenticated = true;
        clearTimeout(authTimer);
        sessionTimer = setTimeout(() => { try { client.end(); } catch { /* */ } }, MAX_SESSION_MS);

        client.on('session', (accept) => {
          const session = accept();
          const ptyState = { cols: 80, rows: 24 };
          let onResize: ((c: number, r: number) => void) | null = null;

          session.on('pty', (acc: any, _rej: any, ptyInfo: any) => {
            if (ptyInfo) { ptyState.cols = ptyInfo.cols || ptyState.cols; ptyState.rows = ptyInfo.rows || ptyState.rows; }
            try { acc && acc(); } catch { /* ignore */ }
          });
          session.on('window-change', (acc: any, _rej: any, wcInfo: any) => {
            if (wcInfo) { ptyState.cols = wcInfo.cols || ptyState.cols; ptyState.rows = wcInfo.rows || ptyState.rows; }
            if (onResize) onResize(ptyState.cols, ptyState.rows);
            try { acc && acc(); } catch { /* ignore */ }
          });

          session.on('shell', async (acc: any) => {
            const stream = acc();
            const u = userId != null ? await loadUser(userId, sourceIp) : null;
            if (!u) { stream.write('identity error\r\n'); stream.end(); return; }
            if (!(await passGate(stream, u, false))) return;
            bastionAudit('login', { userId: u.userId, ip: sourceIp, details: { mode: 'shell', via: u.gateVia } });

            // Idle timeout on user INPUT (keeps working during a jump too).
            const resetIdle = () => {
              if (idleTimer) clearTimeout(idleTimer);
              idleTimer = setTimeout(() => {
                try { stream.write('\r\nIdle timeout — disconnected.\r\n'); } catch { /* */ }
                try { client.end(); } catch { /* */ }
              }, IDLE_TIMEOUT_MS);
            };
            resetIdle();
            stream.on('data', resetIdle);

            u.pty = ptyState;
            u.setResizeHook = (fn) => { onResize = fn; };
            const lastJump = takeLastJumpFailure(u.userId);
            if (lastJump) { try { stream.write(clean(lastJump, 300) + '\r\n'); } catch { /* */ } }
            startMaisonShell(stream, u, managedShellJump);
          });

          session.on('exec', async (acc: any, _rej: any, execInfo: any) => {
            const stream = acc();
            const u = userId != null ? await loadUser(userId, sourceIp) : null;
            if (!u) { try { stream.stderr.write('identity error\n'); } catch { /* */ } try { stream.exit(1); } catch { /* */ } stream.end(); return; }
            if (!(await passGate(stream, u, true))) return;
            const command = clean(execInfo?.command, 256);
            bastionAudit('exec', { userId: u.userId, ip: sourceIp, details: { command, via: u.gateVia } });
            try {
              await handleCommand(command, stream, u,
                async () => { stream.write('Jumps require an interactive session (ssh -t).\r\n'); });
              try { stream.exit(0); } catch { /* */ }
            } catch {
              try { stream.exit(1); } catch { /* */ }
            }
            stream.end();
          });
        });
      });
    });

    server.on('error', (err: Error) => logger.error(err, '[ssh-bastion] server error'));
    server.listen(config.sshBastion.port, '0.0.0.0', () => {
      started = true;
      logger.info(`[ssh-bastion] listening on :${config.sshBastion.port}`);
      startGrantJanitor();
    });
  } catch (err) {
    // The bastion is optional — never let a start failure take down the server.
    logger.error(err, '[ssh-bastion] failed to start');
  }
}
