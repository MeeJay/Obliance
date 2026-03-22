import { Router, Request, Response, NextFunction } from 'express';
import express from 'express';
import { commandService } from '../services/command.service';
import { auditService } from '../services/audit.service';

const router = Router();

// Upload route needs larger body limit for base64 file content
const uploadBodyParser = express.json({ limit: '200mb' });

// POST /api/devices/:deviceId/files/list
router.post('/:deviceId/files/list', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const deviceId = parseInt(req.params.deviceId, 10);
    const { path } = req.body;
    const cmd = await commandService.enqueue({
      deviceId,
      tenantId: req.tenantId!,
      type: 'list_directory',
      payload: { path: path || '' },
      priority: 'high',
      createdBy: req.session?.userId,
    });
    res.json({ data: cmd });
  } catch (err) { next(err); }
});

// POST /api/devices/:deviceId/files/create-directory
router.post('/:deviceId/files/create-directory', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const deviceId = parseInt(req.params.deviceId, 10);
    const { path } = req.body;
    if (!path) return res.status(400).json({ error: 'path is required' });
    await auditService.log({
      tenantId: req.tenantId!,
      userId: req.session?.userId,
      deviceId,
      action: 'file_explorer.create_directory',
      resourceType: 'directory',
      resourcePath: path,
      ipAddress: req.ip,
    });
    const cmd = await commandService.enqueue({
      deviceId,
      tenantId: req.tenantId!,
      type: 'create_directory',
      payload: { path },
      priority: 'high',
      createdBy: req.session?.userId,
    });
    res.json({ data: cmd });
  } catch (err) { next(err); }
});

// POST /api/devices/:deviceId/files/rename
router.post('/:deviceId/files/rename', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const deviceId = parseInt(req.params.deviceId, 10);
    const { oldPath, newPath } = req.body;
    if (!oldPath || !newPath) return res.status(400).json({ error: 'oldPath and newPath are required' });
    await auditService.log({
      tenantId: req.tenantId!,
      userId: req.session?.userId,
      deviceId,
      action: 'file_explorer.rename',
      resourceType: 'file',
      resourcePath: oldPath,
      details: { newPath },
      ipAddress: req.ip,
    });
    const cmd = await commandService.enqueue({
      deviceId,
      tenantId: req.tenantId!,
      type: 'rename_file',
      payload: { oldPath, newPath },
      priority: 'high',
      createdBy: req.session?.userId,
    });
    res.json({ data: cmd });
  } catch (err) { next(err); }
});

// POST /api/devices/:deviceId/files/delete
router.post('/:deviceId/files/delete', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const deviceId = parseInt(req.params.deviceId, 10);
    const { path, recursive } = req.body;
    if (!path) return res.status(400).json({ error: 'path is required' });
    await auditService.log({
      tenantId: req.tenantId!,
      userId: req.session?.userId,
      deviceId,
      action: 'file_explorer.delete',
      resourceType: recursive ? 'directory' : 'file',
      resourcePath: path,
      details: { recursive: !!recursive },
      ipAddress: req.ip,
    });
    const cmd = await commandService.enqueue({
      deviceId,
      tenantId: req.tenantId!,
      type: 'delete_file',
      payload: { path, recursive: !!recursive },
      priority: 'high',
      createdBy: req.session?.userId,
    });
    res.json({ data: cmd });
  } catch (err) { next(err); }
});

// POST /api/devices/:deviceId/files/download
router.post('/:deviceId/files/download', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const deviceId = parseInt(req.params.deviceId, 10);
    const { path } = req.body;
    if (!path) return res.status(400).json({ error: 'path is required' });
    await auditService.log({
      tenantId: req.tenantId!,
      userId: req.session?.userId,
      deviceId,
      action: 'file_explorer.download',
      resourceType: 'file',
      resourcePath: path,
      ipAddress: req.ip,
    });
    const cmd = await commandService.enqueue({
      deviceId,
      tenantId: req.tenantId!,
      type: 'download_file',
      payload: { path },
      priority: 'high',
      createdBy: req.session?.userId,
    });
    res.json({ data: cmd });
  } catch (err) { next(err); }
});

// POST /api/devices/:deviceId/files/upload
router.post('/:deviceId/files/upload', uploadBodyParser, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const deviceId = parseInt(req.params.deviceId, 10);
    const { path, data, overwrite } = req.body;
    if (!path || !data) return res.status(400).json({ error: 'path and data are required' });
    await auditService.log({
      tenantId: req.tenantId!,
      userId: req.session?.userId,
      deviceId,
      action: 'file_explorer.upload',
      resourceType: 'file',
      resourcePath: path,
      details: { overwrite: !!overwrite, sizeBytes: Math.round(data.length * 0.75) },
      ipAddress: req.ip,
    });
    const cmd = await commandService.enqueue({
      deviceId,
      tenantId: req.tenantId!,
      type: 'upload_file',
      payload: { path, data, overwrite: !!overwrite },
      priority: 'high',
      createdBy: req.session?.userId,
    });
    res.json({ data: cmd });
  } catch (err) { next(err); }
});

// POST /api/devices/:deviceId/files/open-explorer (audit: user opened file explorer)
router.post('/:deviceId/files/open-explorer', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const deviceId = parseInt(req.params.deviceId, 10);
    await auditService.log({
      tenantId: req.tenantId!,
      userId: req.session?.userId,
      deviceId,
      action: 'file_explorer.open',
      ipAddress: req.ip,
    });
    res.json({ data: { logged: true } });
  } catch (err) { next(err); }
});

// GET /api/devices/:deviceId/files/audit-log
router.get('/:deviceId/files/audit-log', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const deviceId = parseInt(req.params.deviceId, 10);
    const logs = await auditService.getByDevice(deviceId, req.tenantId!);
    res.json({ data: logs });
  } catch (err) { next(err); }
});

export default router;
