import { Router } from 'express';
import { prisma } from '../db/prisma';
import { ok, created, badRequest, notFound } from '../http/envelope';
import { handler } from '../http/errors';
import { requireAuth } from '../middleware/auth';

export const partsRouter = Router();

partsRouter.use(requireAuth);

function pagination(query: any) {
  const pageSize = Math.max(1, Math.min(500, Number(query.limit ?? query.take) || 20));
  const page = Math.max(1, Number(query.page) || 1);
  const skip = query.skip !== undefined && query.skip !== '' ? Number(query.skip) : (page - 1) * pageSize;
  const take = query.take !== undefined && query.take !== '' ? Number(query.take) : pageSize;
  return { page, pageSize, skip, take };
}

function validate(data: any) {
  const code = String(data?.code || '').trim().toUpperCase();
  const name = String(data?.name || '').trim();
  if (!code) throw badRequest('Código (SKU) é obrigatório.');
  if (!name) throw badRequest('Nome da peça é obrigatório.');

  const numberOr = (v: any, fallback = 0) => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? fallback : Number(v));

  return {
    code,
    name,
    description: data.description ? String(data.description).trim() : null,
    category: data.category ? String(data.category).trim() : null,
    unit: data.unit ? String(data.unit).trim() : 'UN',
    costPrice: numberOr(data.costPrice),
    salePrice: numberOr(data.salePrice),
    minStock: Math.max(0, Math.trunc(numberOr(data.minStock, 1))),
    quantity: Math.max(0, Math.trunc(numberOr(data.quantity, 0))),
    status: data.status === 'INACTIVE' ? ('INACTIVE' as const) : ('ACTIVE' as const),
    // PDF p.3: Tipo (Novo/Usado/Digital), NCM e % de comissão específica
    productType:
      data.productType === 'NEW' || data.productType === 'USED' || data.productType === 'DIGITAL'
        ? (data.productType as 'NEW' | 'USED' | 'DIGITAL')
        : null,
    ncm: data.ncm ? String(data.ncm).trim() : null,
    commissionPercent:
      data.commissionPercent === '' || data.commissionPercent === null || data.commissionPercent === undefined
        ? null
        : Number.isNaN(Number(data.commissionPercent))
          ? null
          : Math.max(0, Number(data.commissionPercent)),
    // Briefing A: fabricante/características (busca) e limite de desconto por item
    manufacturer: data.manufacturer ? String(data.manufacturer).trim() : null,
    characteristics: data.characteristics ? String(data.characteristics).trim() : null,
    maxDiscountPercent: nullablePercent(data.maxDiscountPercent),
    maxDiscountValue: nullableNonNegative(data.maxDiscountValue),
    // Briefing A3: item pode ficar fora do alerta de reposição
    alertEnabled: data.alertEnabled === false || data.alertEnabled === 'false' ? false : true,
    // Briefing: código de barra (SKU) para busca/leitura
    barcode: data.barcode ? String(data.barcode).trim() : null,
    supplier: data.supplier ? String(data.supplier).trim() : null,
    location: data.location ? String(data.location).trim() : null,
  };
}

function nullablePercent(v: any): number | null {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  if (Number.isNaN(n)) return null;
  if (n < 0 || n > 100) throw badRequest('Desconto máximo em % deve estar entre 0 e 100.', 'INVALID_DISCOUNT_LIMIT');
  return n;
}

function nullableNonNegative(v: any): number | null {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  if (Number.isNaN(n)) return null;
  if (n < 0) throw badRequest('Desconto máximo não pode ser negativo.', 'INVALID_DISCOUNT_LIMIT');
  return n;
}

// GET /api/inventory/stats
partsRouter.get(
  '/stats',
  handler(async (_req, res) => {
    const [total, active, inactive, sum] = await Promise.all([
      prisma.part.count(),
      prisma.part.count({ where: { status: 'ACTIVE' } }),
      prisma.part.count({ where: { status: 'INACTIVE' } }),
      prisma.part.aggregate({ _sum: { quantity: true } }),
    ]);
    const lowStockResult = await prisma.$queryRawUnsafe<{ count: number }[]>(`SELECT COUNT(*)::int FROM "parts" WHERE "status" = 'ACTIVE' AND "alert_enabled" = true AND "quantity" <= "min_stock"`);
    const lowStock = Number(lowStockResult[0]?.count || 0);

    const valuation = await prisma.part.aggregate({
      where: { status: 'ACTIVE' },
      _sum: { quantity: true, costPrice: true, salePrice: true },
    });

    const costValue = await prisma.part
      .findMany({ where: { status: 'ACTIVE' }, select: { quantity: true, costPrice: true, salePrice: true } })
      .then((rows) =>
        rows.reduce(
          (acc, r) => ({
            cost: acc.cost + r.quantity * r.costPrice,
            sale: acc.sale + r.quantity * r.salePrice,
          }),
          { cost: 0, sale: 0 }
        )
      );

    ok(res, {
      total,
      active,
      inactive,
      lowStock,
      totalItems: sum._sum.quantity || 0,
      valuation: {
        costValue: costValue.cost,
        saleValue: costValue.sale,
        potentialProfit: costValue.sale - costValue.cost,
        itemsValued: valuation._sum.quantity || 0,
      },
    });
  })
);

// GET /api/inventory/low-stock
partsRouter.get(
  '/low-stock',
  handler(async (_req, res) => {
    const items = await prisma.part.findMany({
      where: { status: 'ACTIVE', alertEnabled: true, quantity: { lte: prisma.part.fields.minStock } },
      orderBy: { quantity: 'asc' },
    });
    ok(res, items);
  })
);

// GET /api/inventory/categories
partsRouter.get(
  '/categories',
  handler(async (_req, res) => {
    const rows = await prisma.part.findMany({
      where: { category: { not: null } },
      distinct: ['category'],
      select: { category: true },
      orderBy: { category: 'asc' },
    });
    ok(res, rows.map((r) => r.category).filter(Boolean));
  })
);

// GET /api/inventory
partsRouter.get(
  '/',
  handler(async (req, res) => {
    const { page, pageSize, skip, take } = pagination(req.query);
    const search = String(req.query.search || '').trim();
    const category = String(req.query.category || '').trim();
    const status = String(req.query.status || '').trim();
    const lowStock = req.query.lowStock === 'true';

    const where: any = {};
    if (search) {
      // Briefing A2: busca por código, nome, descrição, categoria, NCM,
      // fabricante e características (ex.: "placa de vídeo", "processador")
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
        { barcode: { contains: search } },
        { description: { contains: search, mode: 'insensitive' } },
        { category: { contains: search, mode: 'insensitive' } },
        { ncm: { contains: search } },
        { manufacturer: { contains: search, mode: 'insensitive' } },
        { characteristics: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (category) where.category = category;
    if (status === 'ACTIVE' || status === 'INACTIVE') where.status = status;
    if (lowStock) {
      where.alertEnabled = true;
      where.quantity = { lte: prisma.part.fields.minStock };
    }

    const [rows, total] = await Promise.all([
      prisma.part.findMany({
        where,
        orderBy: { name: 'asc' },
        skip,
        take,
        include: { _count: { select: { movements: true } } },
      }),
      prisma.part.count({ where }),
    ]);

    const data = rows.map((p) => ({ ...p, needsRestock: p.alertEnabled && p.quantity <= p.minStock }));
    ok(res, { data, total, page, pageSize });
  })
);

// GET /api/inventory/:id
partsRouter.get(
  '/:id',
  handler(async (req, res) => {
    const part = await prisma.part.findUnique({
      where: { id: req.params.id },
      include: {
        _count: { select: { movements: true } },
        movements: { orderBy: { createdAt: 'desc' }, take: 30, include: { user: { select: { id: true, name: true } } } },
      },
    });
    if (!part) throw notFound('Peça não encontrada');
    ok(res, { ...part, needsRestock: part.alertEnabled && part.quantity <= part.minStock });
  })
);

// GET /api/inventory/:id/movements
partsRouter.get(
  '/:id/movements',
  handler(async (req, res) => {
    const { page, pageSize, skip, take } = pagination(req.query);
    const where = { partId: req.params.id };
    const [data, total] = await Promise.all([
      prisma.stockMovement.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: { user: { select: { id: true, name: true } } },
      }),
      prisma.stockMovement.count({ where }),
    ]);
    ok(res, { data, total, page, pageSize });
  })
);

// POST /api/inventory
partsRouter.post(
  '/',
  handler(async (req, res) => {
    const data = validate(req.body);
    const dup = await prisma.part.findUnique({ where: { code: data.code } });
    if (dup) throw badRequest(`Código "${data.code}" já cadastrado.`, 'DUPLICATE_CODE');

    const part = await prisma.$transaction(async (tx) => {
      const createdPart = await tx.part.create({ data });
      if (createdPart.quantity > 0) {
        await tx.stockMovement.create({
          data: {
            partId: createdPart.id,
            type: 'IN',
            qty: createdPart.quantity,
            reason: 'Estoque inicial',
            userId: req.user!.id,
          },
        });
      }
      return createdPart;
    });

    created(res, part);
  })
);

// PUT /api/inventory/:id
partsRouter.put(
  '/:id',
  handler(async (req, res) => {
    const existing = await prisma.part.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('Peça não encontrada');

    const data = validate({ ...existing, ...req.body });
    if (data.code !== existing.code) {
      const dup = await prisma.part.findUnique({ where: { code: data.code } });
      if (dup) throw badRequest(`Código "${data.code}" já cadastrado.`, 'DUPLICATE_CODE');
    }

    const updated = await prisma.part.update({ where: { id: existing.id }, data });
    ok(res, updated);
  })
);

// PUT /api/inventory/:id/toggle-status
partsRouter.put(
  '/:id/toggle-status',
  handler(async (req, res) => {
    const existing = await prisma.part.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('Peça não encontrada');
    const updated = await prisma.part.update({
      where: { id: existing.id },
      data: { status: existing.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' },
    });
    ok(res, updated);
  })
);

// POST /api/inventory/:id/stock  { type: IN|OUT|ADJUSTMENT, qty, reason }
partsRouter.post(
  '/:id/stock',
  handler(async (req, res) => {
    const { type, qty, reason } = req.body || {};
    const quantity = Math.trunc(Number(qty));

    if (!['IN', 'OUT', 'ADJUSTMENT'].includes(type)) {
      throw badRequest('Tipo deve ser IN, OUT ou ADJUSTMENT.', 'INVALID_MOVEMENT_TYPE');
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw badRequest('Quantidade inválida.');
    }

    const part = await prisma.part.findUnique({ where: { id: req.params.id } });
    if (!part) throw notFound('Peça não encontrada');

    const delta = type === 'IN' ? quantity : type === 'OUT' ? -quantity : quantity;
    const newQuantity = type === 'ADJUSTMENT' ? quantity : part.quantity + delta;

    if (newQuantity < 0) {
      throw badRequest(
        `Estoque insuficiente. Disponível: ${part.quantity}, solicitado: ${quantity}.`,
        'INSUFFICIENT_STOCK'
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.part.update({
        where: { id: part.id },
        data: { quantity: newQuantity },
      });
      await tx.stockMovement.create({
        data: {
          partId: part.id,
          type,
          qty: type === 'ADJUSTMENT' ? Math.abs(newQuantity - part.quantity) : quantity,
          reason: reason || `Ajuste manual (${type})`,
          userId: req.user!.id,
        },
      });
      return updated;
    });

    ok(res, result);
  })
);

// DELETE /api/inventory/:id
partsRouter.delete(
  '/:id',
  handler(async (req, res) => {
    const existing = await prisma.part.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('Peça não encontrada');

    const inUse = await prisma.budgetItem.count({ where: { partId: existing.id } });
    const inUseOs = await prisma.osItem.count({ where: { partId: existing.id } });
    if (inUse + inUseOs > 0) {
      // Desativa em vez de apagar para preservar histórico fiscal/orçamentário
      const updated = await prisma.part.update({ where: { id: existing.id }, data: { status: 'INACTIVE' } });
      return ok(res, {
        deactivated: true,
        message: 'A peça possui histórico em orçamentos/O.S. e foi desativada (preservando o histórico).',
        part: updated,
      });
    }

    await prisma.part.delete({ where: { id: existing.id } });
    ok(res, { message: 'Peça excluída' });
  })
);

// GET /api/inventory/movements/monthly - estimativa de movimentação do mês
partsRouter.get(
  '/movements/monthly',
  handler(async (req, res) => {
    const now = new Date();
    const year = Number(req.query.year) || now.getFullYear();
    const month = Number(req.query.month) || now.getMonth() + 1;
    const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
    const end = new Date(Date.UTC(year, month, 1, 0, 0, 0));

    const movements = await prisma.stockMovement.findMany({
      where: { createdAt: { gte: start, lt: end } },
      include: { part: { select: { id: true, name: true, code: true, costPrice: true, salePrice: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const entries = movements.filter((m) => m.type === 'IN');
    const exits = movements.filter((m) => m.type === 'OUT');
    const adjustments = movements.filter((m) => m.type === 'ADJUSTMENT');

    const sumQty = (list: typeof movements) => list.reduce((acc, m) => acc + m.qty, 0);

    ok(res, {
      year,
      month,
      entries: { count: entries.length, qty: sumQty(entries) },
      exits: { count: exits.length, qty: sumQty(exits) },
      adjustments: { count: adjustments.length, qty: sumQty(adjustments) },
      movements,
    });
  })
);
