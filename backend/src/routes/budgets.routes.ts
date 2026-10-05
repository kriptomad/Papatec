import { Router } from 'express';
import { existsSync } from 'fs';
import { prisma } from '../db/prisma';
import { ok, created, badRequest, notFound, conflict } from '../http/envelope';
import { handler } from '../http/errors';
import { requireAuth } from '../middleware/auth';
import { settingsService } from '../services/settings.service';
import { resolveUploadPath, removeUploadedFile, PUBLIC_STATICS, uploadBudgetPhotos } from '../services/storage.service';
import { discountValueFor, assertDiscountAllowed } from '../utils/discounts';
import { Prisma } from '@prisma/client';

export const budgetsRouter = Router();

budgetsRouter.use(requireAuth);

const includeBudget = {
  client: true,
  creator: { select: { id: true, name: true, email: true, role: true } },
  items: { include: { part: true, service: true } },
  attachments: true,
  serviceOrder: { select: { id: true, osNumber: true, status: true } },
} as const;

const VALID_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['SENT', 'APPROVED', 'REJECTED', 'EXPIRED'],
  SENT: ['DRAFT', 'APPROVED', 'REJECTED', 'EXPIRED'],
  APPROVED: ['SENT', 'REJECTED'],
  REJECTED: ['DRAFT'],
  EXPIRED: ['DRAFT'],
  CONVERTED_TO_OS: [],
};

interface ItemInput {
  partId?: string | null;
  serviceId?: string | null;
  name: string;
  qty: number;
  unitPrice: number;
  // Briefing B3: desconto por item (% ou R$)
  discount: number;
  discountType: 'VALUE' | 'PERCENT';
  type: 'PART' | 'SERVICE' | 'LABOR';
  // Briefing: comissão personalizada por item (abertura de OS × venda)
  commissionPercent: number;
  commissionValue: number;
  commissionType: 'PERCENT' | 'VALUE';
}

function parseItems(raw: any): ItemInput[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item: any) => {
    const qty = Math.max(1, Math.trunc(Number(item.qty) || 1));
    const unitPrice = Math.max(0, Number(item.unitPrice) || 0);
    const type = ['PART', 'SERVICE', 'LABOR'].includes(item.type) ? item.type : 'PART';
    return {
      partId: item.partId || null,
      serviceId: item.serviceId || null,
      name: String(item.name || '').trim() || (type === 'PART' ? 'Peça' : 'Serviço'),
      qty,
      unitPrice,
      discount: Math.max(0, Number(item.discount) || 0),
      discountType: item.discountType === 'PERCENT' ? ('PERCENT' as const) : ('VALUE' as const),
      type,
      commissionPercent: Math.max(0, Number(item.commissionPercent) || 0),
      commissionValue: Math.max(0, Number(item.commissionValue) || 0),
      commissionType: item.commissionType === 'VALUE' ? ('VALUE' as const) : ('PERCENT' as const),
    };
  });
}

/** Briefing B3: valida os descontos dos itens contra as regras do admin. */
async function validateItemDiscounts(items: ItemInput[]) {
  for (const item of items) {
    await assertDiscountAllowed({
      partId: item.partId,
      base: item.qty * item.unitPrice,
      discount: item.discount,
      discountType: item.discountType,
      label: item.name,
    });
  }
}

/** Valor líquido de um item já com o desconto aplicado. */
function itemNet(i: { qty: number; unitPrice: number; discount?: number; discountType?: string }) {
  const base = round2(i.qty * i.unitPrice);
  return round2(base - discountValueFor(base, i.discount ?? 0, i.discountType || 'VALUE'));
}

function computeTotals(items: ItemInput[], laborHours: number, laborRate: number) {
  const totalParts = items.filter((i) => i.type === 'PART').reduce((sum, i) => sum + itemNet(i), 0);
  const totalServices = items.filter((i) => i.type !== 'PART').reduce((sum, i) => sum + itemNet(i), 0);
  const totalLabor = round2(laborHours) * round2(laborRate);
  const total = round2(totalParts) + round2(totalServices) + round2(totalLabor);
  return {
    totalParts: round2(totalParts),
    totalServices: round2(totalServices),
    totalLabor: round2(totalLabor),
    total: round2(total),
  };
}

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

function validatePayload(body: any) {
  // Briefing: o usuário precisa saber EXATAMENTE quais campos faltam -
  // acumula TODOS os erros e devolve num único 400 com `fields`.
  const errors: Record<string, string> = {};

  const clientId = String(body?.clientId || '').trim();
  if (!clientId) errors.clientId = 'Selecione o cliente';

  const defect = String(body?.defect || '').trim();
  if (defect.length < 5) errors.defect = 'Descreva o defeito (mínimo 5 caracteres)';

  const equipment = Array.isArray(body?.equipment) && body.equipment.length ? body.equipment : [{ name: 'Não informado' }];
  if (!equipment.every((e: any) => e && typeof e === 'object' && String(e.name || '').trim())) {
    errors.equipment = 'Todos os equipamentos precisam de um nome';
  }

  const laborHours = Math.max(0, Number(body?.laborHours) || 0);
  const laborRate = Math.max(0, Number(body?.laborRate) || 0);
  const items = parseItems(body?.items);
  if (!Array.isArray(body?.items) || body.items.length === 0) {
    errors.items = 'Adicione ao menos um item (produto ou serviço)';
  }

  const validUntil = body?.validUntil ? new Date(String(body.validUntil)) : null;
  if (validUntil && Number.isNaN(validUntil.getTime())) errors.validUntil = 'Data de validade inválida';

  // Briefing B2.2: serviço local × externo + endereço do serviço (snapshot)
  const serviceType = body?.serviceType === 'EXTERNAL' ? 'EXTERNAL' : 'LOCAL';
  const rawAddr = body?.serviceAddress;
  const serviceAddress =
    rawAddr && typeof rawAddr === 'object' && String(rawAddr.street || '').trim()
      ? {
          label: rawAddr.label ? String(rawAddr.label) : '',
          street: String(rawAddr.street).trim(),
          number: rawAddr.number ? String(rawAddr.number) : '',
          complement: rawAddr.complement ? String(rawAddr.complement) : '',
          district: rawAddr.district ? String(rawAddr.district) : '',
          zip: rawAddr.zip ? String(rawAddr.zip) : '',
          city: rawAddr.city ? String(rawAddr.city) : '',
          state: rawAddr.state ? String(rawAddr.state) : '',
        }
      : null;
  if (serviceType === 'EXTERNAL' && !serviceAddress) {
    errors.serviceAddress = 'Serviço externo requer o endereço do serviço (rua obrigatória)';
  }

  if (Object.keys(errors).length > 0) {
    throw badRequest('Campos obrigatórios faltando ou inválidos', 'VALIDATION_ERROR', errors);
  }

  return {
    clientId,
    equipment: equipment.map((e: any) => ({
      name: String(e.name || '').trim(),
      brand: e.brand ? String(e.brand) : '',
      model: e.model ? String(e.model) : '',
      serial: e.serial ? String(e.serial) : '',
      photos: Array.isArray(e.photos) ? e.photos : [],
      notes: e.notes ? String(e.notes) : '',
    })),
    defect,
    laborHours,
    laborRate,
    items,
    notes: body?.notes ? String(body.notes) : null,
    validUntil,
    serviceType,
    serviceAddress,
  };
}

async function assertClient(clientId: string) {
  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) throw badRequest('Cliente selecionado não existe.', 'CLIENT_NOT_FOUND');
}

// GET /api/budgets/stats (antes de /:id)
budgetsRouter.get(
  '/stats',
  handler(async (_req, res) => {
    const [total, byStatus, recent] = await Promise.all([
      prisma.budget.count(),
      prisma.budget.groupBy({ by: ['status'], _count: { status: true } }),
      prisma.budget.aggregate({
        where: { createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
        _sum: { total: true },
        _count: true,
      }),
    ]);

    ok(res, {
      total,
      byStatus: byStatus.reduce<Record<string, number>>((acc, curr) => {
        acc[curr.status] = curr._count.status;
        return acc;
      }, {}),
      last30Days: { total: recent._sum.total || 0, count: recent._count },
    });
  })
);

// GET /api/budgets
budgetsRouter.get(
  '/',
  handler(async (req, res) => {
    const pageSize = Math.max(1, Math.min(200, Number(req.query.limit ?? req.query.take) || 20));
    const page = Math.max(1, Number(req.query.page) || 1);
    const skip = req.query.skip !== undefined && req.query.skip !== '' ? Number(req.query.skip) : (page - 1) * pageSize;
    const take = req.query.take !== undefined && req.query.take !== '' ? Number(req.query.take) : pageSize;

    const search = String(req.query.search || '').trim();
    const status = String(req.query.status || '').trim();
    const clientId = String(req.query.clientId || '').trim();
    const startDate = req.query.startDate ? new Date(String(req.query.startDate)) : null;
    const endDate = req.query.endDate ? new Date(String(req.query.endDate)) : null;

    const where: any = {};
    if (search) {
      where.OR = [
        { client: { name: { contains: search, mode: 'insensitive' } } },
        { client: { phone: { contains: search } } },
        { defect: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (status) where.status = status as any;
    if (clientId) where.clientId = clientId;
    if (startDate && !Number.isNaN(startDate.getTime())) where.createdAt = { ...(where.createdAt || {}), gte: startDate };
    if (endDate && !Number.isNaN(endDate.getTime())) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      where.createdAt = { ...(where.createdAt || {}), lte: end };
    }

    const [data, total] = await Promise.all([
      prisma.budget.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take, include: includeBudget }),
      prisma.budget.count({ where }),
    ]);

    ok(res, { data, total, page, pageSize });
  })
);

// GET /api/budgets/:id
budgetsRouter.get(
  '/:id',
  handler(async (req, res) => {
    const budget = await prisma.budget.findUnique({ where: { id: req.params.id }, include: includeBudget });
    if (!budget) throw notFound('Orçamento não encontrado');
    ok(res, budget);
  })
);

// POST /api/budgets
budgetsRouter.post(
  '/',
  uploadBudgetPhotos.any(),
  handler(async (req, res) => {
    const body = req.body?.data ? JSON.parse(req.body.data) : req.body;
    const payload = validatePayload(body);
    await assertClient(payload.clientId);
    await validateItemDiscounts(payload.items);

    const totals = computeTotals(payload.items, payload.laborHours, payload.laborRate);

    const budget = await prisma.budget.create({
      data: {
        clientId: payload.clientId,
        creatorId: req.user!.id,
        status: 'DRAFT',
        equipment: payload.equipment as unknown as Prisma.InputJsonValue,
        defect: payload.defect,
        laborHours: payload.laborHours,
        laborRate: payload.laborRate,
        ...totals,
        notes: payload.notes,
        validUntil: payload.validUntil,
        serviceType: payload.serviceType,
        serviceAddress: payload.serviceAddress ? (payload.serviceAddress as Prisma.InputJsonValue) : Prisma.DbNull,
        items: {
          create: payload.items.map((item: ItemInput) => ({
            partId: item.partId,
            serviceId: item.serviceId,
            name: item.name,
            qty: item.qty,
            unitPrice: item.unitPrice,
            discount: item.discount,
            discountType: item.discountType,
            commissionPercent: item.commissionPercent,
            commissionValue: item.commissionValue,
            commissionType: item.commissionType,
            total: itemNet(item),
            type: item.type as any,
          })),
        },
        attachments: {
          create: (req.files as Express.Multer.File[] | undefined)?.map((file) => ({
            filePath: `${PUBLIC_STATICS.budgets}/${file.filename}`,
          })) || [],
        },
      },
      include: includeBudget,
    });

    created(res, budget);
  })
);

// PUT /api/budgets/:id
budgetsRouter.put(
  '/:id',
  uploadBudgetPhotos.any(),
  handler(async (req, res) => {
    const existing = await prisma.budget.findUnique({ where: { id: req.params.id }, include: { attachments: true } });
    if (!existing) throw notFound('Orçamento não encontrado');
    if (existing.status === 'CONVERTED_TO_OS') {
      throw badRequest('Orçamento já convertido em O.S. e não pode ser editado.', 'ALREADY_CONVERTED');
    }

    const body = req.body?.data ? JSON.parse(req.body.data) : req.body;
    const payload = validatePayload(body);
    await assertClient(payload.clientId);
    await validateItemDiscounts(payload.items);

    const totals = computeTotals(payload.items, payload.laborHours, payload.laborRate);

    const budget = await prisma.$transaction(async (tx) => {
      await tx.budgetItem.deleteMany({ where: { budgetId: existing.id } });

      // Remove fotos antigas do disco se novas foram enviadas
      const files = (req.files as Express.Multer.File[] | undefined) || [];
      if (files.length > 0) {
        for (const attachment of existing.attachments) removeUploadedFile(attachment.filePath);
        await tx.budgetAttachment.deleteMany({ where: { budgetId: existing.id } });
      }

      return tx.budget.update({
        where: { id: existing.id },
        data: {
          clientId: payload.clientId,
          equipment: payload.equipment as unknown as Prisma.InputJsonValue,
          defect: payload.defect,
          laborHours: payload.laborHours,
          laborRate: payload.laborRate,
          ...totals,
          notes: payload.notes,
          validUntil: payload.validUntil,
          serviceType: payload.serviceType,
          serviceAddress: payload.serviceAddress ? (payload.serviceAddress as Prisma.InputJsonValue) : Prisma.DbNull,
          items: {
            create: payload.items.map((item: ItemInput) => ({
              partId: item.partId,
              serviceId: item.serviceId,
              name: item.name,
              qty: item.qty,
              unitPrice: item.unitPrice,
              discount: item.discount,
              discountType: item.discountType,
              commissionPercent: item.commissionPercent,
              commissionValue: item.commissionValue,
              commissionType: item.commissionType,
              total: itemNet(item),
              type: item.type as any,
            })),
          },
          ...(files.length
            ? {
                attachments: {
                  create: files.map((file) => ({ filePath: `${PUBLIC_STATICS.budgets}/${file.filename}` })),
                },
              }
            : {}),
        },
        include: includeBudget,
      });
    });

    ok(res, budget);
  })
);

// PUT /api/budgets/:id/status
budgetsRouter.put(
  '/:id/status',
  handler(async (req, res) => {
    const { status } = req.body || {};
    const budget = await prisma.budget.findUnique({ where: { id: req.params.id } });
    if (!budget) throw notFound('Orçamento não encontrado');
    if (!status) throw badRequest('Status é obrigatório.');

    const allowed = VALID_TRANSITIONS[budget.status] || [];
    if (!allowed.includes(status)) {
      throw badRequest(`Transição inválida: ${budget.status} → ${status}`, 'INVALID_TRANSITION');
    }

    const updated = await prisma.budget.update({
      where: { id: budget.id },
      data: { status },
      include: includeBudget,
    });

    ok(res, updated);
  })
);

// POST /api/budgets/:id/convert-to-os  (ACID - Serializable)
budgetsRouter.post(
  '/:id/convert-to-os',
  handler(async (req, res) => {
    const budgetId = req.params.id;
    const { technicianId, warrantyDays } = req.body || {};

    const result = await prisma.$transaction(
      async (tx) => {
        const budget = await tx.budget.findUnique({
          where: { id: budgetId },
          include: { items: true, serviceOrder: true },
        });

        if (!budget) throw notFound('Orçamento não encontrado');
        if (budget.status !== 'APPROVED') {
          throw badRequest('Apenas orçamentos APROVADOS podem virar O.S.', 'BUDGET_NOT_APPROVED');
        }
        if (budget.serviceOrder) throw conflict('Este orçamento já gerou uma O.S.', 'ALREADY_CONVERTED');

        // Valida técnico
        if (technicianId) {
          const tech = await tx.user.findUnique({ where: { id: technicianId } });
          if (!tech || !tech.active) throw badRequest('Técnico inválido ou inativo.', 'TECHNICIAN_NOT_FOUND');
        }

        // Valida estoque de todas as peças ANTES de qualquer baixa
        for (const item of budget.items) {
          if (item.type !== 'PART' || !item.partId) continue;
          const part = await tx.part.findUnique({ where: { id: item.partId } });
          if (!part) throw badRequest(`Peça "${item.name}" não existe mais no estoque.`, 'PART_NOT_FOUND');
          if (part.status === 'INACTIVE') throw badRequest(`Peça "${item.name}" está inativada.`, 'PART_INACTIVE');
          if (part.quantity < item.qty) {
            throw badRequest(
              `Estoque insuficiente para "${part.name}" (SKU ${part.code}). Disponível: ${part.quantity}, necessário: ${item.qty}.`,
              'INSUFFICIENT_STOCK'
            );
          }
        }

        // Baixa de estoque + movimentos
        for (const item of budget.items) {
          if (item.type !== 'PART' || !item.partId) continue;
          await tx.part.update({
            where: { id: item.partId },
            data: { quantity: { decrement: item.qty } },
          });
          await tx.stockMovement.create({
            data: {
              partId: item.partId,
              type: 'OUT',
              qty: item.qty,
              reason: `Saída para O.S. gerada do orçamento #${budget.id.slice(0, 8)}`,
              userId: req.user!.id,
            },
          });
        }

        const warranty = Math.max(0, Number(warrantyDays) || Number(await settingsService.get<number>('default_warranty_days')) || 90);

        // Briefing B8.2: checklist dos serviços usados vira snapshot da O.S.
        const serviceIds = budget.items.filter((i) => i.serviceId).map((i) => i.serviceId as string);
        const checklist: Array<{ label: string; done: boolean }> = [];
        if (serviceIds.length) {
          const services = await tx.service.findMany({ where: { id: { in: serviceIds } }, select: { name: true, checklist: true } });
          for (const svc of services) {
            if (Array.isArray(svc.checklist)) {
              for (const raw of svc.checklist as any[]) {
                const label = String(typeof raw === 'string' ? raw : raw?.label || '').trim();
                if (label) checklist.push({ label, done: false });
              }
            }
          }
        }

        const os = await tx.serviceOrder.create({
          data: {
            budgetId: budget.id,
            clientId: budget.clientId,
            creatorId: req.user!.id,
            technicianId: technicianId || null,
            status: 'OPEN',
            equipment: budget.equipment as Prisma.InputJsonValue,
            defect: budget.defect,
            laborHours: budget.laborHours,
            laborRate: budget.laborRate,
            totalParts: budget.totalParts,
            totalServices: budget.totalServices,
            totalLabor: budget.totalLabor,
            total: budget.total,
            warrantyDays: warranty,
            serviceType: budget.serviceType,
            serviceAddress: budget.serviceAddress ? (budget.serviceAddress as Prisma.InputJsonValue) : Prisma.DbNull,
            checklist: checklist.length ? (checklist as Prisma.InputJsonValue) : Prisma.DbNull,
            items: {
              create: budget.items.map((item) => ({
                partId: item.partId,
                serviceId: item.serviceId,
                name: item.name,
                qty: item.qty,
                unitPrice: item.unitPrice,
                discount: item.discount,
                discountType: item.discountType,
                commissionPercent: item.commissionPercent || 0,
                commissionValue: item.commissionValue || 0,
                commissionType: item.commissionType || 'PERCENT',
                total: item.total,
                type: item.type,
              })),
            },
            movements: {
              create: {
                userId: req.user!.id,
                fromStatus: null,
                toStatus: 'OPEN',
                note: `O.S. criada a partir do orçamento #${budget.id.slice(0, 8)}`,
              },
            },
          },
          include: {
            client: true,
            items: true,
            technician: { select: { id: true, name: true } },
          },
        });

        await tx.budget.update({
          where: { id: budget.id },
          data: { status: 'CONVERTED_TO_OS' },
        });

        return os;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 }
    );

    ok(res, result);
  })
);

// DELETE /api/budgets/:id
budgetsRouter.delete(
  '/:id',
  handler(async (req, res) => {
    const budget = await prisma.budget.findUnique({
      where: { id: req.params.id },
      include: { attachments: true, serviceOrder: true },
    });
    if (!budget) throw notFound('Orçamento não encontrado');
    if (budget.serviceOrder) {
      throw badRequest('Orçamento vinculado a uma O.S. não pode ser excluído.', 'CONVERTED_TO_OS');
    }
    if (!['DRAFT', 'REJECTED', 'EXPIRED'].includes(budget.status)) {
      throw badRequest('Apenas rascunhos, rejeitados ou expirados podem ser excluídos.', 'INVALID_STATUS');
    }

    for (const attachment of budget.attachments) removeUploadedFile(attachment.filePath);
    await prisma.budget.delete({ where: { id: budget.id } });

    ok(res, { message: 'Orçamento excluído' });
  })
);

// GET /api/budgets/:id/attachment/:attachmentId - baixa de anexo
budgetsRouter.get(
  '/:id/attachment/:attachmentId',
  handler(async (req, res) => {
    const attachment = await prisma.budgetAttachment.findUnique({ where: { id: req.params.attachmentId } });
    if (!attachment || attachment.budgetId !== req.params.id) throw notFound('Anexo não encontrado');

    const full = resolveUploadPath(attachment.filePath);
    if (!existsSync(full)) throw notFound('Arquivo não existe mais no disco');
    res.sendFile(full);
  })
);
