import { Router } from 'express';
import { prisma } from '../db/prisma';
import { ok, created, badRequest, notFound, conflict } from '../http/envelope';
import { handler } from '../http/errors';
import { requireAuth, requireRole } from '../middleware/auth';
import { DEFAULT_SERVICES } from '../services/catalog.service';
import { Prisma } from '@prisma/client';

export const servicesRouter = Router();

servicesRouter.use(requireAuth);

/**
 * Briefing B8.2: checklist opcional do serviço (lista de labels).
 * Aceita ["Limpar cooler", ...] ou [{ label: "..." }, ...].
 */
function parseChecklist(raw: any): string[] | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (!Array.isArray(raw)) throw badRequest('Checklist inválido.');
  const labels = raw
    .map((item: any) => String(typeof item === 'string' ? item : item?.label || '').trim())
    .filter(Boolean);
  return labels.length ? labels : null;
}

/** Converte para o formato aceito pelo Prisma em campo Json anulável. */
function jsonOrNull(value: string[] | null | undefined): typeof Prisma.DbNull | Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.DbNull;
  return value;
}

// GET /api/services/by-category (antes de /:id)
servicesRouter.get(
  '/by-category',
  handler(async (_req, res) => {
    const services = await prisma.service.findMany({
      where: { isActive: true },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
    const grouped = services.reduce<Record<string, typeof services>>((acc, service) => {
      (acc[service.category] ||= []).push(service);
      return acc;
    }, {});
    ok(res, grouped);
  })
);

// GET /api/services
servicesRouter.get(
  '/',
  handler(async (req, res) => {
    const where: any = {};
    if (req.query.category) where.category = String(req.query.category);
    if (req.query.isActive !== undefined) where.isActive = req.query.isActive === 'true';

    const services = await prisma.service.findMany({
      where,
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
    ok(res, services);
  })
);

// GET /api/services/:id
servicesRouter.get(
  '/:id',
  handler(async (req, res) => {
    const service = await prisma.service.findUnique({ where: { id: req.params.id } });
    if (!service) throw notFound('Serviço não encontrado');
    ok(res, service);
  })
);

// POST /api/services (ADMIN)
servicesRouter.post(
  '/',
  requireRole('ADMIN'),
  handler(async (req, res) => {
    const name = String(req.body?.name || '').trim();
    if (!name) throw badRequest('Nome do serviço é obrigatório.');
    const price = Number(req.body?.price);
    if (!Number.isFinite(price) || price < 0) throw badRequest('Preço inválido.');

    if (await prisma.service.findUnique({ where: { name } })) {
      throw conflict('Já existe um serviço com esse nome.', 'DUPLICATE_SERVICE');
    }

    const service = await prisma.service.create({
      data: {
        name,
        description: req.body?.description ? String(req.body.description) : null,
        price,
        category: String(req.body?.category || 'MAINTENANCE').toUpperCase(),
        estimatedHours: Math.max(0, Number(req.body?.estimatedHours) || 1),
        checklist: jsonOrNull(parseChecklist(req.body?.checklist)),
        isActive: req.body?.isActive !== false,
      },
    });
    created(res, service);
  })
);

// PUT /api/services/:id (ADMIN)
servicesRouter.put(
  '/:id',
  requireRole('ADMIN'),
  handler(async (req, res) => {
    const existing = await prisma.service.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('Serviço não encontrado');

    const data: any = {};
    if (req.body?.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!name) throw badRequest('Nome do serviço é obrigatório.');
      if (name !== existing.name) {
        const dup = await prisma.service.findUnique({ where: { name } });
        if (dup) throw conflict('Já existe um serviço com esse nome.', 'DUPLICATE_SERVICE');
      }
      data.name = name;
    }
    if (req.body?.price !== undefined) {
      const price = Number(req.body.price);
      if (!Number.isFinite(price) || price < 0) throw badRequest('Preço inválido.');
      data.price = price;
    }
    if (req.body?.description !== undefined) data.description = req.body.description ? String(req.body.description) : null;
    if (req.body?.category !== undefined) data.category = String(req.body.category).toUpperCase();
    if (req.body?.estimatedHours !== undefined) data.estimatedHours = Math.max(0, Number(req.body.estimatedHours) || 1);
    if (req.body?.checklist !== undefined) data.checklist = jsonOrNull(parseChecklist(req.body.checklist));
    if (req.body?.isActive !== undefined) data.isActive = Boolean(req.body.isActive);

    const service = await prisma.service.update({ where: { id: existing.id }, data });
    ok(res, service);
  })
);

// PUT /api/services/:id/toggle (ADMIN)
servicesRouter.put(
  '/:id/toggle',
  requireRole('ADMIN'),
  handler(async (req, res) => {
    const existing = await prisma.service.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('Serviço não encontrado');
    const service = await prisma.service.update({
      where: { id: existing.id },
      data: { isActive: !existing.isActive },
    });
    ok(res, service);
  })
);

// DELETE /api/services/:id (ADMIN)
servicesRouter.delete(
  '/:id',
  requireRole('ADMIN'),
  handler(async (req, res) => {
    const existing = await prisma.service.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('Serviço não encontrado');

    const used = (await prisma.budgetItem.count({ where: { serviceId: existing.id } }))
      + (await prisma.osItem.count({ where: { serviceId: existing.id } }));

    if (used > 0) {
      const service = await prisma.service.update({ where: { id: existing.id }, data: { isActive: false } });
      return ok(res, {
        deactivated: true,
        message: 'Serviço possui histórico e foi apenas desativado.',
        service,
      });
    }

    await prisma.service.delete({ where: { id: existing.id } });
    ok(res, { message: 'Serviço excluído' });
  })
);

// POST /api/services/init (ADMIN) - recria o catálogo padrão
servicesRouter.post(
  '/init',
  requireRole('ADMIN'),
  handler(async (_req, res) => {
    let createdCount = 0;
    for (const service of DEFAULT_SERVICES) {
      const exists = await prisma.service.findUnique({ where: { name: service.name } });
      if (!exists) {
        await prisma.service.create({ data: service });
        createdCount++;
      }
    }
    ok(res, { message: `${createdCount} serviço(s) padrão criado(s).`, created: createdCount });
  })
);
