import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import { ok, created, badRequest, notFound } from '../http/envelope';
import { handler } from '../http/errors';
import { requireAuth } from '../middleware/auth';
import { nextSequence, formatCode } from '../utils/codes';

// ---------------------------------------------------------------------------
// Entrada de Mercadoria / Compra (PDF p.5)
//
// POST /api/purchases registra a compra ATÔMICAMENTE (Serializable):
//   1. cria a compra + itens com código único (COM-0001);
//   2. baixa a entrada no estoque (movimento IN por item);
//   3. atualiza o custo do produto com frete + imposto - desconto
//      RATEADOS proporcionalmente ao valor de cada item (PDF p.5, melhorias).
// Se qualquer passo falhar, nada é gravado.
// ---------------------------------------------------------------------------

export const purchasesRouter = Router();

purchasesRouter.use(requireAuth);

function pagination(query: any) {
  const pageSize = Math.max(1, Math.min(500, Number(query.limit ?? query.take) || 20));
  const page = Math.max(1, Number(query.page) || 1);
  const skip = query.skip !== undefined && query.skip !== '' ? Number(query.skip) : (page - 1) * pageSize;
  const take = query.take !== undefined && query.take !== '' ? Number(query.take) : pageSize;
  return { page, pageSize, skip, take };
}

const str = (v: any) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim());
const num = (v: any) => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? 0 : Number(v));
const round2 = (v: number) => Math.round(v * 100) / 100;

interface PurchaseInput {
  supplierId: string;
  purchaseDate: Date;
  freight: number;
  tax: number;
  discountType: 'VALUE' | 'PERCENT';
  discount: number;
  paymentMethod: string | null;
  nfNumber: string | null;
  nfTransport: string | null;
  notes: string | null;
  items: { partId: string; qty: number; unitPrice: number }[];
}

function validate(body: any): PurchaseInput {
  const supplierId = String(body?.supplierId || '').trim();
  if (!supplierId) throw badRequest('Fornecedor é obrigatório.', 'SUPPLIER_REQUIRED');

  const purchaseDate = body?.purchaseDate ? new Date(body.purchaseDate) : new Date();
  if (Number.isNaN(purchaseDate.getTime())) throw badRequest('Data da compra inválida.');

  const freight = num(body?.freight);
  const tax = num(body?.tax);
  if (freight < 0) throw badRequest('Frete não pode ser negativo.');
  if (tax < 0) throw badRequest('Imposto não pode ser negativo.');

  const discountType = body?.discountType === 'PERCENT' ? ('PERCENT' as const) : ('VALUE' as const);
  const discount = num(body?.discount);
  if (discount < 0) throw badRequest('Desconto não pode ser negativo.');
  if (discountType === 'PERCENT' && discount > 100) {
    throw badRequest('Desconto percentual não pode ser maior que 100%.');
  }

  const rawItems = Array.isArray(body?.items) ? body.items : [];
  if (rawItems.length === 0) throw badRequest('Adicione pelo menos um item à compra.', 'ITEMS_REQUIRED');

  const seen = new Set<string>();
  const items = rawItems.map((it: any, i: number) => {
    const partId = String(it?.partId || '').trim();
    const qty = Math.trunc(Number(it?.qty));
    const unitPrice = Number(it?.unitPrice);
    if (!partId) throw badRequest(`Item ${i + 1}: selecione o produto.`);
    if (seen.has(partId)) throw badRequest(`Item ${i + 1}: produto duplicado na lista.`, 'DUPLICATE_ITEM');
    seen.add(partId);
    if (!Number.isFinite(qty) || qty <= 0) throw badRequest(`Item ${i + 1}: quantidade deve ser maior que zero.`);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) throw badRequest(`Item ${i + 1}: valor unitário inválido.`);
    return { partId, qty, unitPrice };
  });

  return {
    supplierId,
    purchaseDate,
    freight,
    tax,
    discountType,
    discount,
    paymentMethod: str(body?.paymentMethod),
    nfNumber: str(body?.nfNumber),
    nfTransport: str(body?.nfTransport),
    notes: str(body?.notes),
    items,
  };
}

// GET /api/purchases
purchasesRouter.get(
  '/',
  handler(async (req, res) => {
    const { page, pageSize, skip, take } = pagination(req.query);
    const search = String(req.query.search || '').trim();
    const supplierId = String(req.query.supplierId || '').trim();
    const startDate = String(req.query.startDate || '').trim();
    const endDate = String(req.query.endDate || '').trim();

    const where: any = {};
    if (search) {
      where.OR = [
        { code: { contains: search, mode: 'insensitive' } },
        { supplier: { name: { contains: search, mode: 'insensitive' } } },
        { supplier: { cnpj: { contains: search } } },
        { supplier: { cpf: { contains: search } } },
        { nfNumber: { contains: search } },
        { paymentMethod: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (supplierId) where.supplierId = supplierId;
    if (startDate || endDate) {
      where.purchaseDate = {};
      if (startDate) where.purchaseDate.gte = new Date(`${startDate}T00:00:00`);
      if (endDate) where.purchaseDate.lte = new Date(`${endDate}T23:59:59.999`);
    }

    const [data, total] = await Promise.all([
      prisma.purchase.findMany({
        where,
        orderBy: { purchaseDate: 'desc' },
        skip,
        take,
        include: {
          supplier: { select: { id: true, code: true, name: true } },
          user: { select: { id: true, name: true } },
          _count: { select: { items: true } },
        },
      }),
      prisma.purchase.count({ where }),
    ]);

    ok(res, { data, total, page, pageSize });
  })
);

// GET /api/purchases/:id
purchasesRouter.get(
  '/:id',
  handler(async (req, res) => {
    const purchase = await prisma.purchase.findUnique({
      where: { id: req.params.id },
      include: {
        supplier: true,
        user: { select: { id: true, name: true } },
        items: { include: { part: { select: { id: true, code: true, name: true, quantity: true } } } },
      },
    });
    if (!purchase) throw notFound('Compra não encontrada');
    ok(res, purchase);
  })
);

// POST /api/purchases  (ACID - Serializable)
purchasesRouter.post(
  '/',
  handler(async (req, res) => {
    const input = validate(req.body);

    const result = await prisma.$transaction(
      async (tx) => {
        // 1. Fornecedor
        const supplier = await tx.supplier.findUnique({ where: { id: input.supplierId } });
        if (!supplier) throw badRequest('Fornecedor não encontrado.', 'SUPPLIER_NOT_FOUND');
        if (!supplier.active) {
          throw badRequest(`Fornecedor "${supplier.name}" está inativo. Ative-o antes de registrar a compra.`, 'SUPPLIER_INACTIVE');
        }

        // 2. Produtos (valida TODOS antes de qualquer gravação)
        const partIds = [...new Set(input.items.map((i) => i.partId))];
        const parts = await tx.part.findMany({ where: { id: { in: partIds } } });
        const byId = new Map(parts.map((p) => [p.id, p]));
        for (const it of input.items) {
          const part = byId.get(it.partId);
          if (!part) throw badRequest('Produto selecionado não existe mais no estoque.', 'PART_NOT_FOUND');
          if (part.status === 'INACTIVE') {
            throw badRequest(`Produto "${part.name}" está inativado. Ative-o antes de comprar.`, 'PART_INACTIVE');
          }
        }

        // 3. Totais e desconto
        const itemsTotal = round2(input.items.reduce((s, it) => s + it.qty * it.unitPrice, 0));
        const discountValue = round2(
          input.discountType === 'PERCENT' ? (itemsTotal * input.discount) / 100 : input.discount
        );
        const total = round2(itemsTotal + input.freight + input.tax - discountValue);
        if (total < 0) throw badRequest('O desconto é maior que o total da compra. Ajuste os valores.', 'DISCOUNT_TOO_LARGE');

        // 4. Rateio: frete + imposto - desconto distribuídos no valor de cada item
        //    (custo individual final = PDF p.5 "distribuição automática no custo")
        const extraTotal = input.freight + input.tax - discountValue;
        const enriched = input.items.map((it) => {
          const part = byId.get(it.partId)!;
          const itemTotal = round2(it.qty * it.unitPrice);
          const share = itemsTotal > 0 ? itemTotal / itemsTotal : 0;
          const unitCost = round2(it.unitPrice + (extraTotal * share) / it.qty);
          return {
            partId: part.id,
            name: part.name,
            code: part.code,
            qty: it.qty,
            unitPrice: it.unitPrice,
            unitCost,
            total: itemTotal,
          };
        });

        // 5. Código único COM-0001 + criação da compra com itens
        const code = formatCode('COM', await nextSequence(tx, 'purchase'));
        const purchase = await tx.purchase.create({
          data: {
            code,
            supplierId: supplier.id,
            purchaseDate: input.purchaseDate,
            itemsTotal,
            freight: input.freight,
            tax: input.tax,
            discountType: input.discountType,
            discount: input.discount,
            total,
            paymentMethod: input.paymentMethod,
            nfNumber: input.nfNumber,
            nfTransport: input.nfTransport,
            notes: input.notes,
            userId: req.user!.id,
            items: { create: enriched },
          },
          include: { items: true, supplier: true },
        });

        // 6. Entrada de estoque + custo médio ponderado + movimento IN
        for (const it of enriched) {
          const part = byId.get(it.partId)!;
          const incomingValue = it.unitCost * it.qty;
          const stockValue = part.quantity * part.costPrice;
          const newQty = part.quantity + it.qty;
          const newCost = round2(newQty > 0 ? (stockValue + incomingValue) / newQty : it.unitCost);

          await tx.part.update({
            where: { id: part.id },
            data: { quantity: newQty, costPrice: newCost },
          });
          await tx.stockMovement.create({
            data: {
              partId: part.id,
              type: 'IN',
              qty: it.qty,
              reason: `Entrada de compra ${code} - ${supplier.name}`,
              unitValue: it.unitCost,
              userId: req.user!.id,
            },
          });
        }

        return purchase;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 }
    );

    created(res, result);
  })
);

// DELETE /api/purchases/:id - remoção da entrada com REVERSÃO de estoque
purchasesRouter.delete(
  '/:id',
  handler(async (req, res) => {
    const purchase = await prisma.purchase.findUnique({
      where: { id: req.params.id },
      include: { items: true, supplier: true },
    });
    if (!purchase) throw notFound('Compra não encontrada');

    await prisma.$transaction(
      async (tx) => {
        // Reverte estoque de cada item; custo NÃO é recalculado (média ponderada
        // é irreversível sem histórico completo) - o próximo ajuste/compra corrige.
        for (const item of purchase.items) {
          if (!item.partId) continue;
          const part = await tx.part.findUnique({ where: { id: item.partId } });
          if (part && part.quantity < item.qty) {
            throw badRequest(
              `Não é possível remover: "${part.name}" já saiu do estoque (disponível: ${part.quantity}, a entrada tinha ${item.qty}).`,
              'STOCK_ALREADY_USED'
            );
          }
        }
        for (const item of purchase.items) {
          if (!item.partId) continue;
          await tx.part.update({
            where: { id: item.partId },
            data: { quantity: { decrement: item.qty } },
          });
          await tx.stockMovement.create({
            data: {
              partId: item.partId,
              type: 'OUT',
              qty: item.qty,
              reason: `Reversão da compra ${purchase.code} - ${purchase.supplier.name}`,
              userId: req.user!.id,
            },
          });
        }
        await tx.purchase.delete({ where: { id: purchase.id } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 }
    );

    ok(res, { message: 'Compra removida e estoque revertido' });
  })
);
