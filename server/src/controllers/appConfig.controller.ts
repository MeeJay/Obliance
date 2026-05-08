import type { Request, Response, NextFunction } from 'express';
import { appConfigService } from '../services/appConfig.service';
import { AppError } from '../middleware/errorHandler';

const ALLOWED_KEYS = [
  'allow_2fa', 'force_2fa', 'otp_smtp_server_id',
  'obligate_enabled',
] as const;

export const appConfigController = {
  async getAll(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const cfg = await appConfigService.getAll();
      res.json({ success: true, data: cfg });
    } catch (err) { next(err); }
  },

  async set(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const key = req.params.key as typeof ALLOWED_KEYS[number];
      if (!ALLOWED_KEYS.includes(key)) throw new AppError(400, `Unknown config key: ${key}`);
      const { value } = req.body;
      if (value === undefined) throw new AppError(400, 'Missing value');
      await appConfigService.set(key, String(value));
      res.json({ success: true });
    } catch (err) { next(err); }
  },

  /** GET /admin/config/agent-global */
  async getAgentGlobal(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const cfg = await appConfigService.getAgentGlobal();
      res.json({ success: true, data: cfg });
    } catch (err) { next(err); }
  },

  /** PATCH /admin/config/agent-global */
  async patchAgentGlobal(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { checkIntervalSeconds, scanIntervalSeconds, heartbeatMonitoring, maxMissedPushes, notificationTypes } = req.body;
      const patch: Record<string, unknown> = {};
      if ('checkIntervalSeconds' in req.body) patch.checkIntervalSeconds = checkIntervalSeconds;
      if ('scanIntervalSeconds' in req.body) patch.scanIntervalSeconds = scanIntervalSeconds;
      if ('heartbeatMonitoring' in req.body) patch.heartbeatMonitoring = heartbeatMonitoring;
      if ('maxMissedPushes' in req.body) patch.maxMissedPushes = maxMissedPushes;
      if ('notificationTypes' in req.body) patch.notificationTypes = notificationTypes;
      const updated = await appConfigService.setAgentGlobal(patch);
      res.json({ success: true, data: updated });
    } catch (err) { next(err); }
  },

  // ── Obligate SSO gateway ───────────────────────────────────────────────────

  async getObligateConfig(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const cfg = await appConfigService.getObligateConfig();
      res.json({ success: true, data: cfg });
    } catch (err) { next(err); }
  },

  async setObligateConfig(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const patch: { url?: string | null; apiKey?: string | null; enabled?: boolean } = {};
      if ('url' in req.body) patch.url = (req.body as { url?: string | null }).url?.trim() || null;
      if ('apiKey' in req.body) patch.apiKey = (req.body as { apiKey?: string | null }).apiKey?.trim() || null;
      if ('enabled' in req.body) patch.enabled = !!req.body.enabled;
      const updated = await appConfigService.patchObligateConfig(patch);
      res.json({ success: true, data: updated });
    } catch (err) { next(err); }
  },

  // ── File explorer editable extensions (cross-tenant global setting) ────

  async getEditableExtensions(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const extensions = await appConfigService.getEditableExtensions();
      const defaults = appConfigService.getDefaultEditableExtensions();
      res.json({ success: true, data: { extensions, defaults } });
    } catch (err) { next(err); }
  },

  async setEditableExtensions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { extensions } = req.body as { extensions?: unknown };
      if (!Array.isArray(extensions)) throw new AppError(400, 'extensions must be an array of strings');
      const saved = await appConfigService.setEditableExtensions(extensions as string[]);
      res.json({ success: true, data: { extensions: saved } });
    } catch (err) { next(err); }
  },

  // ── Global metric-threshold default (cascade layer 2) ─────────────
  // Stored as a JSON-encoded string under app_config['metric_thresholds_global'].
  // The endpoint validates the shape with the same Zod schema the
  // group + tenant editors use so all three surfaces accept the same
  // input — no surprise where one layer rejects a payload another
  // would accept.

  async getGlobalThresholds(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const raw = await appConfigService.get('metric_thresholds_global');
      let value: unknown = null;
      if (raw) {
        try { value = JSON.parse(raw); } catch { value = null; }
      }
      res.json({ success: true, data: { thresholds: value } });
    } catch (err) { next(err); }
  },

  async setGlobalThresholds(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { metricThresholdsSchema } = await import('../validators/group.schema');
      const { thresholds } = req.body as { thresholds?: unknown };
      // Treat null/undefined/{} as "clear" — drop the row so the
      // resolver falls through to the system default below it.
      if (thresholds == null || (typeof thresholds === 'object' && Object.keys(thresholds as object).length === 0)) {
        await appConfigService.set('metric_thresholds_global', '');
        const { invalidateGlobalThresholdCache } = await import('../services/threshold.service');
        invalidateGlobalThresholdCache();
        res.json({ success: true, data: { thresholds: null } });
        return;
      }
      const parsed = metricThresholdsSchema.safeParse(thresholds);
      if (!parsed.success) {
        const issues = parsed.error.errors.map((e) => `${e.path.join('.') || '<root>'}: ${e.message}`).join('; ');
        throw new AppError(400, `Invalid thresholds — ${issues}`);
      }
      await appConfigService.set('metric_thresholds_global', JSON.stringify(parsed.data));
      const { invalidateGlobalThresholdCache } = await import('../services/threshold.service');
      invalidateGlobalThresholdCache();
      res.json({ success: true, data: { thresholds: parsed.data } });
    } catch (err) { next(err); }
  },
};
