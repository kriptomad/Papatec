import { Router } from 'express';
import { prisma } from '../db/prisma';
import { ok, created, badRequest, notFound } from '../http/envelope';
import { handler } from '../http/errors';
import { requireAuth } from '../middleware/auth';
import { nextSequence, formatCode } from '../utils/codes';

export const clientsRouter = Router();

clientsRouter.use(requireAuth);

function pagination(query: any) {
  const pageSize = Math.max(1, Math.min(500, Number(query.limit ?? query.take) || 20));
  const page = Math.max(1, Number(query.page) || 1);
  const skip = query.skip !== undefined && query.skip !== '' ? Number(query.skip) : (page - 1) * pageSize;
  const take = query.take !== undefined && query.take !== '' ? Number(query.take) : pageSize;
  return { page, pageSize, skip, take };
}

const str = (v: any) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim());

function validate(data: any, enforceDocs = true) {
  const name = String(data?.name || '').trim();
  const phone = String(data?.phone || '').trim();
  if (!name) throw badRequest('Nome do cliente é obrigatório.');
  if (!phone) throw badRequest('Telefone do cliente é obrigatório.');
  // Briefing D2: CPF obrigatório p/ Pessoa Física, CNPJ obrigatório p/ Jurídica.
  // Vale em criações e em edições que tocam em tipo/documentos (PUTs parciais,
  // como toggle de status, não são derrubados por um cadastro antigo incompleto)
  const type = data.type === 'PJ' ? ('PJ' as const) : ('PF' as const);
  const cpf = str(data.cpf);
  const cnpj = str(data.cnpj);
  if (enforceDocs) {
    if (type === 'PF' && !cpf) throw badRequest('CPF é obrigatório para Pessoa Física.', 'CPF_REQUIRED');
    if (type === 'PJ' && !cnpj) throw badRequest('CNPJ é obrigatório para Pessoa Jurídica.', 'CNPJ_REQUIRED');
  }
  return {
    name,
    phone,
    // PDF p.1: classificação PF/PJ + status ativo/inativo
    type,
    active: typeof data.active === 'boolean' ? data.active : undefined,
    ramal: str(data.ramal),
    email: str(data.email),
    site: str(data.site),
    // Endereço legado (compatibilidade)
    address: str(data.address),
    // Endereço estruturado (PDF p.1)
    street: str(data.street),
    number: str(data.number),
    complement: str(data.complement),
    district: str(data.district),
    zip: str(data.zip),
    city: str(data.city),
    state: str(data.state),
    // Documentos
    cpf,
    rg: str(data.rg),
    cnpj,
    ie: str(data.ie),
    im: str(data.im),
    // Funcionário responsável
    responsibleId: str(data.responsibleId),
    notes: str(data.notes),
  };
}

async function assertNoDuplicateDoc(cpf: string | null, cnpj: string | null, id?: string) {
  if (cpf) {
    const dup = await prisma.client.findUnique({ where: { cpf } });
    if (dup && dup.id !== id) throw badRequest('Já existe um cliente com este CPF/documento.', 'DUPLICATE_CPF');
  }
  if (cnpj) {
    const dup = await prisma.client.findUnique({ where: { cnpj } });
    if (dup && dup.id !== id) throw badRequest('Já existe um cliente com este CNPJ/documento.', 'DUPLICATE_CNPJ');
  }
}

async function assertResponsible(responsibleId: string | null) {
  if (!responsibleId) return;
  const user = await prisma.user.findUnique({ where: { id: responsibleId } });
  if (!user) throw badRequest('Funcionário responsável não encontrado.', 'RESPONSIBLE_NOT_FOUND');
}

// GET /api/clients
clientsRouter.get(
  '/',
  handler(async (req, res) => {
    const { page, pageSize, skip, take } = pagination(req.query);
    const search = String(req.query.search || '').trim();
    const hasActiveOs = req.query.hasActiveOs === 'true';
    const active = String(req.query.active || '').trim();
    const type = String(req.query.type || '').trim();

    const where: any = {};
    if (search) {
      // Pesquisa por nome, telefone, e-mail, CPF/CNPJ, RG e código único (PDF p.1)
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
        { email: { contains: search, mode: 'insensitive' } },
        { cpf: { contains: search } },
        { cnpj: { contains: search } },
        { rg: { contains: search } },
        { code: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (active === 'true') where.active = true;
    if (active === 'false') where.active = false;
    if (type === 'PF' || type === 'PJ') where.type = type;

    let data;
    let total;

    if (hasActiveOs) {
      // Clientes com O.S. em aberto
      const active = await prisma.serviceOrder.findMany({
        where: { status: { notIn: ['DELIVERED', 'CANCELLED'] } },
        select: { clientId: true },
        distinct: ['clientId'],
      });
      const ids = active.map((o) => o.clientId);
      where.id = { in: ids };
      [data, total] = await Promise.all([
        prisma.client.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take,
          include: { _count: { select: { budgets: true, serviceOrders: true } } },
        }),
        prisma.client.count({ where }),
      ]);
    } else {
      [data, total] = await Promise.all([
        prisma.client.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take,
          include: { _count: { select: { budgets: true, serviceOrders: true } } },
        }),
        prisma.client.count({ where }),
      ]);
    }

    ok(res, { data, total, page, pageSize });
  })
);

// GET /api/clients/:id
clientsRouter.get(
  '/:id',
  handler(async (req, res) => {
    const client = await prisma.client.findUnique({
      where: { id: req.params.id },
      include: {
        _count: { select: { budgets: true, serviceOrders: true, sales: true } },
        responsible: { select: { id: true, name: true } },
        // Briefing D3/D1: vários endereços e equipamentos do cliente
        addresses: { orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] },
        equipments: { orderBy: { name: 'asc' } },
      },
    });
    if (!client) throw notFound('Cliente não encontrado');
    ok(res, client);
  })
);

// GET /api/clients/:id/history
clientsRouter.get(
  '/:id/history',
  handler(async (req, res) => {
    const client = await prisma.client.findUnique({ where: { id: req.params.id } });
    if (!client) throw notFound('Cliente não encontrado');

    const [budgets, serviceOrders, sales] = await Promise.all([
      prisma.budget.findMany({
        where: { clientId: client.id },
        orderBy: { createdAt: 'desc' },
        include: { items: true, serviceOrder: { select: { id: true, osNumber: true } } },
      }),
      prisma.serviceOrder.findMany({
        where: { clientId: client.id },
        orderBy: { createdAt: 'desc' },
        include: { items: true, technician: { select: { id: true, name: true } } },
      }),
      // Briefing D: histórico de SERVIÇOS e VENDAS do cliente
      prisma.sale.findMany({
        where: { clientId: client.id },
        orderBy: { createdAt: 'desc' },
        include: { items: true, user: { select: { id: true, name: true } } },
      }),
    ]);

    ok(res, { client, budgets, serviceOrders, sales });
  })
);

// POST /api/clients
clientsRouter.post(
  '/',
  handler(async (req, res) => {
    const data = validate(req.body);
    await assertNoDuplicateDoc(data.cpf, data.cnpj);
    await assertResponsible(data.responsibleId);

    const client = await prisma.$transaction(async (tx) => {
      const code = formatCode('CLI', await nextSequence(tx, 'client'));
      return tx.client.create({ data: { ...data, code } });
    });

    created(res, client);
  })
);

// PUT /api/clients/:id
clientsRouter.put(
  '/:id',
  handler(async (req, res) => {
    const existing = await prisma.client.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('Cliente não encontrado');

    const body = req.body || {};
    const touchesDocs = 'type' in body || 'cpf' in body || 'cnpj' in body;
    const data = validate({ ...existing, ...body }, touchesDocs);
    await assertNoDuplicateDoc(data.cpf, data.cnpj, existing.id);
    await assertResponsible(data.responsibleId);

    const client = await prisma.client.update({ where: { id: existing.id }, data });
    ok(res, client);
  })
);

// DELETE /api/clients/:id
clientsRouter.delete(
  '/:id',
  handler(async (req, res) => {
    const existing = await prisma.client.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { budgets: true, serviceOrders: true } } },
    });
    if (!existing) throw notFound('Cliente não encontrado');

    const openOrders = await prisma.serviceOrder.count({
      where: { clientId: existing.id, status: { notIn: ['DELIVERED', 'CANCELLED'] } },
    });
    if (openOrders > 0) {
      throw badRequest('Cliente possui Ordens de Serviço em aberto. Cancele ou entregue-as antes de excluir.', 'CLIENT_HAS_OPEN_ORDERS');
    }

    // Orçamentos/SO do cliente são removidos em cascata pelo schema (onDelete: Cascade)
    await prisma.client.delete({ where: { id: existing.id } });
    ok(res, { message: 'Cliente excluído' });
  })
);

// ---------------------------------------------------------------------------
// Briefing D3/B.2.1: VÁRIOS endereços por cliente (dropdown no orçamento/O.S.)
// ---------------------------------------------------------------------------

async function assertClientExists(id: string) {
  const client = await prisma.client.findUnique({ where: { id } });
  if (!client) throw notFound('Cliente não encontrado');
  return client;
}

function addressData(data: any) {
  const street = String(data?.street || '').trim();
  if (!street) throw badRequest('Rua é obrigatória no endereço.', 'ADDRESS_STREET_REQUIRED');
  return {
    label: str(data.label),
    street,
    number: str(data.number),
    complement: str(data.complement),
    district: str(data.district),
    zip: str(data.zip),
    city: str(data.city),
    state: str(data.state),
    isDefault: data.isDefault === true || data.isDefault === 'true',
  };
}

// GET /api/clients/:id/addresses
clientsRouter.get(
  '/:id/addresses',
  handler(async (req, res) => {
    await assertClientExists(req.params.id);
    const list = await prisma.clientAddress.findMany({
      where: { clientId: req.params.id },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    ok(res, list);
  })
);

// POST /api/clients/:id/addresses
clientsRouter.post(
  '/:id/addresses',
  handler(async (req, res) => {
    await assertClientExists(req.params.id);
    const data = addressData(req.body);
    const addr = await prisma.$transaction(async (tx) => {
      if (data.isDefault) {
        await tx.clientAddress.updateMany({ where: { clientId: req.params.id }, data: { isDefault: false } });
      }
      return tx.clientAddress.create({ data: { ...data, clientId: req.params.id } });
    });
    created(res, addr);
  })
);

// PUT /api/clients/:id/addresses/:addrId
clientsRouter.put(
  '/:id/addresses/:addrId',
  handler(async (req, res) => {
    await assertClientExists(req.params.id);
    const existing = await prisma.clientAddress.findUnique({ where: { id: req.params.addrId } });
    if (!existing || existing.clientId !== req.params.id) throw notFound('Endereço não encontrado');
    const data = addressData(req.body);
    const addr = await prisma.$transaction(async (tx) => {
      if (data.isDefault) {
        await tx.clientAddress.updateMany({
          where: { clientId: req.params.id, id: { not: existing.id } },
          data: { isDefault: false },
        });
      }
      return tx.clientAddress.update({ where: { id: existing.id }, data });
    });
    ok(res, addr);
  })
);

// DELETE /api/clients/:id/addresses/:addrId
clientsRouter.delete(
  '/:id/addresses/:addrId',
  handler(async (req, res) => {
    await assertClientExists(req.params.id);
    const existing = await prisma.clientAddress.findUnique({ where: { id: req.params.addrId } });
    if (!existing || existing.clientId !== req.params.id) throw notFound('Endereço não encontrado');
    await prisma.clientAddress.delete({ where: { id: existing.id } });
    ok(res, { message: 'Endereço excluído' });
  })
);

// ---------------------------------------------------------------------------
// Briefing D1: equipamentos do cliente (ID único atrelado ao cliente)
// ---------------------------------------------------------------------------

function equipmentData(data: any) {
  const name = String(data?.name || '').trim();
  if (!name) throw badRequest('Nome do equipamento é obrigatório.', 'EQUIPMENT_NAME_REQUIRED');
  return {
    name,
    brand: str(data.brand),
    model: str(data.model),
    serialNumber: str(data.serialNumber),
    notes: str(data.notes),
  };
}

// GET /api/clients/:id/equipment
clientsRouter.get(
  '/:id/equipment',
  handler(async (req, res) => {
    await assertClientExists(req.params.id);
    const list = await prisma.equipment.findMany({
      where: { clientId: req.params.id },
      orderBy: { name: 'asc' },
    });
    ok(res, list);
  })
);

// POST /api/clients/:id/equipment
clientsRouter.post(
  '/:id/equipment',
  handler(async (req, res) => {
    await assertClientExists(req.params.id);
    const data = equipmentData(req.body);
    const eq = await prisma.equipment.create({ data: { ...data, clientId: req.params.id } });
    created(res, eq);
  })
);

// PUT /api/clients/:id/equipment/:eqId
clientsRouter.put(
  '/:id/equipment/:eqId',
  handler(async (req, res) => {
    await assertClientExists(req.params.id);
    const existing = await prisma.equipment.findUnique({ where: { id: req.params.eqId } });
    if (!existing || existing.clientId !== req.params.id) throw notFound('Equipamento não encontrado');
    const data = equipmentData(req.body);
    const eq = await prisma.equipment.update({ where: { id: existing.id }, data });
    ok(res, eq);
  })
);

// DELETE /api/clients/:id/equipment/:eqId
clientsRouter.delete(
  '/:id/equipment/:eqId',
  handler(async (req, res) => {
    await assertClientExists(req.params.id);
    const existing = await prisma.equipment.findUnique({ where: { id: req.params.eqId } });
    if (!existing || existing.clientId !== req.params.id) throw notFound('Equipamento não encontrado');
    await prisma.equipment.delete({ where: { id: existing.id } });
    ok(res, { message: 'Equipamento excluído' });
  })
);
