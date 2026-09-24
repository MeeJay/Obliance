import { db } from '../../db';
import { permissionService } from '../permission.service';
import { clean, bastionAudit } from './bastionUtil';
import { authorizeJump } from './jumpAuthz';

const MAX_LINE = 512; // input line cap — no unbounded buffer growth

// The "SSH maison" — the restricted interactive shell a user lands in when they
// SSH to the bastion WITHOUT targeting a machine. It never gives a shell on the
// Obliance server: it only lists the machines the user may reach and jumps.

export interface BastionUser {
  userId: number;
  isAdmin: boolean;
  username: string;
  sourceIp?: string;
  /** Current terminal size (updated on window-change) — for the jump bridge. */
  pty?: { cols: number; rows: number };
  /** Register a live-resize forwarder while a jump is active (null clears it). */
  setResizeHook?: (fn: ((cols: number, rows: number) => void) | null) => void;
}

export interface BastionDevice {
  id: number; uuid: string; hostname: string; display_name: string | null;
  os_type: string; status: string; tenant: string | null; dossier: string | null;
  tenant_id: number;
}

// P3/P5 inject the real jump; P2 passes a stub. Returns when the jump session ends.
export type JumpFn = (device: BastionDevice, stream: any, user: BastionUser) => Promise<void>;

const BANNER =
  '\r\n  Obliance SSH — bastion\r\n' +
  "  Type 'help' for commands. You are NOT on the Obliance server.\r\n";

const HELP =
  "Commands:\r\n" +
  "  help, ?                       show this help\r\n" +
  "  list [-t <tenant>] [-d <folder>]   list machines you can reach\r\n" +
  "  ssh <machine> [-t <tenant>]   jump to a machine (by hostname or uuid)\r\n" +
  "  whoami                        show your identity\r\n" +
  "  exit                          disconnect\r\n";

async function listMachines(u: BastionUser, tenant?: string, dossier?: string): Promise<BastionDevice[]> {
  const visible = await permissionService.getVisibleDeviceIds(u.userId, u.isAdmin);
  if (visible !== 'all' && visible.length === 0) return [];
  let q = db('devices as d')
    .leftJoin('tenants as t', 't.id', 'd.tenant_id')
    .leftJoin('device_groups as g', 'g.id', 'd.group_id')
    .whereNot('d.os_type', 'windows')  // bastion = SSH targets (unix-like); Windows uses RDP
    .select(
      'd.id', 'd.uuid', 'd.hostname', 'd.display_name', 'd.os_type', 'd.status', 'd.tenant_id',
      't.name as tenant', 'g.name as dossier',
    );
  q = q.where('d.approval_status', 'approved');
  if (visible !== 'all') q = q.whereIn('d.id', visible as number[]);
  if (tenant) q = q.where('t.name', 'ilike', `%${tenant}%`);
  if (dossier) q = q.where('g.name', 'ilike', `%${dossier}%`);
  return q.orderBy([{ column: 't.name' }, { column: 'g.name' }, { column: 'd.hostname' }]).limit(2000);
}

function parseFlags(tokens: string[]): { positional: string[]; t?: string; d?: string } {
  const positional: string[] = [];
  let t: string | undefined, d: string | undefined;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === '-t') t = tokens[++i];
    else if (tokens[i] === '-d') d = tokens[++i];
    else positional.push(tokens[i]);
  }
  return { positional, t, d };
}

function fmtTable(rows: BastionDevice[]): string {
  if (!rows.length) return 'No machines match.\r\n';
  const head = ['TENANT', 'FOLDER', 'HOSTNAME', 'OS', 'STATUS'];
  // Every cell is agent- or user-controlled -> strip terminal control sequences.
  const data = rows.map((r) => [
    clean(r.tenant || '-', 40), clean(r.dossier || '-', 40), clean(r.display_name || r.hostname, 64),
    clean(r.os_type, 16), clean(r.status, 16),
  ]);
  const widths = head.map((h, i) => Math.max(h.length, ...data.map((row) => row[i].length)));
  const line = (cols: string[]) => cols.map((c, i) => c.padEnd(widths[i])).join('  ');
  return [line(head), ...data.map(line)].join('\r\n') + `\r\n(${rows.length})\r\n`;
}

export async function handleCommand(line: string, stream: any, u: BastionUser, onJump: JumpFn): Promise<boolean> {
  const w = (s: string) => stream.write(s.replace(/\n/g, '\r\n'));
  const tokens = line.split(/\s+/).filter(Boolean);
  const cmd = (tokens[0] || '').toLowerCase();
  switch (cmd) {
    case 'help': case '?': w(HELP); break;
    case 'list': case 'ls': {
      const { t, d } = parseFlags(tokens.slice(1));
      const rows = await listMachines(u, t, d);
      bastionAudit('list', { userId: u.userId, ip: u.sourceIp, details: { tenant: t, folder: d, count: rows.length } });
      stream.write(fmtTable(rows));
      break;
    }
    case 'ssh': {
      const { positional, t } = parseFlags(tokens.slice(1));
      const target = positional[0];
      if (!target) { w('usage: ssh <machine> [-t <tenant>]\n'); break; }
      const shown = clean(target, 64);
      const matches = (await listMachines(u, t)).filter((r) =>
        r.hostname.toLowerCase() === target.toLowerCase() ||
        (r.display_name || '').toLowerCase() === target.toLowerCase() ||
        r.uuid === target);
      if (matches.length === 0) { w(`No accessible machine "${shown}".\n`); break; }
      if (matches.length > 1) {
        w(`Ambiguous "${shown}" — ${matches.length} matches; narrow with -t <tenant> or use the uuid:\n`);
        stream.write(fmtTable(matches));
        break;
      }
      const dev = matches[0];
      // Same gates as the web remote-session route (rw, `remote` capability,
      // action restriction, legacy agent, privacy mode, approval).
      const decision = await authorizeJump(u, dev.id);
      if (!decision.ok) {
        bastionAudit('jump_denied', { tenantId: dev.tenant_id, userId: u.userId, deviceId: dev.id, ip: u.sourceIp, details: { reason: decision.reason } });
        w(`${decision.reason}\n`);
        break;
      }
      await onJump(dev, stream, u);
      break;
    }
    case 'whoami': w(`${clean(u.username, 64)} (Obliance user #${u.userId}${u.isAdmin ? ', admin' : ''})\n`); break;
    case 'exit': case 'quit': case 'logout': return false;
    default: w(`Unknown command: ${cmd} — type 'help'.\n`);
  }
  return true;
}

// Minimal raw-PTY line editor (printable chars, backspace, Ctrl-C/Ctrl-D, Enter).
export function startMaisonShell(stream: any, u: BastionUser, onJump: JumpFn): void {
  const prompt = () => stream.write('obli> ');
  stream.write(BANNER.replace(/\n/g, '\r\n'));
  prompt();

  let buf = '';
  let busy = false;

  stream.on('data', async (data: Buffer) => {
    if (busy) return; // ignore input while a command runs
    for (const b of data) {
      if (b === 0x0d || b === 0x0a) {          // Enter
        stream.write('\r\n');
        const line = buf.trim();
        buf = '';
        if (line) {
          busy = true;
          try {
            const keepGoing = await handleCommand(line, stream, u, onJump);
            if (!keepGoing) { stream.write('Bye.\r\n'); stream.end(); return; }
          } catch {
            stream.write('error\r\n');
          }
          busy = false;
        }
        prompt();
      } else if (b === 0x7f || b === 0x08) {   // Backspace / DEL
        if (buf.length) { buf = buf.slice(0, -1); stream.write('\b \b'); }
      } else if (b === 0x03) {                 // Ctrl-C
        buf = ''; stream.write('^C\r\n'); prompt();
      } else if (b === 0x04) {                 // Ctrl-D
        stream.write('\r\nBye.\r\n'); stream.end(); return;
      } else if (b >= 0x20 && b < 0x7f) {      // printable
        if (buf.length >= MAX_LINE) continue;  // cap: drop overflow, never grow unbounded
        buf += String.fromCharCode(b); stream.write(String.fromCharCode(b));
      }
    }
  });
  stream.on('error', () => { /* client reset */ });
}
