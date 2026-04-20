import { Router } from 'express';
import { requireRole } from '../middleware/rbac';
import { commandService } from '../services/command.service';
import { agentHub } from '../services/agentHub.service';
import { privacyGateService } from '../services/privacyGate.service';
import { db } from '../db';
import { AppError } from '../middleware/errorHandler';

const router = Router({ mergeParams: true });

// Rate-limit password attempts per (user, device). Simple in-memory.
const attempts = new Map<string, { count: number; resetAt: number }>();
const RATE_MAX = 5;
const RATE_WINDOW_MS = 60_000;

function checkRateLimit(userId: number, deviceId: number): boolean {
  const k = `${userId}:${deviceId}`;
  const now = Date.now();
  const e = attempts.get(k);
  if (!e || now > e.resetAt) {
    attempts.set(k, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (e.count >= RATE_MAX) return false;
  e.count++;
  return true;
}

/**
 * Dispatch a privacy-gate command to the agent and wait synchronously for
 * the result. Passwords are attached to the payload but NEVER written to
 * the DB command_queue row — we strip them before enqueue.
 */
async function sendPrivacyCommand(
  deviceId: number,
  tenantId: number,
  type: string,
  payload: Record<string, any>,
  userId: number,
): Promise<{ status: string; result: any }> {
  if (!agentHub.isConnected(deviceId)) {
    throw new AppError(503, 'Agent is offline');
  }

  // Create a queue row WITHOUT the secret fields so plaintext never persists.
  const redactedPayload = { ...payload };
  delete redactedPayload.password;
  delete redactedPayload.oldPassword;
  delete redactedPayload.newPassword;

  const cmd = await commandService.enqueue({
    deviceId,
    tenantId,
    type: type as any,
    payload: redactedPayload,
    priority: 'high',
    expiresInSeconds: 30,
    createdBy: userId,
  });

  // Push the FULL payload (with secrets) via the live WS channel. It is not
  // persisted — the WS frame is in memory only, TLS-encrypted in flight.
  const pushed = agentHub.push(deviceId, {
    type: 'command',
    id: cmd.id,
    commandType: type,
    payload,
  });
  if (!pushed) throw new AppError(503, 'Agent push channel failed');

  return commandService.waitForResult(cmd.id, 15000);
}

// POST /api/devices/:id/privacy/password — set, change, or remove
router.post('/password', requireRole('admin'), async (req, res, next) => {
  try {
    const deviceId = parseInt((req.params as any).id);
    const tenantId = req.tenantId!;
    const userId = req.session.userId!;

    const device = await db('devices').where({ id: deviceId, tenant_id: tenantId }).first();
    if (!device) throw new AppError(404, 'Device not found');

    const { action, password, newPassword } = req.body as {
      action: 'set' | 'change' | 'remove';
      password: string;
      newPassword?: string;
    };

    if (!action || !password) throw new AppError(400, 'action and password are required');

    // UI-level check: block when privacy is ON. The agent enforces this too.
    if (device.privacy_mode_enabled) {
      throw new AppError(409, 'Cannot modify privacy password while privacy mode is active');
    }

    let type: string;
    let payload: Record<string, any>;
    if (action === 'set') {
      type = 'set_privacy_password';
      payload = { password };
    } else if (action === 'change') {
      if (!newPassword) throw new AppError(400, 'newPassword required');
      type = 'change_privacy_password';
      payload = { oldPassword: password, newPassword };
    } else if (action === 'remove') {
      type = 'remove_privacy_password';
      payload = { password };
    } else {
      throw new AppError(400, 'Invalid action');
    }

    // Rate limit (wrong password abuse)
    if (!checkRateLimit(userId, deviceId)) {
      throw new AppError(429, 'Too many password attempts, retry in a minute');
    }

    const result = await sendPrivacyCommand(deviceId, tenantId, type, payload, userId);

    if (result.status !== 'success') {
      const err = result.result?.error || 'Operation failed';
      throw new AppError(400, err);
    }

    // Update the persistent "password set" flag on the device.
    const isSet = action !== 'remove';
    await db('devices').where({ id: deviceId }).update({
      privacy_password_set: isSet,
      privacy_password_set_at: isSet ? new Date() : null,
      updated_at: new Date(),
    });

    res.json({ data: { passwordSet: isSet } });
  } catch (err) { next(err); }
});

// POST /api/devices/:id/privacy/unlock — verify password + create unlock session
router.post('/unlock', async (req, res, next) => {
  try {
    const deviceId = parseInt((req.params as any).id);
    const tenantId = req.tenantId!;
    const userId = req.session.userId!;
    const { password, feature } = req.body as { password: string; feature: string };

    if (!password || !feature) throw new AppError(400, 'password and feature are required');

    const device = await db('devices').where({ id: deviceId, tenant_id: tenantId }).first();
    if (!device) throw new AppError(404, 'Device not found');
    if (!device.privacy_password_set) throw new AppError(400, 'No privacy password is set on this device');

    if (!checkRateLimit(userId, deviceId)) {
      throw new AppError(429, 'Too many password attempts, retry in a minute');
    }

    const result = await sendPrivacyCommand(
      deviceId,
      tenantId,
      'verify_privacy_password',
      { password, feature },
      userId,
    );

    if (result.status !== 'success' || !result.result?.unlockToken) {
      throw new AppError(401, result.result?.error || 'Incorrect password');
    }

    privacyGateService.put(userId, deviceId, feature, result.result.unlockToken);
    const ttlSeconds: number = Number(result.result.ttlSeconds) || 900;
    try {
      const { auditService } = await import('../services/audit.service');
      await auditService.logReq(req, 'privacy.unlocked', {
        deviceId, resourceType: 'device', resourcePath: String(deviceId),
        details: { feature, ttlSeconds },
      });
    } catch {}
    res.json({ data: { unlocked: true, feature, ttlSeconds } });
  } catch (err) { next(err); }
});

// POST /api/devices/:id/privacy/disable-with-password — disable privacy via password gate
router.post('/disable-with-password', async (req, res, next) => {
  try {
    const deviceId = parseInt((req.params as any).id);
    const tenantId = req.tenantId!;
    const userId = req.session.userId!;
    const { password } = req.body as { password: string };
    if (!password) throw new AppError(400, 'password is required');

    const device = await db('devices').where({ id: deviceId, tenant_id: tenantId }).first();
    if (!device) throw new AppError(404, 'Device not found');
    if (!device.privacy_password_set) throw new AppError(400, 'No privacy password is set on this device');

    if (!checkRateLimit(userId, deviceId)) {
      throw new AppError(429, 'Too many password attempts, retry in a minute');
    }

    // Verify first
    const verify = await sendPrivacyCommand(
      deviceId,
      tenantId,
      'verify_privacy_password',
      { password, feature: '_disable_' },
      userId,
    );
    if (verify.status !== 'success') {
      throw new AppError(401, verify.result?.error || 'Incorrect password');
    }

    // Password OK -> issue the real disable command.
    const cmd = await commandService.enqueue({
      deviceId,
      tenantId,
      type: 'disable_privacy_mode' as any,
      priority: 'high',
      expiresInSeconds: 60,
      createdBy: userId,
    });
    agentHub.push(deviceId, { type: 'command', id: cmd.id, commandType: 'disable_privacy_mode', payload: {} });
    res.json({ data: { success: true, commandId: cmd.id } });
  } catch (err) { next(err); }
});

// GET /api/devices/:id/privacy/unlocks — list my active unlock sessions for this device
router.get('/unlocks', async (req, res, next) => {
  try {
    const deviceId = parseInt((req.params as any).id);
    const userId = req.session.userId!;
    res.json({ data: privacyGateService.list(userId, deviceId) });
  } catch (err) { next(err); }
});

export default router;
