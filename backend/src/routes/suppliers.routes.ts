import { Router } from 'express';
import { prisma } from '../db/prisma';
import { ok, created, badRequest, notFound } from '../http/envelope';
import { handler } from '../http/errors';
import { requireAuth } from '../middleware/auth';
import { nextSequence, formatCode } from '../utils/codes';

// ---------------------------------------------------------------------------
// Fornecedores (PDF p.2) - espelho do cadastro de Cliente, com histórico de
// compras no detalhe e pesquisa por CPF/CNPJ na listagem.
// ---------------------------------------------------------------------------

export const suppliersRouter = Router();

suppliersRouter.use(requireAuth);

function pagination(query: any) {
  const pageSize = Math.max(1, Math.min(500, Number(query.limit ?? query.take) || 20));
  const page = Math.max(1, Number(query.page) || 1);
  const skip = query.skip !== undefined && query.skip !== '' ? Number(query.skip) : (page - 1) * pageSize;
  const take = query.take !== undefined && query.take !== '' ? Number(query.take) : pageSize;
  return { page, pageSize, skip, take };
}

const str = (v: any) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim());

function validate(data: any) {
  const name = String(data?.name || '').trim();
  if (!name) throw badRequest('Nome do fornecedor é obrigatório.');

  return {
    name,
    type: data.type === 'PJ' ? ('PJ' as const) : ('PF' as const),
    active: typeof data.active === 'boolean' ? data.active : undefined,
    // Contato: responsável pelo contato (PDF p.2)
    contact: str(data.contact),
    phone: str(data.phone),
    ramal: str(data.ramal),
    email: str(data.email),
    site: str(data.site),
    // Endereço (Rua/Av., Número, Complemento, Bairro, CEP, Cidade, Estado)
    street: str(data.street),
    number: str(data.number),
    complement: str(data.complement),
    district: str(data.district),
    zip: str(data.zip),
    city: str(data.city),
    state: str(data.state),
    // Documentos (Físico: RG/CPF - Jurídico: CNPJ/IE/IM)
    cpf: str(data.cpf),
    rg: str(data.rg),
    cnpj: str(data.cnpj),
    ie: str(data.ie),
    im: str(data.im),
    notes: str(data.notes),
  };
}

async function assertNoDuplicateDoc(cpf: string | null, cnpj: string | null, id?: string) {
  if (cpf) {
    const dup = await prisma.supplier.findUnique({ where: { cpf } });
    if (dup && dup.id !== id) throw badRequest('Já existe um fornecedor com este CPF/documento.', 'DUPLICATE_CPF');
  }
  if (cnpj) {
    const dup = await prisma.supplier.findUnique({ where: { cnpj } });
    if (dup && dup.id !== id) throw badRequest('Já existe um fornecedor com este CNPJ/documento.', 'DUPLICATE_CNPJ');
  }
}

// GET /api/suppliers/options - lista enxuta para o seletor da tela de Compra
suppliersRouter.get(
  '/options',
  handler(async (_req, res) => {
    const rows = await prisma.supplier.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
      select: { id: true, code: true, name: true, type: true },
    });
    ok(res, rows);
  })
);

// GET /api/suppliers
suppliersRouter.get(
  '/',
  handler(async (req, res) => {
    const { page, pageSize, skip, take } = pagination(req.query);
    const search = String(req.query.search || '').trim();
    const active = String(req.query.active || '').trim();

    const where: any = {};
    if (search) {
      // Pesquisa por nome, código, CPF/CNPJ, contato, e-mail e telefone (PDF p.2)
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
        { cpf: { contains: search } },
        { cnpj: { contains: search } },
        { contact: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
      ];
    }
    if (active === 'true') where.active = true;
    if (active === 'false') where.active = false;

    const [data, total] = await Promise.all([
      prisma.supplier.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: { _count: { select: { purchases: true } } },
      }),
      prisma.supplier.count({ where }),
    ]);

    ok(res, { data, total, page, pageSize });
  })
);

// GET /api/suppliers/:id - detalhe com histórico de compras (PDF p.2)
suppliersRouter.get(
  '/:id',
  handler(async (req, res) => {
    const supplier = await prisma.supplier.findUnique({
      where: { id: req.params.id },
      include: {
        _count: { select: { purchases: true } },
        purchases: {
          orderBy: { purchaseDate: 'desc' },
          include: { items: true, user: { select: { id: true, name: true } } },
        },
      },
    });
    if (!supplier) throw notFound('Fornecedor não encontrado');
    ok(res, supplier);
  })
);

// POST /api/suppliers
suppliersRouter.post(
  '/',
  handler(async (req, res) => {
    const data = validate(req.body);
    await assertNoDuplicateDoc(data.cpf, data.cnpj);

    const supplier = await prisma.$transaction(async (tx) => {
      const code = formatCode('FOR', await nextSequence(tx, 'supplier'));
      return tx.supplier.create({ data: { ...data, code } });
    });

    created(res, supplier);
  })
);

// PUT /api/suppliers/:id
suppliersRouter.put(
  '/:id',
  handler(async (req, res) => {
    const existing = await prisma.supplier.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('Fornecedor não encontrado');

    const data = validate({ ...existing, ...req.body });
    await assertNoDuplicateDoc(data.cpf, data.cnpj, existing.id);

    const supplier = await prisma.supplier.update({ where: { id: existing.id }, data });
    ok(res, supplier);
  })
);

// DELETE /api/suppliers/:id
suppliersRouter.delete(
  '/:id',
  handler(async (req, res) => {
    const existing = await prisma.supplier.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { purchases: true } } },
    });
    if (!existing) throw notFound('Fornecedor não encontrado');

    if ((existing._count?.purchases || 0) > 0) {
      throw badRequest(
        'Fornecedor possui compras registradas. Desative-o para preservar o histórico.',
        'SUPPLIER_HAS_PURCHASES'
      );
    }

    await prisma.supplier.delete({ where: { id: existing.id } });
    ok(res, { message: 'Fornecedor excluído' });
  })
);

// PUT /api/suppliers/:id/toggle-active
suppliersRouter.put(
  '/:id/toggle-active',
  handler(async (req, res) => {
    const existing = await prisma.supplier.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('Fornecedor não encontrado');
    const supplier = await prisma.supplier.update({
      where: { id: existing.id },
      data: { active: !existing.active },
    });
    ok(res, supplier);
  })
);
