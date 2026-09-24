import crypto from 'crypto';
import { db } from '../../db';
import type { SshPublicKey } from '@obliance/shared';

const KEY_TYPES = new Set([
  'ssh-ed25519', 'ssh-rsa', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384',
  'ecdsa-sha2-nistp521', 'sk-ssh-ed25519@openssh.com', 'sk-ecdsa-sha2-nistp256@openssh.com',
]);

function rowToKey(r: any): SshPublicKey {
  return {
    id: r.id, userId: r.user_id, name: r.name, keyType: r.key_type,
    publicKey: r.public_key, fingerprint: r.fingerprint,
    createdAt: r.created_at, lastUsedAt: r.last_used_at,
  };
}

// Parse an OpenSSH public key line -> type + blob + SHA256 fingerprint.
// Throws on malformed input. Fingerprint == `ssh-keygen -lf` output:
// "SHA256:" + base64(sha256(wire-blob)) with padding stripped.
export function parsePublicKey(line: string): { type: string; fingerprint: string; normalized: string } {
  const parts = String(line || '').trim().split(/\s+/);
  if (parts.length < 2) throw new Error('Invalid SSH public key');
  const [type, b64] = parts;
  if (!KEY_TYPES.has(type)) throw new Error(`Unsupported key type: ${type}`);
  let blob: Buffer;
  try { blob = Buffer.from(b64, 'base64'); } catch { throw new Error('Invalid key data'); }
  if (blob.length < 4) throw new Error('Invalid key data');
  // The wire blob is length-prefixed with the same type string — cheap integrity check.
  const nameLen = blob.readUInt32BE(0);
  if (nameLen > 64 || 4 + nameLen > blob.length) throw new Error('Invalid key data');
  if (blob.subarray(4, 4 + nameLen).toString('ascii') !== type) throw new Error('Key type / data mismatch');
  const fingerprint = 'SHA256:' + crypto.createHash('sha256').update(blob).digest('base64').replace(/=+$/, '');
  return { type, fingerprint, normalized: `${type} ${b64}` };
}

// Fingerprint of the raw SSH wire blob (what ssh2 hands us as ctx.key.data).
export function fingerprintBlob(blob: Buffer): string {
  return 'SHA256:' + crypto.createHash('sha256').update(blob).digest('base64').replace(/=+$/, '');
}

class UserKeysService {
  async list(userId: number): Promise<SshPublicKey[]> {
    const rows = await db('user_ssh_keys').where({ user_id: userId }).orderBy('created_at', 'desc');
    return rows.map(rowToKey);
  }

  async add(userId: number, name: string, publicKey: string): Promise<SshPublicKey> {
    const parsed = parsePublicKey(publicKey);
    try {
      const [row] = await db('user_ssh_keys').insert({
        user_id: userId, name: (name || 'key').toString().slice(0, 120),
        key_type: parsed.type, public_key: parsed.normalized, fingerprint: parsed.fingerprint,
      }).returning('*');
      return rowToKey(row);
    } catch (err: any) {
      // Global unique(fingerprint): a key maps to exactly one identity.
      if (err?.code === '23505') throw new Error('This SSH key is already registered');
      throw err;
    }
  }

  async remove(userId: number, id: number): Promise<boolean> {
    const n = await db('user_ssh_keys').where({ id, user_id: userId }).delete();
    return n > 0;
  }

  // Bastion PublicKeyCallback: presented-key fingerprint -> Obliance user.
  async resolveByFingerprint(fingerprint: string): Promise<{ userId: number } | null> {
    const row = await db('user_ssh_keys').where({ fingerprint }).first('user_id');
    if (!row) return null;
    db('user_ssh_keys').where({ fingerprint }).update({ last_used_at: new Date() }).catch(() => {});
    return { userId: row.user_id };
  }
}

export const userKeysService = new UserKeysService();
