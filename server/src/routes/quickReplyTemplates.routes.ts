import { Router, type Request, type Response } from 'express';
import { db } from '../db';
import type { QuickReplyTemplate } from '@obliance/shared';

const router = Router();

function rowToTemplate(row: any): QuickReplyTemplate {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    translations: typeof row.translations === 'string' ? JSON.parse(row.translations) : row.translations,
    sortOrder: row.sort_order,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// GET / — list all templates for the tenant (all users)
router.get('/', async (req: Request, res: Response, next) => {
  try {
    const rows = await db('quick_reply_templates')
      .where({ tenant_id: req.tenantId! })
      .orderBy('sort_order', 'asc');
    res.json({ data: rows.map(rowToTemplate) });
  } catch (err) { next(err); }
});

// POST / — create a new template (admin only)
router.post('/', async (req: Request, res: Response, next) => {
  try {
    const user = (req as any).session;
    if (user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

    const { translations } = req.body;
    if (!translations || typeof translations !== 'object') {
      return res.status(400).json({ error: 'translations object required' });
    }

    const maxOrder = await db('quick_reply_templates')
      .where({ tenant_id: req.tenantId! })
      .max('sort_order as max')
      .first();

    const [row] = await db('quick_reply_templates').insert({
      tenant_id: req.tenantId!,
      translations: JSON.stringify(translations),
      sort_order: (maxOrder?.max ?? -1) + 1,
      created_by: user.userId,
    }).returning('*');

    res.status(201).json({ data: rowToTemplate(row) });
  } catch (err) { next(err); }
});

// PUT /:id — update a template (admin only)
router.put('/:id', async (req: Request, res: Response, next) => {
  try {
    const user = (req as any).session;
    if (user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

    const updates: any = {};
    if (req.body.translations) updates.translations = JSON.stringify(req.body.translations);
    if (req.body.sortOrder !== undefined) updates.sort_order = req.body.sortOrder;
    updates.updated_at = new Date();

    const [row] = await db('quick_reply_templates')
      .where({ id: req.params.id, tenant_id: req.tenantId! })
      .update(updates)
      .returning('*');

    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json({ data: rowToTemplate(row) });
  } catch (err) { next(err); }
});

// PUT /reorder — reorder templates (admin only)
router.put('/reorder', async (req: Request, res: Response, next) => {
  try {
    const user = (req as any).session;
    if (user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

    const { ids } = req.body as { ids: number[] };
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids array required' });

    await db.transaction(async (trx) => {
      for (let i = 0; i < ids.length; i++) {
        await trx('quick_reply_templates')
          .where({ id: ids[i], tenant_id: req.tenantId! })
          .update({ sort_order: i });
      }
    });

    res.json({ success: true });
  } catch (err) { next(err); }
});

// DELETE /:id — delete a template (admin only)
router.delete('/:id', async (req: Request, res: Response, next) => {
  try {
    const user = (req as any).session;
    if (user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

    const deleted = await db('quick_reply_templates')
      .where({ id: req.params.id, tenant_id: req.tenantId! })
      .delete();

    if (!deleted) return res.status(404).json({ error: 'Not found' });
    res.status(204).send();
  } catch (err) { next(err); }
});

export default router;
