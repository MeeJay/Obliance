/**
 * Agent tools — serves the static `smartctl` binary to Linux agents that lack
 * smartmontools, for the native disk-health collector (diskHealthProbes.ts).
 *
 * GET /api/agent-tools/smartctl?arch=amd64|arm64&token=<hmac>
 *
 * Public (no session) but token-gated: the token is minted per-device by
 * diskHealthCollector and injected into the probe script. The payload is a
 * public GPL binary, so the token only prevents the endpoint being an open
 * file mirror — it is not a secrecy boundary.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { smartctlAsset } from '../services/smartctlAsset.service';

const router = Router();

router.get('/smartctl', (req: Request, res: Response): void => {
  const arch = String(req.query.arch || '');
  const token = req.query.token as string | undefined;

  if (!smartctlAsset.isArch(arch)) {
    res.status(400).json({ success: false, error: 'invalid arch' });
    return;
  }
  if (!smartctlAsset.verifyToken(token)) {
    res.status(403).json({ success: false, error: 'invalid or expired token' });
    return;
  }
  const filePath = smartctlAsset.resolvePath(arch);
  if (!filePath) {
    res.status(404).json({ success: false, error: 'binary not available' });
    return;
  }
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', 'attachment; filename="smartctl"');
  res.sendFile(filePath, (err) => {
    if (err && !res.headersSent) res.status(500).end();
  });
});

export default router;
