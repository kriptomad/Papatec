import { Router, Request, Response } from 'express';
import { prisma } from '../db/prisma';
import { requireAuth, requireRole } from '../middleware/auth';
import { handler } from '../http/errors';
import { ok, created, notFound, badRequest } from '../http/envelope';
// B3/A1: mesmo teto de desconto aplicado em O.S. e orçamento. Vendas era o
// único módulo que NÃO validava — deixava passar desconto acima do configurado.
import { assertDiscountAllowed } from '../utils/discounts';
import { Prisma } from '@prisma/client';

export const salesRouter = Router();

// Helper: gerar próximo código VDA-XXXX
async function nextSaleCode(tx: Prisma.TransactionClient): Promise<string> {
  const seq = await tx.sequence.upsert({
    where: { key: 'sale' },
    create: { key: 'sale', value: 1 },
    update: { value: { increment: 1 } },
  });
  return `VDA-${String(seq.value).padStart(4, '0')}`;
}

/**
 * B3/A1: valida o desconto de cada item e o desconto geral da venda.
 *
 * Mesmo teto aplicado em O.S. e orçamento (`max_discount_pct` + teto da peça).
 * Vendas era o único módulo que não chamava `assertDiscountAllowed`, então o
 * sistema aceitava desconto maior do que o configurado nas Configurações.
 *
 * Executa ANTES de abrir a transação, para não deixar estado meio escrito.
 */
async function assertSaleDiscountsAllowed(
  items: any[],
  saleDiscount: any,
  saleDiscountType: any,
): Promise<void> {
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const lineTotal = (Number(item.qty) || 0) * (Number(item.unitPrice) || 0);
    await assertDiscountAllowed({
      partId: item.partId || null,
      base: lineTotal,
      discount: item.discount || 0,
      discountType: item.discountType || 'VALUE',
      label: item.name || item.code || `Item ${i + 1}`,
    });
  }

  const gross = items.reduce(
    (s: number, it: any) => s + (Number(it.qty) || 0) * (Number(it.unitPrice) || 0),
    0,
  );
  await assertDiscountAllowed({
    base: gross,
    discount: saleDiscount || 0,
    discountType: saleDiscountType || 'VALUE',
    label: 'Desconto geral da venda',
  });
}

// GET /api/sales?page=&limit=&clientId=&userId=&startDate=&endDate=
salesRouter.get(
  '/',
  requireAuth,
  handler(async (req: Request, res: Response) => {
    const { page = '1', limit = '20', clientId, userId, startDate, endDate, saleType, search } = req.query as Record<string, string>;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = {};
    if (clientId) where.clientId = clientId;
    if (userId) where.userId = userId;
    if (saleType) where.saleType = saleType;
    if (search) {
      // Busca por código da venda, nome do cliente ou nome do vendedor
      where.OR = [
        { code: { contains: search, mode: 'insensitive' } },
        { client: { name: { contains: search, mode: 'insensitive' } } },
        { user: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [data, total] = await Promise.all([
      prisma.sale.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { createdAt: 'desc' },
        include: {
          client: { select: { id: true, name: true, code: true } },
          user: { select: { id: true, name: true } },
          items: { include: { part: { select: { id: true, name: true, code: true } } } },
        },
      }),
      prisma.sale.count({ where }),
    ]);
    ok(res, { data, total, page: Number(page), limit: Number(limit) });
  })
);

// GET /api/sales/:id
salesRouter.get(
  '/:id',
  requireAuth,
  handler(async (req: Request, res: Response) => {
    const sale = await prisma.sale.findUnique({
      where: { id: req.params.id },
      include: {
        client: true,
        user: { select: { id: true, name: true } },
        items: { include: { part: { select: { id: true, name: true, code: true, salePrice: true } } } },
        returns: { include: { items: true, user: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' as const } },
      },
    });
    if (!sale) throw notFound('Venda não encontrada');
    ok(res, sale);
  })
);

// POST /api/sales - criar venda de produto (RECEPTIONIST, ADMIN)
salesRouter.post(
  '/',
  requireAuth,
  requireRole('ADMIN', 'RECEPTIONIST'),
  handler(async (req: Request, res: Response) => {
    const { clientId, items, discount = 0, discountType = 'VALUE', paymentMethod, notes, saleType = 'PRODUCT_ONLY', osId, deliveryAddress, freight = 0 } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      throw badRequest('Pelo menos um item é obrigatório');
    }
    // PDF p.6: frete da venda entra no total geral
    const freightValue = Math.max(0, Number(freight) || 0);
    // Valida itens (acumula TODOS os campos faltando para o front mostrar)
    const missing: Record<string, string> = {};
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.partId && !item.name) missing[`items.${i}.name`] = 'Item precisa de produto ou descrição';
      if (!item.qty || item.qty < 1) missing[`items.${i}.qty`] = 'Quantidade inválida';
      if (item.unitPrice === undefined || item.unitPrice === null || item.unitPrice < 0) missing[`items.${i}.unitPrice`] = 'Preço inválido';
    }
    if (Object.keys(missing).length > 0) {
      throw badRequest('Itens da venda inválidos', 'VALIDATION_ERROR', missing);
    }

    // B3/A1: bloqueia desconto acima do teto configurado ANTES de transacionar
    await assertSaleDiscountsAllowed(items, discount, discountType);

    const sale = await prisma.$transaction(async (tx) => {
      const code = await nextSaleCode(tx);
      // Calcular totais e comissões
      let total = 0;
      let totalCommission = 0;
      const itemsData = items.map((item: any) => {
        const lineTotal = item.qty * item.unitPrice;
        const itemDiscount = item.discountType === 'PERCENT'
          ? (lineTotal * (item.discount || 0)) / 100
          : (item.discount || 0);
        const net = lineTotal - Math.min(itemDiscount, lineTotal);
        total += net;

        // Comissão do item
        const commType = item.commissionType || 'PERCENT';
        const commPercent = item.commissionPercent || 0;
        const commValue = item.commissionValue || 0;
        const itemCommission = commType === 'PERCENT'
          ? (net * commPercent) / 100
          : commValue;
        totalCommission += itemCommission;

        return {
          partId: item.partId,
          name: item.name,
          code: item.code,
          qty: item.qty,
          unitPrice: item.unitPrice,
          total: net,
          discount: item.discount || 0,
          discountType: item.discountType || 'VALUE',
          commissionPercent: commPercent,
          commissionValue: commValue,
          commissionType: commType,
        };
      });

      // Desconto geral da venda (frete somado após o desconto)
      const saleDiscount = discountType === 'PERCENT' ? (total * discount) / 100 : discount;
      const finalTotal = total - Math.min(saleDiscount, total) + freightValue;

      const createdSale = await tx.sale.create({
        data: {
          code,
          clientId: clientId || null,
          userId: req.user!.id,
          saleType,
          osId,
          total: finalTotal,
          discount: saleDiscount,
          discountType,
          freight: freightValue,
          paymentMethod,
          notes,
          totalCommission,
          deliveryAddress: deliveryAddress ? (deliveryAddress as Prisma.InputJsonValue) : undefined,
          items: { create: itemsData },
        },
        include: { items: true, client: true, user: true },
      });

      // Baixa de estoque + movimento com valor (histórico entradas/saídas c/ valores)
      for (const item of items) {
        if (item.partId && item.qty > 0) {
          await tx.part.update({
            where: { id: item.partId },
            data: { quantity: { decrement: item.qty } },
          });
          await tx.stockMovement.create({
            data: {
              partId: item.partId,
              type: 'OUT',
              qty: item.qty,
              reason: `Venda ${code}`,
              unitValue: item.unitPrice || 0,
              userId: req.user!.id,
            },
          });
        }
      }
      return createdSale;
    });
    created(res, sale);
  })
);

// PUT /api/sales/:id - apenas se PRODUCT_ONLY e status permite (não tem status, mas pode cancelar)
salesRouter.put(
  '/:id',
  requireAuth,
  requireRole('ADMIN', 'RECEPTIONIST'),
  handler(async (req: Request, res: Response) => {
    const existing = await prisma.sale.findUnique({ where: { id: req.params.id }, include: { items: true } });
    if (!existing) throw notFound('Venda não encontrada');
    if (existing.saleType !== 'PRODUCT_ONLY') {
      throw badRequest('Apenas vendas de produto (sem OS) podem ser editadas', 'INVALID_SALE_TYPE');
    }
    // Recria itens
    const { items, discount, discountType, paymentMethod, notes, clientId, deliveryAddress, freight } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      throw badRequest('Pelo menos um item é obrigatório');
    }
    const freightValue = Math.max(0, Number(freight) || 0);

    // B3/A1: mesmo teto de desconto da criação — a edição também validava nada
    await assertSaleDiscountsAllowed(items, discount, discountType);

    const sale = await prisma.$transaction(async (tx) => {
      // Devolve estoque dos itens antigos (serão recriados)
      for (const old of existing.items) {
        if (old.partId && old.qty > 0) {
          await tx.part.update({
            where: { id: old.partId },
            data: { quantity: { increment: old.qty } },
          });
        }
      }
      await tx.saleItem.deleteMany({ where: { saleId: existing.id } });

      let total = 0;
      let totalCommission = 0;
      const itemsData = items.map((item: any) => {
        const lineTotal = item.qty * item.unitPrice;
        const itemDiscount = item.discountType === 'PERCENT'
          ? (lineTotal * (item.discount || 0)) / 100
          : (item.discount || 0);
        const net = lineTotal - Math.min(itemDiscount, lineTotal);
        total += net;

        const commType = item.commissionType || 'PERCENT';
        const commPercent = item.commissionPercent || 0;
        const commValue = item.commissionValue || 0;
        const itemCommission = commType === 'PERCENT'
          ? (net * commPercent) / 100
          : commValue;
        totalCommission += itemCommission;

        return {
          partId: item.partId,
          name: item.name,
          code: item.code,
          qty: item.qty,
          unitPrice: item.unitPrice,
          total: net,
          discount: item.discount || 0,
          discountType: item.discountType || 'VALUE',
          commissionPercent: commPercent,
          commissionValue: commValue,
          commissionType: commType,
        };
      });

      const saleDiscount = discountType === 'PERCENT' ? (total * (discount || 0)) / 100 : (discount || 0);
      const finalTotal = total - Math.min(saleDiscount, total) + freightValue;

      const updated = await tx.sale.update({
        where: { id: existing.id },
        data: {
          clientId: clientId || null,
          total: finalTotal,
          discount: saleDiscount,
          discountType: discountType || 'VALUE',
          freight: freightValue,
          paymentMethod,
          notes,
          totalCommission,
          deliveryAddress: deliveryAddress !== undefined
            ? (deliveryAddress as Prisma.InputJsonValue)
            : undefined,
          items: { create: itemsData },
        },
        include: { items: true, client: true, user: true },
      });

      // Baixa de estoque dos itens novos
      for (const item of items) {
        if (item.partId && item.qty > 0) {
          await tx.part.update({
            where: { id: item.partId },
            data: { quantity: { decrement: item.qty } },
          });
          await tx.stockMovement.create({
            data: {
              partId: item.partId,
              type: 'OUT',
              qty: item.qty,
              reason: `Venda ${updated.code || updated.id} (edição)`,
              unitValue: item.unitPrice || 0,
              userId: req.user!.id,
            },
          });
        }
      }
      return updated;
    });
    ok(res, sale);
  })
);

// DELETE /api/sales/:id - apenas ADMIN, e devolve estoque
salesRouter.delete(
  '/:id',
  requireAuth,
  requireRole('ADMIN'),
  handler(async (req: Request, res: Response) => {
    const sale = await prisma.sale.findUnique({ where: { id: req.params.id }, include: { items: true } });
    if (!sale) throw notFound('Venda não encontrada');

    await prisma.$transaction(async (tx) => {
      // Devolver estoque
      for (const item of sale.items) {
        if (item.partId) {
          await tx.part.update({ where: { id: item.partId }, data: { quantity: { increment: item.qty } } });
          await tx.stockMovement.create({
            data: {
              partId: item.partId,
              type: 'IN',
              qty: item.qty,
              reason: 'Devolução - Venda excluída',
              userId: req.user!.id,
            },
          });
        }
      }
      await tx.sale.delete({ where: { id: sale.id } });
    });
    ok(res, { message: 'Venda excluída e estoque devolvido' });
  })
);

// POST /api/sales/from-os/:osId - converter OS entregue em venda (nota de venda)
salesRouter.post(
  '/from-os/:osId',
  requireAuth,
  requireRole('ADMIN', 'RECEPTIONIST'),
  handler(async (req: Request, res: Response) => {
    const os = await prisma.serviceOrder.findUnique({
      where: { id: req.params.osId },
      include: { items: { include: { part: true } }, client: true },
    });
    if (!os) throw notFound('O.S. não encontrada');
    if (os.status !== 'DELIVERED') {
      throw badRequest('Apenas O.S. entregues podem gerar nota de venda', 'INVALID_STATUS');
    }
    // Verifica se já existe venda desta OS
    const existing = await prisma.sale.findFirst({ where: { osId: os.id } });
    if (existing) throw badRequest('Já existe nota de venda para esta O.S.', 'ALREADY_EXISTS');

    const sale = await prisma.$transaction(async (tx) => {
      const code = await nextSaleCode(tx);
      const itemsData = os.items.map(item => {
        const lineTotal = item.qty * item.unitPrice;
        const itemDiscount = item.discountType === 'PERCENT'
          ? (lineTotal * (item.discount || 0)) / 100
          : (item.discount || 0);
        const net = lineTotal - Math.min(itemDiscount, lineTotal);
        // Comissão padrão do item (pega do produto ou 0)
        const commPercent = item.part?.commissionPercent || 0;
        const itemCommission = (net * commPercent) / 100;
        return {
          partId: item.partId,
          name: item.name,
          code: item.part?.code,
          qty: item.qty,
          unitPrice: item.unitPrice,
          total: net,
          discount: item.discount || 0,
          discountType: item.discountType || 'VALUE',
          commissionPercent: commPercent,
          commissionValue: 0,
          commissionType: 'PERCENT',
        };
      });
      const total = itemsData.reduce((s, i) => s + i.total, 0);
      const totalCommission = itemsData.reduce((s, i) => {
        const itemComm = i.commissionType === 'PERCENT'
          ? (i.total * i.commissionPercent) / 100
          : i.commissionValue;
        return s + itemComm;
      }, 0);

      return tx.sale.create({
        data: {
          code,
          clientId: os.clientId,
          userId: req.user!.id,
          saleType: 'FROM_OS',
          osId: os.id,
          total,
          discount: 0,
          discountType: 'VALUE',
          totalCommission,
          items: { create: itemsData },
        },
        include: { items: true, client: true, user: true },
      });
    });
    created(res, sale);
  })
);

// ---------------------------------------------------------------------------
// Briefing: DEVOLUCAO / TROCA - gera um DOCUMENTO com observacoes e devolve
// estoque. Fica vinculado a venda.
// ---------------------------------------------------------------------------

async function nextReturnCode(tx: Prisma.TransactionClient): Promise<string> {
  const seq = await tx.sequence.upsert({
    where: { key: 'sale_return' },
    create: { key: 'sale_return', value: 1 },
    update: { value: { increment: 1 } },
  });
  return 'DEV-' + String(seq.value).padStart(4, '0');
}

// GET /api/sales/:id/returns - documentos de devolucao/troca da venda
salesRouter.get(
  '/:id/returns',
  requireAuth,
  handler(async (req: Request, res: Response) => {
    const sale = await prisma.sale.findUnique({ where: { id: req.params.id } });
    if (!sale) throw notFound('Venda nao encontrada');
    const returns = await prisma.saleReturn.findMany({
      where: { saleId: sale.id },
      orderBy: { createdAt: 'desc' },
      include: { items: true, user: { select: { id: true, name: true } } },
    });
    ok(res, returns);
  })
);

// POST /api/sales/:id/returns - cria documento de devolucao/troca
salesRouter.post(
  '/:id/returns',
  requireAuth,
  requireRole('ADMIN', 'RECEPTIONIST'),
  handler(async (req: Request, res: Response) => {
    const sale = await prisma.sale.findUnique({
      where: { id: req.params.id },
      include: { items: true },
    });
    if (!sale) throw notFound('Venda nao encontrada');

    const { type = 'RETURN', items, reason, notes } = req.body;
    const missing: Record<string, string> = {};
    if (!type || !['RETURN', 'EXCHANGE'].includes(type)) missing.type = 'Tipo invalido (RETURN ou EXCHANGE)';
    if (!items || !Array.isArray(items) || items.length === 0) {
      missing.items = 'Selecione ao menos um item para devolver';
    } else {
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const orig = sale.items.find((s) => s.id === it.saleItemId);
        if (!orig) missing['items.' + i + '.saleItemId'] = 'Item nao pertence a esta venda';
        else if (!it.qty || it.qty < 1 || it.qty > orig.qty) {
          missing['items.' + i + '.qty'] = 'Quantidade invalida (max ' + orig.qty + ')';
        }
      }
    }
    if (Object.keys(missing).length > 0) {
      throw badRequest('Dados invalidos para devolucao', 'VALIDATION_ERROR', missing);
    }

    const doc = await prisma.$transaction(async (tx) => {
      const code = await nextReturnCode(tx);
      let total = 0;
      const itemsData = items.map((it: any) => {
        const orig = sale.items.find((s) => s.id === it.saleItemId)!;
        total += it.qty * orig.unitPrice;
        return {
          saleItemId: orig.id,
          partId: orig.partId,
          name: orig.name,
          qty: it.qty,
          unitPrice: orig.unitPrice,
          total: it.qty * orig.unitPrice,
        };
      });

      const createdDoc = await tx.saleReturn.create({
        data: {
          code,
          saleId: sale.id,
          type,
          reason: reason || null,
          notes: notes || null,
          total,
          userId: req.user!.id,
          items: { create: itemsData },
        },
        include: { items: true, user: { select: { id: true, name: true } } },
      });

      // Restaura estoque dos itens devolvidos
      for (const it of itemsData) {
        if (it.partId && it.qty > 0) {
          await tx.part.update({
            where: { id: it.partId },
            data: { quantity: { increment: it.qty } },
          });
          await tx.stockMovement.create({
            data: {
              partId: it.partId,
              type: 'IN',
              qty: it.qty,
              reason: (type === 'EXCHANGE' ? 'Troca ' : 'Devolucao ') + code + ' - Venda ' + (sale.code || sale.id),
              unitValue: it.unitPrice,
              userId: req.user!.id,
            },
          });
        }
      }
      return createdDoc;
    });

    created(res, doc);
  })
);