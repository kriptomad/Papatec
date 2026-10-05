import { Router } from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { prisma } from '../db/prisma';
import { ok, created, badRequest, notFound, conflict } from '../http/envelope';
import { handler } from '../http/errors';
import { requireAuth } from '../middleware/auth';
import { uploadOsPhotos, resolveUploadPath, removeUploadedFile, PUBLIC_STATICS } from '../services/storage.service';
import { discountValueFor, assertDiscountAllowed } from '../utils/discounts';
import { Prisma } from '@prisma/client';
import { existsSync } from 'fs';
import { broadcastOsUpdate } from './osRealtime.routes';

export const serviceOrdersRouter = Router();

serviceOrdersRouter.use(requireAuth);

const includeOrder = {
  client: true,
  creator: { select: { id: true, name: true, email: true, role: true } },
  technician: { select: { id: true, name: true, email: true, role: true } },
  items: { include: { part: true, service: true } },
  photos: true,
  movements: { orderBy: { createdAt: 'asc' } as any, include: { user: { select: { id: true, name: true, role: true } } } },
  visits: { orderBy: [{ date: 'asc' }, { scheduledAt: 'asc' }] as any, include: { tech: { select: { id: true, name: true } } } },
  budget: { select: { id: true, status: true, createdAt: true, total: true, defect: true } },
} as const;

const VALID_TRANSITIONS: Record<string, string[]> = {
  OPEN: ['IN_PROGRESS', 'WAITING_PARTS', 'CANCELLED'],
  IN_PROGRESS: ['WAITING_PARTS', 'READY', 'CANCELLED', 'OPEN'],
  WAITING_PARTS: ['IN_PROGRESS', 'CANCELLED'],
  READY: ['DELIVERED', 'IN_PROGRESS', 'CANCELLED'],
  DELIVERED: [],
  CANCELLED: ['OPEN'],
};

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

function parseItems(raw: any): any[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item: any) => ({
    partId: item.partId || null,
    serviceId: item.serviceId || null,
    name: String(item.name || '').trim() || 'Item',
    qty: Math.max(1, Math.trunc(Number(item.qty) || 1)),
    unitPrice: Math.max(0, Number(item.unitPrice) || 0),
    // Briefing B3: desconto por item (% ou R$)
    discount: Math.max(0, Number(item.discount) || 0),
    discountType: item.discountType === 'PERCENT' ? 'PERCENT' : 'VALUE',
    type: ['PART', 'SERVICE', 'LABOR'].includes(item.type) ? item.type : 'PART',
    // Briefing: comissão personalizada por item
    commissionPercent: Math.max(0, Number(item.commissionPercent) || 0),
    commissionValue: Math.max(0, Number(item.commissionValue) || 0),
    commissionType: item.commissionType === 'VALUE' ? 'VALUE' : 'PERCENT',
  }));
}

/** Comissão total somada dos itens. */
function computeCommission(items: any[]): number {
  const total = items.reduce((s, i) => {
    const net = itemNet(i);
    const comm = i.commissionType === 'VALUE'
      ? (i.commissionValue || 0)
      : (net * (i.commissionPercent || 0)) / 100;
    return s + comm;
  }, 0);
  return round2(total);
}

/** Valor líquido de um item já com o desconto aplicado. */
function itemNet(i: { qty: number; unitPrice: number; discount?: number; discountType?: string }) {
  const base = round2(i.qty * i.unitPrice);
  return round2(base - discountValueFor(base, i.discount ?? 0, i.discountType || 'VALUE'));
}

function computeTotals(items: any[], laborHours: number, laborRate: number) {
  const totalParts = items.filter((i) => i.type === 'PART').reduce((s, i) => s + itemNet(i), 0);
  const totalServices = items.filter((i) => i.type !== 'PART').reduce((s, i) => s + itemNet(i), 0);
  const totalLabor = round2(laborHours) * round2(laborRate);
  return {
    totalParts: round2(totalParts),
    totalServices: round2(totalServices),
    totalLabor: round2(totalLabor),
    total: round2(totalParts + totalServices + totalLabor),
  };
}

/** Briefing B3: valida o desconto de um item contra as regras do admin. */
async function validateItemDiscounts(items: any[]) {
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

function normalizeAddress(raw: any) {
  return raw && typeof raw === 'object' && String(raw.street || '').trim()
    ? {
        label: raw.label ? String(raw.label) : '',
        street: String(raw.street).trim(),
        number: raw.number ? String(raw.number) : '',
        complement: raw.complement ? String(raw.complement) : '',
        district: raw.district ? String(raw.district) : '',
        zip: raw.zip ? String(raw.zip) : '',
        city: raw.city ? String(raw.city) : '',
        state: raw.state ? String(raw.state) : '',
      }
    : null;
}

function serviceAddressFrom(body: any) {
  return normalizeAddress(body?.serviceAddress);
}

function validatePayload(body: any) {
  // Briefing: indicar TODOS os campos faltando de uma vez
  const errors: Record<string, string> = {};

  const clientId = String(body?.clientId || '').trim();
  if (!clientId) errors.clientId = 'Selecione o cliente';
  const defect = String(body?.defect || '').trim();
  if (defect.length < 3) errors.defect = 'Descreva o defeito/problema (mínimo 3 caracteres)';
  const equipment = Array.isArray(body?.equipment) && body.equipment.length ? body.equipment : [{ name: 'Não informado' }];

  // Briefing B2.2: serviço local × externo × acesso remoto + endereço; C2: fonte da mão de obra
  const serviceType = ['EXTERNAL', 'REMOTE'].includes(body?.serviceType) ? body.serviceType : 'LOCAL';
  const serviceAddress = serviceAddressFrom(body);
  if (serviceType === 'EXTERNAL' && !serviceAddress) {
    errors.serviceAddress = 'Serviço externo requer o endereço do serviço (rua obrigatória)';
  }

  // Briefing: serviço externo com VÁRIOS endereços (residência + escritório...).
  // O endereço principal continua sendo `serviceAddress`; os demais vêm em
  // `extraAddresses`. Só o principal é obrigatório — ter 1 endereço é válido.
  const extraAddresses: any[] = [];
  const rawExtras = Array.isArray(body?.extraAddresses) ? body.extraAddresses : [];
  rawExtras.forEach((raw: any, i: number) => {
    const addr = normalizeAddress(raw);
    if (addr) {
      extraAddresses.push(addr);
      return;
    }
    // Objeto preenchido parcialmente (digitou a cidade mas esqueceu a rua)
    const touched =
      raw && typeof raw === 'object' && Object.values(raw).some((v) => String(v ?? '').trim());
    if (touched && serviceType === 'EXTERNAL') {
      errors[`extraAddresses.${i}.street`] = `Endereço ${i + 2}: a rua é obrigatória`;
    }
  });

  const laborSource = body?.laborSource === 'VISITS' ? 'VISITS' : 'MANUAL';

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
      // Briefing: acessórios entregues, estado de conservação, senha do aparelho
      accessories: e.accessories ? String(e.accessories) : '',
      condition: e.condition ? String(e.condition) : '',
      password: e.password ? String(e.password) : '',
      droppedOffBy: e.droppedOffBy ? String(e.droppedOffBy) : '',
    })),
    defect,
    diagnosis: body?.diagnosis ? String(body.diagnosis) : null,
    solution: body?.solution ? String(body.solution) : null,
    laborHours: Math.max(0, Number(body?.laborHours) || 0),
    laborRate: Math.max(0, Number(body?.laborRate) || 0),
    warrantyDays: Math.max(0, Math.trunc(Number(body?.warrantyDays) || 90)),
    technicianId: body?.technicianId || null,
    items: parseItems(body?.items),
    serviceType,
    serviceAddress,
    // Lista completa de endereços do serviço externo (principal + adicionais).
    // Fica nula em LOCAL/REMOTE. Ã‰ a base para gerar UMA VISITA POR ENDEREÃ‡O
    // e para o popup de agendamento escolher o local de cada horário.
    serviceAddresses: serviceType === 'EXTERNAL' && serviceAddress
      ? [serviceAddress, ...extraAddresses]
      : null,
    laborSource,
    // Briefing O.S.: observações internas x externas (a externa é impressa)
    internalNotes: body?.internalNotes ? String(body.internalNotes) : null,
    externalNotes: body?.externalNotes ? String(body.externalNotes) : null,
    // Briefing O.S.: acessórios/estado/senha/quem deixou (snapshot na O.S.)
    accessories: body?.accessories ? String(body.accessories) : null,
    condition: body?.condition ? String(body.condition) : null,
    devicePassword: body?.devicePassword ? String(body.devicePassword) : null,
    droppedOffBy: body?.droppedOffBy ? String(body.droppedOffBy) : null,
    // Briefing: delivery - retirado/levado ao cliente com valor automático
    deliveryType: ['NONE', 'PICKUP', 'DELIVERY'].includes(body?.deliveryType) ? body.deliveryType : 'NONE',
    deliveryValue: Math.max(0, Number(body?.deliveryValue) || 0),
    deliveryDone: body?.deliveryDone === true,
    // PDF p.6/7 - fechamento de O.S.: forma de pagamento combinada,
    // contato com cliente (aprovação + desconto) e resumo p/ cliente.
    // undefined = campo não enviado, não toca no valor existente.
    paymentMethod: body?.paymentMethod !== undefined
      ? (body.paymentMethod ? String(body.paymentMethod) : null)
      : undefined,
    clientApproved: typeof body?.clientApproved === 'boolean'
      ? body.clientApproved
      : (body?.clientApproved !== undefined ? null : undefined),
    clientContactNotes: body?.clientContactNotes !== undefined
      ? (body.clientContactNotes ? String(body.clientContactNotes) : null)
      : undefined,
    clientSummary: body?.clientSummary !== undefined
      ? (body.clientSummary ? String(body.clientSummary) : null)
      : undefined,
  };
}

/**
 * Briefing B1: O.S. entregue só é editada com senha.
 * Aceita senha de um ADMIN ativo, ou a senha do próprio usuário logado quando
 * ele é RECEPTIONIST (vendedor). Técnico comum não destrava.
 */
async function assertOrderEditable(req: any, order: { status: string }) {
  // Briefing B1: concluída (READY) ou entregue (DELIVERED) só edita com senha
  if (order.status !== 'DELIVERED' && order.status !== 'READY') return;
  const raw = req.body?.data && typeof req.body.data === 'string' ? JSON.parse(req.body.data) : req.body;
  const password = raw?.unlockPassword || req.query?.unlockPassword;
  if (!password) {
    throw badRequest('O.S. concluída/entregue: informe a senha (admin ou vendedor) para editar.', 'ALREADY_DELIVERED');
  }
  const user = req.user!;
  if (user.role === 'RECEPTIONIST') {
    const self = await prisma.user.findUnique({ where: { id: user.id } });
    if (!self || !self.active || !(await bcrypt.compare(String(password), self.password))) {
      throw badRequest('Senha inválida para destravar a edição.', 'INVALID_UNLOCK_PASSWORD');
    }
    return;
  }
  const admins = await prisma.user.findMany({ where: { role: 'ADMIN', active: true } });
  for (const admin of admins) {
    if (await bcrypt.compare(String(password), admin.password)) return;
  }
  throw badRequest('Senha de administrador inválida.', 'INVALID_UNLOCK_PASSWORD');
}

/**
 * Briefing C2: soma das horas registradas nas visitas (entrada → saída).
 * Usado quando a mão de obra da O.S. vem do registro de horas.
 */
async function sumVisitHours(osId: string): Promise<number> {
  const visits = await prisma.serviceVisit.findMany({ where: { osId } });
  const hours = visits.reduce((sum, v) => {
    if (!v.arrival || !v.departure) return sum;
    return sum + (v.departure.getTime() - v.arrival.getTime()) / 3_600_000;
  }, 0);
  return round2(hours);
}

// GET /api/service-orders/stats
serviceOrdersRouter.get(
  '/stats',
  handler(async (_req, res) => {
    const [total, byStatus, delivered] = await Promise.all([
      prisma.serviceOrder.count(),
      prisma.serviceOrder.groupBy({ by: ['status'], _count: { status: true } }),
      prisma.serviceOrder.aggregate({
        where: { status: 'DELIVERED' },
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
      delivered: { total: delivered._sum.total || 0, count: delivered._count },
    });
  })
);

// GET /api/service-orders
serviceOrdersRouter.get(
  '/',
  handler(async (req, res) => {
    const pageSize = Math.max(1, Math.min(200, Number(req.query.limit ?? req.query.take) || 20));
    const page = Math.max(1, Number(req.query.page) || 1);
    const skip = req.query.skip !== undefined && req.query.skip !== '' ? Number(req.query.skip) : (page - 1) * pageSize;
    const take = req.query.take !== undefined && req.query.take !== '' ? Number(req.query.take) : pageSize;

    const search = String(req.query.search || '').trim();
    const status = String(req.query.status || '').trim();
    const clientId = String(req.query.clientId || '').trim();
    const technicianId = String(req.query.technicianId || '').trim();

    const searchNum = parseInt(search);
    const isNumeric = !isNaN(searchNum);
    const where: any = {};
    if (search) {
      where.OR = [
        ...(isNumeric ? [{ osNumber: { equals: searchNum } }] : []),
        { client: { name: { contains: search, mode: 'insensitive' } } },
        { client: { phone: { contains: search } } },
        { defect: { contains: search, mode: 'insensitive' } },
        { diagnosis: { contains: search, mode: 'insensitive' } },
        { items: { some: { name: { contains: search, mode: 'insensitive' } } } },
      ];
    }
    if (status) where.status = status as any;
    if (clientId) where.clientId = clientId;
    if (technicianId) where.technicianId = technicianId;

    if (req.query.startDate) {
      const start = new Date(String(req.query.startDate));
      if (!Number.isNaN(start.getTime())) where.createdAt = { ...(where.createdAt || {}), gte: start };
    }
    if (req.query.endDate) {
      const end = new Date(String(req.query.endDate));
      end.setHours(23, 59, 59, 999);
      if (!Number.isNaN(end.getTime())) where.createdAt = { ...(where.createdAt || {}), lte: end };
    }

    const [data, total] = await Promise.all([
      prisma.serviceOrder.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take, include: includeOrder }),
      prisma.serviceOrder.count({ where }),
    ]);

    ok(res, { data, total, page, pageSize });
  })
);

// GET /api/service-orders/:id
serviceOrdersRouter.get(
  '/:id',
  handler(async (req, res) => {
    const order = await prisma.serviceOrder.findUnique({ where: { id: req.params.id }, include: includeOrder });
    if (!order) throw notFound('Ordem de Serviço não encontrada');
    ok(res, order);
  })
);

// GET /api/service-orders/:id/timeline
serviceOrdersRouter.get(
  '/:id/timeline',
  handler(async (req, res) => {
    const order = await prisma.serviceOrder.findUnique({ where: { id: req.params.id } });
    if (!order) throw notFound('Ordem de Serviço não encontrada');

    const movements = await prisma.osMovement.findMany({
      where: { osId: order.id },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { id: true, name: true, role: true } } },
    });
    ok(res, movements);
  })
);

// POST /api/service-orders
serviceOrdersRouter.post(
  '/',
  uploadOsPhotos.any(),
  handler(async (req, res) => {
    const body = req.body?.data ? JSON.parse(req.body.data) : req.body;
    const payload = validatePayload(body);
    await validateItemDiscounts(payload.items);

    const client = await prisma.client.findUnique({ where: { id: payload.clientId } });
    if (!client) throw badRequest('Cliente selecionado não existe.', 'CLIENT_NOT_FOUND');

    // Briefing C2: com "horas do registro", a mão de obra vem das visitas
    // (O.S. nova ainda não tem visitas)
    const laborHours = payload.laborSource === 'VISITS' ? 0 : payload.laborHours;
    const totals = computeTotals(payload.items, laborHours, payload.laborRate);

    const order = await prisma.$transaction(async (tx) => {
      // Briefing B8.2: checklist dos serviços usados vira snapshot da O.S.
      const serviceIds = payload.items.filter((i: any) => i.serviceId).map((i: any) => i.serviceId);
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

      const createdOrder = await tx.serviceOrder.create({
        data: {
          clientId: payload.clientId,
          creatorId: req.user!.id,
          technicianId: payload.technicianId,
          status: 'OPEN',
          equipment: payload.equipment as unknown as Prisma.InputJsonValue,
          defect: payload.defect,
          diagnosis: payload.diagnosis,
          solution: payload.solution,
          laborHours,
          laborRate: payload.laborRate,
          warrantyDays: payload.warrantyDays,
          serviceType: payload.serviceType,
          serviceAddress: payload.serviceAddress ? (payload.serviceAddress as Prisma.InputJsonValue) : Prisma.DbNull,
          // Lista completa de endereços do serviço externo (principal + adicionais)
          serviceAddresses: payload.serviceAddresses ? (payload.serviceAddresses as Prisma.InputJsonValue) : Prisma.DbNull,
          laborSource: payload.laborSource,
          checklist: checklist.length ? (checklist as Prisma.InputJsonValue) : Prisma.DbNull,
          paymentMethod: payload.paymentMethod,
          clientApproved: payload.clientApproved,
          clientContactNotes: payload.clientContactNotes,
          clientSummary: payload.clientSummary,
          internalNotes: payload.internalNotes,
          externalNotes: payload.externalNotes,
          accessories: payload.accessories,
          condition: payload.condition,
          devicePassword: payload.devicePassword,
          droppedOffBy: payload.droppedOffBy,
          deliveryType: payload.deliveryType,
          deliveryValue: payload.deliveryValue,
          deliveryDone: payload.deliveryDone,
          totalCommission: computeCommission(payload.items),
          ...totals,
          items: {
            create: payload.items.map((item: any) => ({
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
              type: item.type,
            })),
          },
          movements: {
            create: {
              userId: req.user!.id,
              toStatus: 'OPEN',
              note: 'O.S. criada',
            },
          },
          photos: {
            create: ((req.files as Express.Multer.File[] | undefined) || []).map((file) => ({
              filePath: `${PUBLIC_STATICS.os}/${file.filename}`,
            })),
          },
        },
        include: includeOrder,
      });

      // Baixa de estoque das peças já vinculadas
      await this_decrementStock(tx, payload.items, req.user!.id, createdOrder.id);
      return createdOrder;
    });

    created(res, order);
  })
);

/** Baixa de estoque das peças (com movimento registrado). */
async function this_decrementStock(
  tx: Prisma.TransactionClient,
  items: any[],
  userId: string,
  osId: string
) {
  for (const item of items) {
    if (item.type !== 'PART' || !item.partId) continue;
    const part = await tx.part.findUnique({ where: { id: item.partId } });
    if (!part) throw badRequest(`Peça "${item.name}" não existe no estoque.`, 'PART_NOT_FOUND');
    if (part.quantity < item.qty) {
      throw badRequest(
        `Estoque insuficiente para "${part.name}" (SKU ${part.code}). Disponível: ${part.quantity}, necessário: ${item.qty}.`,
        'INSUFFICIENT_STOCK'
      );
    }
    await tx.part.update({ where: { id: item.partId }, data: { quantity: { decrement: item.qty } } });
    await tx.stockMovement.create({
      data: {
        partId: item.partId,
        type: 'OUT',
        qty: item.qty,
        reason: `Saída para O.S. #${osId.slice(0, 8)}`,
        unitValue: item.unitPrice || 0,
        userId,
      },
    });
  }
}

// PUT /api/service-orders/:id
serviceOrdersRouter.put(
  '/:id',
  uploadOsPhotos.any(),
  handler(async (req, res) => {
    const existing = await prisma.serviceOrder.findUnique({
      where: { id: req.params.id },
      include: { items: true, photos: true },
    });
    if (!existing) throw notFound('Ordem de Serviço não encontrada');
    // Briefing B1: entregue só edita com senha (admin ou vendedor)
    await assertOrderEditable(req, existing);

    const body = req.body?.data ? JSON.parse(req.body.data) : req.body;
    const payload = validatePayload(body);
    await validateItemDiscounts(payload.items);

    const client = await prisma.client.findUnique({ where: { id: payload.clientId } });
    if (!client) throw badRequest('Cliente selecionado não existe.', 'CLIENT_NOT_FOUND');

    // Briefing C2: "horas do registro" prevalece sobre o digitado
    const laborHours = payload.laborSource === 'VISITS' ? await sumVisitHours(existing.id) : payload.laborHours;
    const totals = computeTotals(payload.items, laborHours, payload.laborRate);
    const files = (req.files as Express.Multer.File[] | undefined) || [];

    const order = await prisma.$transaction(async (tx) => {
      // Devolve estoque das peças removidas / alteradas
      for (const oldItem of existing.items) {
        if (oldItem.type !== 'PART' || !oldItem.partId) continue;
        const stillPresent = payload.items.some(
          (i: any) => i.partId === oldItem.partId && i.type === 'PART'
        );
        if (!stillPresent) {
          await tx.part.update({ where: { id: oldItem.partId }, data: { quantity: { increment: oldItem.qty } } });
          await tx.stockMovement.create({
            data: {
              partId: oldItem.partId,
              type: 'IN',
              qty: oldItem.qty,
              reason: 'Devolução - item removido da O.S.',
              userId: req.user!.id,
            },
          });
        }
      }

      await tx.osItem.deleteMany({ where: { osId: existing.id } });

      if (files.length > 0) {
        for (const photo of existing.photos) removeUploadedFile(photo.filePath);
        await tx.osPhoto.deleteMany({ where: { osId: existing.id } });
      }

      const updated = await tx.serviceOrder.update({
        where: { id: existing.id },
        data: {
          clientId: payload.clientId,
          technicianId: payload.technicianId,
          paymentMethod: payload.paymentMethod,
          clientApproved: payload.clientApproved,
          clientContactNotes: payload.clientContactNotes,
          clientSummary: payload.clientSummary,
          equipment: payload.equipment as unknown as Prisma.InputJsonValue,
          defect: payload.defect,
          diagnosis: payload.diagnosis,
          solution: payload.solution,
          laborHours,
          laborRate: payload.laborRate,
          warrantyDays: payload.warrantyDays,
          serviceType: payload.serviceType,
          serviceAddress: payload.serviceAddress ? (payload.serviceAddress as Prisma.InputJsonValue) : Prisma.DbNull,
          // Lista completa de endereços do serviço externo (principal + adicionais)
          serviceAddresses: payload.serviceAddresses ? (payload.serviceAddresses as Prisma.InputJsonValue) : Prisma.DbNull,
          laborSource: payload.laborSource,
          internalNotes: payload.internalNotes,
          externalNotes: payload.externalNotes,
          accessories: payload.accessories,
          condition: payload.condition,
          devicePassword: payload.devicePassword,
          droppedOffBy: payload.droppedOffBy,
          deliveryType: payload.deliveryType,
          deliveryValue: payload.deliveryValue,
          deliveryDone: payload.deliveryDone,
          totalCommission: computeCommission(payload.items),
          ...totals,
          items: {
            create: payload.items.map((item: any) => ({
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
              type: item.type,
            })),
          },
          ...(files.length
            ? { photos: { create: files.map((f) => ({ filePath: `${PUBLIC_STATICS.os}/${f.filename}` })) } }
            : {}),
        },
        include: includeOrder,
      });

      // Baixa de estoque das peças novas
      await this_decrementStock(tx, payload.items, req.user!.id, existing.id);
      return updated;
    });

    ok(res, order);
  })
);

// PUT /api/service-orders/:id/closing
// PDF p.6/7 - processo de fechamento de O.S.: forma de pagamento combinada,
// contato com cliente (aprovação/desconto) e "resumo p/ cliente"
// (gerar -> salvar -> imprimir). São passos do fechamento, não exigem senha.
serviceOrdersRouter.put(
  '/:id/closing',
  handler(async (req, res) => {
    const existing = await prisma.serviceOrder.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('Ordem de Serviço não encontrada');

    const body = req.body || {};
    const data: Prisma.ServiceOrderUpdateInput = {};
    if (body.paymentMethod !== undefined) data.paymentMethod = body.paymentMethod ? String(body.paymentMethod) : null;
    if (body.clientApproved !== undefined) data.clientApproved = typeof body.clientApproved === 'boolean' ? body.clientApproved : null;
    if (body.clientContactNotes !== undefined) data.clientContactNotes = body.clientContactNotes ? String(body.clientContactNotes) : null;
    if (body.clientSummary !== undefined) data.clientSummary = body.clientSummary ? String(body.clientSummary) : null;
    if (body.diagnosis !== undefined) data.diagnosis = body.diagnosis ? String(body.diagnosis) : null;
    if (body.solution !== undefined) data.solution = body.solution ? String(body.solution) : null;

    const order = await prisma.serviceOrder.update({ where: { id: existing.id }, data, include: includeOrder });
    ok(res, order);
  })
);

// PUT /api/service-orders/:id/status
serviceOrdersRouter.put(
  '/:id/status',
  handler(async (req, res) => {
    const { status, note } = req.body || {};
    const order = await prisma.serviceOrder.findUnique({ where: { id: req.params.id } });
    if (!order) throw notFound('Ordem de Serviço não encontrada');
    if (!status) throw badRequest('Status é obrigatório.');

    const allowed = VALID_TRANSITIONS[order.status] || [];
    if (!allowed.includes(status)) {
      throw badRequest(`Transição inválida: ${order.status} → ${status}`, 'INVALID_TRANSITION');
    }

    const now = new Date();
    const timestamps: any = {};
    if (status === 'IN_PROGRESS' && !order.startedAt) timestamps.startedAt = now;
    if (status === 'READY') timestamps.finishedAt = now;
    if (status === 'DELIVERED') timestamps.deliveredAt = now;
    if (status === 'OPEN') {
      timestamps.startedAt = null;
      timestamps.finishedAt = null;
      timestamps.deliveredAt = null;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.serviceOrder.update({
        where: { id: order.id },
        data: { status, ...timestamps },
        include: includeOrder,
      });
      await tx.osMovement.create({
        data: {
          osId: order.id,
          userId: req.user!.id,
          fromStatus: order.status,
          toStatus: status,
          note: note || null,
        },
      });
      return result;
    });

    ok(res, updated);
  })
);

// PUT /api/service-orders/:id/assign  { technicianId }
serviceOrdersRouter.put(
  '/:id/assign',
  handler(async (req, res) => {
    const { technicianId } = req.body || {};
    const order = await prisma.serviceOrder.findUnique({ where: { id: req.params.id } });
    if (!order) throw notFound('Ordem de Serviço não encontrada');

    if (technicianId) {
      const tech = await prisma.user.findUnique({ where: { id: technicianId } });
      if (!tech || !tech.active) throw badRequest('Técnico inválido ou inativo.', 'TECHNICIAN_NOT_FOUND');
    }

    const updated = await prisma.serviceOrder.update({
      where: { id: order.id },
      data: { technicianId: technicianId || null },
      include: includeOrder,
    });
    ok(res, updated);
  })
);

// POST /api/service-orders/:id/items
serviceOrdersRouter.post(
  '/:id/items',
  handler(async (req, res) => {
    const order = await prisma.serviceOrder.findUnique({ where: { id: req.params.id }, include: { items: true } });
    if (!order) throw notFound('Ordem de Serviço não encontrada');
    if (['CANCELLED'].includes(order.status)) {
      throw badRequest('Não é possível adicionar itens em uma O.S. cancelada.', 'ORDER_CLOSED');
    }
    // Briefing B1: O.S. entregue só edita com senha (admin ou vendedor)
    await assertOrderEditable(req, order);

    const [item] = parseItems([req.body]);
    if (!item) throw badRequest('Item inválido.');
    // Briefing B3: desconto por item respeita as regras do admin
    await validateItemDiscounts([item]);

    const result = await prisma.$transaction(async (tx) => {
      const created = await tx.osItem.create({
        data: {
          osId: order.id,
          partId: item.partId,
          serviceId: item.serviceId,
          name: item.name,
          qty: item.qty,
          unitPrice: item.unitPrice,
          discount: item.discount,
          discountType: item.discountType,
          total: itemNet(item),
          type: item.type,
        },
        include: { part: true, service: true },
      });

      if (item.type === 'PART' && item.partId) {
        const part = await tx.part.findUnique({ where: { id: item.partId } });
        if (!part) throw badRequest('Peça não encontrada.', 'PART_NOT_FOUND');
        if (part.quantity < item.qty) {
          throw badRequest(`Estoque insuficiente para "${part.name}". Disponível: ${part.quantity}.`, 'INSUFFICIENT_STOCK');
        }
        await tx.part.update({ where: { id: item.partId }, data: { quantity: { decrement: item.qty } } });
        await tx.stockMovement.create({
          data: {
            partId: item.partId,
            type: 'OUT',
            qty: item.qty,
            reason: `Saída para O.S. #${order.id.slice(0, 8)}`,
            userId: req.user!.id,
          },
        });
      }

      const allItems = [...order.items, { ...item, qty: item.qty, unitPrice: item.unitPrice }];
      const totals = computeTotals(allItems, order.laborHours, order.laborRate);
      await tx.serviceOrder.update({ where: { id: order.id }, data: totals });

      return created;
    });

    created(res, result);
  })
);

// DELETE /api/service-orders/:id/items/:itemId
serviceOrdersRouter.delete(
  '/:id/items/:itemId',
  handler(async (req, res) => {
    const order = await prisma.serviceOrder.findUnique({ where: { id: req.params.id }, include: { items: true } });
    if (!order) throw notFound('Ordem de Serviço não encontrada');
    // Briefing B1/B3: remover item de O.S. entregue exige senha (admin/vendedor)
    await assertOrderEditable(req, order);

    const item = await prisma.osItem.findUnique({ where: { id: req.params.itemId } });
    if (!item || item.osId !== order.id) throw notFound('Item não encontrado');

    const result = await prisma.$transaction(async (tx) => {
      await tx.osItem.delete({ where: { id: item.id } });

      if (item.type === 'PART' && item.partId) {
        await tx.part.update({ where: { id: item.partId }, data: { quantity: { increment: item.qty } } });
        await tx.stockMovement.create({
          data: {
            partId: item.partId,
            type: 'IN',
            qty: item.qty,
            reason: 'Devolução - item removido da O.S.',
            userId: req.user!.id,
          },
        });
      }

      const remaining = order.items.filter((i) => i.id !== item.id);
      const totals = computeTotals(remaining, order.laborHours, order.laborRate);
      return tx.serviceOrder.update({ where: { id: order.id }, data: totals, include: includeOrder });
    });

    ok(res, result);
  })
);

// POST /api/service-orders/:id/photos
serviceOrdersRouter.post(
  '/:id/photos',
  uploadOsPhotos.single('photo'),
  handler(async (req, res) => {
    const order = await prisma.serviceOrder.findUnique({ where: { id: req.params.id } });
    if (!order) {
      if (req.file) removeUploadedFile(`${PUBLIC_STATICS.os}/${req.file.filename}`);
      throw notFound('Ordem de Serviço não encontrada');
    }
    if (!req.file) throw badRequest('Nenhum arquivo enviado (campo "photo").');

    const photo = await prisma.osPhoto.create({
      data: {
        osId: order.id,
        filePath: `${PUBLIC_STATICS.os}/${req.file.filename}`,
        caption: req.body?.caption ? String(req.body.caption) : null,
      },
    });
    created(res, photo);
  })
);

// DELETE /api/service-orders/photos/:photoId
serviceOrdersRouter.delete(
  '/photos/:photoId',
  handler(async (req, res) => {
    const photo = await prisma.osPhoto.findUnique({ where: { id: req.params.photoId } });
    if (!photo) throw notFound('Foto não encontrada');
    removeUploadedFile(photo.filePath);
    await prisma.osPhoto.delete({ where: { id: photo.id } });
    ok(res, { message: 'Foto removida' });
  })
);

// DELETE /api/service-orders/:id
serviceOrdersRouter.delete(
  '/:id',
  handler(async (req, res) => {
    const order = await prisma.serviceOrder.findUnique({
      where: { id: req.params.id },
      include: { photos: true, items: true },
    });
    if (!order) throw notFound('Ordem de Serviço não encontrada');
    if (order.status !== 'OPEN') {
      throw badRequest('Apenas O.S. em aberto (não iniciadas) podem ser excluídas.', 'INVALID_STATUS');
    }

    await prisma.$transaction(async (tx) => {
      // Devolve estoque das peças reservadas
      for (const item of order.items) {
        if (item.type === 'PART' && item.partId) {
          await tx.part.update({ where: { id: item.partId }, data: { quantity: { increment: item.qty } } });
          await tx.stockMovement.create({
            data: {
              partId: item.partId,
              type: 'IN',
              qty: item.qty,
              reason: 'Devolução - O.S. excluída',
              userId: req.user!.id,
            },
          });
        }
      }
      await tx.serviceOrder.delete({ where: { id: order.id } });
    });

    for (const photo of order.photos) removeUploadedFile(photo.filePath);

    ok(res, { message: 'Ordem de Serviço excluída' });
  })
);

// GET /api/service-orders/photo/:photoId - serve a foto
serviceOrdersRouter.get(
  '/photo/:photoId',
  handler(async (req, res) => {
    const photo = await prisma.osPhoto.findUnique({ where: { id: req.params.photoId } });
    if (!photo) throw notFound('Foto não encontrada');
    const full = resolveUploadPath(photo.filePath);
    if (!existsSync(full)) throw notFound('Arquivo não existe mais no disco');
    res.sendFile(full);
  })
);

// ---------------------------------------------------------------------------
// Briefing B1: valida a senha de destravamento ANTES de editar a entregue
// ---------------------------------------------------------------------------
serviceOrdersRouter.post(
  '/:id/unlock',
  handler(async (req, res) => {
    const order = await prisma.serviceOrder.findUnique({ where: { id: req.params.id } });
    if (!order) throw notFound('Ordem de Serviço não encontrada');
    if (order.status !== 'DELIVERED' && order.status !== 'READY') {
      ok(res, { unlocked: true, required: false });
      return;
    }
    await assertOrderEditable(req, { status: order.status });
    ok(res, { unlocked: true, required: true });
  })
);

// ---------------------------------------------------------------------------
// Briefing B2: observacoes em tempo real (sem trocar o status da O.S.)
// ---------------------------------------------------------------------------
serviceOrdersRouter.post(
  '/:id/notes',
  handler(async (req, res) => {
    const order = await prisma.serviceOrder.findUnique({ where: { id: req.params.id } });
    if (!order) throw notFound('Ordem de Serviço não encontrada');
    const note = String(req.body?.note || '').trim();
    if (!note) throw badRequest('Observação é obrigatória.', 'NOTE_REQUIRED');
    if (note.length > 2000) throw badRequest('Observação muito longa (máx. 2000 caracteres).');
    const movement = await prisma.osMovement.create({
      data: { osId: order.id, userId: req.user!.id, fromStatus: order.status, toStatus: order.status, note },
      include: { user: { select: { id: true, name: true } } },
    });
    created(res, movement);
  })
);

// ---------------------------------------------------------------------------
// Briefing B8: checklist da O.S. (montado dos servicos na criacao)
// ---------------------------------------------------------------------------
serviceOrdersRouter.put(
  '/:id/checklist',
  handler(async (req, res) => {
    const order = await prisma.serviceOrder.findUnique({ where: { id: req.params.id } });
    if (!order) throw notFound('Ordem de Serviço não encontrada');
    const raw = req.body?.checklist;
    if (!Array.isArray(raw)) throw badRequest('Checklist inválido.');
    const checklist = raw
      .map((c: any) => ({ label: String(c?.label || '').trim(), done: c?.done === true }))
      .filter((c) => c.label);
    const updated = await prisma.serviceOrder.update({
      where: { id: order.id },
      data: { checklist: checklist as Prisma.InputJsonValue },
      include: includeOrder,
    });
    ok(res, updated);
  })
);

// ---------------------------------------------------------------------------
// Briefing B6: token p/ camera do celular (upload sem sessao)
// ---------------------------------------------------------------------------
function photoTokenSecret() {
  return process.env.JWT_SECRET || 'papatec-photo-secret';
}

function signPhotoToken(osId: string, exp: number) {
  const mac = crypto.createHmac('sha256', photoTokenSecret()).update(`${osId}:${exp}`).digest('hex');
  return `${exp}.${mac}`;
}

function verifyPhotoToken(osId: string, token: string) {
  const [expStr, mac] = String(token || '').split('.');
  const exp = Number(expStr);
  if (!exp || !mac || Date.now() > exp) return false;
  const expect = crypto.createHmac('sha256', photoTokenSecret()).update(`${osId}:${exp}`).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(mac, 'hex'), Buffer.from(expect, 'hex'));
  } catch {
    return false;
  }
}

serviceOrdersRouter.post(
  '/:id/photos/token',
  handler(async (req, res) => {
    const order = await prisma.serviceOrder.findUnique({ where: { id: req.params.id } });
    if (!order) throw notFound('Ordem de Serviço não encontrada');
    const exp = Date.now() + 15 * 60 * 1000;
    ok(res, { token: signPhotoToken(order.id, exp), expiresAt: new Date(exp).toISOString() });
  })
);

// Upload sem sessao (celular escaneia o QR): validado apenas pelo token HMAC.
export const osMobileRouter = Router();

osMobileRouter.post(
  '/:id/photos',
  uploadOsPhotos.single('photo'),
  handler(async (req, res) => {
    const token = String(req.query.token || '');
    const order = await prisma.serviceOrder.findUnique({ where: { id: req.params.id } });
    if (!order || !token || !verifyPhotoToken(order.id, token)) {
      if (req.file) removeUploadedFile(`${PUBLIC_STATICS.os}/${req.file.filename}`);
      throw badRequest('Link inválido ou expirado.', 'INVALID_PHOTO_TOKEN');
    }
    if (!req.file) throw badRequest('Nenhum arquivo enviado (campo "photo").');
    const photo = await prisma.osPhoto.create({
      data: {
        osId: order.id,
        filePath: `${PUBLIC_STATICS.os}/${req.file.filename}`,
        caption: req.body?.caption ? String(req.body.caption) : 'Celular',
      },
    });
    created(res, photo);
  })
);





