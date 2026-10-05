import { Router } from 'express';
import { ok, created } from '../http/envelope';
import { handler } from '../http/errors';
import { requireAuth, requireRole } from '../middleware/auth';
import { settingsService } from '../services/settings.service';

export const settingsRouter = Router();

settingsRouter.use(requireAuth);

// GET /api/settings/catalog - definições (label, categoria, tipo) para a UI (ADMIN)
settingsRouter.get(
  '/catalog',
  requireRole('ADMIN'),
  handler(async (_req, res) => {
    ok(res, settingsService.getCatalog());
  })
);

// GET /api/settings/category/:category (ADMIN)
settingsRouter.get(
  '/category/:category',
  requireRole('ADMIN'),
  handler(async (req, res) => {
    ok(res, await settingsService.getByCategory(req.params.category));
  })
);

// GET /api/settings (ADMIN)
settingsRouter.get(
  '/',
  requireRole('ADMIN'),
  handler(async (_req, res) => {
    ok(res, await settingsService.getAll());
  })
);

// PUT /api/settings (lote) - ADMIN
settingsRouter.put(
  '/',
  requireRole('ADMIN'),
  handler(async (req, res) => {
    const payload = req.body?.settings ?? req.body;
    const results = await settingsService.setMany(payload || {});
    ok(res, { updated: results, settings: await settingsService.getAll() });
  })
);

// POST /api/settings/init - ADMIN
settingsRouter.post(
  '/init',
  requireRole('ADMIN'),
  handler(async (_req, res) => {
    await settingsService.ensureDefaults();
    created(res, { message: 'Configurações padrão criadas.', settings: await settingsService.getAll() });
  })
);

// PUT /api/settings/:key - ADMIN
settingsRouter.put(
  '/:key',
  requireRole('ADMIN'),
  handler(async (req, res) => {
    const { value } = req.body || {};
    const result = await settingsService.set(req.params.key, value);
    ok(res, result);
  })
);
