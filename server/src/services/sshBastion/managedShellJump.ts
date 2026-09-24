import { EventEmitter } from 'events';
import { remoteService } from '../remote.service';
import { logger } from '../../utils/logger';
import { clean, bastionAudit } from './bastionUtil';
import type { JumpFn } from './maisonShell';

// ─── T0 managed-shell jump ────────────────────────────────────────────────────
//
// Bridges the user's ssh2 shell stream to the agent's EXISTING PTY tunnel via
// remoteService, IN-PROCESS: the bastion registers as the "browser" end with a
// ws-like adapter and mirrors EXACTLY what the browser xterm client does over
// WebSocket — binary frames = raw PTY bytes, text frames = {type:'resize'}.
// No agent change, no target change: the far shell is spawned by the agent
// (root), exactly like the current web-ssh.

const CONNECT_TIMEOUT_MS = 30_000;

class InProcessBrowser extends EventEmitter {
  paired = false;
  private closed = false;

  private onData = (b: Buffer) => {
    if (!this.closed) this.emit('message', Buffer.isBuffer(b) ? b : Buffer.from(b), true); // keystrokes -> agent stdin
  };

  private onStreamClose = () => {
    if (this.closed) return;
    this.emit('close');            // user disconnected -> relay tears the agent side down
    this.finish('user_disconnect');
  };

  constructor(private stream: any) {
    super();
    stream.on('data', this.onData);
    stream.on('close', this.onStreamClose);
  }

  // Relay -> "browser". Text frames are control ({"type":"paired"}); binary
  // frames are the agent's shell output, written to the user's terminal.
  // Inert once closed: a late agent must never write into the maison shell.
  send(data: Buffer | string, opts?: { binary?: boolean }): void {
    if (this.closed) return;
    if (!this.paired) { this.paired = true; this.emit('paired'); }
    if (typeof data === 'string') return;
    if (opts?.binary) { try { this.stream.write(data); } catch { /* stream gone */ } }
  }

  resize(cols: number, rows: number): void {
    if (!this.closed) this.emit('message', JSON.stringify({ type: 'resize', cols, rows }), false);
  }

  ping(): void { /* no-op — in-process, no idle proxy to keep alive */ }

  // Called by the relay when the far side (agent / shell) closed. Control
  // returns to the maison shell — the user's ssh2 stream is NOT ended.
  close(): void {
    this.finish('remote_closed');
  }

  finish(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    try { this.stream.off?.('data', this.onData); } catch { /* */ }
    try { this.stream.off?.('close', this.onStreamClose); } catch { /* */ }
    this.emit('done', reason);
  }
}

export const managedShellJump: JumpFn = async (device, stream, user) => {
  const w = (s: string) => { try { stream.write(s); } catch { /* */ } };
  const host = clean(device.display_name || device.hostname, 64);
  w(`\r\nConnecting to ${host}…\r\n`);

  let session: any;
  try {
    session = await remoteService.createSession(device.id, device.tenant_id, user.userId, 'ssh' as any);
  } catch (err: any) {
    logger.error(err, '[ssh-bastion] createSession failed');
    w('\r\nFailed to open the session.\r\n');
    return;
  }
  const audit = { tenantId: device.tenant_id, userId: user.userId, deviceId: device.id, ip: user.sourceIp };
  bastionAudit('jump_started', { ...audit, details: { sessionId: session.id, tier: 'managed_shell' } });

  const adapter = new InProcessBrowser(stream);
  const size = user.pty || { cols: 80, rows: 24 };
  // Size the far PTY as soon as the agent is paired, then follow live resizes.
  adapter.once('paired', () => adapter.resize(size.cols, size.rows));
  user.setResizeHook?.((c, r) => adapter.resize(c, r));
  remoteService.registerBrowserTunnel(session.sessionToken, adapter);

  // Agent offline / refusing: never leave the user stuck forever.
  const timer = setTimeout(() => {
    if (!adapter.paired) {
      w(`\r\n${host} did not answer (agent offline?).\r\n`);
      adapter.finish('agent_timeout');
    }
  }, CONNECT_TIMEOUT_MS);

  const reason = await new Promise<string>((resolve) => adapter.once('done', resolve));
  clearTimeout(timer);
  user.setResizeHook?.(null);

  // Never paired: the relay never bridged, so clean the entry + DB row ourselves.
  if (!adapter.paired) {
    remoteService.dropTunnel(session.sessionToken);
    remoteService.endSession(session.id, device.tenant_id, reason).catch(() => { /* best effort */ });
  }
  bastionAudit('jump_ended', { ...audit, details: { sessionId: session.id, reason } });
  if (reason !== 'user_disconnect') w(`\r\nDisconnected from ${host}.\r\n`);
};
