import { Router } from 'express';
import { scriptService } from '../services/script.service';
import { scheduleService } from '../services/schedule.service';

const router = Router();

// GET /api/scripts
router.get('/', async (req, res, next) => {
  try {
    const { platform, categoryId, search } = req.query as any;
    const scripts = await scriptService.getScripts(req.tenantId!, {
      platform, categoryId: categoryId ? parseInt(categoryId) : undefined, search,
    });
    res.json(scripts);
  } catch (err) { next(err); }
});

// GET /api/scripts/categories
router.get('/categories', async (req, res, next) => {
  try {
    const categories = await scriptService.getCategories(req.tenantId!);
    res.json(categories);
  } catch (err) { next(err); }
});

// GET /api/scripts/:id
router.get('/:id', async (req, res, next) => {
  try {
    const script = await scriptService.getScriptById(parseInt(req.params.id), req.tenantId!);
    if (!script) return res.status(404).json({ error: 'Script not found' });
    res.json(script);
  } catch (err) { next(err); }
});

// POST /api/scripts
router.post('/', async (req, res, next) => {
  try {
    const script = await scriptService.createScript(req.tenantId!, {
      ...req.body, createdBy: req.session.userId,
    });
    res.status(201).json(script);
  } catch (err) { next(err); }
});

// PUT /api/scripts/:id
router.put('/:id', async (req, res, next) => {
  try {
    const script = await scriptService.updateScript(parseInt(req.params.id), req.tenantId!, {
      ...req.body, updatedBy: req.session.userId,
    });
    if (!script) return res.status(404).json({ error: 'Script not found' });
    res.json(script);
  } catch (err) { next(err); }
});

// DELETE /api/scripts/:id
router.delete('/:id', async (req, res, next) => {
  try {
    await scriptService.deleteScript(parseInt(req.params.id), req.tenantId!);
    res.status(204).send();
  } catch (err) { next(err); }
});

// POST /api/scripts/:id/execute
router.post('/:id/execute', async (req, res, next) => {
  try {
    const { deviceIds, parameterValues } = req.body;
    const executions = await scheduleService.executeNow(
      parseInt(req.params.id), deviceIds, req.tenantId!,
      parameterValues || {}, req.session.userId!
    );
    res.status(202).json(executions);
  } catch (err) { next(err); }
});

export default router;
