import { db } from '../db';
import { config } from '../config';
import type { SoftwareRepoPackage, SoftwareRepoSettings } from '@obliance/shared';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const REPO_SUBDIR = 'software-repo';
const MAX_FILE_SIZE = parseInt(process.env.REPO_MAX_FILE_SIZE || String(500 * 1024 * 1024), 10); // 500 MB default
const ALLOWED_EXTENSIONS = ['.msi', '.exe', '.deb', '.rpm', '.pkg', '.dmg'];

/** Error carrying an HTTP status so routes can surface a precise code
 *  (413 quota, 403 disabled) instead of a generic 500/400. */
export class RepoError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'RepoError';
  }
}

function repoDir(tenantId: number): string {
  return path.join(config.customDir, REPO_SUBDIR, String(tenantId));
}

function hashKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

class SoftwareRepoService {
  private rowToPackage(row: any): SoftwareRepoPackage {
    return {
      id: row.id, uuid: row.uuid, tenantId: row.tenant_id,
      filename: row.filename, displayName: row.display_name,
      fileSize: Number(row.file_size), fileHash: row.file_hash,
      mimeType: row.mime_type, platform: row.platform,
      uploadedBy: row.uploaded_by, createdAt: row.created_at,
    };
  }

  async list(tenantId: number): Promise<SoftwareRepoPackage[]> {
    const rows = await db('software_repo_packages')
      .where({ tenant_id: tenantId })
      .orderBy('created_at', 'desc');
    return rows.map(this.rowToPackage);
  }

  // ── Per-tenant settings / quota / access key ──────────────────────────────

  /** Sum of stored package sizes for a tenant (bytes). */
  async usedBytes(tenantId: number): Promise<number> {
    const row = await db('software_repo_packages')
      .where({ tenant_id: tenantId })
      .sum({ total: 'file_size' })
      .first() as any;
    return Number(row?.total ?? 0);
  }

  async getSettings(tenantId: number): Promise<SoftwareRepoSettings> {
    const tenant = await db('tenants').where({ id: tenantId }).first(
      'repo_enabled', 'repo_quota_bytes', 'repo_access_key_hash', 'repo_access_key_prefix',
    ) as any;
    const agg = await db('software_repo_packages')
      .where({ tenant_id: tenantId })
      .sum({ total: 'file_size' })
      .count({ n: '*' })
      .first() as any;
    return {
      enabled: tenant?.repo_enabled !== false,
      quotaBytes: tenant?.repo_quota_bytes != null ? Number(tenant.repo_quota_bytes) : null,
      usedBytes: Number(agg?.total ?? 0),
      packageCount: Number(agg?.n ?? 0),
      hasKey: !!tenant?.repo_access_key_hash,
      keyPrefix: tenant?.repo_access_key_prefix ?? null,
    };
  }

  async updateSettings(
    tenantId: number,
    patch: { enabled?: boolean; quotaBytes?: number | null },
  ): Promise<SoftwareRepoSettings> {
    const update: Record<string, unknown> = {};
    if (patch.enabled !== undefined) update.repo_enabled = patch.enabled;
    if (patch.quotaBytes !== undefined) {
      // Guard against negative / absurd values; null = unlimited.
      update.repo_quota_bytes = patch.quotaBytes == null
        ? null
        : Math.max(0, Math.floor(patch.quotaBytes));
    }
    if (Object.keys(update).length) {
      await db('tenants').where({ id: tenantId }).update(update);
    }
    return this.getSettings(tenantId);
  }

  /** Generate a fresh access key, store only its hash + prefix, return the
   *  plaintext ONCE. Any previous key is replaced (single active key). */
  async generateAccessKey(tenantId: number): Promise<{ key: string; prefix: string }> {
    const key = `obl_repo_${crypto.randomBytes(24).toString('base64url')}`;
    const prefix = key.slice(0, 16);
    await db('tenants').where({ id: tenantId }).update({
      repo_access_key_hash: hashKey(key),
      repo_access_key_prefix: prefix,
    });
    return { key, prefix };
  }

  async revokeAccessKey(tenantId: number): Promise<void> {
    await db('tenants').where({ id: tenantId }).update({
      repo_access_key_hash: null,
      repo_access_key_prefix: null,
    });
  }

  /** Resolve the tenant that owns a given access key (constant-time-ish via
   *  hash lookup). Returns null for unknown keys. */
  async resolveTenantByKey(key: string): Promise<number | null> {
    if (!key) return null;
    const row = await db('tenants')
      .where({ repo_access_key_hash: hashKey(key) })
      .first('id');
    return row ? row.id : null;
  }

  /** True when the tenant's depot is enabled (defaults to true). */
  async isEnabled(tenantId: number): Promise<boolean> {
    const row = await db('tenants').where({ id: tenantId }).first('repo_enabled');
    return row?.repo_enabled !== false;
  }

  /** Throw a 403 RepoError if the depot is disabled for this tenant. */
  async assertEnabled(tenantId: number): Promise<void> {
    if (!(await this.isEnabled(tenantId))) {
      throw new RepoError(403, 'The software repository is disabled for this tenant.');
    }
  }

  async upload(
    tenantId: number,
    file: { originalname: string; buffer: Buffer; mimetype: string },
    platform: 'windows' | 'linux' | 'macos',
    displayName: string | null,
    uploadedBy: number,
  ): Promise<SoftwareRepoPackage> {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      throw new RepoError(400, `File type ${ext} not allowed. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`);
    }
    if (file.buffer.length > MAX_FILE_SIZE) {
      throw new RepoError(413, `File too large (${(file.buffer.length / 1024 / 1024).toFixed(0)} MB). Max: ${(MAX_FILE_SIZE / 1024 / 1024).toFixed(0)} MB`);
    }

    // Depot must be enabled for this tenant (master can turn it off entirely).
    await this.assertEnabled(tenantId);

    // Per-tenant storage quota (NULL = unlimited). Enforced against the sum of
    // already-stored packages + the incoming file.
    const settings = await this.getSettings(tenantId);
    if (settings.quotaBytes != null) {
      const projected = settings.usedBytes + file.buffer.length;
      if (projected > settings.quotaBytes) {
        const mb = (n: number) => (n / 1024 / 1024).toFixed(0);
        throw new RepoError(
          413,
          `Storage quota exceeded: ${mb(settings.usedBytes)} MB used + ${mb(file.buffer.length)} MB > ${mb(settings.quotaBytes)} MB quota.`,
        );
      }
    }

    // SECURITY: sanitise the user-supplied filename before persisting.
    // The DB-stored value ends up in `Content-Disposition: filename=…`
    // on download, so unbounded UTF-8 + CR/LF + quotes lets an
    // attacker:
    //   - inject a CRLF and forge response headers
    //   - inject `; filename*=UTF-8''…` confusable for an admin
    //   - smuggle path traversal segments into a value an
    //     unprotected file-serving middleware later trusts
    // We strip any path component (`basename`), drop control chars
    // and collapse anything that's not [\w.\- ] into `_`, then cap
    // the length. The disk file itself uses `${uuid}${ext}` (already
    // server-controlled), so the sanitisation here protects only the
    // returned headers / API responses.
    const safeFilename = path.basename(file.originalname)
      .replace(/[\u0000-\u001f\u007f\r\n\t]/g, '')
      .replace(/[^\w. \-]/g, '_')
      .slice(0, 200) || `upload${ext}`;

    const hash = crypto.createHash('sha256').update(file.buffer).digest('hex');

    const [row] = await db('software_repo_packages').insert({
      tenant_id: tenantId,
      filename: safeFilename,
      display_name: displayName || safeFilename,
      file_size: file.buffer.length,
      file_hash: hash,
      mime_type: file.mimetype,
      platform,
      uploaded_by: uploadedBy,
    }).returning('*');

    // Write to disk
    const dir = repoDir(tenantId);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${row.uuid}${ext}`);
    fs.writeFileSync(filePath, file.buffer);

    return this.rowToPackage(row);
  }

  async delete(id: number, tenantId: number): Promise<void> {
    const row = await db('software_repo_packages').where({ id, tenant_id: tenantId }).first();
    if (!row) return;

    // Remove file from disk
    const ext = path.extname(row.filename).toLowerCase();
    const filePath = path.join(repoDir(tenantId), `${row.uuid}${ext}`);
    try { fs.unlinkSync(filePath); } catch {}

    await db('software_repo_packages').where({ id, tenant_id: tenantId }).delete();
  }

  async getFilePath(uuid: string, tenantId?: number): Promise<{ filePath: string; filename: string; mimeType: string } | null> {
    let q = db('software_repo_packages').where({ uuid });
    if (tenantId !== undefined) q = q.andWhere({ tenant_id: tenantId });
    const row = await q.first();
    if (!row) return null;

    const ext = path.extname(row.filename).toLowerCase();
    const filePath = path.join(repoDir(row.tenant_id), `${row.uuid}${ext}`);
    if (!fs.existsSync(filePath)) return null;

    return { filePath, filename: row.filename, mimeType: row.mime_type || 'application/octet-stream' };
  }
}

export const softwareRepoService = new SoftwareRepoService();
