import { EventEmitter } from 'events';
import { db } from '../../db';
import { logger } from '../../utils/logger';
import { agentHub } from '../agentHub.service';
import { remoteService } from '../remote.service';
import { privacyGateService } from '../privacyGate.service';
import { resolveMachine, type BastionUser } from './maisonShell';
import { authorizeJump } from './jumpAuthz';
import { clean, bastionAudit } from './bastionUtil';

// ─── T1 native ProxyJump (ephemeral authorized_keys) ──────────────────────────
//
//   ssh -J you@bastion:port obli@MACHINE
//
// The client opens a `direct-tcpip` channel to "MACHINE:22" on the bastion and
// then runs a normal, END-TO-END encrypted SSH session through it with the
// target's real sshd. The bastion never sees that session in clear. For the
// target sshd to accept the user's key, the agent (root) installs a one-time
// authorized_keys line for the dedicated `obli` account:
//
//   from="127.0.0.1,::1",expiry-time="…" ssh-ed25519 AAAA… obliance-grant:<id>:<exp>
//
//   - from=loopback: the line only works through the agent relay (the agent
//     dials the local sshd), never from the network;
//   - short TTL (GRANT_TTL_MS): the line only has to live through the target
//     authentication; an established session is unaffected by its removal;
//   - removed on channel close (ssh_jump_revoke), by the agent janitor at expiry
//     (crash / lost revoke), and by expiry-time on OpenSSH >= 7.6.
//
// sshd_config is NEVER modified. The bastion relays raw bytes through the
// existing agent tunnel (remote protocol 'sshjump' = TCP relay to local sshd).

export const PROXYJUMP_MIN_AGENT = '4.5.79';
const GRANT_TTL_MS = 5 * 60_000;
const GRANT_TIMEOUT_MS = 25_000;
const CONNECT_TIMEOUT_MS = 30_000;
const MAX_JUMPS_PER_USER = 20;
const MAX_PREPAIR_BYTES = 1024 * 1024;
const FAILURE_SHOWN_MS = 15 * 60_000;

function versionAtLeast(v: string | null | undefined, min: string): boolean {
  const a = String(v || '').split(/[.+-]/).map((x) => parseInt(x, 10) || 0);
  const b = min.split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return true;
}

// A refused channel cannot carry a message (the client only prints
// "administratively prohibited"), so the reason is kept and shown at the
// user's next interactive login on the bastion.
const lastFailure = new Map<number, { at: number; target: string; reason: string }>();

export function takeLastJumpFailure(userId: number): string | null {
  const f = lastFailure.get(userId);
  lastFailure.delete(userId);
  if (!f || Date.now() - f.at > FAILURE_SHOWN_MS) return null;
  return `Last ProxyJump to "${f.target}" was refused: ${f.reason}`;
}

const activeJumps = new Map<number, number>(); // userId -> open ProxyJump channels

// Raw byte bridge between the ssh2 direct-tcpip channel and the relay, playing
// the "browser" end in-process (same contract as the T0 adapter, binary only).
// Bytes the client sends before the agent is paired (its SSH banner) are
// buffered and flushed once the relay has wired the agent side.
class RawBridge extends EventEmitter {
  paired = false;
  private ready = false;
  private closed = false;
  private pending: Buffer[] = [];
  private pendingBytes = 0;

  private onData = (d: Buffer) => {
    if (this.closed) return;
    const b = Buffer.isBuffer(d) ? d : Buffer.from(d);
    if (this.ready) { this.emit('message', b, true); return; }
    this.pendingBytes += b.length;
    if (this.pendingBytes > MAX_PREPAIR_BYTES) { this.finish('prepair_overflow'); return; }
    this.pending.push(b);
  };

  private onClose = () => {
    if (this.closed) return;
    this.emit('close');
    this.finish('user_disconnect');
  };

  constructor(private channel: any) {
    super();
    channel.on('data', this.onData);
    channel.on('close', this.onClose);
    channel.on('error', () => { /* client reset */ });
  }

  send(data: Buffer | string, opts?: { binary?: boolean }): void {
    if (this.closed) return;
    if (!this.paired) {
      this.paired = true;
      this.emit('paired');
      // The relay attaches its message handler right after this call returns.
      setImmediate(() => {
        if (this.closed) return;
        this.ready = true;
        for (const b of this.pending) this.emit('message', b, true);
        this.pending = [];
        this.pendingBytes = 0;
      });
    }
    if (typeof data === 'string' || !opts?.binary) return; // control frames
    try { this.channel.write(data); } catch { /* channel gone */ }
  }

  resize(): void { /* raw TCP — no terminal */ }
  ping(): void { /* in-process */ }

  close(): void {
    try { this.channel.end(); } catch { /* */ }
    this.finish('remote_closed');
  }

  finish(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    this.pending = [];
    try { this.channel.off?.('data', this.onData); } catch { /* */ }
    try { this.channel.off?.('close', this.onClose); } catch { /* */ }
    try { this.channel.end(); } catch { /* */ }
    this.emit('done', reason);
  }
}

// Key line for the target: TYPE + base64 blob from the key the user just
// proved possession of at the bastion. The type comes from the wire blob
// itself (ctx.key.algo can be a signature algo such as rsa-sha2-512).
export function authorizedKeyFromBlob(blob: Buffer): string | null {
  if (blob.length < 4) return null;
  const n = blob.readUInt32BE(0);
  if (n > 64 || 4 + n > blob.length) return null;
  const type = blob.subarray(4, 4 + n).toString('ascii');
  if (!/^[a-z0-9@.-]+$/.test(type)) return null;
  return `${type} ${blob.toString('base64')}`;
}

async function revokeGrant(deviceId: number, grantId: string, status: 'closed' | 'error', error?: string): Promise<void> {
  const res = await agentHub.request(deviceId, 'ssh_jump_revoke', { grantId }, 15_000);
  await db('ssh_bastion_grants').where({ id: grantId }).update({
    status, closed_at: new Date(),
    error: error ?? (res.success ? null : `revoke failed: ${res.error || 'unknown'} (agent janitor removes it at expiry)`),
  }).catch(() => { /* best effort */ });
}

export async function handleProxyJump(
  u: BastionUser,
  keyBlob: Buffer,
  info: { destIP: string; destPort: number },
  accept: () => any,
  reject: () => void,
): Promise<void> {
  const target = clean(info?.destIP, 128);
  const fail = (reason: string, audit?: { tenantId?: number; deviceId?: number }) => {
    lastFailure.set(u.userId, { at: Date.now(), target: target || '?', reason });
    bastionAudit('jump_denied', { ...audit, userId: u.userId, ip: u.sourceIp, details: { tier: 'ephemeral_authkeys', target, reason } });
    try { reject(); } catch { /* */ }
  };

  if (!target) return fail('empty target');
  if ((activeJumps.get(u.userId) || 0) >= MAX_JUMPS_PER_USER) return fail('too many simultaneous ProxyJump connections');

  let matches = await resolveMachine(u, target);
  // SSH-config alias form "<machine>.<alias>" (Host *.obliance -> ProxyJump):
  // exact name first, then without the last label. Only ever narrows to a
  // machine the user may already reach, so a wrong strip cannot widen access.
  if (matches.length === 0 && target.includes('.')) {
    matches = await resolveMachine(u, target.slice(0, target.lastIndexOf('.')));
  }
  if (matches.length === 0) return fail(`no accessible machine "${target}"`);
  if (matches.length > 1) return fail(`"${target}" is ambiguous (${matches.length} machines) — use its uuid (see "list")`);
  const dev = matches[0];
  const audit = { tenantId: dev.tenant_id, deviceId: dev.id };

  if (dev.os_type !== 'linux') return fail('native ProxyJump is only available on Linux machines — use "ssh <machine>" in the bastion shell', audit);
  if (!versionAtLeast(dev.agent_version, PROXYJUMP_MIN_AGENT)) {
    return fail(`agent ${dev.agent_version || '?'} is too old for ProxyJump (needs ${PROXYJUMP_MIN_AGENT}) — use "ssh <machine>" in the bastion shell`, audit);
  }
  const decision = await authorizeJump(u, dev.id);
  if (!decision.ok) return fail(decision.reason, audit);
  if (!agentHub.isConnected(dev.id)) return fail('agent offline', audit);

  const keyLine = authorizedKeyFromBlob(keyBlob);
  if (!keyLine) return fail('unusable key', audit);
  const { fingerprintBlob } = await import('./userKeys.service');

  // ── 1. Grant: one-time authorized_keys line on the target ─────────────────
  const expiresAt = new Date(Date.now() + GRANT_TTL_MS);
  const [grant] = await db('ssh_bastion_grants').insert({
    user_id: u.userId, device_id: dev.id, tenant_id: dev.tenant_id,
    tier: 'ephemeral_authkeys', target_user: 'obli', status: 'pending',
    source_ip: u.sourceIp || null, public_key_fp: fingerprintBlob(keyBlob), expires_at: expiresAt,
  }).returning('id');
  const grantId: string = grant.id ?? grant;

  const unlockToken = privacyGateService.get(u.userId, dev.id, 'remote');
  const res = await agentHub.request(dev.id, 'ssh_jump_grant', {
    grantId, publicKey: keyLine, expiresAt: Math.floor(expiresAt.getTime() / 1000),
    ...(unlockToken ? { unlockToken } : {}),
  }, GRANT_TIMEOUT_MS);
  if (!res.success) {
    const why = clean(res.error || res.result?.error || 'grant failed', 200);
    await db('ssh_bastion_grants').where({ id: grantId }).update({ status: 'error', error: why, closed_at: new Date() }).catch(() => {});
    return fail(`the machine refused the temporary key: ${why}`, audit);
  }
  const sshdAddr = String(res.result?.sshdAddr || '');
  const port = parseInt(sshdAddr.split(':').pop() || '', 10);
  await db('ssh_bastion_grants').where({ id: grantId })
    .update({ status: 'active', sshd_port: Number.isFinite(port) ? port : null }).catch(() => {});

  // ── 2. Raw relay: channel <-> agent tunnel <-> local sshd ─────────────────
  let session: any;
  try {
    session = await remoteService.createSession(dev.id, dev.tenant_id, u.userId, 'sshjump');
  } catch (err) {
    logger.error(err, '[ssh-bastion] proxyjump createSession failed');
    await revokeGrant(dev.id, grantId, 'error', 'session creation failed');
    return fail('could not open the relay', audit);
  }

  let channel: any;
  try { channel = accept(); } catch {
    remoteService.dropTunnel(session.sessionToken);
    remoteService.endSession(session.id, dev.tenant_id, 'user_disconnect').catch(() => {});
    await revokeGrant(dev.id, grantId, 'closed');
    return;
  }

  activeJumps.set(u.userId, (activeJumps.get(u.userId) || 0) + 1);
  bastionAudit('jump_started', {
    ...audit, userId: u.userId, ip: u.sourceIp,
    details: { sessionId: session.id, grantId, tier: 'ephemeral_authkeys', warnings: res.result?.warnings },
  });

  const bridge = new RawBridge(channel);
  remoteService.registerBrowserTunnel(session.sessionToken, bridge as any);
  const timer = setTimeout(() => { if (!bridge.paired) bridge.finish('agent_timeout'); }, CONNECT_TIMEOUT_MS);
  const reason = await new Promise<string>((resolve) => bridge.once('done', resolve));
  clearTimeout(timer);

  if (!bridge.paired) {
    remoteService.dropTunnel(session.sessionToken);
    remoteService.endSession(session.id, dev.tenant_id, reason).catch(() => {});
  }
  const n = (activeJumps.get(u.userId) || 1) - 1;
  if (n <= 0) activeJumps.delete(u.userId); else activeJumps.set(u.userId, n);

  await revokeGrant(dev.id, grantId, 'closed');
  bastionAudit('jump_ended', { ...audit, userId: u.userId, ip: u.sourceIp, details: { sessionId: session.id, grantId, reason } });
}

// Server-side sweep: grants whose TTL is over are closed and a revoke is
// attempted (the agent janitor removes the line at expiry anyway).
export function startGrantJanitor(): void {
  const sweep = async () => {
    try {
      const stale = await db('ssh_bastion_grants')
        .whereIn('status', ['pending', 'active'])
        .where('tier', 'ephemeral_authkeys')
        .where('expires_at', '<', new Date(Date.now() - 60_000))
        .limit(200)
        .select('id', 'device_id');
      for (const g of stale) {
        if (agentHub.isConnected(g.device_id)) void agentHub.request(g.device_id, 'ssh_jump_revoke', { grantId: g.id }, 15_000);
      }
      if (stale.length) {
        await db('ssh_bastion_grants').whereIn('id', stale.map((g: any) => g.id))
          .update({ status: 'closed', closed_at: new Date() });
      }
    } catch (err) {
      logger.error(err, '[ssh-bastion] grant janitor failed');
    }
  };
  void sweep();
  setInterval(sweep, 5 * 60_000).unref?.();
}
