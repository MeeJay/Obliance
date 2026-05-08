import { db } from '../db';
import { config } from '../config';
import type { SoftwareRepoPackage } from '@obliance/shared';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const REPO_SUBDIR = 'software-repo';
const MAX_FILE_SIZE = parseInt(process.env.REPO_MAX_FILE_SIZE || String(500 * 1024 * 1024), 10); // 500 MB default
const ALLOWED_EXTENSIONS = ['.msi', '.exe', '.deb', '.rpm', '.pkg', '.dmg'];

function repoDir(tenantId: number): string {
  return path.join(config.customDir, REPO_SUBDIR, String(tenantId));
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

  async upload(
    tenantId: number,
    file: { originalname: string; buffer: Buffer; mimetype: string },
    platform: 'windows' | 'linux' | 'macos',
    displayName: string | null,
    uploadedBy: number,
  ): Promise<SoftwareRepoPackage> {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      throw new Error(`File type ${ext} not allowed. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`);
    }
    if (file.buffer.length > MAX_FILE_SIZE) {
      throw new Error(`File too large (${(file.buffer.length / 1024 / 1024).toFixed(0)} MB). Max: ${(MAX_FILE_SIZE / 1024 / 1024).toFixed(0)} MB`);
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
