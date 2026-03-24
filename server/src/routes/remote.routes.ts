import { Router } from 'express';
import { remoteService } from '../services/remote.service';
import { permissionService } from '../services/permission.service';
import { AppError } from '../middleware/errorHandler';
import { db } from '../db';

const router = Router();

router.post('/sessions', async (req, res, next) => {
  try {
    const { deviceId, protocol, sessionId } = req.body;

    // Permission check — need 'remote' capability
    if (req.session.role !== 'admin') {
      const canRemote = await permissionService.canUseCapability(req.session.userId!, deviceId, false, 'remote');
      if (!canRemote) return next(new AppError(403, 'Remote access not permitted for your team'));
    }
    const session = await remoteService.createSession(
      deviceId, req.tenantId!, req.session.userId!, protocol,
      typeof sessionId === 'number' ? sessionId : undefined,
    );
    res.status(201).json({ data: session });
  } catch (err) { next(err); }
});

router.get('/sessions', async (req, res, next) => {
  try {
    const { deviceId, status } = req.query as any;
    const items = await remoteService.getSessions(req.tenantId!, {
      deviceId: deviceId ? parseInt(deviceId) : undefined, status,
    });
    res.json({ data: { items, total: items.length } });
  } catch (err) { next(err); }
});

// POST /sessions/:id/end — matches client remoteApi.endSession
router.post('/sessions/:id/end', async (req, res, next) => {
  try {
    await remoteService.endSession(req.params.id, req.tenantId!, 'user_disconnect');
    res.status(204).send();
  } catch (err) { next(err); }
});

// DELETE /sessions/:id — legacy path kept for backward compat
router.delete('/sessions/:id', async (req, res, next) => {
  try {
    await remoteService.endSession(req.params.id, req.tenantId!, 'user_disconnect');
    res.status(204).send();
  } catch (err) { next(err); }
});

// ─── Oblireach relay authentication ─────────────────────────────────────────
//
// POST /relay/validate-agent
// Called by the standalone Oblireach relay server to verify that a connecting
// agent is authorised for the given session.  This endpoint is NOT behind the
// normal auth middleware — the relay uses a shared internal secret
// (OBLIREACH_SECRET) passed as the X-Internal-Secret header.
//
// Body:   { sessionToken: string, apiKey: string }
// Returns { valid: boolean, sessionToken: string }
router.post('/relay/validate-agent', async (req, res, next) => {
  try {
    const internalSecret = process.env.OBLIREACH_SECRET;
    if (!internalSecret || req.headers['x-internal-secret'] !== internalSecret) {
      return res.status(403).json({ valid: false, error: 'forbidden' });
    }

    const { sessionToken, apiKey } = req.body as { sessionToken?: string; apiKey?: string };
    if (!sessionToken || !apiKey) {
      return res.status(400).json({ valid: false, error: 'missing fields' });
    }

    // Look up the session and the device's API key together
    const row = await db('remote_sessions as rs')
      .join('agent_api_keys as k', 'k.device_id', 'rs.device_id')
      .where('rs.session_token', sessionToken)
      .where('k.key', apiKey)
      .whereIn('rs.status', ['waiting', 'connecting', 'active'])
      .select('rs.session_token', 'rs.protocol')
      .first();

    if (!row || row.protocol !== 'oblireach') {
      return res.json({ valid: false });
    }

    return res.json({ valid: true, sessionToken: row.session_token });
  } catch (err) { next(err); }
});

// POST /relay/issue-viewer-token
// Called by the Obliance server itself (or by the browser via the regular
// authenticated session) to obtain a short-lived viewer token for the
// Oblireach relay.  Uses the OBLIREACH_SECRET + sessionToken to mint a HMAC
// token that the relay can verify locally.
router.post('/relay/issue-viewer-token', async (req, res, next) => {
  try {
    const { sessionId } = req.body as { sessionId?: string };
    if (!sessionId) return res.status(400).json({ error: 'missing sessionId' });

    const session = await db('remote_sessions')
      .where({ id: sessionId, tenant_id: req.tenantId! })
      .whereIn('status', ['waiting', 'connecting', 'active'])
      .first();

    if (!session || session.protocol !== 'oblireach') {
      return res.status(404).json({ error: 'session not found or wrong protocol' });
    }

    // Derive the relay URL from env (defaults to same host, port 7900)
    const relayHost = process.env.OBLIREACH_RELAY_URL || '';
    const secret    = process.env.OBLIREACH_SECRET    || 'change-me-in-production';
    const viewerToken = issueRelayToken(session.session_token, secret);

    return res.json({ viewerToken, relayHost, sessionToken: session.session_token });
  } catch (err) { next(err); }
});

// ── Helper: mint a relay viewer token identical to the Go relay's format ──────
// Format: "<sessionToken>.<expireUnix>.<hmac-sha256-hex>"
function issueRelayToken(sessionToken: string, secret: string, ttlSeconds = 3600): string {
  const crypto = require('crypto') as typeof import('crypto');
  const expire = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${sessionToken}.${expire}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

export default router;
